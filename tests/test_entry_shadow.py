"""影子紀錄與前瞻評估測試 — v13.3.0

背景：虛擬交易每月只成交 5~8 筆，ML 樣本累積太慢。被擋候選的後續漲跌是
      反事實標籤，必須正確 join 才有價值。這裡守住 join 的正確性與健壯性。
"""
import json
import pytest

import scripts.entry_shadow_recorder as esr


def _vday(date, prices):
    return {'date': date, 'records': {s: {'p': p} for s, p in prices.items()}}


class TestPriceIndex:
    def test_只收有效價格(self):
        days = [{'date': '2026-09-01',
                 'records': {'A.TW': {'p': 100}, 'B.TW': {'p': 0},
                             'C.TW': {'p': None}, 'D.TW': {}}}]
        idx = esr.build_price_index(days)
        assert idx['2026-09-01'] == {'A.TW': 100}

    def test_空輸入不爆(self):
        assert esr.build_price_index(None) == {}
        assert esr.build_price_index([]) == {}


class TestEvaluate:
    def _setup(self):
        # 6 個交易日，lag=5 → 只有第 0 天能對到答案（第 5 天）
        dates = ['2026-09-%02d' % d for d in (1, 2, 3, 4, 7, 8)]
        idx = esr.build_price_index([_vday(d, {'A.TW': 100 + i * 10}) for i, d in enumerate(dates)])
        shadow = [{'date': dates[0],
                   'records': {'A.TW': {'p': 100, 'blocked_by': 'individual_daily_limit_1/1'}}}]
        return shadow, idx

    def test_用第五個交易日的價格算報酬(self):
        shadow, idx = self._setup()
        assert esr.evaluate(shadow, idx) == 1
        # 第 0 天 100 → 第 5 天 150
        assert shadow[0]['records']['A.TW']['ret5'] == 50.0

    def test_不足五個交易日則不評估(self):
        shadow, idx = self._setup()
        idx = {d: v for d, v in list(idx.items())[:5]}   # 只剩 5 天
        assert esr.evaluate(shadow, idx) == 0
        assert 'ret5' not in shadow[0]['records']['A.TW']

    def test_已評估過不重算(self):
        shadow, idx = self._setup()
        shadow[0]['records']['A.TW']['ret5'] = 99.0
        assert esr.evaluate(shadow, idx) == 0
        assert shadow[0]['records']['A.TW']['ret5'] == 99.0

    def test_未來那天沒有該檔就跳過(self):
        shadow, idx = self._setup()
        for d in list(idx)[1:]:
            idx[d].pop('A.TW', None)
        assert esr.evaluate(shadow, idx) == 0

    def test_影子紀錄日期不在快照中不爆(self):
        shadow, idx = self._setup()
        shadow[0]['date'] = '2025-01-01'
        assert esr.evaluate(shadow, idx) == 0

    def test_下跌算成負報酬(self):
        dates = ['2026-09-%02d' % d for d in (1, 2, 3, 4, 7, 8)]
        idx = esr.build_price_index([_vday(d, {'A.TW': 100 - i * 5}) for i, d in enumerate(dates)])
        shadow = [{'date': dates[0], 'records': {'A.TW': {'p': 100, 'blocked_by': 'x'}}}]
        esr.evaluate(shadow, idx)
        assert shadow[0]['records']['A.TW']['ret5'] == -25.0


class TestSummarize:
    def test_依阻擋原因分組算勝率(self):
        shadow = [{'date': '2026-09-01', 'records': {
            'A.TW': {'blocked_by': 'daily_limit', 'ret5': 5.0},
            'B.TW': {'blocked_by': 'daily_limit', 'ret5': -1.0},
            'C.TW': {'blocked_by': 'entered', 'ret5': 3.0},
            'D.TW': {'blocked_by': 'daily_limit'},          # 未評估，不計入
        }}]
        s = esr.summarize(shadow, min_samples=2)
        assert s['daily_limit']['n'] == 2
        assert s['daily_limit']['win_rate'] == 50.0
        assert s['daily_limit']['avg_ret5'] == 2.0
        assert s['daily_limit']['reliable'] is True
        assert s['entered']['n'] == 1
        assert s['entered']['reliable'] is False, '樣本 1 筆不該標成可信'

    def test_樣本不足要標記(self):
        shadow = [{'date': 'd', 'records': {'A.TW': {'blocked_by': 'x', 'ret5': 1.0}}}]
        assert esr.summarize(shadow, min_samples=10)['x']['reliable'] is False

    def test_無資料回空字典(self):
        assert esr.summarize([]) == {}
        assert esr.summarize(None) == {}


class TestEngineGates:
    """引擎端：等待確認判定 + 放寬後的每日上限"""

    def test_只算確認次數真的不夠的(self, engine):
        pending = {'A.TW': {'count': 4}, 'B.TW': {'count': 1}, 'C.TW': {'count': 2}}
        # count>=2 的已通過確認，卡在別處，不該顯示為「等待確認」
        assert engine._waiting_confirm(pending) == ['B.TW']

    def test_空pending回空list(self, engine):
        assert engine._waiting_confirm({}) == []
        assert engine._waiting_confirm(None) == []

    def test_個股每日上限預設為3(self, engine):
        import inspect
        src = inspect.getsource(engine._should_enter)
        assert "get('daily_individual_entry_limit', 3)" in src, \
            '預設 1 會讓資金運用率卡在 3%（ETF 已被全數跳過，個股永遠先撞這道牆）'

    def test_ai_bot_明確設定為3(self, engine):
        s = engine._ai_bot_default_portfolio()['settings']
        assert s['daily_individual_entry_limit'] == 3


class TestNormalizeReason:
    """v13.4.0：帶數值的原因要合併成同一組，否則每筆自成一組、統計失效"""

    @pytest.mark.parametrize('raw,expected', [
        ('ma5_extended_7.1_over_3', 'ma5_extended'),
        ('ma5_extended_7.5_over_5.0', 'ma5_extended'),
        ('day_gain_hot_7.35_over_3.0', 'day_gain_hot'),
        ('conf_80_below_85', 'conf_below'),
        ('cooldown_until_2026-09-10', 'cooldown'),
        ('individual_daily_limit_1/1', 'individual_daily_limit'),
        ('individual_daily_limit_3/3', 'individual_daily_limit'),
        ('defense_mode_elevated_sox_-3.2', 'defense_mode'),
        ('sector_full_半導體', 'sector_full'),
        ('already_held', 'already_held'),
        ('entered', 'entered'),
        (None, 'unknown'),
        ('', 'unknown'),
    ])
    def test_正規化(self, raw, expected):
        assert esr.normalize_reason(raw) == expected

    def test_summary_會合併同類(self):
        shadow = [{'date': 'd', 'records': {
            'A.TW': {'blocked_by': 'ma5_extended_7.1_over_3', 'ret5': 1.0},
            'B.TW': {'blocked_by': 'ma5_extended_9.9_over_5.0', 'ret5': -1.0},
        }}]
        s = esr.summarize(shadow, min_samples=1)
        assert list(s) == ['ma5_extended'] and s['ma5_extended']['n'] == 2


class TestEvaluateWithSeries:
    """v13.4.0：verdict_history 只快照使用者自選股，AI 候選池輪動 → 要用個股日 K 補"""

    def _bars(self, start_day, closes):
        return [('2026-09-%02d' % (start_day + i), c) for i, c in enumerate(closes)]

    def test_用第5根K棒收盤價(self):
        shadow = [{'date': '2026-09-01', 'records': {'X.TW': {'p': 100, 'blocked_by': 'x'}}}]
        series = {'X.TW': self._bars(1, [100, 101, 102, 103, 104, 110, 120])}
        assert esr.evaluate_with_series(shadow, series) == 1
        rec = shadow[0]['records']['X.TW']
        assert rec['ret5'] == 10.0 and rec['ret5_src'] == 'yfinance'

    def test_紀錄日休市_從下一根K起算(self):
        # 9/6 週六紀錄（引擎不該跑，但防禦）→ 基準是 9/7 那根
        shadow = [{'date': '2026-09-06', 'records': {'X.TW': {'p': 100, 'blocked_by': 'x'}}}]
        series = {'X.TW': self._bars(7, [100, 1, 1, 1, 1, 90])}
        esr.evaluate_with_series(shadow, series)
        assert shadow[0]['records']['X.TW']['ret5'] == -10.0

    def test_K棒不足5根不評估(self):
        shadow = [{'date': '2026-09-01', 'records': {'X.TW': {'p': 100, 'blocked_by': 'x'}}}]
        series = {'X.TW': self._bars(1, [100, 101, 102])}
        assert esr.evaluate_with_series(shadow, series) == 0

    def test_已由verdict評估過的不覆蓋(self):
        shadow = [{'date': '2026-09-01', 'records': {'X.TW': {'p': 100, 'ret5': 3.0}}}]
        series = {'X.TW': self._bars(1, [100] * 10)}
        assert esr.evaluate_with_series(shadow, series) == 0
        assert shadow[0]['records']['X.TW']['ret5'] == 3.0

    def test_抓不到序列就跳過(self):
        shadow = [{'date': '2026-09-01', 'records': {'X.TW': {'p': 100}}}]
        assert esr.evaluate_with_series(shadow, {}) == 0
