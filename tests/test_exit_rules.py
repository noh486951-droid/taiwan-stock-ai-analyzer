"""出場規則測試 — 停損 / 急跌防禦 / 交易日計算

回歸案例（v12.6.9）：急跌防禦門檻曾造成「今天買明天跌 2% 就被賣飛」，
共 7 筆 -4%~-10% 的虧損。修法：持有 >= 2 交易日才啟動 + 門檻放寬到 -5%。
"""
import pytest


def _snap(price, change_pct=None, conf=80, verdict='Bullish'):
    """組出引擎預期的 snapshot 結構"""
    return {
        'price': price,
        'ai': {'verdict': verdict, 'confidence': conf},
        'data': {'change_pct': change_pct} if change_pct is not None else {},
    }


def _pos(entry_date, entry_price=100.0, **kw):
    p = {'entry_date': entry_date, 'entry_price': entry_price, 'shares': 1000}
    p.update(kw)
    return p


@pytest.fixture
def today(engine, monkeypatch):
    """固定「今天」為 2026-08-27（週四），讓交易日計算可預期"""
    monkeypatch.setattr(engine, 'today_str', '2026-08-27')
    return '2026-08-27'


class TestTradingDaysBetween:
    """交易日計算是所有持有期判斷的基礎，錯了會連鎖影響停損/逾期"""

    def test_same_day_is_zero(self, engine):
        assert engine.trading_days_between('2026-08-27', '2026-08-27') == 0

    def test_consecutive_weekdays(self, engine):
        # 週一 8/24 → 週四 8/27 = 3 個交易日
        assert engine.trading_days_between('2026-08-24', '2026-08-27') == 3

    def test_skips_weekend(self, engine):
        # 週五 8/21 → 週一 8/24 = 1 個交易日（跳過六日）
        assert engine.trading_days_between('2026-08-21', '2026-08-24') == 1

    def test_full_week_spans_five(self, engine):
        # 週一 8/17 → 週一 8/24 = 5 個交易日
        assert engine.trading_days_between('2026-08-17', '2026-08-24') == 5

    def test_reverse_order_returns_zero(self, engine):
        """未來日期不該回傳負數"""
        assert engine.trading_days_between('2026-08-27', '2026-08-20') == 0


class TestStopLoss:
    def test_triggers_at_or_below_stop(self, engine, today):
        pos = _pos('2026-08-20', stop_loss=95.0)
        should, reason = _should = engine._should_exit(pos, _snap(94.0), {}, '2330.TW')
        assert should is True and reason == 'stop'

    def test_not_triggered_above_stop(self, engine, today):
        pos = _pos('2026-08-20', stop_loss=95.0)
        should, reason = engine._should_exit(pos, _snap(96.0), {}, '2330.TW')
        assert reason != 'stop'


class TestDayCrashDefense:
    """v12.6.9 回歸：不可再出現「隔天小回檔就被掃出」"""

    SETTINGS = {'day_crash_start_after_days': 2, 'day_crash_exit_pct_individual': -5.0,
                'min_hold_trading_days': 3}

    def test_not_triggered_on_entry_day(self, engine, today):
        """當日進場當日暴跌 → 不觸發（持有 0 交易日）"""
        pos = _pos('2026-08-27')
        should, reason = engine._should_exit(pos, _snap(90.0, change_pct=-9.0),
                                             self.SETTINGS, '2330.TW')
        assert reason != 'day_crash'

    def test_not_triggered_next_day(self, engine, today):
        """T+1 暴跌 → 仍不觸發（給股票一個喘息交易日）"""
        pos = _pos('2026-08-26')  # 昨天買，持有 1 交易日
        should, reason = engine._should_exit(pos, _snap(90.0, change_pct=-9.0),
                                             self.SETTINGS, '2330.TW')
        assert reason != 'day_crash', 'T+1 就觸發會造成賣飛（v12.6.9 回歸）'

    def test_triggers_from_day_two(self, engine, today):
        """T+2 起且跌幅 <= -5% → 觸發（真崩盤該擋）"""
        pos = _pos('2026-08-25')  # 持有 2 交易日
        should, reason = engine._should_exit(pos, _snap(90.0, change_pct=-6.0),
                                             self.SETTINGS, '2330.TW')
        assert should is True and reason == 'day_crash'

    def test_normal_pullback_not_triggered(self, engine, today):
        """正常回檔 -3% 不該被掃出（放寬到 -5% 的用意）"""
        pos = _pos('2026-08-25')
        should, reason = engine._should_exit(pos, _snap(97.0, change_pct=-3.0),
                                             self.SETTINGS, '2330.TW')
        assert reason != 'day_crash'


class TestExitRobustness:
    def test_missing_price_does_not_crash(self, engine, today):
        """快照沒價格時要安全回傳 False，不能拋例外"""
        should, reason = engine._should_exit(_pos('2026-08-20'), {'price': None, 'ai': {}},
                                             {}, '2330.TW')
        assert should is False

    def test_none_snapshot_does_not_crash(self, engine, today):
        should, reason = engine._should_exit(_pos('2026-08-20'), None, {}, '2330.TW')
        assert should is False
