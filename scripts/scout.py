"""
scout.py — 市場雷達掃描器

每日盤後從全市場掃出多項排行榜：
  - 法人買超 / 賣超 前 N
  - 漲幅 / 跌幅 前 N
  - 量增爆量榜（今日量 / MA5 量 ≥ 2.0）
  - 籌碼集中度跳升榜（依 tdcc_prev.json delta）
  - 連 3 日上榜（recurring）— 從 scout_history.json 比對

輸出：
  data/scout_radar.json     當日結果
  data/scout_history.json   30 日歷史（用來算連續上榜）

可選 --ai-pick：呼叫 Gemini 從雷達結果挑 17 檔「如果 AI 自己選自選股會選哪些」
輸出 data/ai_picked_watchlist.json
"""
from __future__ import annotations

import os
import sys
import json
import time
from datetime import datetime, timedelta
from typing import Any

import requests
import pytz
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

TW_TZ = pytz.timezone("Asia/Taipei")
NOW = datetime.now(TW_TZ)
TODAY = NOW.strftime("%Y%m%d")

DATA_DIR = "data"
RADAR_PATH = os.path.join(DATA_DIR, "scout_radar.json")
HISTORY_PATH = os.path.join(DATA_DIR, "scout_history.json")
AI_PICK_PATH = os.path.join(DATA_DIR, "ai_picked_watchlist.json")

TOP_N = 10
HISTORY_KEEP_DAYS = 30

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}


# ─────────────────────────────────────────────
# 工具
# ─────────────────────────────────────────────
def _parse_int(v: Any) -> int:
    try:
        return int(str(v).replace(",", "").strip())
    except Exception:
        return 0


def _parse_float(v: Any) -> float:
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return 0.0


def _load_json(path: str, default):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        print(f"  ⚠️ load {path} failed: {e}", flush=True)
    return default


def _save_json(path: str, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ─────────────────────────────────────────────
# T86 — 三大法人買賣超日報（全市場）
# ─────────────────────────────────────────────
def fetch_t86() -> tuple[str | None, list[dict]]:
    """回傳 (data_date, stocks) — stocks 每筆: {code,name,foreign,trust,dealer,total}"""
    print("[scout] fetching T86 (institutional)...", flush=True)
    dates = [TODAY] + [(NOW - timedelta(days=d)).strftime("%Y%m%d") for d in range(1, 6)]

    for d in dates:
        try:
            url = f"https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date={d}&selectType=ALL"
            res = requests.get(url, timeout=30, headers=UA, verify=False)
            j = res.json()
            if j.get("stat") == "OK" and j.get("data"):
                rows = j["data"]
                stocks = []
                for row in rows:
                    if len(row) < 19:
                        continue
                    code = str(row[0]).strip()
                    name = str(row[1]).strip()
                    if not code.isdigit():
                        continue
                    foreign = _parse_int(row[4]) + _parse_int(row[7])  # 外資+陸資 + 外資自營
                    trust = _parse_int(row[10])
                    dealer = _parse_int(row[11])
                    total = _parse_int(row[18])
                    stocks.append({
                        "code": code,
                        "symbol": code + ".TW",
                        "name": name,
                        "foreign": foreign,
                        "trust": trust,
                        "dealer": dealer,
                        "total": total,
                    })
                print(f"  ✅ T86 {d}: {len(stocks)} stocks", flush=True)
                return d, stocks
        except Exception as e:
            print(f"  ⚠️ T86 {d} failed: {e}", flush=True)
        time.sleep(0.3)

    return None, []


# ─────────────────────────────────────────────
# STOCK_DAY_ALL — 全市場日線（價/量）
# ─────────────────────────────────────────────
def fetch_stock_day_all() -> list[dict]:
    """回傳全市場個股日線：[{code,symbol,name,close,change,change_pct,volume,value}]"""
    print("[scout] fetching STOCK_DAY_ALL...", flush=True)
    try:
        res = requests.get(
            "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
            timeout=30,
            verify=False,
            headers={"Accept": "application/json"},
        )
        raw = res.json()
        if not isinstance(raw, list):
            return []
        stocks = []
        for r in raw:
            try:
                code = str(r.get("Code", "")).strip()
                if not code.isdigit():
                    continue
                close = _parse_float(r.get("ClosingPrice", 0))
                change = _parse_float(r.get("Change", 0))
                volume = _parse_int(r.get("TradeVolume", 0))  # 股
                value = _parse_int(r.get("TradeValue", 0))    # 元
                if close <= 0:
                    continue
                prev_close = close - change
                change_pct = (change / prev_close * 100) if prev_close > 0 else 0
                stocks.append({
                    "code": code,
                    "symbol": code + ".TW",
                    "name": str(r.get("Name", "")).strip(),
                    "close": close,
                    "change": round(change, 2),
                    "change_pct": round(change_pct, 2),
                    "volume": volume,
                    "value": value,
                })
            except Exception:
                continue
        print(f"  ✅ STOCK_DAY_ALL: {len(stocks)} stocks", flush=True)
        return stocks
    except Exception as e:
        print(f"  ⚠️ STOCK_DAY_ALL failed: {e}", flush=True)
        return []


# ─────────────────────────────────────────────
# 量增榜 — 用 daily_base_data.json 裡的 ma5_volume
# ─────────────────────────────────────────────
def detect_volume_surge(stocks: list[dict]) -> list[dict]:
    """量增榜：今日量 / MA5 ≥ 2.0；MA5 來源 daily_base_data.json 或 stock_inst_history."""
    base = _load_json(os.path.join(DATA_DIR, "daily_base_data.json"), {})
    ma5_map = {}
    if isinstance(base, dict):
        # 結構: {symbol: {ma5_volume, ...}} or {stocks: {...}}
        src = base.get("stocks", base)
        for sym, info in src.items():
            try:
                code = sym.replace(".TW", "").replace(".TWO", "")
                ma5 = info.get("ma5_volume") or info.get("avg_volume_5d")
                if ma5:
                    ma5_map[code] = float(ma5)
            except Exception:
                continue

    out = []
    for s in stocks:
        ma5 = ma5_map.get(s["code"])
        if not ma5 or ma5 <= 0:
            continue
        ratio = s["volume"] / ma5
        if ratio >= 2.0 and s["volume"] >= 1000_000:  # 1000 張以上才算
            out.append({**s, "vol_ratio": round(ratio, 2), "ma5_volume": int(ma5)})
    out.sort(key=lambda x: -x["vol_ratio"])
    return out[:TOP_N]


# ─────────────────────────────────────────────
# 籌碼集中跳升榜 — 用 tdcc_prev.json delta
# ─────────────────────────────────────────────
def detect_chip_concentration_jump() -> list[dict]:
    """需要兩週的 TDCC 資料，這裡只能讀 tdcc_prev.json 裡有的（如果有 baseline 就有 delta）。"""
    prev = _load_json(os.path.join(DATA_DIR, "tdcc_prev.json"), {})
    stocks = prev.get("stocks", {}) if isinstance(prev, dict) else {}
    # tdcc_prev 只有當週百分比，沒 delta — delta 要從 watchlist_analysis 之類去找
    # 改作法：從 watchlist_analysis.json 抓 chip_concentration delta
    wa = _load_json(os.path.join(DATA_DIR, "watchlist_analysis.json"), {})
    wa_stocks = wa.get("stocks", {}) if isinstance(wa, dict) else {}
    out = []
    for sym, info in wa_stocks.items():
        cc = info.get("chip_concentration") or {}
        delta = cc.get("whale_delta")
        if delta is None:
            continue
        try:
            d = float(delta)
            if abs(d) >= 0.3:  # 0.3 個百分點以上
                out.append({
                    "symbol": sym,
                    "code": sym.replace(".TW", "").replace(".TWO", ""),
                    "name": info.get("name", ""),
                    "whale_delta": d,
                    "whale_pct": cc.get("whale_pct"),
                    "signal": cc.get("signal"),
                })
        except Exception:
            continue
    out.sort(key=lambda x: -x["whale_delta"])
    return out


# ─────────────────────────────────────────────
# 異常買盤偵測 — 法人買超 + 同日大跌 = 假買盤訊號
#   常見來源：融券回補、外資 delta hedge、借券還券、ETF 套利、鉅額換手
# ─────────────────────────────────────────────
def detect_suspicious_buy(t86_stocks: list[dict], drop_threshold: float = -2.0,
                          top_pool: int = 30) -> list[dict]:
    """從法人買超榜前 N 名中，篩出當日漲跌 ≤ -2% 的「買超 + 殺盤」股。

    回傳：[{code, name, foreign, trust, total, change_pct, close, volume,
            anomaly_type, severity}]
    severity = 0..1，change_pct 越負且買超越大越接近 1
    """
    # 只看當日有量、有價的
    valid = [s for s in t86_stocks
             if s.get("change_pct") is not None
             and (s.get("volume") or 0) >= 100_000]
    if not valid:
        return []

    # 取「合計買超」前 top_pool 與「外資買超」前 top_pool 聯集當作候選池
    total_top = set()
    foreign_top = set()
    trust_top = set()
    for s in sorted(valid, key=lambda x: -x.get("total", 0))[:top_pool]:
        total_top.add(s["code"])
    for s in sorted(valid, key=lambda x: -x.get("foreign", 0))[:top_pool]:
        foreign_top.add(s["code"])
    for s in sorted(valid, key=lambda x: -x.get("trust", 0))[:top_pool]:
        trust_top.add(s["code"])

    pool_codes = total_top | foreign_top | trust_top
    out = []
    for s in valid:
        if s["code"] not in pool_codes:
            continue
        cp = s.get("change_pct") or 0
        if cp > drop_threshold:
            continue
        # 標記異常類型
        sources = []
        if s["code"] in foreign_top and (s.get("foreign") or 0) > 0:
            sources.append("外資")
        if s["code"] in trust_top and (s.get("trust") or 0) > 0:
            sources.append("投信")
        if s["code"] in total_top and (s.get("total") or 0) > 0 and not sources:
            sources.append("法人合計")
        if not sources:
            continue
        # severity: |change_pct|/10 + 法人買超占成交量比重
        net_buy = max(s.get("foreign", 0), s.get("total", 0))
        vol = s.get("volume") or 1
        buy_ratio = (net_buy * 1000) / max(vol, 1) if net_buy > 0 else 0  # 大致占比
        severity = round(min(1.0, (abs(cp) / 10) + min(buy_ratio, 0.5)), 2)
        out.append({
            "code": s["code"],
            "symbol": s.get("symbol", s["code"] + ".TW"),
            "name": s.get("name", ""),
            "foreign": s.get("foreign", 0),
            "trust": s.get("trust", 0),
            "total": s.get("total", 0),
            "change_pct": cp,
            "close": s.get("close"),
            "volume": s.get("volume"),
            "anomaly_type": "+".join(sources) + "買超但下跌",
            "severity": severity,
            "hint": "可能為融券回補 / delta hedge / 借券還券 / ETF 套利 / 鉅額換手",
        })
    out.sort(key=lambda x: (x["change_pct"], -x["severity"]))  # 跌最多排第一
    return out[:TOP_N]


# ─────────────────────────────────────────────
# 連 3 日上榜偵測
# ─────────────────────────────────────────────
def detect_recurring(today_radar: dict, history: dict) -> dict:
    """history.days = [{date, board_codes: {board_name: [code,...]}}, ...]
    回傳: {board_name: [{code, days_in_a_row, last_seen_dates: [...]}]}
    """
    days = history.get("days", [])
    recurring = {}

    boards_to_check = ["foreign_buy_top", "foreign_sell_top", "total_buy_top",
                       "price_up_top", "volume_surge_top"]
    for board in boards_to_check:
        # 取今日該榜的 code 集合
        today_codes = {x.get("code") for x in today_radar.get(board, []) if x.get("code")}
        if not today_codes:
            continue
        # 往前找最多 5 天歷史
        history_codes_per_day = []
        for h in days[-5:]:
            board_codes = h.get("board_codes", {}).get(board, [])
            history_codes_per_day.append(set(board_codes))

        hot = []
        for code in today_codes:
            streak = 1  # 今天算第 1 天
            # 從最近一天往前檢查
            for past in reversed(history_codes_per_day):
                if code in past:
                    streak += 1
                else:
                    break
            if streak >= 3:
                hot.append({"code": code, "streak": streak})
        if hot:
            hot.sort(key=lambda x: -x["streak"])
            recurring[board] = hot
    return recurring


# ─────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────
def build_radar() -> dict:
    t86_date, t86_stocks = fetch_t86()
    sda_stocks = fetch_stock_day_all()

    # 把 T86 + SDA 合併（用 code 對映）— SDA 有價/量，T86 有法人
    sda_map = {s["code"]: s for s in sda_stocks}
    for t in t86_stocks:
        sda = sda_map.get(t["code"])
        if sda:
            t["close"] = sda.get("close")
            t["change_pct"] = sda.get("change_pct")
            t["volume"] = sda.get("volume")

    # 法人榜（先過濾掉成交量 < 100 張的，避免冷門股雜訊）
    active = [t for t in t86_stocks if (t.get("volume") or 0) >= 100_000]
    foreign_buy = sorted(active, key=lambda x: -x["foreign"])[:TOP_N]
    foreign_sell = sorted(active, key=lambda x: x["foreign"])[:TOP_N]
    trust_buy = sorted(active, key=lambda x: -x["trust"])[:TOP_N]
    total_buy = sorted(active, key=lambda x: -x["total"])[:TOP_N]
    total_sell = sorted(active, key=lambda x: x["total"])[:TOP_N]

    # 漲跌幅榜（過濾低價股 < 10、成交量 < 1000 張避免雞蛋水餃股）
    movers = [s for s in sda_stocks if s["close"] >= 10 and s["volume"] >= 1000_000]
    price_up = sorted(movers, key=lambda x: -x["change_pct"])[:TOP_N]
    price_down = sorted(movers, key=lambda x: x["change_pct"])[:TOP_N]

    # 量增榜
    vol_surge = detect_volume_surge(sda_stocks)

    # 籌碼集中跳升
    chip_jump = detect_chip_concentration_jump()

    # 異常買盤（法人買超 + 同日大跌）
    suspicious = detect_suspicious_buy(t86_stocks)

    # 組成今日雷達
    radar = {
        "date": t86_date or TODAY,
        "fetched_at": NOW.strftime("%Y-%m-%d %H:%M:%S"),
        "foreign_buy_top": foreign_buy,
        "foreign_sell_top": foreign_sell,
        "trust_buy_top": trust_buy,
        "total_buy_top": total_buy,
        "total_sell_top": total_sell,
        "price_up_top": price_up,
        "price_down_top": price_down,
        "volume_surge_top": vol_surge,
        "chip_concentration_jump": chip_jump,
        "suspicious_buy_top": suspicious,
    }

    # 連 3 日上榜偵測
    history = _load_json(HISTORY_PATH, {"days": []})
    recurring = detect_recurring(radar, history)
    radar["recurring_3d"] = recurring

    # 寫入歷史（用今日 t86_date 取代 TODAY，避免假日 dup）
    today_codes_per_board = {
        b: [x.get("code") for x in radar.get(b, []) if x.get("code")]
        for b in ["foreign_buy_top", "foreign_sell_top", "total_buy_top",
                  "price_up_top", "volume_surge_top"]
    }
    new_day = {"date": radar["date"], "board_codes": today_codes_per_board}
    days = history.get("days", [])
    # 同日去重
    days = [d for d in days if d.get("date") != radar["date"]]
    days.append(new_day)
    days = days[-HISTORY_KEEP_DAYS:]
    _save_json(HISTORY_PATH, {"days": days, "updated_at": radar["fetched_at"]})

    return radar


# ─────────────────────────────────────────────
# 可選：AI 自選股
# ─────────────────────────────────────────────
def ai_pick_watchlist(radar: dict, target_size: int = 17) -> dict:
    """呼叫 Gemini，從雷達結果挑 N 檔，回傳 {picks: [...], reasoning: ...}"""
    try:
        # lazy import — 只有需要時才 import
        sys.path.insert(0, "scripts")
        from ai_analyzer import get_client, gemini_generate_with_retry, MODEL_FLASH  # noqa
    except Exception as e:
        print(f"[scout] ai_pick: cannot import ai_analyzer: {e}", flush=True)
        return {"error": str(e)}

    client = get_client(role="watchlist")
    if not client:
        return {"error": "no Gemini client (missing API key)"}

    # 為了讓 prompt 不爆，每榜只送 top 8
    def _short(lst, fields):
        return [{f: x.get(f) for f in fields} for x in (lst or [])[:8]]

    summary = {
        "date": radar.get("date"),
        "foreign_buy_top": _short(radar.get("foreign_buy_top"), ["code", "name", "foreign", "change_pct"]),
        "foreign_sell_top": _short(radar.get("foreign_sell_top"), ["code", "name", "foreign", "change_pct"]),
        "trust_buy_top": _short(radar.get("trust_buy_top"), ["code", "name", "trust", "change_pct"]),
        "price_up_top": _short(radar.get("price_up_top"), ["code", "name", "change_pct", "volume"]),
        "volume_surge_top": _short(radar.get("volume_surge_top"), ["code", "name", "vol_ratio", "change_pct"]),
        "recurring_3d": radar.get("recurring_3d"),
        "suspicious_buy_top": _short(radar.get("suspicious_buy_top"), ["code", "name", "anomaly_type", "change_pct"]),
    }

    prompt = f"""
你是專業的台股操盤手。以下是當日（{radar.get('date')}）市場雷達掃描結果。
請以「中長線投資」+「避開短沖噴出股」為原則，挑出 {target_size} 檔最值得納入觀察名單的個股。

排行榜資料：
{json.dumps(summary, ensure_ascii=False, indent=2)}

選股原則：
1. **產業多元** — 不要全押在半導體 / 金融，至少 5 個產業
2. **法人共識** — 優先有法人買超 + 連 3 日上榜的（recurring_3d）
3. **避開噴出股** — 單日漲 ≥ 8% 或量增 ≥ 5x 的視為已過熱，盡量不選
4. **大小型混搭** — 至少含 5 檔權值股（市值前 50）+ 5 檔中型潛力股
5. **籌碼穩定** — 法人賣超榜、跌幅榜不要碰
6. **避開假買盤** — `suspicious_buy_top` 是「法人買超但同日下跌」的異常股（融券回補/避險/套利），絕對不選

請以 JSON 格式回覆：
{{
  "picks": [
    {{"symbol": "2330.TW", "name": "台積電", "category": "權值股 / 半導體", "reason": "<60字>"}},
    ...
  ],
  "rationale": "<整體選股策略 100-200 字>",
  "sectors_covered": ["半導體", "金融", "..."]
}}
"""
    try:
        resp = gemini_generate_with_retry(
            client, prompt, model=MODEL_FLASH, temperature=0.5, role="watchlist"
        )
        text = resp.text if hasattr(resp, "text") else str(resp)
        # 試著抽 JSON
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            # 找第一個 { ... 最後一個 }
            i, j = text.find("{"), text.rfind("}")
            data = json.loads(text[i:j + 1]) if i >= 0 and j > i else {"raw": text}
        data["generated_at"] = NOW.strftime("%Y-%m-%d %H:%M:%S")
        data["radar_date"] = radar.get("date")
        return data
    except Exception as e:
        return {"error": str(e), "generated_at": NOW.strftime("%Y-%m-%d %H:%M:%S")}


def main():
    print(f"=== Scout v1.0 — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    radar = build_radar()
    _save_json(RADAR_PATH, radar)
    print(f"[scout] wrote {RADAR_PATH}", flush=True)
    print(f"  📊 法人買超 top1: {radar['foreign_buy_top'][0]['name'] if radar['foreign_buy_top'] else 'N/A'}", flush=True)
    print(f"  📉 法人賣超 top1: {radar['foreign_sell_top'][0]['name'] if radar['foreign_sell_top'] else 'N/A'}", flush=True)
    print(f"  🚀 漲幅榜 top1:   {radar['price_up_top'][0]['name'] if radar['price_up_top'] else 'N/A'}", flush=True)
    print(f"  🔁 連 3 日上榜:   {sum(len(v) for v in radar['recurring_3d'].values())} 檔", flush=True)
    print(f"  ⚠️ 異常買盤:      {len(radar.get('suspicious_buy_top', []))} 檔", flush=True)

    if "--ai-pick" in sys.argv:
        print("[scout] running AI pick...", flush=True)
        pick = ai_pick_watchlist(radar)
        _save_json(AI_PICK_PATH, pick)
        if "picks" in pick:
            print(f"  🤖 AI 挑選: {len(pick['picks'])} 檔", flush=True)
            for p in pick["picks"][:5]:
                print(f"     - {p.get('symbol')} {p.get('name')}: {p.get('category')}", flush=True)


if __name__ == "__main__":
    main()
