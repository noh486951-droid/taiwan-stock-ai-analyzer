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

# v11.10: Discord 推送（永遠 try/except 包，推送失敗不能讓引擎崩潰）
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import notify_discord as _nd
except Exception:
    _nd = None

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

# v12.3.5：台股國定假日休市檢查
# 優先讀 data/tw_holidays.json（由 update_tw_holidays.py 每天從 TWSE 官方更新）
# 讀不到 fallback 到內建 set（過渡保險，2027 之後請靠 JSON 自動更新）
_FALLBACK_HOLIDAYS = {
    '2026-01-01',
    '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
    '2026-02-27', '2026-02-28',
    '2026-04-03', '2026-04-06',
    '2026-05-01',
    '2026-06-19',
    '2026-09-25',
    '2026-10-09', '2026-10-10',
    '2027-01-01',
}


def _load_tw_holidays() -> set:
    try:
        if os.path.exists('data/tw_holidays.json'):
            with open('data/tw_holidays.json', 'r', encoding='utf-8') as f:
                j = json.load(f) or {}
            hs = j.get('holidays') or []
            if hs:
                return set(hs) | _FALLBACK_HOLIDAYS  # 雙保險合併
    except Exception as e:
        print(f"  ⚠️ load tw_holidays.json fail: {e}（用內建 fallback）", flush=True)
    return _FALLBACK_HOLIDAYS


TW_MARKET_HOLIDAYS = _load_tw_holidays()
is_market_holiday = today_str in TW_MARKET_HOLIDAYS

# ── 交易時段檢查 ──
hm = now.hour * 100 + now.minute
is_trading_hours = (now.weekday() < 5) and (not is_market_holiday) and (900 <= hm <= 1340)
is_after_market = (now.weekday() < 5) and (not is_market_holiday) and (1400 <= hm <= 1600)

if not ENGINE_SECRET:
    print("  ⚠️ PAPER_TRADE_ENGINE_SECRET not set — skipping.", flush=True)
    sys.exit(0)

# v12.3.4：休市日直接停掉引擎（不進、不出、不寫 snapshot），避免用過期收盤價亂判斷
if is_market_holiday:
    print(f"  🎌 {today_str} 為台股休市日（端午/春節/國慶等），引擎跳過。", flush=True)
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


# v12.3.1：snapshot 從 daily_review 搬到 engine，確保每日有記錄
#   原本只在 paper_trade_daily_review 跑，但：
#   1. AI bot 不走 daily_review → 永遠 0 筆 snapshot
#   2. Daily review 每天 18:00 才跑，失敗就漏一天
#   現在 engine 每次跑都記，同日只留一筆（後寫覆蓋）
def record_daily_snapshot(portfolio, watchlist_analysis):
    try:
        cash = portfolio.get('cash', 0)
        positions = portfolio.get('positions') or {}
        stocks = (watchlist_analysis or {}).get('stocks', {})
        positions_value = 0
        for sym, p in positions.items():
            cur = (stocks.get(sym, {}).get('price')) or p.get('entry_price') or 0
            positions_value += cur * (p.get('shares') or 0)
        total = cash + positions_value
        history = portfolio.get('history') or []
        wins = sum(1 for t in history if (t.get('pnl') or 0) > 0)
        win_rate = wins / len(history) * 100 if history else 0
        snapshot = {
            'date': now.strftime('%Y-%m-%d'),
            'total_assets': round(total, 0),
            'cash': round(cash, 0),
            'positions_value': round(positions_value, 0),
            'positions_count': len(positions),
            'total_trades': len(history),
            'wins': wins,
            'win_rate': round(win_rate, 1),
        }
        snaps = portfolio.setdefault('daily_snapshots', [])
        # 同日只留一筆（後寫覆蓋）
        snaps = [s for s in snaps if s.get('date') != snapshot['date']]
        snaps.append(snapshot)
        snaps.sort(key=lambda x: x['date'])
        portfolio['daily_snapshots'] = snaps[-365:]   # 保留 1 年

        # v12.6.0：把當前防禦模式寫進 portfolio meta，前端可 render banner
        try:
            dm = get_defense_mode()
            portfolio['defense_mode'] = {
                'level': dm['level'],
                'reasons': dm['reasons'],
                'triggers': dm.get('triggers') or {},
                'updated_at': now.strftime('%Y-%m-%d %H:%M:%S'),
            }
        except Exception:
            pass
    except Exception as e:
        print(f"  ⚠️ snapshot failed: {e}", flush=True)


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
        # v12.6.8：把 daily_snapshots + defense_mode 也回寫（原本漏掉 → 快照圖表永遠沒資料）
        "daily_snapshots": portfolio.get('daily_snapshots'),
        "defense_mode": portfolio.get('defense_mode'),
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


# ============================================================
# v11.6：宏觀風險觸發器 / 防禦模式
# ============================================================
_MACRO_RISK_CACHE = {}

def get_macro_risk():
    """v11.6：綜合 VIX / US10Y / USD-TWD / 美股龍頭隔夜訊號 → 計算宏觀風險等級

    回傳 dict：
      {
        "level": "normal" | "elevated" | "defensive",
        "score": int,                # 風險分數（0-10），>=5 elevated，>=8 defensive
        "triggers": [str, ...],      # 觸發的條件描述（中文）
        "details": {...}             # 各指標數值
      }

    判斷規則（每命中一條 +score）：
      VIX >= 25                                 +2
      VIX >= 30                                 +3 (累加)
      US10Y >= 4.5%                             +1
      US10Y >= 5.0%                             +2
      USD/TWD >= 32.5（新台幣大幅貶值）          +1
      USD/TWD >= 33.0                           +2
      NVDA / SOX 隔夜跌幅 ≤ -5%                  +3
      NVDA / SOX 隔夜跌幅 ≤ -3%                  +1
      TAIEX 當日 change_pct <= -2%              +2
    """
    if _MACRO_RISK_CACHE:
        return _MACRO_RISK_CACHE
    score = 0
    triggers = []
    details = {}
    try:
        raw = load_json('data/raw_data.json') or {}
        market = raw.get('market_data') or raw.get('market') or {}

        # VIX
        vix = (market.get('VIX') or {}).get('price')
        details['vix'] = vix
        if isinstance(vix, (int, float)):
            if vix >= 30:
                score += 5  # 25+2 + 30+3 累加
                triggers.append(f"VIX 高點 {vix:.1f}（極度恐慌）")
            elif vix >= 25:
                score += 2
                triggers.append(f"VIX 偏高 {vix:.1f}（恐慌升溫）")

        # US10Y
        us10y = (market.get('US10Y') or {}).get('price')
        details['us10y'] = us10y
        if isinstance(us10y, (int, float)):
            if us10y >= 5.0:
                score += 3
                triggers.append(f"美 10 年期殖利率 {us10y:.2f}%（資金成本壓力）")
            elif us10y >= 4.5:
                score += 1
                triggers.append(f"美 10 年期殖利率 {us10y:.2f}%（偏高）")

        # USD/TWD
        usd_twd = (market.get('USD/TWD') or {}).get('price')
        details['usd_twd'] = usd_twd
        if isinstance(usd_twd, (int, float)):
            if usd_twd >= 33.0:
                score += 3
                triggers.append(f"USD/TWD {usd_twd:.2f}（新台幣大幅貶值）")
            elif usd_twd >= 32.5:
                score += 1
                triggers.append(f"USD/TWD {usd_twd:.2f}（新台幣偏弱）")

        # NVDA / SOX 隔夜暴跌
        nvda_cp = (market.get('NVDA') or {}).get('change_pct')
        sox_cp = (market.get('SOX') or {}).get('change_pct')
        worst = None
        if isinstance(nvda_cp, (int, float)):
            worst = nvda_cp if worst is None else min(worst, nvda_cp)
        if isinstance(sox_cp, (int, float)):
            worst = sox_cp if worst is None else min(worst, sox_cp)
        details['nvda_change'] = nvda_cp
        details['sox_change'] = sox_cp
        if worst is not None:
            if worst <= -5.0:
                score += 3
                triggers.append(f"美股龍頭暴跌（NVDA/SOX 最差 {worst:+.2f}%）")
            elif worst <= -3.0:
                score += 1
                triggers.append(f"美股龍頭走弱（NVDA/SOX 最差 {worst:+.2f}%）")

        # TAIEX 當日
        taiex_cp = (market.get('TAIEX') or {}).get('change_pct')
        details['taiex_change'] = taiex_cp
        if isinstance(taiex_cp, (int, float)) and taiex_cp <= -2.0:
            score += 2
            triggers.append(f"加權指數重挫 {taiex_cp:+.2f}%")
    except Exception as e:
        print(f"  ⚠️ get_macro_risk failed: {e}", flush=True)

    if score >= 8:
        level = "defensive"
    elif score >= 5:
        level = "elevated"
    else:
        level = "normal"
    info = {"level": level, "score": score, "triggers": triggers, "details": details}
    _MACRO_RISK_CACHE.update(info)
    return info


# ============================================================
# v12.6.0：大盤防禦模式 — 比 macro_risk 更敏感的進場過濾
# ============================================================
#  defensive: 暫停右側進場、允許左側、停損改緊
#  extreme: 暫停所有進場（含左側）
#
# 觸發條件（OR 邏輯）：
#  defensive：
#    - 美股龍頭隔夜 ≤ -2%（NVDA / SOX / Nasdaq 任一）
#    - VIX ≥ 22
#    - TAIEX 當日 ≤ -1.5%
#    - USD/TWD ≥ 32.8（新台幣急貶）
#  extreme（任一）：
#    - 美股龍頭隔夜 ≤ -4%
#    - VIX ≥ 30
#    - TAIEX 當日 ≤ -3%
#
# 用戶上週案例驗證：
#   華邦電 6/5 進場 → 美股 -2.15% (符合 defensive)、TAIEX 開盤 -1.33% (邊緣)
#   今國光 6/10 進場 → 系統應在開盤 30 分鐘內判定 defensive 並 block
_DEFENSE_MODE_CACHE = None


def get_defense_mode():
    global _DEFENSE_MODE_CACHE
    if _DEFENSE_MODE_CACHE is not None:
        return _DEFENSE_MODE_CACHE
    reasons = []
    level = 'normal'
    triggers = {}
    try:
        raw = load_json('data/raw_data.json') or {}
        market = raw.get('market_data') or raw.get('market') or {}

        def _cp(name):
            v = (market.get(name) or {}).get('change_pct')
            return v if isinstance(v, (int, float)) else None

        nvda_cp = _cp('NVDA')
        sox_cp = _cp('SOX')
        ndq_cp = _cp('Nasdaq') or _cp('IXIC') or _cp('NDX')
        taiex_cp = _cp('TAIEX')
        vix = (market.get('VIX') or {}).get('price')
        usd_twd = (market.get('USD/TWD') or {}).get('price')
        triggers.update({'nvda': nvda_cp, 'sox': sox_cp, 'nasdaq': ndq_cp,
                         'taiex': taiex_cp, 'vix': vix, 'usd_twd': usd_twd})

        # 美股龍頭隔夜（取最差）
        us_worst = None
        for v in (nvda_cp, sox_cp, ndq_cp):
            if v is None:
                continue
            us_worst = v if us_worst is None else min(us_worst, v)
        triggers['us_worst'] = us_worst

        # === Extreme triggers (最高優先) ===
        if us_worst is not None and us_worst <= -4.0:
            level = 'extreme'
            reasons.append(f'美股龍頭崩盤 {us_worst:+.2f}% (≤-4%)')
        if isinstance(vix, (int, float)) and vix >= 30:
            if level != 'extreme':
                level = 'extreme'
            reasons.append(f'VIX 極端恐慌 {vix:.1f} (≥30)')
        if taiex_cp is not None and taiex_cp <= -3.0:
            if level != 'extreme':
                level = 'extreme'
            reasons.append(f'TAIEX 當日 {taiex_cp:+.2f}% (≤-3%)')

        # === Defensive triggers ===
        if level != 'extreme':
            if us_worst is not None and us_worst <= -2.0:
                level = 'defensive'
                reasons.append(f'美股隔夜走弱 {us_worst:+.2f}% (≤-2%)')
            if isinstance(vix, (int, float)) and vix >= 22:
                if level == 'normal':
                    level = 'defensive'
                reasons.append(f'VIX 偏高 {vix:.1f} (≥22)')
            if taiex_cp is not None and taiex_cp <= -1.5:
                if level == 'normal':
                    level = 'defensive'
                reasons.append(f'TAIEX 跌幅 {taiex_cp:+.2f}% (≤-1.5%)')
            if isinstance(usd_twd, (int, float)) and usd_twd >= 32.8:
                if level == 'normal':
                    level = 'defensive'
                reasons.append(f'新台幣急貶 USD/TWD {usd_twd:.2f}')
    except Exception as e:
        print(f"  ⚠️ get_defense_mode failed: {e}", flush=True)

    info = {'level': level, 'reasons': reasons, 'triggers': triggers}
    _DEFENSE_MODE_CACHE = info
    if level != 'normal':
        print(f"  🛡️ Defense Mode = {level.upper()} | {' / '.join(reasons)}", flush=True)
    return info


# ============================================================
# v11.6：族群集中警示（避免同產業壓重倉）
# ============================================================
_SECTOR_INDEX_CACHE = None  # symbol -> sector_name

def _build_sector_index():
    global _SECTOR_INDEX_CACHE
    if _SECTOR_INDEX_CACHE is not None:
        return _SECTOR_INDEX_CACHE
    idx = {}
    try:
        sm = load_json('data/sector_map.json') or {}
        for sec in (sm.get('sectors') or []):
            name = sec.get('name')
            for s in (sec.get('key_stocks') or []):
                if s and name and s not in idx:
                    idx[s] = name
    except Exception as e:
        print(f"  ⚠️ build sector index failed: {e}", flush=True)
    _SECTOR_INDEX_CACHE = idx
    return idx


def _sector_of(sym: str) -> str | None:
    return _build_sector_index().get(sym)


def _sector_concentration(portfolio: dict) -> dict:
    """回傳 {sector_name: count} 統計目前持倉的族群分佈"""
    counts = {}
    for s in (portfolio.get('positions') or {}).keys():
        sec = _sector_of(s)
        if sec:
            counts[sec] = counts.get(sec, 0) + 1
    return counts


MACRO_LEVEL_ZH = {
    "normal": "正常",
    "elevated": "警戒（門檻加嚴）",
    "defensive": "防禦（縮減部位）",
}


def _apply_macro_defense(settings: dict, macro: dict) -> dict:
    """根據宏觀風險等級回傳調整後的 settings 副本（不污染原 dict）。

    elevated：
      - confidence_threshold +5
      - per_position_cap × 0.7
    defensive：
      - confidence_threshold +10（再扣風險）
      - per_position_cap × 0.5
      - max_positions 從 5 砍到 3
      - daily_entry_limit 從 3 砍到 1
    """
    if macro.get("level") == "normal":
        return settings
    s = dict(settings)
    if macro["level"] == "elevated":
        s['confidence_threshold'] = s.get('confidence_threshold', 80) + 5
        s['per_position_cap'] = int(s.get('per_position_cap', 200000) * 0.7)
    elif macro["level"] == "defensive":
        s['confidence_threshold'] = s.get('confidence_threshold', 80) + 10
        s['per_position_cap'] = int(s.get('per_position_cap', 200000) * 0.5)
        s['max_positions'] = min(s.get('max_positions', 5), 3)
        s['daily_entry_limit'] = min(s.get('daily_entry_limit', 3), 1)
    return s


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


# v11.10：階梯預警 / 鴨子飛了警示 觸發點
LADDER_UP_LEVELS = [3.0, 5.0, 7.0, 10.0, 15.0]      # 獲利階梯（5 點）
LADDER_DOWN_LEVELS = [-2.0, -4.0, -6.0, -8.0, -10.0]  # 虧損階梯（5 點）
DUCK_ARM_PCT = 7.0          # 浮盈曾 ≥ 7% 才視為「曾達高峰」
DUCK_DROP_PCT = 5.0          # 從峰值跌回 ≥ 5pp 才警示


def _check_ladder_and_duck_alerts(uid: str, sym: str, position: dict, snap: dict, settings: dict):
    """每個 tick 跑一次，檢查是否要推階梯/鴨子警示
    狀態存在 position['notify_alerted_levels']: list[float]、position['duck_alerted']: bool
    """
    if _nd is None or not _nd.should_notify_uid(uid):
        return
    if not snap or snap.get('price') is None:
        return
    price = snap['price']
    entry = position.get('entry_price')
    if not entry:
        return
    pnl_pct = (price - entry) / entry * 100
    max_p = position.get('max_profit_pct') or 0

    alerted = position.setdefault('notify_alerted_levels', [])

    # 1. 階梯：找出所有「應該觸發但還沒推」的階梯
    new_triggers = []
    for L in LADDER_UP_LEVELS:
        if pnl_pct >= L and L not in alerted:
            new_triggers.append(L)
    for L in LADDER_DOWN_LEVELS:
        if pnl_pct <= L and L not in alerted:
            new_triggers.append(L)

    if new_triggers:
        # 一次推一個（取絕對值最大的，比較顯眼）
        L = max(new_triggers, key=abs)
        target_price = position.get('target_price')
        stop_price = position.get('stop_loss')
        target_pct = ((target_price - entry) / entry * 100) if target_price else None
        stop_pct = ((stop_price - entry) / entry * 100) if stop_price else None
        try:
            _nd.card_ladder(
                sym=sym, name=position.get('name') or sym,
                level_pct=L, current_pnl_pct=pnl_pct,
                target_pct=target_pct, stop_pct=stop_pct,
                price=price, max_pnl_pct=max_p,
            )
        except Exception as e:
            print(f"  ⚠️ ladder push failed {sym}: {e}", flush=True)
        # 把這次觸發的階梯都標記掉（避免來回刷屏）
        alerted.extend(new_triggers)
        position['notify_alerted_levels'] = sorted(set(alerted))

    # 2. 鴨子飛了：曾 ≥ 7% 但回吐 ≥ 5pp 且還沒推過
    if (max_p >= DUCK_ARM_PCT and (max_p - pnl_pct) >= DUCK_DROP_PCT
            and not position.get('duck_alerted')):
        try:
            _nd.card_duck(
                sym=sym, name=position.get('name') or sym,
                max_pnl_pct=max_p, current_pnl_pct=pnl_pct, price=price,
            )
        except Exception as e:
            print(f"  ⚠️ duck push failed {sym}: {e}", flush=True)
        position['duck_alerted'] = True


def _update_trailing_stop(position, snap, settings):
    """v11.6 / v11.6.1：每次 tick 都呼叫一次，更新 highest_price、max_profit_pct、trailing_stop。

    機制 A — ATR 動態移動停利（trailing_activated）：
      浮盈 >= trailing_arm_profit_pct（預設 +5%）後啟動，stop = highest − atr_mult × ATR

    機制 B — 獲利鎖定（profit_locked，v11.6.1 新增）：
      浮盈「曾經達到」profit_lock_arm_pct（預設 +7%）後 arm；
      之後只要浮盈跌破 profit_lock_floor_pct（預設 +3%）就出場，避免賺單變賠單
      停損價 = entry × (1 + floor_pct/100)

    最終 trailing_stop 取兩者較高（較嚴）的那個，確保獲利鎖定不會被 ATR 拉低。
    """
    if not snap or snap.get('price') is None:
        return
    price = snap['price']
    # 1. 更新最高價
    hp = position.get('highest_price') or position.get('entry_price') or price
    if price > hp:
        position['highest_price'] = round(price, 2)
        hp = position['highest_price']

    entry_price = position.get('entry_price') or price
    profit_pct = (price - entry_price) / entry_price * 100 if entry_price else 0

    # 2. 更新「歷史最大浮盈」— 給獲利鎖定判斷用
    max_profit = position.get('max_profit_pct')
    if max_profit is None or profit_pct > max_profit:
        position['max_profit_pct'] = round(profit_pct, 2)
        max_profit = position['max_profit_pct']

    # 3. 機制 B：獲利鎖定 — 一旦曾達 arm_pct 浮盈，後續就 arm
    lock_arm = settings.get('profit_lock_arm_pct', 7.0)
    lock_floor = settings.get('profit_lock_floor_pct', 3.0)
    if not position.get('profit_locked') and (max_profit or 0) >= lock_arm:
        position['profit_locked'] = True
        position['profit_lock_armed_at'] = now.strftime('%Y-%m-%d %H:%M:%S')
    profit_lock_stop = None
    if position.get('profit_locked') and entry_price:
        profit_lock_stop = round(entry_price * (1 + lock_floor / 100), 2)
        position['profit_lock_stop'] = profit_lock_stop

    # 4. 機制 A：ATR 移動停利
    arm_pct = settings.get('trailing_arm_profit_pct', 5.0)
    if not position.get('trailing_activated'):
        if profit_pct < arm_pct:
            # 機制 A 還沒啟動，但仍要把獲利鎖定價寫進 trailing_stop（讓出場判斷只看一個欄位）
            if profit_lock_stop is not None:
                cur_stop = position.get('trailing_stop')
                if cur_stop is None or profit_lock_stop > cur_stop:
                    position['trailing_stop'] = profit_lock_stop
            return
        position['trailing_activated'] = True

    atr = position.get('entry_atr')
    cur_atr = (snap.get('data', {}).get('technical', {}) or {}).get('ATR14')
    if isinstance(cur_atr, (int, float)) and cur_atr > 0:
        atr = cur_atr
    atr_mult = settings.get('atr_trail_multiplier', 2.0)
    if isinstance(atr, (int, float)) and atr > 0:
        atr_stop = hp - atr_mult * atr
    else:
        trail_pct = settings.get('trailing_pct_fallback', 8.0)
        atr_stop = hp * (1 - trail_pct / 100)

    # 5. 取較嚴（較高）的當作有效 trailing_stop
    candidates = [atr_stop]
    if profit_lock_stop is not None:
        candidates.append(profit_lock_stop)
    new_stop = max(candidates)

    cur_stop = position.get('trailing_stop')
    if cur_stop is None or new_stop > cur_stop:
        position['trailing_stop'] = round(new_stop, 2)


def _should_exit(position, snap, settings, sym=None):
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

    # v11.6.1：獲利鎖定優先（即使 trailing 機制 A 還沒 arm，也可以鎖）
    if position.get('profit_locked') and position.get('profit_lock_stop'):
        if price <= position['profit_lock_stop']:
            return True, 'profit_lock'

    # v11.6：ATR 移動停利 — 啟動後若跌破 trailing_stop 出場
    if position.get('trailing_activated') and position.get('trailing_stop'):
        if price <= position['trailing_stop']:
            return True, 'trailing_stop'

    # B. 單日急跌保護（比停損先觸發，因為可能停損還沒到但已跌很多）
    #    只在「持倉不是今天剛買」的前提下觸發，避免當日進場當日出場
    if position.get('entry_date') != today_str:
        today_change = None
        data = snap.get('data') or {}
        if isinstance(data.get('change_pct'), (int, float)):
            today_change = data.get('change_pct')
        # v12.1.2 改進 #3：個股 / ETF 拆 day_crash 門檻
        # v12.1.4 修：用傳入的 sym（之前誤用不存在的 portfolio 變數導致 NameError crash）
        is_etf_held = sym and _is_etf(sym)
        if is_etf_held:
            day_crash_threshold = settings.get('day_crash_exit_pct_etf', -5.0)
        else:
            day_crash_threshold = settings.get('day_crash_exit_pct_individual', -4.0)
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
    # v12.2.2：日曆日保險（防止 trading_days_between 邊界誤差）
    #   例：5/11 進場到 5/25，trading_days 是 10，日曆日 14；
    #   設 14 天後一定出場，避免 UI 顯示 11 天但引擎還認為 9 天的狀況
    try:
        from datetime import datetime as _dt
        entry_dt = _dt.strptime(position['entry_date'][:10], '%Y-%m-%d').date()
        today_dt = _dt.strptime(today_str[:10], '%Y-%m-%d').date()
        cal_days = (today_dt - entry_dt).days
        cal_stale = settings.get('stale_exit_calendar_days', 14)
        if cal_days >= cal_stale:
            return True, 'stale_calendar'
    except Exception:
        pass
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


# v12.1.2：大型權值股清單（市值 > 5000 億 / 0050 主要成份）
# 進場時要求 RS 強勢才能買，避免追高
LARGE_CAPS = {
    '2330', '2454', '2317', '2308', '2382', '2891', '2412', '2881', '2303',
    '2882', '1301', '2884', '2002', '3008', '2885', '2886', '2887', '2890',
    '2892', '2912', '1216', '1303', '2207', '3034', '6505', '3711', '4904',
    '2357', '2474', '5871', '5876', '5880', '1326', '2105', '3045',
}


def _is_etf(sym: str) -> bool:
    """ETF 代碼：00 開頭或 009 開頭"""
    code = sym.replace('.TW', '').replace('.TWO', '')
    return code.startswith('00')


def _is_large_cap(sym: str) -> bool:
    code = sym.replace('.TW', '').replace('.TWO', '')
    return code in LARGE_CAPS


def _count_entries_by_type(today_entries_list):
    """today_entries_list: [sym, sym, ...]
    回傳 {'etf': N, 'individual': M}
    """
    etf = sum(1 for s in today_entries_list if _is_etf(s))
    ind = len(today_entries_list) - etf
    return {'etf': etf, 'individual': ind}


# v12.2：受控左側交易 — 只抄「基本面強 + 大戶沒跑 + 跌到季線支撐」的股票
#   模仿「欣興 800 抄底」的邏輯量化版，不是看到跌就買
_GOLDEN_CROSS_CODES = None   # 從 scout_radar.json 載入的黃金交叉股代碼集合


def _load_golden_cross_codes():
    global _GOLDEN_CROSS_CODES
    if _GOLDEN_CROSS_CODES is not None:
        return _GOLDEN_CROSS_CODES
    codes = set()
    try:
        if os.path.exists('data/scout_radar.json'):
            with open('data/scout_radar.json', 'r', encoding='utf-8') as f:
                radar = json.load(f) or {}
            for g in (radar.get('golden_cross_top') or []):
                c = g.get('code')
                if c:
                    codes.add(c)
    except Exception as e:
        print(f"  ⚠️ load golden_cross failed: {e}", flush=True)
    _GOLDEN_CROSS_CODES = codes
    return codes


def _should_enter_left_side(sym, snap, portfolio, settings):
    """受控左側進場（全部條件要滿足才買）：
    1. 是黃金交叉股（大戶布局 ∩ 月營收 YoY 正成長）
    2. 大戶這週沒減碼（whale_delta >= 0）
    3. 股價回檔到季線 MA60 附近（±3%）
    4. RSI < 35（短線超賣）
    回傳 (should: bool, reason: str)
    """
    if sym in portfolio.get('positions', {}):
        return False, 'already_held'
    if not snap or snap.get('price') is None:
        return False, 'no_price'

    # v12.6.0：防禦模式 extreme 也擋左側（大盤崩盤時連抄底都不該抄）
    if settings.get('enable_defense_mode', True):
        dm = get_defense_mode()
        if dm['level'] == 'extreme':
            return False, f"defense_extreme_no_left_side"

    code = sym.replace('.TW', '').replace('.TWO', '')
    # 條件 1：黃金交叉股
    if code not in _load_golden_cross_codes():
        return False, 'left_not_golden_cross'

    sd = snap.get('data') or {}
    tech = sd.get('technical') or {}
    chip = sd.get('chip_concentration') or {}
    price = snap['price']

    # 條件 2：大戶沒減碼
    whale_delta = chip.get('whale_delta')
    if isinstance(whale_delta, (int, float)) and whale_delta < 0:
        return False, f'left_whale_selling_{whale_delta}'

    # 條件 3：回檔到季線附近（±3%）
    ma60 = tech.get('MA60')
    if not isinstance(ma60, (int, float)) or ma60 <= 0:
        return False, 'left_no_ma60'
    dev = (price - ma60) / ma60 * 100
    near_pct = settings.get('left_side_ma60_near_pct', 3.0)
    if abs(dev) > near_pct:
        return False, f'left_not_near_ma60_{dev:.1f}'

    # 條件 4：RSI 超賣
    rsi = tech.get('RSI')
    rsi_limit = settings.get('left_side_rsi_limit', 35)
    if not isinstance(rsi, (int, float)) or rsi >= rsi_limit:
        return False, f'left_rsi_{rsi}_not_oversold'

    return True, 'left_side_ok'


def _should_enter(sym, snap, portfolio, settings, today_entries_count, today_entries_list=None):
    """回傳 (should_enter: bool, blocked_reason: str)
    today_entries_list: 今日已進場的 sym 清單（給 ETF/個股拆分用）
    """
    # v11.6：宏觀風險防禦模式 — 在進場前覆寫 settings
    if settings.get('enable_macro_defense', True):
        macro = get_macro_risk()
        settings = _apply_macro_defense(settings, macro)
    if sym in portfolio.get('positions', {}):
        return False, 'already_held'

    # v12.1.2 改進 #1：個股 / ETF 拆 daily_entry_limit
    is_etf_sym = _is_etf(sym)

    # v12.3：完全跳過 ETF（用戶 6/5 回饋：ETF 不適合此系統）
    #   ETF 追蹤指數無法差異化，AI 技術面 / 基本面訊號意義不大
    #   勝率看似高（4/4=100%）但實際只是隨機波動 + target 設太低
    if is_etf_sym and settings.get('skip_etf_entry', True):
        return False, 'etf_skipped_by_design'

    today_list = today_entries_list or []
    counts = _count_entries_by_type(today_list)
    if is_etf_sym:
        etf_limit = settings.get('daily_etf_entry_limit', 2)
        if counts['etf'] >= etf_limit:
            return False, f'etf_daily_limit_{counts["etf"]}/{etf_limit}'
    else:
        ind_limit = settings.get('daily_individual_entry_limit', 1)
        if counts['individual'] >= ind_limit:
            return False, f'individual_daily_limit_{counts["individual"]}/{ind_limit}'
    # 總額仍受 daily_entry_limit 限
    if today_entries_count >= settings.get('daily_entry_limit', 3):
        return False, 'daily_limit'

    if len(portfolio.get('positions', {})) >= settings.get('max_positions', 5):
        return False, 'max_positions'
    # v11.6：族群集中警示 — 同族群最多 N 檔（預設 2）
    sector_cap = settings.get('sector_concentration_cap', 2)
    if sector_cap > 0:
        sec = _sector_of(sym)
        if sec:
            counts = _sector_concentration(portfolio)
            if counts.get(sec, 0) >= sector_cap:
                return False, f'sector_full_{sec}'
    # v12.2.9：開盤 30 分鐘不下單（之前 5 分鐘）
    #   華邦電 6/5 09:20 進場後當日跌停，原因：開盤前 30 分鐘市場找方向期，
    #   早盤大量資金搶進搶出，技術面不穩定，AI 容易被「假突破」誤導
    open_safety_min = settings.get('market_open_safety_minutes', 30)
    if now.hour == 9 and now.minute < open_safety_min:
        return False, f'market_open_safety_{open_safety_min}min'

    # v12.6.0：大盤防禦模式（最敏感的 macro filter，先擋掉再說）
    #   right-side entry 一律擋（不論 defensive / extreme）
    #   左側交易仍可（_should_enter_left_side 只擋 extreme）
    if settings.get('enable_defense_mode', True):
        dm = get_defense_mode()
        if dm['level'] in ('defensive', 'extreme'):
            return False, f"defense_mode_{dm['level']}_{','.join(dm['reasons'][:2])[:60]}"

    # v12.2.9：TAIEX 當下跌幅 ≥ X% → 暫停所有新買進（系統性風險防護）
    #   不是只擋半導體（SOX 跌 3% filter），整個大盤弱時就停手
    if settings.get('enable_taiex_crash_filter', True):
        try:
            with open('data/raw_data.json', 'r', encoding='utf-8') as _rf:
                _raw = json.load(_rf)
            taiex_cp = ((_raw.get('market') or {}).get('TAIEX') or {}).get('change_pct')
            taiex_limit = settings.get('taiex_crash_buy_limit_pct', -1.5)
            if isinstance(taiex_cp, (int, float)) and taiex_cp <= taiex_limit:
                return False, f'taiex_crash_{taiex_cp}_below_{taiex_limit}'
        except Exception:
            pass
    cooldown_end = (portfolio.get('cooldowns') or {}).get(sym)
    if cooldown_end and cooldown_end >= today_str:
        return False, f'cooldown_until_{cooldown_end}'

    if not snap or snap['price'] is None:
        return False, 'no_price'
    ai = snap['ai'] or {}
    if ai.get('verdict') != 'Bullish':
        return False, f'verdict_{ai.get("verdict")}'
    conf = ai.get('confidence') or 0
    # v12.1.2 改進 #2：個股 / ETF 拆 confidence 門檻
    if is_etf_sym:
        base_thresh = settings.get('confidence_threshold_etf', 80)
    else:
        base_thresh = settings.get('confidence_threshold_individual', 85)   # 個股更嚴
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

    # v11.7：強勢族群過濾 — 「對的訊號 + 對的族群」才進場
    # mode: off / weak_only（只擋弱勢/落後）/ top3_only（必須在前三大強勢）
    sf_mode = settings.get('sector_filter_mode', 'weak_only')
    if sf_mode != 'off':
        sd = snap.get('data') or {}
        sector_flow = sd.get('sector_flow') or {}
        sf_strength = sector_flow.get('strength')
        if sf_mode == 'weak_only' and sf_strength in ('弱勢', '落後'):
            return False, f'sector_weak_{sector_flow.get("sector_name", "?")}'
        if sf_mode == 'top3_only' and sf_strength not in ('強勢', '領漲'):
            return False, f'sector_not_top_{sector_flow.get("sector_name", "?")}'

    # v11.7：MA5 乖離過濾 — 避免追在「過熱」高點
    if settings.get('enable_ma5_extension_filter', True):
        ma5 = (snap.get('data', {}).get('technical', {}) or {}).get('MA5')
        if isinstance(ma5, (int, float)) and ma5 > 0:
            ext_pct = (price - ma5) / ma5 * 100
            base_limit = settings.get('ma5_extension_limit_pct', 3.0)
            relaxed_limit = settings.get('ma5_extension_strong_limit_pct', 5.0)
            sig_strength = (sug.get('signal_strength') or '').lower()
            limit = relaxed_limit if (sig_strength == 'strong' or conf >= 90) else base_limit
            if ext_pct > limit:
                return False, f'ma5_extended_{ext_pct:.1f}_over_{limit}'

    # v11.13.7：進場時 RS 相對強度過濾（修補 bug — 之前只在出場用，進場沒擋）
    # AI 給 Bullish 不代表這檔強過大盤；如果今天個股 -2% 大盤 +0.5%，就是逆勢買法
    if settings.get('enable_rs_entry_filter', True):
        sd_data = snap.get('data') or {}
        rs = sd_data.get('rs') or {}
        rs_label = rs.get('label')
        rs_vs = rs.get('vs_taiex_pct')
        # 規則 1：label 直接弱勢/極弱 → 拒絕
        if rs_label in ('弱勢', '極弱'):
            return False, f'rs_weak_entry_{rs_label}'
        # 規則 2：vs_taiex_pct 落後大盤 ≥ 1.5pp 也拒絕（雙重保險）
        rs_gap_limit = settings.get('rs_entry_gap_limit', -1.5)
        if isinstance(rs_vs, (int, float)) and rs_vs <= rs_gap_limit:
            return False, f'rs_underperform_{rs_vs}_below_{rs_gap_limit}'

    # v12.1.2 改進 #4：5 日累積漲幅過熱 → 拒絕進場（防追高，仁寶/力積電兩個 day_crash 案例都是追高）
    if not is_etf_sym and settings.get('enable_5d_overheat_filter', True):
        sd_data = snap.get('data') or {}
        tech = sd_data.get('technical') or {}
        # 5 日累積漲幅 = (今收 - 5 日前收) / 5 日前收
        # 沒直接欄位，用 MA5 偏離 + change_5d 做雙重判斷
        ma5 = tech.get('MA5')
        close = sd_data.get('close') or price
        if isinstance(ma5, (int, float)) and ma5 > 0:
            ma5_dev = (close - ma5) / ma5 * 100
            ma5_limit = settings.get('ma5_overheat_limit_pct', 8.0)
            if ma5_dev > ma5_limit:
                return False, f'5d_overheat_ma5dev_{ma5_dev:.1f}_over_{ma5_limit}'
        # 也檢查連續上漲天數（如果有）
        consecutive_up = tech.get('consecutive_up_days') or 0
        if isinstance(consecutive_up, (int, float)) and consecutive_up >= 5:
            return False, f'5d_overheat_5up_in_row'

    # v12.1.2 改進 #5：大型權值股需 RS 強勢才進場（避免在台積電/鴻海高檔追進）
    if _is_large_cap(sym) and settings.get('enable_large_cap_rs_filter', True):
        sd_data = snap.get('data') or {}
        rs = sd_data.get('rs') or {}
        rs_label = rs.get('label')
        rs_vs = rs.get('vs_taiex_pct')
        # 必須 label 是強勢/領漲，或 vs_taiex 至少 +0.5pp
        is_strong = rs_label in ('強勢', '領漲')
        is_outperform = isinstance(rs_vs, (int, float)) and rs_vs >= 0.5
        if not (is_strong or is_outperform):
            return False, f'large_cap_rs_not_strong_{rs_label}_vs{rs_vs}'

    # v11.14.12 #1：半導體股 + 美股暴跌 = 拒絕進場
    # 原 macro_defense 是全市場通用，這條專門擋半導體（SOX 跌幅 ≥ 3% 才適用）
    if settings.get('enable_semi_us_link_filter', True):
        sec = _sector_of(sym) or ''
        if '半導體' in sec or 'semiconductor' in sec.lower():
            macro_details = get_macro_risk().get('details') or {}
            sox_cp = macro_details.get('sox_change')
            nvda_cp = macro_details.get('nvda_change')
            worst = None
            for v in (sox_cp, nvda_cp):
                if isinstance(v, (int, float)):
                    worst = v if worst is None else min(worst, v)
            # v12.2.9：閾值收嚴 -3% → -2%（華邦電案例 SOX -2.15% 沒擋到）
            us_semi_drop_limit = settings.get('us_semi_drop_limit', -2.0)
            if worst is not None and worst <= us_semi_drop_limit:
                return False, f'us_semi_weak_{worst:.1f}_sec_{sec}'

    return True, ''


def _atr_adjust_stop(entry_price, ai_stop, atr, settings):
    """v11.7：用 ATR 校準 AI 給的停損價，避免「該股波動 5% 但停損只給 3%」（太緊）
    或「該股波動 1% 但停損給 8%」（太鬆）。

    規則：
      desired_min_distance = max(min_atr_mult × ATR, ai_stop_distance)  # 至少容忍 1.5 倍日均波動
      desired_max_distance = max_atr_mult × ATR                         # 但也不要超過 3 倍 ATR
      最終停損 = entry - clamp(原距離, min_distance, max_distance)
    """
    if not isinstance(atr, (int, float)) or atr <= 0 or not entry_price or not ai_stop:
        return ai_stop, "no_atr"
    min_mult = settings.get('atr_entry_stop_min_mult', 1.5)
    max_mult = settings.get('atr_entry_stop_max_mult', 3.0)
    ai_dist = entry_price - ai_stop
    min_dist = min_mult * atr
    max_dist = max_mult * atr
    if ai_dist < min_dist:
        new_stop = round(entry_price - min_dist, 2)
        return new_stop, f"widened (AI stop too tight: {ai_dist:.2f} < {min_dist:.2f})"
    if ai_dist > max_dist:
        new_stop = round(entry_price - max_dist, 2)
        return new_stop, f"tightened (AI stop too loose: {ai_dist:.2f} > {max_dist:.2f})"
    return ai_stop, "unchanged"


def _open_position(sym, snap, portfolio, settings, entry_side='right'):
    # v11.6：宏觀防禦覆寫 settings（per_position_cap 縮減 / max_positions 縮減）
    if settings.get('enable_macro_defense', True):
        settings = _apply_macro_defense(settings, get_macro_risk())
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
    # v12.2：左側交易倉位減半（風險高，賭小一點）
    if entry_side == 'left':
        budget *= settings.get('left_side_size_factor', 0.5)
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

    # v11.7：ATR 校準停損
    entry_atr = (snap.get('data', {}).get('technical', {}) or {}).get('ATR14')
    ai_stop = sug.get('stop_loss')
    adj_stop = ai_stop
    stop_adj_note = "no_atr"
    if settings.get('enable_atr_entry_stop', True):
        adj_stop, stop_adj_note = _atr_adjust_stop(price, ai_stop, entry_atr, settings)
        if adj_stop != ai_stop:
            print(f"  📐 [{sym}] ATR-adjust stop: {ai_stop} → {adj_stop} ({stop_adj_note}, ATR={entry_atr})", flush=True)

    # v12.2：左側交易停損放寬到「季線 MA60 再 -5%」（給反轉空間）
    if entry_side == 'left':
        ma60 = (snap.get('data', {}).get('technical', {}) or {}).get('MA60')
        if isinstance(ma60, (int, float)) and ma60 > 0:
            left_stop = round(ma60 * (1 - settings.get('left_side_stop_below_ma60_pct', 5.0) / 100), 2)
            adj_stop = left_stop
            stop_adj_note = f"left_side_ma60_{ma60}_-5pct"
        # 沒目標價就用 AI 給的，沒有就用 +15%
        if not sug.get('target_price'):
            sug = dict(sug)
            sug['target_price'] = round(price * 1.15, 2)

    portfolio['cash'] -= total
    # v11.14.12 #3：分批止盈計畫
    scale_out_plan = []
    if settings.get('enable_scale_out', True):
        levels = settings.get('scale_out_levels') or [
            {'trigger_pct': 10.0, 'fraction': 1 / 3},
            {'trigger_pct': 20.0, 'fraction': 1 / 3},
        ]
        for lv in levels:
            scale_out_plan.append({
                'trigger_pct': float(lv.get('trigger_pct', 10)),
                'fraction': float(lv.get('fraction', 1 / 3)),
                'executed': False,
                'executed_at': None,
                'executed_price': None,
            })

    portfolio['positions'][sym] = {
        'shares': shares,
        'original_shares': shares,           # v11.14.12 #3：分批止盈需要記原始股數
        'entry_price': round(price, 2),
        'entry_cost': round(total, 2),
        'original_entry_cost': round(total, 2),  # 同上
        'entry_date': today_str,
        'entry_time': now.strftime('%Y-%m-%d %H:%M:%S'),
        'entry_verdict': ai.get('verdict'),
        'entry_confidence': ai.get('confidence'),
        'target_price': sug.get('target_price'),
        'stop_loss': adj_stop,
        'ai_original_stop': ai_stop,         # 保留 AI 原值供審計
        'stop_adjustment_note': stop_adj_note,
        'expected_hold_days': sug.get('hold_days_expected'),
        'signal_strength': sug.get('signal_strength'),
        'name': snap['data'].get('name'),
        # v11.5：盤勢標籤（出場後也保留在 trade record，供回測勝率分組）
        'entry_market_regime': get_market_regime().get('regime', 'unknown'),
        'entry_taiex': get_market_regime().get('taiex'),
        # v11.6：ATR 移動停利欄位
        'highest_price': round(price, 2),
        'entry_atr': (snap.get('data', {}).get('technical', {}) or {}).get('ATR14'),
        'trailing_stop': None,           # 進場第一天先不啟動 trailing
        'trailing_activated': False,
        # v11.6.1：獲利鎖定
        'max_profit_pct': 0,
        'profit_locked': False,
        'profit_lock_stop': None,
        # v11.14.12 #3：分批止盈
        'scale_out_plan': scale_out_plan,
        'realized_pnl_partial': 0.0,        # 已分批實現的累積損益
        # v12.2：左側 / 右側交易標記（供勝率分組比較）
        'entry_side': entry_side,
    }
    return {'sym': sym, 'shares': shares, 'price': price, 'fee': fee}


def _check_scale_out(sym, snap, portfolio, settings):
    """v11.14.12 #3：分批止盈檢查
    - 浮盈到第 N 級 trigger_pct → 賣 fraction × original_shares
    - 第一級觸發後，停損上移到 entry_price（保本）
    - 第二級觸發後，停損上移到 entry × (1 + first_trigger/2) （鎖一半第一級獲利）
    - 寫一筆 partial=true 的 history 紀錄
    回傳：是否做了分批賣
    """
    pos = portfolio['positions'].get(sym)
    if not pos or not snap or snap.get('price') is None:
        return False
    plan = pos.get('scale_out_plan') or []
    if not plan:
        return False

    price = snap['price']
    entry = pos['entry_price']
    if entry <= 0:
        return False
    cur_pnl_pct = (price - entry) / entry * 100
    original_shares = pos.get('original_shares') or pos['shares']

    did_something = False
    for i, lv in enumerate(plan):
        if lv.get('executed'):
            continue
        if cur_pnl_pct < lv['trigger_pct']:
            continue
        # 觸發！
        sell_shares = max(1, int(round(original_shares * lv['fraction'])))
        # 不能賣超過剩餘的股數
        sell_shares = min(sell_shares, pos['shares'])
        if sell_shares < 1:
            continue
        proceeds = sell_shares * price
        fee = _calc_fees('sell', sell_shares, price)
        net = proceeds - fee
        # 平均成本 = entry_cost 對應 shares 的比例
        cost_share = pos['entry_cost'] / pos['shares']
        partial_cost = cost_share * sell_shares
        partial_pnl = net - partial_cost
        partial_pnl_pct = round(partial_pnl / partial_cost * 100, 2) if partial_cost else 0

        portfolio['cash'] += net
        pos['shares'] -= sell_shares
        pos['entry_cost'] = round(pos['entry_cost'] - partial_cost, 2)
        pos['realized_pnl_partial'] = round((pos.get('realized_pnl_partial') or 0) + partial_pnl, 2)
        lv['executed'] = True
        lv['executed_at'] = now.strftime('%Y-%m-%d %H:%M:%S')
        lv['executed_price'] = round(price, 2)

        # 停損上移
        if i == 0:
            # 第一級：上移到保本（entry_price）
            new_stop = entry
        else:
            # 後續級：上移到「entry × (1 + 上一級 trigger / 2)」 = 鎖住上一級的一半獲利
            prev_trigger = plan[i - 1]['trigger_pct']
            new_stop = round(entry * (1 + prev_trigger / 2 / 100), 2)
        if (pos.get('stop_loss') or 0) < new_stop:
            pos['stop_loss'] = new_stop

        # 寫 history（partial=true，這樣排行榜會把它當一筆勝/敗計）
        trade = {
            'sym': sym,
            'name': pos.get('name'),
            'shares': sell_shares,
            'entry_price': pos['entry_price'],
            'entry_date': pos['entry_date'],
            'exit_price': round(price, 2),
            'exit_date': today_str,
            'exit_time': now.strftime('%Y-%m-%d %H:%M:%S'),
            'exit_reason': f'scale_out_lv{i + 1}_at_{lv["trigger_pct"]:.1f}pct',
            'pnl': round(partial_pnl, 2),
            'pnl_pct': partial_pnl_pct,
            'hold_days': trading_days_between(pos['entry_date'], today_str),
            'entry_confidence': pos.get('entry_confidence'),
            'entry_verdict': pos.get('entry_verdict'),
            'signal_strength': pos.get('signal_strength'),
            'mode': 'scale_out',
            'partial': True,
            'partial_level': i + 1,
            'entry_side': pos.get('entry_side', 'right'),   # v12.2
            'entry_market_regime': pos.get('entry_market_regime', 'unknown'),
            'exit_market_regime': get_market_regime().get('regime', 'unknown'),
        }
        portfolio.setdefault('history', []).append(trade)
        # stats 也加（分批當作獨立一筆）
        s = portfolio.setdefault('stats', {})
        s['total_trades'] = s.get('total_trades', 0) + 1
        if partial_pnl > 0:
            s['win_trades'] = s.get('win_trades', 0) + 1
        s['total_pnl'] = round(s.get('total_pnl', 0) + partial_pnl, 2)

        print(f"  💰 [{sym}] 分批止盈 Lv{i + 1} @ {price} ({lv['trigger_pct']:.0f}%): "
              f"賣 {sell_shares} 股，實現 +{partial_pnl:.0f}（停損移到 {new_stop}）", flush=True)
        did_something = True

    # 全部分批都觸發完且剩餘 < 1% original → 直接全出
    if pos['shares'] < max(1, int(original_shares * 0.02)):
        _close_position(sym, snap, portfolio, 'scale_out_complete')
        return True

    return did_something


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
        # v12.2：左側 / 右側交易標記（供勝率分組比較）
        'entry_side': pos.get('entry_side', 'right'),
        # v11.5：盤勢標籤 — 開倉當天的盤勢，用來算分組勝率
        'entry_market_regime': pos.get('entry_market_regime', 'unknown'),
        'exit_market_regime': get_market_regime().get('regime', 'unknown'),
        # v11.6：ATR trailing 軌跡
        'highest_price': pos.get('highest_price'),
        'trailing_stop_at_exit': pos.get('trailing_stop'),
        'trailing_activated': bool(pos.get('trailing_activated')),
        # v11.6.1：獲利鎖定軌跡
        'max_profit_pct': pos.get('max_profit_pct'),
        'profit_locked': bool(pos.get('profit_locked')),
        'profit_lock_stop_at_exit': pos.get('profit_lock_stop'),
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
    "trailing_stop": "ATR 移動停利（鎖利）",       # v11.6
    "profit_lock":   "獲利鎖定（曾達高點，回吐出場）",  # v11.6.1
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
    if code.startswith('sector_full_'):
        return f"同族群已達上限（{code.split('_', 2)[2]}）"
    # v11.7
    if code.startswith('sector_weak_'):
        return f"族群弱勢/落後（{code.split('_', 2)[2]}）"
    if code.startswith('sector_not_top_'):
        return f"族群非前三強勢（{code.split('_', 3)[3]}）"
    if code.startswith('ma5_extended_'):
        try:
            parts = code.split('_')
            return f"乖離 MA5 過大（{parts[2]}% > {parts[4]}%）— 避免追高被套"
        except Exception:
            return "乖離 MA5 過大（過熱）"
    # v11.13.7
    if code.startswith('rs_weak_entry_'):
        label = code.split('_', 3)[3]
        return f"相對大盤{label} — 進場時 RS 不及格"
    if code.startswith('rs_underperform_'):
        try:
            parts = code.split('_')
            return f"落後大盤 {parts[2]}pp（門檻 {parts[4]}pp）— 逆勢買入風險高"
        except Exception:
            return "相對強度不足"
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

        # v11.6：每 tick 更新 ATR 移動停利（必須在 _should_exit 之前）
        _update_trailing_stop(pos, snap, settings)

        # v11.14.12 #3：分批止盈檢查（在 _should_exit 之前，可能會局部減倉）
        try:
            scaled = _check_scale_out(sym, snap, portfolio, settings)
            if scaled and sym not in portfolio.get('positions', {}):
                # _check_scale_out 已經把它全平倉了
                continue
            # 分批後 pos 物件可能 shares 改變，重新取
            pos = portfolio['positions'].get(sym)
            if not pos:
                continue
        except Exception as _e:
            print(f"  ⚠️ scale_out error {sym}: {_e}", flush=True)

        # v11.10：階梯預警 + 鴨子飛了警示（出場前先檢查）
        try:
            _check_ladder_and_duck_alerts(uid, sym, pos, snap, settings)
        except Exception as _e:
            print(f"  ⚠️ ladder/duck alert error {sym}: {_e}", flush=True)

        should, reason = _should_exit(pos, snap, settings, sym)
        if should:
            # 抓出場前的快照（給 Discord 用）
            _exit_snapshot = {
                'entry_price': pos.get('entry_price'),
                'shares': pos.get('shares'),
                'name': pos.get('name'),
                'entry_date': pos.get('entry_date'),
                'max_profit_pct': pos.get('max_profit_pct'),
            }
            trade = _close_position(sym, snap, portfolio, reason)
            if trade:
                exits.append(trade)
                print(f"  📤 [{uid}] EXIT {sym} @ {trade['exit_price']} ({reason}) pnl={trade['pnl_pct']}%", flush=True)
                # v11.10：推 Discord
                if _nd and _nd.should_notify_uid(uid):
                    try:
                        _nd.card_exit(
                            sym=sym,
                            name=trade.get('name') or _exit_snapshot['name'],
                            shares=trade.get('shares'),
                            entry_price=trade.get('entry_price'),
                            exit_price=trade.get('exit_price'),
                            pnl=trade.get('pnl'),
                            pnl_pct=trade.get('pnl_pct'),
                            reason_zh=_reason_zh(reason),
                            hold_days=trade.get('hold_days'),
                            max_profit_pct=_exit_snapshot.get('max_profit_pct'),
                            entry_date=_exit_snapshot.get('entry_date'),
                        )
                    except Exception as _e:
                        print(f"  ⚠️ Discord exit push failed: {_e}", flush=True)

    # 2. 進場檢查（含連續確認）
    pending = portfolio.setdefault('pending_confirms', {})
    # 清理已過期的 pending（last_seen 非今日）
    for sym in list(pending.keys()):
        ls = pending[sym].get('last_seen', '')
        if ls[:10] != today_str:
            del pending[sym]

    stocks = (watchlist_analysis or {}).get('stocks', {})

    # v11.8：AI 自選帳戶 — 評估範圍只限 ai_picked_watchlist 的選股（與全 watchlist 取交集）
    eval_universe = list(stocks.keys())
    if settings.get('ai_curated_watchlist'):
        ai_picks = []
        try:
            ai_pw_path = 'data/ai_picked_watchlist.json'
            if os.path.exists(ai_pw_path):
                with open(ai_pw_path, 'r', encoding='utf-8') as f:
                    _aipw = json.load(f) or {}
                ai_picks = [(p.get('symbol') or '').strip() for p in (_aipw.get('picks') or [])]
                ai_picks = [s for s in ai_picks if s]
        except Exception as e:
            print(f"  ⚠️ [{uid}] load ai_picked_watchlist failed: {e}", flush=True)
        # 取交集（沒進 watchlist_analysis 的就分析不到，直接略過）
        eval_universe = [s for s in ai_picks if s in stocks]
        print(f"  🤖 [{uid}] AI 自選模式：{len(ai_picks)} picks → {len(eval_universe)} 可評估", flush=True)

    # 計算今日已進場數
    today_entries = sum(1 for t in portfolio.get('history', [])
                        if t.get('entry_date') == today_str)
    today_entries += sum(1 for p in portfolio.get('positions', {}).values()
                         if p.get('entry_date') == today_str)
    # v12.1.2：今日已進場 sym 清單（給 ETF/個股拆分用）
    today_entries_list = (
        [t.get('sym') for t in portfolio.get('history', []) if t.get('entry_date') == today_str]
        + [s for s, p in portfolio.get('positions', {}).items() if p.get('entry_date') == today_str]
    )

    entries = []
    # v10.8.2：逐檔紀錄「為什麼沒買」的原因，供前端顯示
    reasons_breakdown = {}   # reason_code → count
    def _bump(code):
        reasons_breakdown[code] = reasons_breakdown.get(code, 0) + 1

    for sym in eval_universe:
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

        # v11.9 #6：盤中量能激增 → 跳過第 2 次確認（單次即可進場）
        # 觸發條件：volume_analysis.ratio >= 2.0（強烈主力進場訊號）
        sd = (snap.get('data') or {})
        va = sd.get('volume_analysis') or {}
        vol_ratio = va.get('ratio')
        volume_surge = (
            settings.get('enable_volume_surge_fast_track', True)
            and isinstance(vol_ratio, (int, float)) and vol_ratio >= 2.0
        )
        required_confirms = 1 if volume_surge else 2
        if pending[sym]['count'] < required_confirms:
            _bump('pending_confirm')  # 還差確認次數
            continue
        if volume_surge:
            print(f"  ⚡ [{uid}] {sym} 量能激增 ratio={vol_ratio} → 快速通道（跳過第 2 次確認）", flush=True)

        can, why = _should_enter(sym, snap, portfolio, settings, today_entries, today_entries_list)
        if not can:
            _bump(why or 'unknown_block')
            continue
        trade = _open_position(sym, snap, portfolio, settings)
        if trade:
            entries.append(trade)
            today_entries += 1
            today_entries_list.append(sym)
            del pending[sym]
            print(f"  📥 [{uid}] ENTER {sym} {trade['shares']}股 @ {trade['price']}", flush=True)
            # v11.10：推 Discord（進場卡片）
            if _nd and _nd.should_notify_uid(uid):
                try:
                    pos = portfolio['positions'].get(sym, {})
                    _nd.card_entry(
                        sym=sym,
                        name=pos.get('name') or sym,
                        shares=trade.get('shares'),
                        price=trade.get('price'),
                        target=pos.get('target_price'),
                        stop=pos.get('stop_loss'),
                        confidence=pos.get('entry_confidence'),
                        signal_strength=pos.get('signal_strength'),
                        regime_zh=REGIME_ZH.get(pos.get('entry_market_regime', 'unknown'), '-'),
                        sector=_sector_of(sym),
                        cost=pos.get('entry_cost'),
                    )
                except Exception as _e:
                    print(f"  ⚠️ Discord entry push failed: {_e}", flush=True)

    # ── v12.2：受控左側交易（預設關閉，settings.enable_left_side_entry 開）──
    if settings.get('enable_left_side_entry', False):
        for sym in eval_universe:
            if today_entries >= settings.get('daily_entry_limit', 3):
                break
            snap = _stock_snapshot(sym, watchlist_analysis)
            can, why = _should_enter_left_side(sym, snap, portfolio, settings)
            if not can:
                if why and not why.startswith('left_not_golden'):
                    _bump(why)   # 黃金交叉以外的拒絕原因才記（避免洗版）
                continue
            trade = _open_position(sym, snap, portfolio, settings, entry_side='left')
            if trade:
                entries.append(trade)
                today_entries += 1
                today_entries_list.append(sym)
                if sym in pending:
                    del pending[sym]
                pos = portfolio['positions'].get(sym, {})
                print(f"  📥🩸 [{uid}] LEFT-SIDE ENTER {sym} {trade['shares']}股 @ {trade['price']} "
                      f"(季線抄底, stop={pos.get('stop_loss')})", flush=True)
                if _nd and _nd.should_notify_uid(uid):
                    try:
                        _nd.card_entry(
                            sym=sym, name=pos.get('name') or sym,
                            shares=trade.get('shares'), price=trade.get('price'),
                            target=pos.get('target_price'), stop=pos.get('stop_loss'),
                            confidence=pos.get('entry_confidence'),
                            signal_strength='左側抄底',
                            regime_zh=REGIME_ZH.get(pos.get('entry_market_regime', 'unknown'), '-'),
                            sector=_sector_of(sym), cost=pos.get('entry_cost'),
                        )
                    except Exception as _e:
                        print(f"  ⚠️ Discord left-side entry push failed: {_e}", flush=True)

    # 3. 組合狀態摘要（給前端 UI）
    evaluated = len(eval_universe)
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
        # v11.6：宏觀風險 / 防禦模式
        "macro_risk": get_macro_risk(),
        "macro_level_zh": MACRO_LEVEL_ZH.get(get_macro_risk().get("level", "normal"), "-"),
        # v11.6：族群集中度
        "sector_concentration": _sector_concentration(portfolio),
    }

    # v11.11 B：連續虧損警告（出場後檢查）
    if exits and _nd and _nd.should_notify_uid(uid):
        try:
            _check_losing_streak(uid, portfolio)
        except Exception as e:
            print(f"  ⚠️ losing-streak push failed: {e}", flush=True)

    # v11.11 D：收盤即時簡訊（13:30 後第一次 tick 推一次）
    if _nd and _nd.should_notify_uid(uid):
        try:
            _maybe_push_closing_brief(uid, portfolio, watchlist_analysis,
                                       len(entries), len(exits))
        except Exception as e:
            print(f"  ⚠️ closing-brief push failed: {e}", flush=True)

    # v12.3.1：寫回前先記今日 snapshot（給走勢圖用）
    record_daily_snapshot(portfolio, watchlist_analysis)

    # 4. 一律寫回 KV（即使沒交易，狀態也要更新）
    ok = save_portfolio(uid, portfolio)
    if ok:
        if exits or entries:
            print(f"  ✅ [{uid}] saved: {len(exits)} exits, {len(entries)} entries, {len(portfolio.get('positions', {}))} holding", flush=True)
        else:
            print(f"  ℹ️ [{uid}] no changes — {reason_zh}", flush=True)


def _check_losing_streak(uid, portfolio):
    """連 3 筆虧損出場 → 推 Discord（一次警示後，要回血才會再次警示）"""
    history = portfolio.get('history') or []
    if len(history) < 3:
        return
    recent = history[-5:]
    last3 = history[-3:]
    if all((t.get('pnl') or 0) < 0 for t in last3):
        # 避免每筆都推（用 last_streak_alerted 標記）
        last_alerted = portfolio.get('last_streak_alerted_index')
        cur_idx = len(history)
        if last_alerted == cur_idx:
            return
        total_loss = sum((t.get('pnl') or 0) for t in last3)
        total_loss_pct = sum((t.get('pnl_pct') or 0) for t in last3)
        try:
            _nd.card_losing_streak(streak=3, recent_trades=last3,
                                    total_loss=total_loss, total_loss_pct=total_loss_pct)
            portfolio['last_streak_alerted_index'] = cur_idx
        except Exception as e:
            print(f"  ⚠️ losing_streak card failed: {e}", flush=True)


def _maybe_push_closing_brief(uid, portfolio, wa, entries_count, exits_count):
    """13:30-13:50 視窗推一次當日簡訊"""
    h, m = now.hour, now.minute
    in_window = (h == 13 and 30 <= m < 50)
    if not in_window:
        return
    today_str_local = now.strftime('%Y-%m-%d')
    last_pushed = portfolio.get('last_closing_brief_date')
    if last_pushed == today_str_local:
        return  # 今天已推過

    # v11.12.2：算「當日累積」進出場，不是「這一輪」
    history = portfolio.get('history') or []
    positions = portfolio.get('positions') or {}
    today_realized = sum((t.get('pnl') or 0) for t in history if t.get('exit_date') == today_str_local)

    # 當日累積出場 = history 中 exit_date == today
    today_exits_total = sum(1 for t in history if t.get('exit_date') == today_str_local)
    # 當日累積進場 = positions 中 entry_date == today（還沒平倉的）
    #              + history 中 entry_date == today（當日進當日出）
    today_entries_total = sum(1 for p in positions.values() if p.get('entry_date') == today_str_local)
    today_entries_total += sum(1 for t in history if t.get('entry_date') == today_str_local)

    init_capital = (portfolio.get('settings') or {}).get('initial_capital', 1_000_000)
    today_pnl_pct = today_realized / init_capital * 100 if init_capital else 0

    # 加權指數
    taiex_change = 0
    try:
        market = (wa or {}).get('sector_flow', {}).get('taiex') or {}
        taiex_change = market.get('change_pct') or 0
    except Exception:
        pass

    try:
        _nd.card_closing_brief(date_str=today_str_local,
                                taiex_change_pct=taiex_change,
                                today_pnl=today_realized,
                                today_pnl_pct=today_pnl_pct,
                                entries_count=today_entries_total,
                                exits_count=today_exits_total)
        portfolio['last_closing_brief_date'] = today_str_local
    except Exception as e:
        print(f"  ⚠️ closing_brief card failed: {e}", flush=True)


# ============================================================
# v11.8：AI 機器人帳戶（檔案制，繞過 KV）
# ============================================================
AI_BOT_UID = 'ai_scout_bot'
AI_BOT_PORTFOLIO_PATH = 'data/ai_bot_portfolio.json'


def _ai_bot_default_portfolio():
    return {
        'uid': AI_BOT_UID,
        'initialized': True,    # ★ 前端 render() 用此旗標判定「已開戶」
        'cash': 1_000_000,
        'positions': {},
        'history': [],
        'stats': {'total_trades': 0, 'win_trades': 0, 'total_pnl': 0},
        'cooldowns': {},
        'pending_confirms': {},
        'settings': {
            'initial_capital': 1_000_000,
            'max_positions': 10,                  # AI 帳戶最多 10 檔
            'per_position_cap': 100_000,          # 1,000,000 / 10
            'confidence_threshold': 80,
            'cooldown_trading_days': 5,
            'min_hold_trading_days': 3,
            'stale_exit_trading_days': 10,
            'daily_entry_limit': 5,               # AI 比較積極，5/天
            'auto_trade': True,                   # AI 帳戶預設開啟自動交易
            'enable_ai_review': True,
            'ai_curated_watchlist': True,         # ★ 重點旗標
            'profit_lock_arm_pct': 7,
            'profit_lock_floor_pct': 3,
            'ma5_extension_limit_pct': 3,
            'sector_filter_mode': 'weak_only',
            # v12.2：受控左側交易（黃金交叉股 + 季線支撐 + 超賣才抄底）
            'enable_left_side_entry': True,
            'left_side_size_factor': 0.5,         # 倉位減半
            'left_side_ma60_near_pct': 3.0,       # 回檔到季線 ±3%
            'left_side_rsi_limit': 35,            # RSI < 35
            'left_side_stop_below_ma60_pct': 5.0, # 停損 = 季線 -5%
        },
        'engine_updated_at': now.strftime('%Y-%m-%d %H:%M:%S'),
        'has_password': False,
    }


def _load_ai_bot_portfolio():
    if not os.path.exists(AI_BOT_PORTFOLIO_PATH):
        return _ai_bot_default_portfolio()
    try:
        with open(AI_BOT_PORTFOLIO_PATH, 'r', encoding='utf-8') as f:
            p = json.load(f)
        # 補齊缺失設定 / 旗標
        p.setdefault('initialized', True)
        p.setdefault('settings', {})
        defaults = _ai_bot_default_portfolio()['settings']
        for k, v in defaults.items():
            p['settings'].setdefault(k, v)
        return p
    except Exception as e:
        print(f"  ⚠️ load ai_bot_portfolio failed: {e}, recreating", flush=True)
        return _ai_bot_default_portfolio()


def _save_ai_bot_portfolio(portfolio):
    try:
        portfolio['engine_updated_at'] = now.strftime('%Y-%m-%d %H:%M:%S')
        os.makedirs('data', exist_ok=True)
        with open(AI_BOT_PORTFOLIO_PATH, 'w', encoding='utf-8') as f:
            json.dump(portfolio, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"  ⚠️ save ai_bot_portfolio failed: {e}", flush=True)
        return False


def process_ai_bot(watchlist_analysis):
    """v11.8：AI 機器人帳戶 — 與 process_user 同邏輯，但 I/O 走檔案，不打 Worker KV"""
    portfolio = _load_ai_bot_portfolio()
    settings = portfolio.get('settings') or {}

    # 跟 process_user 後段一樣：出場 → 進場 → 寫狀態
    # 這裡直接呼叫 process_user 的邏輯，需要先把 get_portfolio / save_portfolio 短路掉
    # 為了不重複 ~150 行程式碼，採用 monkey-patch 注入：

    # 替身：暫時把 get_portfolio / save_portfolio 換成「讀寫這個 dict」
    global get_portfolio, save_portfolio
    _orig_get = get_portfolio
    _orig_save = save_portfolio
    _saved_holder = {'data': None}

    def _bot_get(uid):
        return portfolio if uid == AI_BOT_UID else _orig_get(uid)

    def _bot_save(uid, data):
        if uid == AI_BOT_UID:
            _saved_holder['data'] = data
            return _save_ai_bot_portfolio(data)
        return _orig_save(uid, data)

    get_portfolio = _bot_get
    save_portfolio = _bot_save
    try:
        process_user(AI_BOT_UID, watchlist_analysis)
    finally:
        get_portfolio = _orig_get
        save_portfolio = _orig_save


def main():
    # EOD settlement 由 14:30 cron 觸發；盤中每 10 分鐘觸發
    if not (is_trading_hours or is_after_market):
        print(f"  ⏰ Outside trading hours ({now.strftime('%H:%M')}), skipping.", flush=True)
        return
    wa = load_json('data/watchlist_analysis.json')
    if not wa:
        print("  ⚠️ No watchlist_analysis.json, skipping.", flush=True)
        return
    # v11.8：先跑 AI 機器人帳戶（檔案制，獨立於使用者 KV）
    try:
        print("  🤖 Processing AI scout bot account...", flush=True)
        process_ai_bot(wa)
    except Exception as e:
        print(f"  ❌ AI bot account failed: {e}", flush=True)
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
