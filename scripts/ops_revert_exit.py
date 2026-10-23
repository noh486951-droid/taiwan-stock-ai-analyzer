"""
一次性維運：撤銷「臨時休市時用過期價格成交」的出場，還原持倉 — v13.7.1

背景：2026-10-23 颱風停止交易，止血前 09:10 引擎以 10/22 收盤價 245 讓鴻海（2317）
      訊號轉弱出場。使用者決定撤銷，讓帳戶回到 10/23 開盤前的狀態。

由 ops/revert_request.json 驅動（push 該檔觸發 .github/workflows/ops_revert.yml）：
  {"uid": "...", "sym": "2317.TW", "exit_date": "2026-10-23",
   "expect": {"entry_price": 243.25, "exit_price": 245},
   "mode": "inspect" | "apply",
   "restore": {"stop_loss": 230, "target_price": 265}}   # apply 才需要

inspect：只讀，輸出交易紀錄與帳戶現況，不做任何修改。
apply  ：驗證通過才寫回 —— 必須剛好一筆符合的出場、該檔目前沒有持倉、且有提供停損與目標。

結果寫到 data/ops/revert_result.json。repo 是公開的，而個人帳戶在網頁上需登入才看得到，
所以結果只放「這一筆交易」與變化量，不放現金餘額、其他持股或完整交易紀錄。
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

WORKER_URL = os.environ.get('WORKER_URL', 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev')
SECRET = os.environ.get('PAPER_TRADE_ENGINE_SECRET', '')
REQ_PATH = 'ops/revert_request.json'
OUT_PATH = 'data/ops/revert_result.json'
FEE_RATE = 0.001425   # 與 paper_trade_engine 一致
TAX_RATE = 0.003
TW = timezone(timedelta(hours=8))

# 交易紀錄裡可直接搬回持倉的欄位（出場時從持倉複製過去的）
_COPY_BACK = ('name', 'shares', 'entry_price', 'entry_date', 'entry_confidence', 'entry_verdict',
              'signal_strength', 'entry_side', 'entry_market_regime', 'highest_price', 'max_profit_pct')


def sell_net(shares, price):
    amount = shares * price
    return amount - round(amount * FEE_RATE) - round(amount * TAX_RATE)


def find_trades(history, sym, exit_date, expect):
    out = []
    for i, t in enumerate(history or []):
        if t.get('sym') != sym or t.get('exit_date') != exit_date:
            continue
        if expect.get('entry_price') is not None and abs(t.get('entry_price', 0) - expect['entry_price']) > 0.005:
            continue
        if expect.get('exit_price') is not None and abs(t.get('exit_price', 0) - expect['exit_price']) > 0.005:
            continue
        out.append((i, t))
    return out


def build_revert(portfolio, idx, trade, restore, now_str):
    """回傳還原後的 portfolio（不改動傳入物件）與摘要。"""
    p = json.loads(json.dumps(portfolio))
    net = sell_net(trade['shares'], trade['exit_price'])
    entry_cost = round(net - trade['pnl'], 2)       # pnl = net - entry_cost
    pos = {k: trade[k] for k in _COPY_BACK if trade.get(k) is not None}
    pos.update({
        'original_shares': trade['shares'],
        'entry_cost': entry_cost,
        'original_entry_cost': entry_cost,
        'entry_time': trade.get('entry_time') or f"{trade['entry_date']} 00:00:00",
        'stop_loss': restore['stop_loss'],
        'target_price': restore['target_price'],
        'trailing_activated': bool(trade.get('trailing_activated')),
        'profit_locked': bool(trade.get('profit_locked')),
        'restored_from_exit': {
            'exit_date': trade['exit_date'], 'exit_time': trade.get('exit_time'),
            'exit_price': trade['exit_price'], 'exit_reason': trade.get('exit_reason'),
            'note': '臨時休市（颱風假）以過期價格成交，使用者決定撤銷', 'restored_at': now_str,
        },
    })
    if trade.get('trailing_stop_at_exit') is not None:
        pos['trailing_stop'] = trade['trailing_stop_at_exit']
    if trade.get('profit_lock_stop_at_exit') is not None:
        pos['profit_lock_stop'] = trade['profit_lock_stop_at_exit']

    p['positions'] = {**(p.get('positions') or {}), trade['sym']: pos}
    del p['history'][idx]
    s = p.setdefault('stats', {})
    s['total_trades'] = s.get('total_trades', 0) - 1
    if trade['pnl'] > 0:
        s['win_trades'] = s.get('win_trades', 0) - 1
    s['total_pnl'] = round(s.get('total_pnl', 0) - trade['pnl'], 2)
    (p.get('cooldowns') or {}).pop(trade['sym'], None)
    p['cash'] = round(p['cash'] - net, 2)
    return p, {'net_refunded': round(net, 2), 'entry_cost': entry_cost, 'position': pos}


# 結果只公開這些交易欄位（使用者已在 Discord 截圖中看過的資訊 + 還原需要判斷的旗標）
_PUBLIC_TRADE_FIELDS = ('sym', 'shares', 'entry_date', 'entry_time', 'entry_price', 'exit_date',
                        'exit_time', 'exit_price', 'exit_reason', 'pnl', 'pnl_pct', 'hold_days',
                        'mode', 'adjustments_count', 'trailing_activated', 'profit_locked',
                        'trailing_stop_at_exit', 'profit_lock_stop_at_exit', 'max_profit_pct')


def _public_trade(t):
    return {k: t.get(k) for k in _PUBLIC_TRADE_FIELDS if k in t}


def _summary(p, sym):
    s = p.get('stats') or {}
    return {'sym_held': sym in (p.get('positions') or {}),
            'sym_in_cooldown': sym in (p.get('cooldowns') or {}),
            'history_len': len(p.get('history') or []),
            'total_trades': s.get('total_trades'), 'win_trades': s.get('win_trades')}


def main():
    req = json.load(open(REQ_PATH, encoding='utf-8'))
    now_str = datetime.now(TW).strftime('%Y-%m-%d %H:%M:%S')
    result = {'ran_at': now_str, 'request': req, 'ok': False}

    def done():
        os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
        json.dump(result, open(OUT_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    if not SECRET:
        result['error'] = 'PAPER_TRADE_ENGINE_SECRET 未設定'
        return done()
    r = requests.get(f"{WORKER_URL}/api/paper-trade",
                     params={'uid': req['uid'], 'engine': 1},
                     headers={'X-Engine': '1', 'X-Engine-Secret': SECRET}, timeout=20)
    if r.status_code != 200:
        result['error'] = f'讀取帳戶失敗 HTTP {r.status_code}'
        return done()
    portfolio = r.json()
    result['before'] = _summary(portfolio, req['sym'])
    cash_before = portfolio.get('cash')

    matches = find_trades(portfolio.get('history'), req['sym'], req['exit_date'], req.get('expect') or {})
    result['matches'] = [_public_trade(t) for _, t in matches]
    result['sym_currently_held'] = req['sym'] in (portfolio.get('positions') or {})

    if req.get('mode') != 'apply':
        result['ok'] = True
        result['note'] = 'inspect 模式：未做任何修改'
        return done()

    restore = req.get('restore') or {}
    problems = []
    if len(matches) != 1:
        problems.append(f'符合條件的出場有 {len(matches)} 筆（必須剛好 1 筆）')
    if result['sym_currently_held']:
        problems.append('該檔目前已有持倉，不能重複還原')
    if not (restore.get('stop_loss') and restore.get('target_price')):
        problems.append('缺少 restore.stop_loss / restore.target_price')
    if problems:
        result['error'] = '；'.join(problems)
        return done()

    idx, trade = matches[0]
    new_p, info = build_revert(portfolio, idx, trade, restore, now_str)
    body = {'uid': req['uid'], 'engine': True, 'engine_secret': SECRET}
    for k in ('cash', 'positions', 'history', 'stats', 'cooldowns'):
        body[k] = new_p.get(k)
    w = requests.post(f"{WORKER_URL}/api/paper-trade", json=body, timeout=20)
    if w.status_code != 200:
        result['error'] = f'寫回失敗 HTTP {w.status_code}'
        return done()
    # 讀回驗證
    chk = requests.get(f"{WORKER_URL}/api/paper-trade", params={'uid': req['uid'], 'engine': 1},
                       headers={'X-Engine': '1', 'X-Engine-Secret': SECRET}, timeout=20).json()
    pub = {'net_refunded': info['net_refunded'], 'entry_cost': info['entry_cost'],
           'stop_loss': info['position']['stop_loss'], 'target_price': info['position']['target_price']}
    result.update({'ok': True, 'applied': pub, 'after': _summary(chk, req['sym']),
                   'cash_delta': round((chk.get('cash') or 0) - (cash_before or 0), 2),
                   'verified': req['sym'] in (chk.get('positions') or {})
                   and not find_trades(chk.get('history'), req['sym'], req['exit_date'],
                                       req.get('expect') or {})})
    return done()


if __name__ == '__main__':
    sys.exit(main() or 0)
