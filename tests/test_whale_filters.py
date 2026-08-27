"""鯨魚選股濾網測試 — v12.9.2 過熱過濾 + v13.0.0 止跌濾網 + 特徵記錄

回歸案例：榮科 -21.5% / 光鼎 -21.5% 都是「還在破底時」被選入的接刀股，
必須被止跌濾網擋掉；中石化 +24% 噴完後隔週再被選 → -12%，必須被過熱濾網擋掉。

註：_filter_overheated 內部呼叫 yf.download，測試以 monkeypatch 注入假價格，
    不打外部 API（穩定 + 快）。
"""
import sys
import pytest

pd = pytest.importorskip('pandas')


def _make_df(price_series_by_sym):
    """組出 yf.download(group_by='ticker') 格式的 MultiIndex DataFrame"""
    frames = {}
    for sym, closes in price_series_by_sym.items():
        frames[(sym, 'Close')] = pd.Series(closes, dtype='float64')
    df = pd.DataFrame(frames)
    df.columns = pd.MultiIndex.from_tuples(df.columns)
    return df


@pytest.fixture
def fake_yf(monkeypatch):
    """注入假的 yfinance.download；回傳 setter 讓各測試指定價格序列"""
    holder = {}

    class _FakeYF:
        @staticmethod
        def download(*args, **kwargs):
            return _make_df(holder['data'])

    def _set(data):
        holder['data'] = data
        monkeypatch.setitem(sys.modules, 'yfinance', _FakeYF)

    return _set


def _flat_then(start, moves):
    """產生價格序列：前面墊平，後面套用 moves（確保長度 >= 15 供 RSI 計算）"""
    base = [start] * (20 - len(moves))
    return base + moves


class TestOverheatedFilter:
    def test_rejects_stock_up_over_12pct_in_5d(self, tdcc, fake_yf):
        """5 日漲超過 12% → 剔除（追已噴股：中石化案例）"""
        fake_yf({'1314.TW': _flat_then(10.0, [10.0, 10.5, 11.0, 11.5, 12.0, 13.0])})
        out = tdcc._filter_overheated([{'sym': '1314.TW', 'name': '中石化'}], top_n=5)
        assert out == [], '5 日大漲的股票應被過熱濾網剔除'

    def test_keeps_mild_gain(self, tdcc, fake_yf):
        """溫和上漲（<12%）且已止跌 → 保留"""
        fake_yf({'2330.TW': _flat_then(100.0, [100.0, 101.0, 102.0, 103.0, 104.0, 105.0])})
        out = tdcc._filter_overheated([{'sym': '2330.TW', 'name': '台積電'}], top_n=5)
        assert len(out) == 1


class TestFallingKnifeFilter:
    def test_rejects_still_falling_stock(self, tdcc, fake_yf):
        """持續破底（距低點 <2% + MA5 下彎）→ 剔除（榮科/光鼎案例）"""
        fake_yf({'4989.TW': _flat_then(100.0, [95.0, 90.0, 85.0, 82.0, 80.0, 78.0])})
        out = tdcc._filter_overheated([{'sym': '4989.TW', 'name': '榮科'}], top_n=5)
        assert out == [], '仍在破底的接刀股應被止跌濾網剔除'

    def test_keeps_stock_bouncing_off_low(self, tdcc, fake_yf):
        """跌深後反彈（距低點 >2%）→ 保留（這才是要的左側買點）"""
        fake_yf({'6226.TW': _flat_then(100.0, [90.0, 82.0, 78.0, 80.0, 83.0, 85.0])})
        out = tdcc._filter_overheated([{'sym': '6226.TW', 'name': '光鼎'}], top_n=5)
        assert len(out) == 1, '已止跌反彈的股票不該被剔除'


class TestFeatureRecording:
    """v13.0.0：特徵是未來學習的燃料，必須完整記錄"""

    def test_records_all_learning_features(self, tdcc, fake_yf):
        fake_yf({'2330.TW': _flat_then(100.0, [95.0, 92.0, 90.0, 93.0, 96.0, 98.0])})
        out = tdcc._filter_overheated([{'sym': '2330.TW', 'name': '台積電'}], top_n=5)
        assert len(out) == 1
        c = out[0]
        for feat in ('price_chg_5d', 'dist_from_low5', 'ma5_slope', 'rsi14'):
            assert feat in c, f'缺少學習特徵 {feat}'
            assert isinstance(c[feat], (int, float))

    def test_dist_from_low5_is_accurate(self, tdcc, fake_yf):
        """距低點 % 計算正確性：低點 80、收 88 → +10%"""
        fake_yf({'2330.TW': _flat_then(100.0, [95.0, 90.0, 80.0, 84.0, 86.0, 88.0])})
        out = tdcc._filter_overheated([{'sym': '2330.TW', 'name': 'T'}], top_n=5)
        assert out[0]['dist_from_low5'] == pytest.approx(10.0, abs=0.1)


class TestFilterRobustness:
    def test_empty_input(self, tdcc):
        assert tdcc._filter_overheated([], top_n=5) == []

    def test_yfinance_failure_keeps_original_list(self, tdcc, monkeypatch):
        """yfinance 掛掉時要保留原名單，不能因抓不到價就全清空"""
        class _BrokenYF:
            @staticmethod
            def download(*a, **k):
                raise RuntimeError('network down')
        monkeypatch.setitem(sys.modules, 'yfinance', _BrokenYF)
        cands = [{'sym': f'{i}.TW', 'name': f'S{i}'} for i in range(8)]
        out = tdcc._filter_overheated(cands, top_n=4)
        assert len(out) == 4, 'API 失敗應降級為保留原名單前 N 檔'

    def test_respects_top_n_limit(self, tdcc, fake_yf):
        """回傳數量不得超過 top_n"""
        fake_yf({f'{i}.TW': _flat_then(100.0, [98.0, 96.0, 95.0, 97.0, 99.0, 100.0])
                 for i in range(10)})
        cands = [{'sym': f'{i}.TW', 'name': f'S{i}'} for i in range(10)]
        out = tdcc._filter_overheated(cands, top_n=3)
        assert len(out) <= 3
