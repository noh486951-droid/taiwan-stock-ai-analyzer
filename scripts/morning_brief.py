"""
morning_brief.py — 盤前準備卡 (v11.11)

每日 08:30 TW 跑一次（00:30 UTC）
推送內容：
  - 美股昨夜（NVDA / SOX / DJI / NDX）
  - 台指期夜盤（如有）
  - 今日總經大事（從 macro_calendar.json）
  - 你的持倉昨收狀況（從 paper-trade KV）
  - AI 自選 Top 5（從 ai_picked_watchlist.json）
"""
from __future__ import annotations

import os
import sys
import json
from datetime import datetime
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# Discord notify
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import notify_discord as _nd
except Exception:
    _nd = None

TW_TZ = pytz.timezone("Asia/Taipei")
NOW = datetime.now(TW_TZ)
TODAY = NOW.strftime("%Y-%m-%d")


def _load(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _fetch_user_positions():
    if not _nd or not _nd.NOTIFY_UID:
        return []
    worker_url = os.environ.get('WORKER_URL', 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev')
    secret = os.environ.get('PAPER_TRADE_ENGINE_SECRET', '')
    try:
        import requests
        r = requests.get(
            f"{worker_url}/api/paper-trade?uid={_nd.NOTIFY_UID}&engine=1",
            headers={'X-Engine-Secret': secret, 'X-Engine': '1'},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json() or {}
        positions = data.get('positions') or {}
        # 載入最近收盤價
        wa = _load('data/watchlist_analysis.json') or {}
        stocks = wa.get('stocks') or {}
        out = []
        for sym, p in positions.items():
            sd = stocks.get(sym, {})
            last_close = sd.get('price') or p.get('entry_price')
            entry = p.get('entry_price') or last_close
            pnl_pct = ((last_close - entry) / entry * 100) if entry else 0
            out.append({
                'sym': sym,
                'name': p.get('name'),
                'last_close': last_close,
                'pnl_pct': round(pnl_pct, 2),
            })
        return out
    except Exception as e:
        print(f"  ⚠️ fetch positions: {e}", flush=True)
        return []


def main():
    print(f"=== Morning Brief — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    if NOW.weekday() >= 5:
        print("  ⏰ 週末，skip", flush=True)
        return
    if _nd is None or not _nd.NOTIFY_UID:
        print("  ⚠️ Discord 未設定，skip", flush=True)
        return

    # v12.7.1：一天只推一次（用戶回報 7 點/8 點各收到一次相同內容）
    #   原因：main.yml 07:07 排程 + CF dispatch/延遲 cron 都落在 7-10 點窗口
    #   用 state 檔記錄推送日（workflow Auto Update commit 會把它帶回 repo）
    state_path = 'data/_pushed_morning_brief.json'
    today_str = NOW.strftime('%Y-%m-%d')
    try:
        if os.path.exists(state_path):
            with open(state_path, 'r', encoding='utf-8') as f:
                st = json.load(f) or {}
            if st.get('date') == today_str:
                print(f"  ↩️ 今天 ({today_str}) 已推過盤前準備卡，skip", flush=True)
                return
    except Exception:
        pass

    # 1. 美股昨夜
    raw = _load('data/raw_data.json') or {}
    market = raw.get('market_data') or raw.get('market') or {}
    us_overnight = {
        'NVDA': market.get('NVDA') or {},
        'SOX': market.get('SOX') or {},
        'AAPL': market.get('AAPL') or {},
        'TSM': market.get('TSMC_ADR') or {},
        'DJI': market.get('DOW') or market.get('DJI') or {},
        'NDX': market.get('NDX') or market.get('NASDAQ') or {},
    }

    # 2. 台指期夜盤（暫無資料源就 None）
    futures_night = {}

    # 3. 今日大事
    today_macro = []
    mc = _load('data/macro_calendar.json') or {}
    for e in (mc.get('events') or []):
        if e.get('date') == TODAY and e.get('importance') in ('high', 'medium'):
            today_macro.append(e)

    # 4. 持倉
    positions = _fetch_user_positions()

    # 5. AI 自選
    ai_pw = _load('data/ai_picked_watchlist.json') or {}
    ai_picks = ai_pw.get('picks') or []

    # 推送
    try:
        ok = _nd.card_morning_brief(
            date_str=TODAY,
            us_overnight=us_overnight,
            futures_night=futures_night,
            today_macro=today_macro,
            positions=positions,
            ai_picks=ai_picks,
        )
        print(f"  📲 Discord push: {ok}", flush=True)
        # v12.7.1：推成功才記 state（失敗時下一輪還能補推）
        if ok:
            try:
                with open(state_path, 'w', encoding='utf-8') as f:
                    json.dump({'date': today_str, 'pushed_at': NOW.strftime('%H:%M:%S')}, f, ensure_ascii=False)
            except Exception:
                pass
    except Exception as e:
        print(f"  ❌ morning brief push failed: {e}", flush=True)


if __name__ == "__main__":
    main()
