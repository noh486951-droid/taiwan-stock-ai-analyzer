"""
v10.8 虛擬投資決策引擎 — 全自動進出場（後端方案 Y）

執行時機：每次 watchlist_quick.py 跑完後，在 GH Actions workflow 裡接著跑
依賴資料：
  data/watchlist_analysis.json — AI 分析結果（含 suggestion_structured）
  data/raw_data.json           — 即時股價

動作：
  1. 從 CF Worker 拉所有 paper_trade 使用者清單
  2. 逐個使用者：
     a. 讀 KV 的 portfolio
     b. 對持倉：檢查出場條件（停損 / 停利 / 反轉 / 逾期）→ 若觸發則平倉
     c. 對 watchlist：掃描進場訊號（verdict=Bullish 且 conf>=80 且 2 次連續確認）
     d. 寫回 KV
"""
import os
import sys
import json
import time
from datetime import datetime, timedelta
import pytz
import requests

tw_tz = pytz.timezone('Asia/Taipei')
now = datetime.now(tw_tz)
today_str = now.strftime('%Y-%m-%d')

WORKER_URL = os.environ.get('WORKER_URL', 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev')
ENGINE_SECRET = os.environ.get('PAPER_TRADE_ENGINE_SECRET', '')

# 台股手續費/稅
FEE_RATE = 0.001425       # 買賣各一次
TAX_RATE = 0.003          # 賣出時證交稅

print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] Paper Trade Engine starting...", flush=True)

# ── 交易時段檢查 ──
hm = now.hour * 100 + now.minute
is_trading_hours = (now.weekday() < 5) and (900 <= hm <= 1340)
is_after_market = (now.weekday() < 5) and (1400 <= hm <= 1600)

if not ENGINE_SECRET:
    print("  ⚠️ PAPER_TRADE_ENGINE_SECRET not set — skipping.", flush=True)
    sys.exit(0)


# ============================================================
# 交易日工具
# ============================================================

def trading_days_ahead(base_str, n):
    """從 base_str (YYYY-MM-DD) 往後算 n 個交易日（跳過週末）"""
    d = datetime.strptime(base_str, '%Y-%m-%d').date()
    count = 0
    while count < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            count += 1
    return d.strftime('%Y-%m-%d')


def trading_days_between(a_str, b_str):
    """計算 a→b 之間的交易日數（b 含當天）"""
    a = datetime.strptime(a_str[:10], '%Y-%m-%d').date()
    b = datetime.strptime(b_str[:10], '%Y-%m-%d').date()
    if b < a:
        return 0
    d = a
    n = 0
    while d < b:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


# ============================================================
# 資料載入
# ============================================================

def load_json(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"  ⚠️ Failed to load {path}: {e}", flush=True)
        return None


def get_all_users():
    url = f"{WORKER_URL}/api/paper-trade/all-users"
    try:
        r = requests.get(url, headers={'X-Engine-Secret': ENGINE_SECRET}, timeout=15)
        r.raise_for_status()
        return r.json().get('users', [])
    except Exception as e:
        print(f"  ⚠️ Fetch users failed: {e}", flush=True)
        return []


def get_portfolio(uid):
    url = f"{WORKER_URL}/api/paper-trade?uid={uid}"
    try:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  ⚠️ Get portfolio {uid} failed: {e}", flush=True)
        return None


def save_portfolio(uid, portfolio):
    url = f"{WORKER_URL}/api/paper-trade"
    body = {
        "uid": uid,
        "engine": True,
        "engine_secret": ENGINE_SECRET,
        "cash": portfolio.get('cash'),
        "positions": portfolio.get('positions'),
        "history": portfolio.get('history'),
        "stats": portfolio.get('stats'),
        "cooldowns": portfolio.get('cooldowns'),
        "pending_confirms": portfolio.get('pending_confirms'),
    }
    try:
        r = requests.post(url, json=body, timeout=15)
        r.raise_for_status()
        return True
    except Exception as e:
        print(f"  ⚠️ Save portfolio {uid} failed: {e} {r.text if 'r' in dir() else ''}", flush=True)
        return False


# ============================================================
# 決策邏輯
# ============================================================

def _stock_snapshot(sym, watchlist_analysis):
    """回傳 {price, ai, data} 或 None"""
    stocks = (watchlist_analysis or {}).get('stocks', {})
    sd = stocks.get(sym)
    if not sd:
        return None
    ai = sd.get('ai_analysis', {})
    price = sd.get('price')
    return {'price': price, 'ai': ai, 'data': sd}


def _calc_fees(side, shares, price):
    """回傳手續費（買賣都有）+ 證交稅（僅賣出）"""
    amount = shares * price
    fee = round(amount * FEE_RATE)
    tax = round(amount * TAX_RATE) if side == 'sell' else 0
    return fee + tax


def _should_exit(position, snap, settings):
    """回傳 (should_exit: bool, reason: str)"""
    if not snap or snap['price'] is None:
        return False, ''
    price = snap['price']
    ai = snap['ai'] or {}

    # 最小持有期保護
    held = trading_days_between(position['entry_date'], today_str)
    min_hold = settings.get('min_hold_trading_days', 3)

    # 停損（任何時候都優先）
    if position.get('stop_loss') and price <= position['stop_loss']:
        return True, 'stop'
    # 達標
    if position.get('target_price') and price >= position['target_price']:
        return True, 'target'
    # 訊號反轉（需已過最小持有期）
    if held >= min_hold:
        verdict = ai.get('verdict')
        if position.get('entry_verdict') == 'Bullish' and verdict == 'Bearish':
            return True, 'reversal'
    # 逾期（持有過久無反轉）
    stale = settings.get('stale_exit_trading_days', 10)
    if held >= stale:
        return True, 'stale'
    return False, ''


def _should_enter(sym, snap, portfolio, settings, today_entries_count):
    """回傳 (should_enter: bool, blocked_reason: str)"""
    if sym in portfolio.get('positions', {}):
        return False, 'already_held'
    if today_entries_count >= settings.get('daily_entry_limit', 3):
        return False, 'daily_limit'
    if len(portfolio.get('positions', {})) >= settings.get('max_positions', 5):
        return False, 'max_positions'
    # 開盤 5 分鐘不下單
    if now.hour == 9 and now.minute < 5:
        return False, 'market_open_safety'
    cooldown_end = (portfolio.get('cooldowns') or {}).get(sym)
    if cooldown_end and cooldown_end >= today_str:
        return False, f'cooldown_until_{cooldown_end}'

    if not snap or snap['price'] is None:
        return False, 'no_price'
    ai = snap['ai'] or {}
    if ai.get('verdict') != 'Bullish':
        return False, f'verdict_{ai.get("verdict")}'
    conf = ai.get('confidence') or 0
    if conf < settings.get('confidence_threshold', 80):
        return False, f'conf_{conf}'

    sug = ai.get('suggestion_structured') or {}
    if not sug.get('target_price') or not sug.get('stop_loss'):
        return False, 'no_structured_price'

    price = snap['price']
    # 價格要落在 entry 區間內（或下方 — 可以撿便宜）
    entry_hi = sug.get('entry_price_high')
    if entry_hi and price > entry_hi * 1.02:  # 2% tolerance
        return False, f'price_above_entry'

    return True, ''


def _open_position(sym, snap, portfolio, settings):
    price = snap['price']
    ai = snap['ai']
    sug = ai.get('suggestion_structured', {})

    # 資金：每筆上限，取 min(per_position_cap, cash/可用槽位)
    positions = portfolio.get('positions', {})
    slots_left = settings['max_positions'] - len(positions)
    if slots_left <= 0:
        return None
    per_cap = settings.get('per_position_cap', 200000)
    budget = min(per_cap, portfolio['cash'] / slots_left * 0.95)  # 保留 5% 緩衝
    shares = int(budget / price / 1000) * 1000  # 整張
    if shares < 1000:
        return None
    cost = shares * price
    fee = _calc_fees('buy', shares, price)
    total = cost + fee
    if total > portfolio['cash']:
        return None

    portfolio['cash'] -= total
    portfolio['positions'][sym] = {
        'shares': shares,
        'entry_price': round(price, 2),
        'entry_cost': round(total, 2),
        'entry_date': today_str,
        'entry_time': now.strftime('%Y-%m-%d %H:%M:%S'),
        'entry_verdict': ai.get('verdict'),
        'entry_confidence': ai.get('confidence'),
        'target_price': sug.get('target_price'),
        'stop_loss': sug.get('stop_loss'),
        'expected_hold_days': sug.get('hold_days_expected'),
        'signal_strength': sug.get('signal_strength'),
        'name': snap['data'].get('name'),
    }
    return {'sym': sym, 'shares': shares, 'price': price, 'fee': fee}


def _close_position(sym, snap, portfolio, reason):
    pos = portfolio['positions'].get(sym)
    if not pos or not snap:
        return None
    price = snap['price']
    shares = pos['shares']
    proceeds = shares * price
    fee = _calc_fees('sell', shares, price)
    net = proceeds - fee
    pnl = net - pos['entry_cost']
    pnl_pct = round(pnl / pos['entry_cost'] * 100, 2) if pos['entry_cost'] else 0
    portfolio['cash'] += net

    trade = {
        'sym': sym,
        'name': pos.get('name'),
        'shares': shares,
        'entry_price': pos['entry_price'],
        'entry_date': pos['entry_date'],
        'exit_price': round(price, 2),
        'exit_date': today_str,
        'exit_time': now.strftime('%Y-%m-%d %H:%M:%S'),
        'exit_reason': reason,
        'pnl': round(pnl, 2),
        'pnl_pct': pnl_pct,
        'hold_days': trading_days_between(pos['entry_date'], today_str),
        'entry_confidence': pos.get('entry_confidence'),
        'entry_verdict': pos.get('entry_verdict'),
        'signal_strength': pos.get('signal_strength'),
    }
    portfolio.setdefault('history', []).append(trade)
    del portfolio['positions'][sym]
    # 冷卻期
    cd_days = portfolio.get('settings', {}).get('cooldown_trading_days', 5)
    portfolio.setdefault('cooldowns', {})[sym] = trading_days_ahead(today_str, cd_days)
    # 更新 stats
    s = portfolio.setdefault('stats', {})
    s['total_trades'] = s.get('total_trades', 0) + 1
    if pnl > 0:
        s['win_trades'] = s.get('win_trades', 0) + 1
    s['total_pnl'] = round(s.get('total_pnl', 0) + pnl, 2)
    return trade


# ============================================================
# 主流程（每個 user 一輪）
# ============================================================

def process_user(uid, watchlist_analysis):
    portfolio = get_portfolio(uid)
    if portfolio is None:
        print(f"  ⚠️ {uid}: portfolio missing", flush=True)
        return
    settings = portfolio.get('settings') or {}
    if not settings.get('auto_trade', False):   # 預設 off
        print(f"  ℹ️ {uid}: auto_trade off, skipping", flush=True)
        return

    # 1. 出場檢查（每個持倉）
    exits = []
    for sym in list(portfolio.get('positions', {}).keys()):
        snap = _stock_snapshot(sym, watchlist_analysis)
        should, reason = _should_exit(portfolio['positions'][sym], snap, settings)
        if should:
            trade = _close_position(sym, snap, portfolio, reason)
            if trade:
                exits.append(trade)
                print(f"  📤 [{uid}] EXIT {sym} @ {trade['exit_price']} ({reason}) pnl={trade['pnl_pct']}%", flush=True)

    # 2. 進場檢查（含連續確認）
    pending = portfolio.setdefault('pending_confirms', {})
    # 清理已過期的 pending（last_seen 非今日）
    for sym in list(pending.keys()):
        ls = pending[sym].get('last_seen', '')
        if ls[:10] != today_str:
            del pending[sym]

    stocks = (watchlist_analysis or {}).get('stocks', {})
    # 計算今日已進場數
    today_entries = sum(1 for t in portfolio.get('history', [])
                        if t.get('entry_date') == today_str)
    today_entries += sum(1 for p in portfolio.get('positions', {}).values()
                         if p.get('entry_date') == today_str)

    entries = []
    for sym in stocks.keys():
        snap = _stock_snapshot(sym, watchlist_analysis)
        # 連續確認：需要 2 次 watchlist_quick 都看到 Bullish 才真正進場
        if snap and (snap['ai'] or {}).get('verdict') == 'Bullish' \
                and (snap['ai'] or {}).get('confidence', 0) >= settings.get('confidence_threshold', 80):
            rec = pending.get(sym, {'count': 0})
            rec['count'] = rec.get('count', 0) + 1
            rec['last_seen'] = now.strftime('%Y-%m-%d %H:%M:%S')
            pending[sym] = rec
        else:
            # 訊號消失 → 重置計數
            if sym in pending:
                del pending[sym]
            continue

        if pending[sym]['count'] < 2:
            continue  # 還沒連續確認完成

        can, why = _should_enter(sym, snap, portfolio, settings, today_entries)
        if not can:
            continue
        trade = _open_position(sym, snap, portfolio, settings)
        if trade:
            entries.append(trade)
            today_entries += 1
            # 進場完清掉 pending
            del pending[sym]
            print(f"  📥 [{uid}] ENTER {sym} {trade['shares']}股 @ {trade['price']}", flush=True)

    # 3. 寫回 KV
    if exits or entries or pending != portfolio.get('pending_confirms', {}):
        ok = save_portfolio(uid, portfolio)
        if ok:
            print(f"  ✅ [{uid}] saved: {len(exits)} exits, {len(entries)} entries, {len(portfolio.get('positions', {}))} holding", flush=True)
    else:
        print(f"  ℹ️ [{uid}] no changes", flush=True)


def main():
    # EOD settlement 由 14:30 cron 觸發；盤中每 10 分鐘觸發
    if not (is_trading_hours or is_after_market):
        print(f"  ⏰ Outside trading hours ({now.strftime('%H:%M')}), skipping.", flush=True)
        return
    wa = load_json('data/watchlist_analysis.json')
    if not wa:
        print("  ⚠️ No watchlist_analysis.json, skipping.", flush=True)
        return
    users = get_all_users()
    if not users:
        print("  ℹ️ No paper-trade users.", flush=True)
        return
    print(f"  👥 Processing {len(users)} users", flush=True)
    for uid in users:
        try:
            process_user(uid, wa)
        except Exception as e:
            print(f"  ❌ User {uid} failed: {e}", flush=True)
        time.sleep(0.5)


if __name__ == '__main__':
    main()
