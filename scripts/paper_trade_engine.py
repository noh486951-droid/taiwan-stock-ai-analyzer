"""
v11.4 虛擬投資決策引擎 — 全自動進出場（後端方案 Y）

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

# === 編碼保險：避免 emoji 在 Windows cp950 / 某些 Linux 最小 locale 下崩潰 ===
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
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
    # v10.8 fix：GET 也要帶 engine secret（因為 access password 保護打開後會擋外來請求）
    url = f"{WORKER_URL}/api/paper-trade?uid={uid}&engine=1"
    headers = {"X-Engine": "1", "X-Engine-Secret": ENGINE_SECRET or ""}
    try:
        r = requests.get(url, headers=headers, timeout=15)
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
        "last_engine_status": portfolio.get('last_engine_status'),
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

# v11.5：盤勢分類（從 raw_data.json TAIEX 讀，全程序共用）
_MARKET_REGIME_CACHE = {}

def get_market_regime():
    """回傳 {'regime': 'bull'|'bear'|'range', 'taiex': float, 'ma20': float, 'ma60': float}
    從 data/raw_data.json 讀 fetch_market_data 寫的欄位；fallback = 'unknown'"""
    if _MARKET_REGIME_CACHE:
        return _MARKET_REGIME_CACHE
    try:
        raw = load_json('data/raw_data.json') or {}
        market = raw.get('market_data') or raw.get('market') or {}
        taiex = market.get('TAIEX') or {}
        info = {
            "regime": taiex.get("regime", "unknown"),
            "taiex": taiex.get("price"),
            "ma20": taiex.get("ma20"),
            "ma60": taiex.get("ma60"),
            "change_pct": taiex.get("change_pct"),
        }
    except Exception:
        info = {"regime": "unknown"}
    _MARKET_REGIME_CACHE.update(info)
    return info


REGIME_ZH = {"bull": "多頭（站上 20MA）", "bear": "空頭（跌破 20MA）",
             "range": "盤整", "unknown": "未知"}


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
    """回傳 (should_exit: bool, reason: str)

    v10.8.2 新增防禦機制：
      A. conf_crash  — AI 信心度連續 2 次 < 50 分 → 主動出場
      B. day_crash   — 持倉不是今天買的，但今日跌幅 ≤ -5% → 防黑天鵝
    """
    if not snap or snap['price'] is None:
        return False, ''
    price = snap['price']
    ai = snap['ai'] or {}

    # 最小持有期保護
    held = trading_days_between(position['entry_date'], today_str)
    min_hold = settings.get('min_hold_trading_days', 3)

    # 停損（任何時候都優先，黑天鵝 / 固定停損都走這條）
    if position.get('stop_loss') and price <= position['stop_loss']:
        return True, 'stop'

    # B. 單日急跌保護（比停損先觸發，因為可能停損還沒到但已跌很多）
    #    只在「持倉不是今天剛買」的前提下觸發，避免當日進場當日出場
    if position.get('entry_date') != today_str:
        today_change = None
        data = snap.get('data') or {}
        if isinstance(data.get('change_pct'), (int, float)):
            today_change = data.get('change_pct')
        day_crash_threshold = settings.get('day_crash_exit_pct', -5.0)
        if today_change is not None and today_change <= day_crash_threshold:
            return True, 'day_crash'

    # 達標
    if position.get('target_price') and price >= position['target_price']:
        return True, 'target'

    # A. 信心度崩跌（需過最小持有期，避免剛買就被雜訊甩出）
    if held >= min_hold:
        if position.get('conf_low_count', 0) >= 2:
            return True, 'conf_crash'

    # 訊號反轉（需已過最小持有期）
    if held >= min_hold:
        verdict = ai.get('verdict')
        if position.get('entry_verdict') == 'Bullish' and verdict == 'Bearish':
            return True, 'reversal'

    # v11.2: 訊號轉弱即時出場（Signal Flip）— 不用等 verdict 翻空，先跑贏「慢半拍」
    # 觸發條件（需已過 min_hold + conf_flip_count 連續 2 次）：
    #   entry_confidence - current_confidence >= 15  且  current_verdict != 'Bullish'
    # 這讓 AI 能像真人一樣「發現苗頭不對就先跑」，而不是等跌破停損才動作
    if held >= min_hold:
        if position.get('conf_flip_count', 0) >= 2:
            return True, 'signal_flip'

    # v11.2: 相對強度持續弱勢 → 資金不在這檔（rs_weak_count 連 2 次）
    if held >= min_hold:
        if position.get('rs_weak_count', 0) >= 2:
            return True, 'rs_weak'

    # 逾期（持有過久無反轉）
    stale = settings.get('stale_exit_trading_days', 10)
    if held >= stale:
        return True, 'stale'
    return False, ''


def _regime_winrate(history, regime, min_samples=10):
    """v11.5：根據歷史交易算「指定盤勢下的勝率」，回傳 (winrate, sample_count)
    sample_count < min_samples 時 winrate 回 None（樣本不夠不調整）"""
    matched = [t for t in (history or []) if t.get('entry_market_regime') == regime]
    if len(matched) < min_samples:
        return None, len(matched)
    wins = sum(1 for t in matched if (t.get('pnl') or 0) > 0)
    return wins / len(matched), len(matched)


def _dynamic_confidence_threshold(base, history, current_regime):
    """v11.5：根據當前盤勢的歷史勝率動態調整進場門檻
       勝率 < 30% → 加 5 分（更嚴）
       勝率 < 40% → 加 3 分
       勝率 > 60% → 減 3 分（更鬆，但不低於 70）
       樣本不夠（<10）就用原值
    """
    if current_regime == 'unknown':
        return base, None, 0
    wr, n = _regime_winrate(history, current_regime)
    if wr is None:
        return base, None, n
    adj = 0
    if wr < 0.30:
        adj = +5
    elif wr < 0.40:
        adj = +3
    elif wr > 0.60:
        adj = -3
    new_threshold = max(70, min(95, base + adj))
    return new_threshold, wr, n


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
    base_thresh = settings.get('confidence_threshold', 80)
    # v11.5：動態盤勢門檻 — 在當前盤勢勝率不佳時自動加嚴
    if settings.get('enable_dynamic_threshold', True):
        regime = get_market_regime().get('regime', 'unknown')
        thresh, _wr, _n = _dynamic_confidence_threshold(
            base_thresh, portfolio.get('history') or [], regime)
    else:
        thresh = base_thresh
    if conf < thresh:
        return False, f'conf_{conf}_below_{thresh}'

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
    # v11.4: 支援零股 — 高價股（台積電、大立光…）用 1 股為單位
    # 優先湊整張；湊不到整張就改買零股（至少 1 股）
    lot_shares = int(budget / price / 1000) * 1000
    if lot_shares >= 1000:
        shares = lot_shares
    else:
        shares = int(budget / price)  # 零股：1 股為單位
    if shares < 1:
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
        # v11.5：盤勢標籤（出場後也保留在 trade record，供回測勝率分組）
        'entry_market_regime': get_market_regime().get('regime', 'unknown'),
        'entry_taiex': get_market_regime().get('taiex'),
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
        # v10.9: 標記這筆是「純固定規則」還是「AI 動態調整」後出場
        'mode': 'adjusted' if pos.get('ai_adjusted') else 'fixed',
        'adjustments_count': len(pos.get('adjustments') or []),
        # v11.5：盤勢標籤 — 開倉當天的盤勢，用來算分組勝率
        'entry_market_regime': pos.get('entry_market_regime', 'unknown'),
        'exit_market_regime': get_market_regime().get('regime', 'unknown'),
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

# 出場原因中文對照（給前端 / 歷史交易顯示）
EXIT_REASON_ZH = {
    "stop":        "觸及停損價",
    "target":      "達到停利目標",
    "reversal":    "AI 訊號翻空",
    "stale":       "持有過久無反轉",
    "conf_crash":  "AI 信心崩跌（連 2 次 <50）",
    "day_crash":   "單日急跌防禦觸發",
    "signal_flip": "訊號轉弱（信心驟降 ≥15）",   # v11.2
    "rs_weak":     "連 2 次弱於大盤（資金流出）",  # v11.2
}


def _reason_zh(code):
    """把英文 reason code 翻成中文說明給前端顯示"""
    if code in EXIT_REASON_ZH:
        return EXIT_REASON_ZH[code]
    if code.startswith('verdict_'):
        v = code.split('_', 1)[1]
        return f"AI 判讀為 {v}（需為 Bullish）"
    if code.startswith('conf_') and '_below_' in code:
        # v11.5: conf_82_below_85
        try:
            _, c, _, t = code.split('_')
            return f"信心度 {c} 分（當前盤勢動態門檻 ≥{t}）"
        except Exception:
            pass
    if code.startswith('conf_below_'):
        return f"信心度低於門檻（{code.rsplit('_', 1)[-1]}）"
    if code.startswith('conf_'):
        c = code.split('_', 1)[1]
        return f"信心度 {c} 分（需 ≥80）"
    if code == 'no_structured_price':
        return "AI 未給出具體停利/停損價位"
    if code == 'price_above_entry':
        return "現價高於 AI 建議進場區間"
    if code == 'already_held':
        return "已持有"
    if code == 'daily_limit':
        return "今日進場次數已達上限"
    if code == 'max_positions':
        return "持倉已滿（5 檔）"
    if code == 'market_open_safety':
        return "開盤 5 分鐘保護期"
    if code == 'no_price':
        return "無即時報價"
    if code.startswith('cooldown_until_'):
        return f"冷卻期中（至 {code.split('_', 2)[2]}）"
    return code


def process_user(uid, watchlist_analysis):
    portfolio = get_portfolio(uid)
    if portfolio is None:
        print(f"  ⚠️ {uid}: portfolio missing", flush=True)
        return
    settings = portfolio.get('settings') or {}
    if not settings.get('auto_trade', False):   # 預設 off
        print(f"  ℹ️ {uid}: auto_trade off, skipping", flush=True)
        # 即使沒開自動交易也寫一筆狀態，讓前端能顯示原因
        portfolio['last_engine_status'] = {
            "timestamp": now.strftime('%Y-%m-%d %H:%M:%S'),
            "summary": "auto_trade 未啟用",
            "reason_zh": "自動交易開關關閉中，請到頁面上打開「自動交易」才會啟動 AI 進出場。",
            "exits": 0,
            "entries": 0,
            "reasons_breakdown": {},
            "pending_confirms_count": 0,
            "evaluated_symbols": 0,
        }
        save_portfolio(uid, portfolio)
        return

    # 1. 出場檢查（每個持倉）
    exits = []
    for sym in list(portfolio.get('positions', {}).keys()):
        snap = _stock_snapshot(sym, watchlist_analysis)
        pos = portfolio['positions'][sym]

        # v10.8.2 A：更新信心度崩跌計數器（放在 _should_exit 之前）
        if snap and snap.get('ai'):
            conf = snap['ai'].get('confidence', 0) or 0
            low_thresh = settings.get('conf_crash_threshold', 50)
            if conf < low_thresh:
                pos['conf_low_count'] = pos.get('conf_low_count', 0) + 1
            else:
                pos['conf_low_count'] = 0  # 回升 → 重置
            pos['last_confidence'] = conf   # debug 用，也方便前端顯示

            # v11.2: Signal Flip 計數器（需要 current_verdict + entry_confidence）
            entry_conf = pos.get('entry_confidence', 0) or 0
            current_verdict = snap['ai'].get('verdict')
            flip_drop = settings.get('signal_flip_drop', 15)
            if entry_conf and (entry_conf - conf) >= flip_drop and current_verdict != 'Bullish':
                pos['conf_flip_count'] = pos.get('conf_flip_count', 0) + 1
            else:
                pos['conf_flip_count'] = 0

            # v11.2: RS 持續弱勢計數（連 2 次 rs.label 為「弱勢」或「極弱」）
            sd_data = snap.get('data') or {}
            rs = sd_data.get('rs') or {}
            rs_label = rs.get('label')
            if rs_label in ('弱勢', '極弱'):
                pos['rs_weak_count'] = pos.get('rs_weak_count', 0) + 1
            else:
                pos['rs_weak_count'] = 0
            pos['last_rs'] = rs  # 前端可顯示

        should, reason = _should_exit(pos, snap, settings)
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
    # v10.8.2：逐檔紀錄「為什麼沒買」的原因，供前端顯示
    reasons_breakdown = {}   # reason_code → count
    def _bump(code):
        reasons_breakdown[code] = reasons_breakdown.get(code, 0) + 1

    for sym in stocks.keys():
        snap = _stock_snapshot(sym, watchlist_analysis)
        ai = (snap['ai'] if snap else None) or {}
        verdict = ai.get('verdict')
        conf = ai.get('confidence', 0) or 0
        conf_thresh = settings.get('confidence_threshold', 80)

        # 連續確認：需要 2 次 watchlist_quick 都看到 Bullish 才真正進場
        if verdict == 'Bullish' and conf >= conf_thresh:
            rec = pending.get(sym, {'count': 0})
            rec['count'] = rec.get('count', 0) + 1
            rec['last_seen'] = now.strftime('%Y-%m-%d %H:%M:%S')
            pending[sym] = rec
        else:
            # 訊號消失 → 重置計數，記錄原因
            if sym in pending:
                del pending[sym]
            if verdict and verdict != 'Bullish':
                _bump(f'verdict_{verdict}')
            elif conf < conf_thresh:
                _bump(f'conf_below_{conf_thresh}')
            else:
                _bump('no_ai_signal')
            continue

        if pending[sym]['count'] < 2:
            _bump('pending_confirm')  # 第 1 次 Bullish，還差 1 次
            continue

        can, why = _should_enter(sym, snap, portfolio, settings, today_entries)
        if not can:
            _bump(why or 'unknown_block')
            continue
        trade = _open_position(sym, snap, portfolio, settings)
        if trade:
            entries.append(trade)
            today_entries += 1
            del pending[sym]
            print(f"  📥 [{uid}] ENTER {sym} {trade['shares']}股 @ {trade['price']}", flush=True)

    # 3. 組合狀態摘要（給前端 UI）
    evaluated = len(stocks)
    if entries or exits:
        # 有實際動作
        parts = []
        if entries:
            parts.append(f"進場 {len(entries)} 檔")
        if exits:
            parts.append(f"出場 {len(exits)} 檔")
        summary = "、".join(parts)
        reason_zh = "AI 已執行" + summary
    elif pending:
        pending_names = list(pending.keys())[:3]
        summary = f"等待第二次 Bullish 確認（{len(pending)} 檔）"
        reason_zh = f"已偵測到 {len(pending)} 檔訊號，需再一次 Bullish 才會進場：{', '.join(pending_names)}"
    elif reasons_breakdown:
        # 沒有任何動作 → 取 top 3 原因
        top = sorted(reasons_breakdown.items(), key=lambda x: -x[1])[:3]
        zh_parts = [f"{_reason_zh(k)} ×{v}" for k, v in top]
        summary = "無符合進場條件"
        reason_zh = "目前所有自選股都未通過 AI 進場門檻：" + "；".join(zh_parts)
    else:
        summary = "自選股清單為空"
        reason_zh = "沒有自選股可供 AI 掃描，請先加入自選股。"

    # v11.5：當前盤勢 + 動態門檻資訊
    regime_info = get_market_regime()
    base_thresh = settings.get('confidence_threshold', 80)
    dyn_thresh, wr, sample_n = _dynamic_confidence_threshold(
        base_thresh, portfolio.get('history') or [], regime_info.get('regime', 'unknown'))

    portfolio['last_engine_status'] = {
        "timestamp": now.strftime('%Y-%m-%d %H:%M:%S'),
        "summary": summary,
        "reason_zh": reason_zh,
        "exits": len(exits),
        "entries": len(entries),
        "reasons_breakdown": reasons_breakdown,
        "pending_confirms_count": len(pending),
        "evaluated_symbols": evaluated,
        # v11.5：盤勢回測資訊
        "market_regime": regime_info.get('regime', 'unknown'),
        "market_regime_zh": REGIME_ZH.get(regime_info.get('regime', 'unknown'), '-'),
        "taiex": regime_info.get('taiex'),
        "taiex_ma20": regime_info.get('ma20'),
        "taiex_ma60": regime_info.get('ma60'),
        "dynamic_threshold": dyn_thresh,
        "base_threshold": base_thresh,
        "regime_winrate": round(wr, 3) if wr is not None else None,
        "regime_sample_count": sample_n,
    }

    # 4. 一律寫回 KV（即使沒交易，狀態也要更新）
    ok = save_portfolio(uid, portfolio)
    if ok:
        if exits or entries:
            print(f"  ✅ [{uid}] saved: {len(exits)} exits, {len(entries)} entries, {len(portfolio.get('positions', {}))} holding", flush=True)
        else:
            print(f"  ℹ️ [{uid}] no changes — {reason_zh}", flush=True)


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
