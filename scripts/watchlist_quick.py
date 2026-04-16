"""
盤中個股快速更新 — 每 10 分鐘跑一次
只更新自選股價格 + 法人資料 + AI 批次分析
不跑：大盤分析、晨間快報、族群地圖、新聞
"""
import os
import sys
import json
import time
from datetime import datetime
import pytz

tw_tz = pytz.timezone('Asia/Taipei')
current_time = datetime.now(tw_tz)

print(f"[{current_time.strftime('%Y-%m-%d %H:%M:%S')}] Watchlist Quick Update starting...", flush=True)

# ── 檢查是否在交易時間（09:00 ~ 13:35） ──
hour, minute = current_time.hour, current_time.minute
time_val = hour * 100 + minute
if time_val < 855 or time_val > 1340:
    print(f"  ⏰ Outside trading hours ({current_time.strftime('%H:%M')}), skipping.", flush=True)
    sys.exit(0)

# ── 匯入 fetch_all 的必要函式 ──
sys.path.insert(0, os.path.dirname(__file__))
from fetch_all import (
    fetch_cloud_watchlist_symbols, fetch_stock_detail,
    fetch_chip_concentration, fetch_stock_institutional,
)

# ── 匯入 ai_analyzer 的批次分析 ──
from ai_analyzer import (
    get_client, analyze_watchlist, MODEL_FLASH_LITE,
)


def main():
    # 1. 取得自選股清單
    symbols = fetch_cloud_watchlist_symbols()

    # 本地 fallback
    watchlist_path = "data/watchlist.json"
    local_symbols = []
    if os.path.exists(watchlist_path):
        try:
            with open(watchlist_path, "r", encoding="utf-8") as f:
                local_symbols = json.load(f)
        except Exception:
            pass
    all_symbols = list(dict.fromkeys(symbols + local_symbols))

    if not all_symbols:
        print("  No watchlist stocks. Exiting.", flush=True)
        return

    print(f"  📋 Watchlist: {len(all_symbols)} stocks → {all_symbols}", flush=True)

    # 2. 抓取即時股價
    watchlist_data = {}
    for sym in all_symbols:
        print(f"  Fetching: {sym}", flush=True)
        watchlist_data[sym] = fetch_stock_detail(sym)

    # 3. 籌碼集中度
    chip_conc = fetch_chip_concentration(all_symbols)
    for sym, conc in chip_conc.items():
        if sym in watchlist_data:
            watchlist_data[sym]["chip_concentration"] = conc

    # 4. 個股法人買賣超 + 5日歷史
    tw_symbols = [s for s in all_symbols if '.TW' in s]
    if tw_symbols:
        inst_data = fetch_stock_institutional(tw_symbols)
        for sym, inst in inst_data.items():
            if sym in watchlist_data:
                watchlist_data[sym]["institutional"] = inst

    # 5. 讀取既有新聞（不重新抓）
    news_titles = []
    try:
        with open("data/raw_data.json", "r", encoding="utf-8") as f:
            raw = json.load(f)
            news_titles = [n.get("title", "") for n in raw.get("news", [])]
    except Exception:
        pass

    # 6. AI 批次分析（1 個 request）
    client = get_client()
    print(f"  🤖 AI batch analysis ({MODEL_FLASH_LITE})...", flush=True)
    data_for_ai = {"watchlist": watchlist_data, "news": [{"title": t} for t in news_titles]}
    watchlist_result = analyze_watchlist(client, data_for_ai)

    # 7. 輸出
    os.makedirs("data", exist_ok=True)
    if watchlist_result:
        output = {
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "update_type": "quick",
            "stocks": watchlist_result,
        }
        with open("data/watchlist_analysis.json", "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"  ✅ Watchlist quick update done: {len(watchlist_result)} stocks", flush=True)
    else:
        print("  ⚠️ No analysis results.", flush=True)


if __name__ == "__main__":
    main()
