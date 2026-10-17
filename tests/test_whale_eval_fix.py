"""鯨魚結算正確性 — v13.6.0

迴歸案例：
  1. 2026-10-07 那週遇國慶連假，10/12 同一次執行先用當天價補進場、又用同價結算
     → 10 檔報酬全是 0.00%，被 Phase 2 學習當成 10 筆輸。
  2. 結算用「最新價」，但晚上跑時 yfinance 常還沒更新：6658 在 10/12 結算記成
     214.5（其實是 10/8 收盤）。96 筆重新結算後有 41 筆報酬變動，平均差近 5 個百分點。
  3. 勝負用「報酬 > 0」：9/15 那週 10 檔全勝，扣大盤後只有 4/10 贏。
"""
import sys

import pandas as pd
import pytest


def _fake_yf(series_by_sym):
    """series_by_sym: {sym: [(date_str, close), ...]}；history 依 start/end 過濾"""
    class _T:
        def __init__(self, sym):
            self.sym = sym

        def history(self, start=None, end=None, period=None, auto_adjust=False):
            rows = series_by_sym.get(self.sym, [])
            if start:
                rows = [r for r in rows if r[0] >= start]
            if end:
                rows = [r for r in rows if r[0] < end]
            idx = pd.DatetimeIndex([r[0] for r in rows])
            return pd.DataFrame({'Close': [r[1] for r in rows]}, index=idx)

    class _YF:
        Ticker = _T
    return _YF


BARS = [('2026-10-07', 202.5), ('2026-10-08', 214.5), ('2026-10-12', 216.0),
        ('2026-10-13', 200.5), ('2026-10-14', 205.0), ('2026-10-15', 210.0)]


@pytest.fixture
def yfmock(snapshot, monkeypatch):
    def install(series):
        monkeypatch.setitem(sys.modules, 'yfinance', _fake_yf(series))
        snapshot._MKT_CACHE.clear()
    return install


class TestCloseOn:
    def test_取選股當天收盤_不是補價當天(self, snapshot, yfmock):
        yfmock({'6658.TW': BARS})
        assert snapshot._get_close_on('6658.TW', '2026-10-07') == 202.5

    def test_選股日休市取下一個交易日(self, snapshot, yfmock):
        yfmock({'6658.TW': BARS})
        assert snapshot._get_close_on('6658.TW', '2026-10-09') == 216.0   # 10/9~10/11 連假

    def test_取不到回None_不可退回用當下價(self, snapshot, yfmock):
        yfmock({})
        assert snapshot._get_close_on('6658.TW', '2026-10-07') is None


class TestCloseAfterNBars:
    def test_第5根K收盤與日期(self, snapshot, yfmock):
        yfmock({'6658.TW': BARS})
        assert snapshot._close_after_n_bars('6658.TW', '2026-10-07', 5) == ('2026-10-15', 210.0)

    def test_K棒不足時回None_等下次再結算(self, snapshot, yfmock):
        # 真實情境：10/12 晚上 yfinance 只更新到 10/8 → 不可拿 10/8 當出場價
        yfmock({'6658.TW': BARS[:2]})
        assert snapshot._close_after_n_bars('6658.TW', '2026-10-07', 5) is None


class TestMarketReturn:
    def test_用同一段期間計算大盤報酬(self, snapshot, yfmock):
        yfmock({'^TWII': [('2026-10-07', 49806), ('2026-10-15', 49308)]})
        assert snapshot._market_return('2026-10-07', '2026-10-15') == -1.0

    def test_取不到回None(self, snapshot, yfmock):
        yfmock({})
        assert snapshot._market_return('2026-10-07', '2026-10-15') is None


class TestLearningUsesExcess:
    def _hist(self, picks_by_week):
        return {'weeks': [{'snapshot_date': d, 'picks': ps} for d, ps in picks_by_week.items()]}

    def test_勝負以贏大盤判定(self, snapshot):
        f = {'rsi14': 60}
        h = self._hist({'2026-09-15': [
            {'return_pct': 5.0, 'excess_pct': -1.0, 'features': f},   # 漲了但輸大盤 → 輸
            {'return_pct': -2.0, 'excess_pct': 1.5, 'features': f},   # 跌了但贏大盤 → 贏
        ]})
        s = snapshot._collect_evaluated(h)
        assert [x['win'] for x in s] == [False, True]

    def test_舊資料無excess退回看絕對報酬(self, snapshot):
        h = self._hist({'2026-07-01': [{'return_pct': 3.0, 'features': {'rsi14': 50}}]})
        assert snapshot._collect_evaluated(h)[0]['win'] is True

    def test_報告標示有效週數(self, snapshot, tmp_path, monkeypatch):
        (tmp_path / 'data').mkdir()
        monkeypatch.chdir(tmp_path)
        picks = lambda: [{'return_pct': i - 2.0, 'excess_pct': i - 2.0,
                          'features': {'rsi14': 40 + i * 5}} for i in range(5)]
        h = self._hist({f'2026-09-{d:02d}': picks() for d in (1, 8, 15, 22)})
        payload, _ = snapshot._phase2_learn(snapshot._collect_evaluated(h))
        assert payload['sample_size'] == 20
        assert payload['effective_weeks'] == 4, '同週股票同漲同跌，獨立樣本≈週數'
        assert payload['win_definition'] == 'excess_vs_taiex'
