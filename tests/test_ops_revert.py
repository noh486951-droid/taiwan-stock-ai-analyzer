"""撤銷過期價格出場 — v13.7.1（2026-10-23 颱風假，鴻海 09:10 以 10/22 收盤 245 出場）"""
import copy

import pytest

import ops_revert_exit as ops


def _engine_close(portfolio, sym, price, now='2026-10-23 09:10:00'):
    """照 paper_trade_engine._close_position 的算法出場，用來驗證還原是否精確互逆"""
    pos = portfolio['positions'][sym]
    shares = pos['shares']
    amount = shares * price
    net = amount - round(amount * ops.FEE_RATE) - round(amount * ops.TAX_RATE)
    pnl = net - pos['entry_cost']
    portfolio['cash'] += net
    portfolio['history'].append({
        'sym': sym, 'name': pos['name'], 'shares': shares, 'entry_price': pos['entry_price'],
        'entry_date': pos['entry_date'], 'exit_price': price, 'exit_date': now[:10],
        'exit_time': now, 'exit_reason': 'signal_flip', 'pnl': round(pnl, 2),
        'pnl_pct': round(pnl / pos['entry_cost'] * 100, 2), 'entry_confidence': 85,
        'entry_verdict': 'Bullish', 'entry_side': 'right', 'entry_market_regime': 'bull',
        'highest_price': 250.0, 'max_profit_pct': 2.77, 'trailing_activated': False,
        'profit_locked': False, 'adjustments_count': 0,
    })
    del portfolio['positions'][sym]
    portfolio['cooldowns'][sym] = '2026-10-30'
    portfolio['stats']['total_trades'] += 1
    if pnl > 0:
        portfolio['stats']['win_trades'] += 1
    portfolio['stats']['total_pnl'] = round(portfolio['stats']['total_pnl'] + pnl, 2)


def _before():
    shares, px = 600, 243.25
    cost = shares * px + round(shares * px * ops.FEE_RATE)
    return {
        'cash': 500000.0,
        'positions': {
            '2317.TW': {'name': '鴻海', 'shares': shares, 'entry_price': px, 'entry_cost': cost,
                        'entry_date': '2026-10-20'},
            '2330.TW': {'name': '台積電', 'shares': 10, 'entry_price': 2400, 'entry_cost': 24034,
                        'entry_date': '2026-10-15'},
        },
        'history': [{'sym': '2454.TW', 'exit_date': '2026-10-01', 'pnl': 1000}],
        'stats': {'total_trades': 1, 'win_trades': 1, 'total_pnl': 1000},
        'cooldowns': {'2454.TW': '2026-10-08'},
    }


@pytest.fixture
def after_bad_exit():
    before = _before()
    p = copy.deepcopy(before)
    _engine_close(p, '2317.TW', 245.0)
    return before, p


class TestFind:
    def test_找到那一筆(self, after_bad_exit):
        _, p = after_bad_exit
        m = ops.find_trades(p['history'], '2317.TW', '2026-10-23',
                            {'entry_price': 243.25, 'exit_price': 245})
        assert len(m) == 1 and m[0][0] == 1

    def test_價格不符不算(self, after_bad_exit):
        _, p = after_bad_exit
        assert ops.find_trades(p['history'], '2317.TW', '2026-10-23', {'exit_price': 246}) == []

    def test_日期不符不算(self, after_bad_exit):
        _, p = after_bad_exit
        assert ops.find_trades(p['history'], '2317.TW', '2026-10-22', {}) == []


class TestBuildRevert:
    def _revert(self, p):
        (idx, t), = ops.find_trades(p['history'], '2317.TW', '2026-10-23', {'exit_price': 245})
        return ops.build_revert(p, idx, t, {'stop_loss': 230, 'target_price': 265}, 'now')

    def test_現金精確回到出場前(self, after_bad_exit):
        before, p = after_bad_exit
        new, _ = self._revert(p)
        assert new['cash'] == pytest.approx(before['cash'], abs=0.01)

    def test_進場成本精確還原(self, after_bad_exit):
        before, p = after_bad_exit
        new, info = self._revert(p)
        assert info['entry_cost'] == pytest.approx(before['positions']['2317.TW']['entry_cost'], abs=0.01)

    def test_統計與紀錄還原(self, after_bad_exit):
        before, p = after_bad_exit
        new, _ = self._revert(p)
        assert new['stats'] == before['stats']
        assert new['history'] == before['history']

    def test_冷卻期移除_其他標的冷卻期保留(self, after_bad_exit):
        _, p = after_bad_exit
        new, _ = self._revert(p)
        assert '2317.TW' not in new['cooldowns']
        assert new['cooldowns']['2454.TW'] == '2026-10-08'

    def test_持倉還原且帶停損目標與註記(self, after_bad_exit):
        _, p = after_bad_exit
        new, _ = self._revert(p)
        pos = new['positions']['2317.TW']
        assert pos['shares'] == 600 and pos['entry_price'] == 243.25
        assert pos['entry_date'] == '2026-10-20'
        assert pos['stop_loss'] == 230 and pos['target_price'] == 265
        assert pos['restored_from_exit']['exit_price'] == 245
        assert '2330.TW' in new['positions'], '其他持倉不可受影響'

    def test_不修改傳入物件(self, after_bad_exit):
        _, p = after_bad_exit
        snapshot = copy.deepcopy(p)
        self._revert(p)
        assert p == snapshot


class TestPublicOutput:
    def test_結果不含現金與其他持股(self):
        s = ops._summary(_before(), '2317.TW')
        assert 'cash' not in s and 'positions' not in s
        assert s['sym_held'] is True

    def test_交易只輸出公開欄位(self, after_bad_exit):
        _, p = after_bad_exit
        pub = ops._public_trade(p['history'][-1])
        assert 'entry_confidence' not in pub and pub['exit_price'] == 245


def test_實際卡片數字_成本分毫不差():
    """10/20 進場卡：594 股 @243.25，成本 144,696.5；10/23 出場 @245，損益 +189.5"""
    net = ops.sell_net(594, 245)
    assert round(net - 189.5, 2) == 144696.5
