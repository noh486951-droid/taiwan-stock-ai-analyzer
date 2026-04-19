"""
每日基準資料預抓取 — 早上開盤前（07:00）執行一次
預先計算自選股「過去 5 個完整交易日」的平均成交量 (MA5 Volume)
存入 data/daily_base_data.json

10 分鐘高頻更新（watchlist_quick.py）只會讀這份 JSON，不再重複抓歷史資料
→ 避免 Yahoo API rate limit + 省 GitHub Actions 分鐘數

v10.5 新增
"""
import os
import sys
import json
from datetime import datetime
import pytz

tw_tz = pytz.timezone('Asia/Taipei')
current_time = datetime.now(tw_tz)

print(f"[{current_time.strftime('%Y-%m-%d %H:%M:%S')}] Daily Base Prefetch starting...", flush=True)

# 非交易日也要跑（讓盤中讀得到前一日的 MA5）
# 週六週日略過即可
weekday = current_time.weekday()  # 0=Mon, 6=Sun
if weekday >= 5:
    print(f"  📅 Weekend ({current_time.strftime('%A')}), skipping prefetch.", flush=True)
    sys.exit(0)

sys.path.insert(0, os.path.dirname(__file__))
from fetch_all import (
    fetch_cloud_watchlist_symbols,
    fetch_ma5_volumes,
    fetch_financial_alerts_batch,
    fetch_monthly_revenue,
    fetch_tdcc_concentration,
)


def main():
    # 1. 取得自選股清單（雲端 + 本地）
    cloud_symbols = fetch_cloud_watchlist_symbols()
    local_symbols = []
    watchlist_path = "data/watchlist.json"
    if os.path.exists(watchlist_path):
        try:
            with open(watchlist_path, "r", encoding="utf-8") as f:
                local_symbols = json.load(f)
        except Exception:
            pass

    all_symbols = list(dict.fromkeys(cloud_symbols + local_symbols))
    if not all_symbols:
        print("  No watchlist stocks. Exiting.", flush=True)
        return

    print(f"  📋 Watchlist: {len(all_symbols)} stocks", flush=True)

    # 2. 抓 MA5 成交量
    ma5_data = fetch_ma5_volumes(all_symbols)

    if not ma5_data:
        print("  ⚠️ No MA5 data fetched. Exiting.", flush=True)
        return

    # 3. 計算財務預警（一天一次，財報欄位當日不會變）
    fin_alerts = {}
    try:
        fin_alerts = fetch_financial_alerts_batch(all_symbols)
    except Exception as e:
        print(f"  ⚠️ Financial alerts batch failed: {e}", flush=True)

    # 4. 抓每月營收（v10.6 功能 1）
    monthly_rev = {}
    try:
        monthly_rev = fetch_monthly_revenue(all_symbols)
    except Exception as e:
        print(f"  ⚠️ Monthly revenue fetch failed: {e}", flush=True)

    # 5. TDCC 大戶/散戶持股（v10.7 功能 1，每週五資料才會變，其他日讀 cache）
    tdcc = {}
    try:
        tdcc = fetch_tdcc_concentration(all_symbols)
    except Exception as e:
        print(f"  ⚠️ TDCC concentration fetch failed: {e}", flush=True)

    # 6. 合併：stocks[sym] = {"ma5_volume":..., "financial_alerts":..., "monthly_revenue":..., "tdcc":...}
    merged = {}
    for sym in all_symbols:
        entry = dict(ma5_data.get(sym, {}))
        fa = fin_alerts.get(sym)
        if fa:
            entry["financial_alerts"] = fa
        rev = monthly_rev.get(sym)
        if rev:
            entry["monthly_revenue"] = rev
        td = tdcc.get(sym)
        if td:
            entry["tdcc"] = td
        if entry:
            merged[sym] = entry

    # 5. 輸出
    os.makedirs("data", exist_ok=True)
    output = {
        "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
        "date": current_time.strftime('%Y-%m-%d'),
        "stocks": merged,
    }
    with open("data/daily_base_data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    alert_count = sum(1 for v in merged.values() if v.get("financial_alerts"))
    rev_count = sum(1 for v in merged.values() if v.get("monthly_revenue"))
    rev_anomaly_count = sum(1 for v in merged.values() if v.get("monthly_revenue", {}).get("anomaly"))
    tdcc_count = sum(1 for v in merged.values() if v.get("tdcc"))
    tdcc_signal_count = sum(1 for v in merged.values() if v.get("tdcc", {}).get("signal") not in (None, "neutral", "no_baseline"))
    print(f"  ✅ Daily base data saved: {len(merged)} stocks | alerts={alert_count} | revenue={rev_count}/{rev_anomaly_count} | tdcc={tdcc_count}/{tdcc_signal_count}", flush=True)


if __name__ == "__main__":
    main()
