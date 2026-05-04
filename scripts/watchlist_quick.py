"""
盤中個股快速更新 — 每 10 分鐘跑一次

v10.5 更新：
- 從 daily_base_data.json 讀取 MA5 成交量（不重複抓歷史）
- 計算 volume_ratio（盤中時間校正，B 方案）
- 把量能比資訊塞進 AI prompt payload
- 整點時段（10:00, 11:00, 13:00）才跑新聞（省 API）
- Groq 新聞情感分析（雙意見：Gemini 技術 + Groq 新聞）

不跑：大盤分析、晨間快報、族群地圖
"""
import os
import sys
import json
import time
from datetime import datetime
import pytz

# === 編碼保險：避免 emoji 在 Windows cp950 / 某些 Linux 最小 locale 下崩潰 ===
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

tw_tz = pytz.timezone('Asia/Taipei')
current_time = datetime.now(tw_tz)

print(f"[{current_time.strftime('%Y-%m-%d %H:%M:%S')}] Watchlist Quick Update (v10.5) starting...", flush=True)

# ── 檢查是否在交易時間（08:55 ~ 13:40） ──
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
    fetch_news, fetch_realtime_prices, _sanitize_symbol_list,
    fetch_sector_realtime_mis,
)

# v11.2: TW 產業對應到我們的 sector 代碼（給 RS 查族群強度用）
# 只列最常見的，對不到的就歸「其他」
_INDUSTRY_TO_SECTOR = {
    "半導體": "半導體", "積體電路": "半導體", "IC": "半導體",
    "電腦": "電腦週邊", "週邊": "電腦週邊",
    "光電": "光電", "面板": "光電",
    "電子零組件": "電子零組件", "被動": "電子零組件", "連接器": "電子零組件",
    "通路": "電子通路",
    "資訊服務": "資訊服務", "軟體": "資訊服務",
    "電子": "電子工業",
    "金融": "金融", "保險": "金融", "銀行": "金融",
    "航運": "航運", "海運": "航運", "航空": "航運",
    "觀光": "觀光", "餐飲": "觀光",
    "塑膠": "塑膠", "塑": "塑膠",
    "生技": "生技醫療", "醫療": "生技醫療", "製藥": "生技醫療",
    "貿易": "貿易百貨", "百貨": "貿易百貨", "零售": "貿易百貨",
    "食品": "食品",
    "化學": "化學", "化工": "化學",
    "鋼鐵": "鋼鐵", "鋼": "鋼鐵",
    "汽車": "汽車",
}


def _match_sector(industry_name, sector_flow):
    """用粗略字串比對把個股 industry 歸到我們抓的族群，回傳 sector dict 或 None"""
    if not industry_name or not sector_flow:
        return None
    sectors = sector_flow.get("sectors") or []
    # 直接精準比對名稱
    for s in sectors:
        if s["name"] in industry_name or industry_name in s["name"]:
            return s
    # 關鍵字映射
    for keyword, target in _INDUSTRY_TO_SECTOR.items():
        if keyword in industry_name:
            for s in sectors:
                if s["name"] == target:
                    return s
    return None


def _compute_rs(stock_change_pct, taiex_change_pct):
    """算個股相對強度 → {vs_taiex_pct, label}"""
    if stock_change_pct is None or taiex_change_pct is None:
        return None
    diff = round(stock_change_pct - taiex_change_pct, 2)
    if diff >= 2.0:
        label = "強勢"
    elif diff >= 0.5:
        label = "跟漲"
    elif diff <= -2.0:
        label = "極弱"
    elif diff <= -0.5:
        label = "弱勢"
    else:
        label = "平盤"
    return {"vs_taiex_pct": diff, "label": label}

# ── 匯入 ai_analyzer 的批次分析 ──
from ai_analyzer import (
    get_client, analyze_watchlist, MODEL_FLASH_LITE,
)


# ============================================================
# v10.5: 量能比計算（B 方案：盤中時間校正）
# ============================================================

# 台股盤中總時長 = 13:30 - 09:00 = 270 分鐘
TRADING_TOTAL_MINUTES = 270


def _trading_elapsed_minutes(now):
    """計算從 09:00 到現在的盤中已過分鐘數（上限 270）"""
    if now.hour < 9:
        return 0
    elapsed = (now.hour - 9) * 60 + now.minute
    return min(max(elapsed, 1), TRADING_TOTAL_MINUTES)


def calc_volume_ratio(current_volume, ma5_volume, now):
    """B 方案：盤中時間校正的量能比

    返回: {"ratio": float, "progress": 0.0~1.0, "intraday_adjusted": bool, "note": str}
    """
    if not ma5_volume or ma5_volume <= 0:
        return {"note": "skipped_no_base"}
    if not current_volume or current_volume <= 0:
        return {"note": "skipped_no_current_volume"}

    elapsed = _trading_elapsed_minutes(now)
    progress = elapsed / TRADING_TOTAL_MINUTES  # 0.0 ~ 1.0

    # 盤中：把 MA5 按當前時間進度打折
    # 例如 10:00 → progress=0.22，預期量 = MA5 × 0.22
    # 如果當前成交量已經超過預期，ratio > 1 表示放量
    # 13:30 後 progress=1.0，等於全日比值
    expected_volume_now = ma5_volume * progress
    if expected_volume_now <= 0:
        return {"note": "skipped_early_session"}

    ratio = round(current_volume / expected_volume_now, 2)

    # 判讀
    verdict_tag = None
    if ratio >= 3.0:
        verdict_tag = "高檔爆量"
    elif ratio >= 1.5:
        verdict_tag = "量能激增"
    elif ratio < 0.5:
        verdict_tag = "量縮"
    elif 0.5 <= ratio < 0.8:
        verdict_tag = "量能偏弱"
    else:
        verdict_tag = "量能正常"

    return {
        "ratio": ratio,
        "current_volume": current_volume,
        "ma5_volume": ma5_volume,
        "expected_volume_at_now": int(expected_volume_now),
        "progress": round(progress, 3),
        "intraday_adjusted": True,
        "verdict_tag": verdict_tag,
        "note": "ok",
    }


# ============================================================
# 主流程
# ============================================================

def _load_daily_base():
    """讀取早上預抓的 MA5 基準資料"""
    path = "data/daily_base_data.json"
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            base = json.load(f)
        # 檢查日期是否為今天（容忍前一日，如果今天是交易日但 07:00 cron 還沒跑）
        base_date = base.get("date", "")
        today = current_time.strftime('%Y-%m-%d')
        if base_date and base_date != today:
            print(f"  ⚠️ Base data is from {base_date} (today: {today}), using anyway", flush=True)
        return base.get("stocks", {})
    except Exception as e:
        print(f"  ⚠️ Failed to load daily_base_data.json: {e}", flush=True)
        return {}


def _is_heavy_task_slot():
    """判斷現在是否該跑「重型任務」（新聞抓取等）
    整點的第一個 tick（分鐘 < 10）且小時為 10/11/13 時觸發
    """
    return minute < 10 and hour in (10, 11, 13)


def main():
    # 1. 取得自選股清單
    symbols = fetch_cloud_watchlist_symbols()

    watchlist_path = "data/watchlist.json"
    local_symbols = []
    if os.path.exists(watchlist_path):
        try:
            with open(watchlist_path, "r", encoding="utf-8") as f:
                local_symbols = json.load(f)
        except Exception:
            pass
    # v11.8：併入 AI 自選股 (data/ai_picked_watchlist.json) — 給 ai_scout_bot 帳戶用
    # 這些 symbol 會跟著一起跑 watchlist_analysis，盤中即時刷新
    ai_picked_symbols = []
    try:
        if os.path.exists("data/ai_picked_watchlist.json"):
            with open("data/ai_picked_watchlist.json", "r", encoding="utf-8") as f:
                ai_pw = json.load(f) or {}
            for p in (ai_pw.get("picks") or []):
                s = (p.get("symbol") or "").strip()
                if s:
                    ai_picked_symbols.append(s)
            if ai_picked_symbols:
                print(f"  🤖 AI 自選股 +{len(ai_picked_symbols)}: {ai_picked_symbols}", flush=True)
    except Exception as e:
        print(f"  ⚠️ load ai_picked_watchlist failed: {e}", flush=True)

    # 合併去重 + 過濾非法 symbol（避免本地 watchlist.json 混入中文名/壞資料）
    all_symbols = _sanitize_symbol_list(list(dict.fromkeys(symbols + local_symbols + ai_picked_symbols)))

    if not all_symbols:
        print("  No watchlist stocks. Exiting.", flush=True)
        return

    print(f"  📋 Watchlist: {len(all_symbols)} stocks → {all_symbols}", flush=True)

    # 2. 讀取 MA5 基準（早上 prefetch 的結果）
    base_data = _load_daily_base()
    if base_data:
        print(f"  📊 MA5 base data loaded: {len(base_data)} stocks", flush=True)
    else:
        print(f"  ⚠️ No MA5 base data — volume_ratio 將顯示為「無基準」", flush=True)

    # 3. 抓取個股資料（yfinance 日線 → MA/RSI/布林等技術指標）
    watchlist_data = {}
    for sym in all_symbols:
        print(f"  Fetching: {sym}", flush=True)
        watchlist_data[sym] = fetch_stock_detail(sym)

    # 3b. v10.8.1: 盤中即時報價覆寫（TWSE MIS，延遲 5~15 秒）
    #     只覆寫 price / change_pct / volume / date，技術指標保留 yfinance 的日線計算結果
    try:
        rt_prices = fetch_realtime_prices(all_symbols)
    except Exception as e:
        print(f"  ⚠️ Realtime price fetch failed: {e}", flush=True)
        rt_prices = {}

    if rt_prices:
        today_str = current_time.strftime('%Y-%m-%d')
        overlaid = 0
        for sym, sd in watchlist_data.items():
            rt = rt_prices.get(sym)
            if not rt or "error" in sd:
                continue
            sd["price"] = rt["price"]
            if rt.get("change_pct") is not None:
                sd["change_pct"] = rt["change_pct"]
            if rt.get("volume"):
                sd["volume"] = rt["volume"]
            sd["date"] = today_str       # 盤中資料日期用今天
            sd["is_realtime"] = True
            sd["realtime_source"] = "TWSE_MIS"
            if rt.get("prev_close"):
                sd["prev_close"] = rt["prev_close"]
            overlaid += 1
        print(f"  ⚡ Realtime overlay: {overlaid}/{len(watchlist_data)} stocks updated from TWSE MIS", flush=True)
    else:
        print(f"  ℹ️ No realtime prices available (fallback to yfinance daily close)", flush=True)

    # 3c. v11.2: 抓族群即時指數 + 大盤，為個股算 RS（相對強度）
    sector_flow = None
    try:
        sector_flow = fetch_sector_realtime_mis()
    except Exception as e:
        print(f"  ⚠️ Sector flow fetch failed: {e}", flush=True)
    taiex_change_pct = None
    if sector_flow and sector_flow.get("taiex"):
        taiex_change_pct = sector_flow["taiex"].get("change_pct")
    if taiex_change_pct is not None:
        rs_count = 0
        for sym, sd in watchlist_data.items():
            if "error" in sd:
                continue
            rs = _compute_rs(sd.get("change_pct"), taiex_change_pct)
            if rs:
                sd["rs"] = rs
                rs_count += 1
            # 族群資金流向：把個股所屬族群的 strength 也塞過去
            ind = (sd.get("fundamental") or {}).get("industry") or sd.get("industry")
            sec_match = _match_sector(ind or "", sector_flow)
            if sec_match:
                sd["sector_flow"] = {
                    "sector_name": sec_match["name"],
                    "sector_change_pct": sec_match["change_pct"],
                    "vs_taiex": sec_match["vs_taiex"],
                    "strength": sec_match["strength"],
                }
        print(f"  📊 RS computed for {rs_count} stocks (TAIEX {taiex_change_pct:+.2f}%)", flush=True)
    else:
        print(f"  ℹ️ Skipping RS — no TAIEX realtime", flush=True)

    # 4. v10.5: 計算量能比（不打歷史 API，只讀 JSON + 除法）
    #          並從 daily_base 注入 financial_alerts（盤中不重算）
    for sym, sd in watchlist_data.items():
        if "error" in sd:
            continue
        base = base_data.get(sym, {})
        ma5_vol = base.get("ma5_volume")
        current_vol = sd.get("volume")
        vol_info = calc_volume_ratio(current_vol, ma5_vol, current_time)
        sd["volume_analysis"] = vol_info
        if vol_info.get("note") == "ok":
            print(f"    {sym} ratio={vol_info['ratio']}x ({vol_info['verdict_tag']})", flush=True)
        # 注入財務警訊（來自早盤 prefetch）
        fa = base.get("financial_alerts")
        if fa:
            sd["financial_alerts"] = fa
        # 注入每月營收（v10.6 功能 1）
        mr = base.get("monthly_revenue")
        if mr:
            sd["monthly_revenue"] = mr
        # 注入 TDCC 大戶/散戶（v10.7 功能 1）
        td = base.get("tdcc")
        if td:
            sd["tdcc"] = td

    # 🔄 v10.8.2: 讀取上次 watchlist_analysis.json，作為 API 失敗時的備援資料來源
    previous_stocks = {}
    try:
        with open("data/watchlist_analysis.json", "r", encoding="utf-8") as f:
            prev = json.load(f)
        previous_stocks = prev.get("stocks", {}) or {}
    except Exception:
        pass

    # 5. 籌碼集中度（抓失敗→沿用上次）
    chip_conc = fetch_chip_concentration(all_symbols) or {}
    stale_chip = 0
    for sym, sd in watchlist_data.items():
        if sym in chip_conc:
            sd["chip_concentration"] = chip_conc[sym]
        else:
            prev_cc = previous_stocks.get(sym, {}).get("chip_concentration")
            if prev_cc:
                sd["chip_concentration"] = {**prev_cc, "is_stale": True}
                stale_chip += 1
    if stale_chip:
        print(f"  ♻️ Chip concentration: {stale_chip} stocks 沿用上次資料（本次抓取失敗）", flush=True)

    # 6. 個股法人買賣超 + 5日歷史（抓失敗→沿用上次）
    tw_symbols = [s for s in all_symbols if '.TW' in s]
    inst_data = {}
    if tw_symbols:
        try:
            inst_data = fetch_stock_institutional(tw_symbols) or {}
        except Exception as e:
            print(f"  ⚠️ Institutional fetch crashed: {e}", flush=True)
    stale_inst = 0
    for sym, sd in watchlist_data.items():
        if sym in inst_data and inst_data[sym]:
            sd["institutional"] = inst_data[sym]
        else:
            prev_inst = previous_stocks.get(sym, {}).get("institutional")
            if prev_inst:
                sd["institutional"] = {**prev_inst, "is_stale": True}
                stale_inst += 1
    if stale_inst:
        print(f"  ♻️ Institutional: {stale_inst} stocks 沿用上次資料（TWSE T86 失敗）", flush=True)

    # 7. 新聞：整點（10/11/13）才抓，其他時段讀既有
    news_titles = []
    if _is_heavy_task_slot():
        print(f"  📰 Heavy task slot ({current_time.strftime('%H:%M')}): fetching news...", flush=True)
        try:
            news_items = fetch_news()
            news_titles = [n.get("title", "") for n in news_items]
            # 順便寫回 raw_data.json 的 news 欄位（供下次使用）
            try:
                with open("data/raw_data.json", "r", encoding="utf-8") as f:
                    raw = json.load(f)
                raw["news"] = news_items
                with open("data/raw_data.json", "w", encoding="utf-8") as f:
                    json.dump(raw, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
        except Exception as e:
            print(f"  ⚠️ News fetch failed: {e}", flush=True)
    else:
        try:
            with open("data/raw_data.json", "r", encoding="utf-8") as f:
                raw = json.load(f)
                news_titles = [n.get("title", "") for n in raw.get("news", [])]
            print(f"  📰 Loaded {len(news_titles)} cached news titles", flush=True)
        except Exception:
            pass

    # 8. AI 批次分析 (Gemini 批次 + Groq 情感同一次 call)
    # v10.6: 自選股高頻分析用 primary key（watchlist role）
    # v10.8.2: 非整點 slot 跳過 Groq（省配額，避免 429 卡滿 workflow）
    if not _is_heavy_task_slot():
        os.environ['SKIP_GROQ_SENTIMENT'] = '1'
    client = get_client("watchlist")
    print(f"  🤖 AI batch analysis ({MODEL_FLASH_LITE})...", flush=True)
    data_for_ai = {"watchlist": watchlist_data, "news": [{"title": t} for t in news_titles]}
    watchlist_result = analyze_watchlist(client, data_for_ai)

    # 9. 輸出 — v10.8 修正：不得覆蓋 ai_analyzer.py 的 heavy 分析
    # 規則：先讀舊檔，逐檔 merge。quick 只更新「價格/技術/量能」欄位；
    # ai_analysis 欄位 → 若 quick 這次有取得有效 AI 內容才覆蓋，否則保留 heavy 版本
    os.makedirs("data", exist_ok=True)
    existing_stocks = {}
    existing_meta = {}
    try:
        with open("data/watchlist_analysis.json", "r", encoding="utf-8") as f:
            prev = json.load(f)
            existing_stocks = prev.get("stocks", {}) or {}
            existing_meta = {k: v for k, v in prev.items() if k != "stocks"}
    except Exception:
        pass

    def _is_valid_ai(ai):
        if not isinstance(ai, dict):
            return False
        a = ai.get("analysis") or ""
        # 空白或未設定訊息 → 無效，不要覆蓋舊的
        if not a.strip():
            return False
        if "API Key 未設定" in a or "資料抓取失敗" in a:
            return False
        return True

    if watchlist_result:
        merged_stocks = dict(existing_stocks)  # 先保留舊檔全部
        for sym, new_entry in watchlist_result.items():
            old_entry = existing_stocks.get(sym, {})
            old_ai = old_entry.get("ai_analysis")
            new_ai = new_entry.get("ai_analysis")
            # 先整份蓋過去（拿到最新價/技術）
            merged = {**old_entry, **new_entry}
            # 但 ai_analysis 用「新的有效就蓋，否則保留舊的」
            if _is_valid_ai(new_ai):
                merged["ai_analysis"] = new_ai
            elif isinstance(old_ai, dict):
                merged["ai_analysis"] = old_ai
                print(f"    ↩️ {sym}: quick AI 無效，保留 heavy 版 ai_analysis", flush=True)
            merged_stocks[sym] = merged

        now_str = current_time.strftime('%Y-%m-%d %H:%M:%S')
        # 保留 heavy 的原始時間（第一次進來時用 existing_meta 的 timestamp，之後就固定）
        heavy_ts = existing_meta.get("heavy_timestamp") or existing_meta.get("timestamp")
        output = {
            **existing_meta,
            "timestamp": now_str,             # 前端「資料日期」永遠顯示最新更新時間
            "quick_timestamp": now_str,
            "heavy_timestamp": heavy_ts or now_str,  # 保留最近一次 heavy 分析時間供除錯
            "update_type": "quick_v11.2",
            "heavy_slot": _is_heavy_task_slot(),
            "stocks": merged_stocks,
        }
        # v11.2: 族群資金流向（成功才覆蓋；失敗就保留 existing_meta 的上次資料）
        if sector_flow:
            output["sector_flow"] = sector_flow

        with open("data/watchlist_analysis.json", "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"  ✅ Watchlist quick update done: {len(watchlist_result)} stocks (merged with prev heavy)", flush=True)
    else:
        print("  ⚠️ No analysis results — 保留現有 watchlist_analysis.json 不動。", flush=True)


if __name__ == "__main__":
    main()
