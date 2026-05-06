"""
track_closing_action.py — 尾盤 5 分鐘量價變動 (v11.9)

執行時機：每日 14:00 GH Actions（收盤後）
目的：抓自選股 + AI 自選股 + 持倉股 13:25-13:30 的價量變動，揪出「法人尾盤拉抬 / 摜壓」訊號

輸出：data/closing_action.json
{
  "updated_at": "...",
  "trade_date": "2026-05-04",
  "alerts": [
    {
      "symbol": "2330.TW",
      "name": "台積電",
      "action": "尾盤拉抬" | "尾盤摜壓" | "尾盤爆量" | "正常",
      "price_move_pct": 1.2,         # 13:25-13:30 的價格變動 %
      "vol_burst_ratio": 2.5,        # 最後 5 分鐘的量 vs 該日均速
      "severity": "high"|"medium"|"low",
      "implication": "..."           # 中文解讀
    }
  ]
}

判定規則：
  尾盤拉抬：price_move_pct >= +1.0% 且 vol_burst_ratio >= 1.5  → 法人/大戶建倉
  尾盤摜壓：price_move_pct <= -1.0% 且 vol_burst_ratio >= 1.5  → 法人/大戶倒貨
  尾盤爆量：vol_burst_ratio >= 3.0 但 price_move 不大          → 對作（注意隔天）
"""
from __future__ import annotations

import os
import sys
import json
from datetime import datetime, time as dtime
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

TW_TZ = pytz.timezone("Asia/Taipei")
NOW = datetime.now(TW_TZ)
TODAY = NOW.strftime("%Y-%m-%d")

OUT_PATH = "data/closing_action.json"


def _load(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _collect_target_symbols() -> list[str]:
    """收集要追蹤的個股：自選股（watchlist_analysis 的 stocks keys）+ AI 自選 + AI bot 持倉"""
    syms = set()
    wa = _load("data/watchlist_analysis.json")
    if wa:
        for s in (wa.get("stocks") or {}).keys():
            syms.add(s)
    ai_pw = _load("data/ai_picked_watchlist.json")
    if ai_pw:
        for p in ai_pw.get("picks") or []:
            s = (p.get("symbol") or "").strip()
            if s:
                syms.add(s)
    bot = _load("data/ai_bot_portfolio.json")
    if bot:
        for s in (bot.get("positions") or {}).keys():
            syms.add(s)
    # 排除 ETF（成交量太大、尾盤行為不同）+ 美股
    return [s for s in syms if s.endswith(".TW") and not s.startswith("00")]


def _classify(price_move_pct: float, vol_burst_ratio: float) -> tuple[str, str, str]:
    """回傳 (action, severity, implication_zh)"""
    if vol_burst_ratio >= 1.5 and price_move_pct >= 1.0:
        return "尾盤拉抬", "high", "法人 / 大戶尾盤建倉，明日開盤多有跳空高開機率"
    if vol_burst_ratio >= 1.5 and price_move_pct <= -1.0:
        return "尾盤摜壓", "high", "法人 / 大戶尾盤倒貨，明日開盤跳空低開風險高"
    if vol_burst_ratio >= 3.0:
        return "尾盤爆量", "medium", "尾盤量能異常但價未明顯動，可能對作或主力換手，注意隔天波動"
    if vol_burst_ratio >= 1.5:
        return "尾盤量增", "low", "尾盤量增但幅度有限，觀察隔天延續性"
    return "正常", "low", ""


def main():
    print(f"=== Closing Action Tracker — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)

    # 只在 14:00-15:00 跑（給 14:00 cron 用）；其他時段直接 skip
    if NOW.weekday() >= 5:
        print("  ⏰ 週末，skip", flush=True)
        return
    if NOW.hour < 13 or NOW.hour > 15:
        print(f"  ⏰ {NOW.hour}:xx 不在執行視窗（13-15 點），skip", flush=True)
        return

    syms = _collect_target_symbols()
    if not syms:
        print("  ⚠️ 沒有可追蹤的個股", flush=True)
        return
    print(f"  🎯 追蹤 {len(syms)} 檔（自選 + AI 自選 + bot 持倉）", flush=True)

    try:
        import yfinance as yf
    except Exception as e:
        print(f"  ❌ yfinance 載入失敗: {e}", flush=True)
        return

    alerts = []
    fail = 0
    for sym in syms:
        try:
            t = yf.Ticker(sym)
            hist = t.history(period="1d", interval="1m")
            if hist is None or len(hist) < 10:
                fail += 1
                continue
            # 找出 13:25 ~ 13:30 範圍的 K 棒
            tw_idx = hist.index.tz_convert(TW_TZ) if hist.index.tz else hist.index
            hist = hist.copy()
            hist.index = tw_idx
            closing_window = hist.between_time("13:25", "13:30")
            if len(closing_window) < 2:
                fail += 1
                continue

            start_price = float(closing_window["Close"].iloc[0])
            end_price = float(closing_window["Close"].iloc[-1])
            price_move_pct = (end_price - start_price) / start_price * 100 if start_price else 0

            # 計算量爆比：最後 5 分鐘量 vs 當日總量 / 270 分鐘
            closing_vol = int(closing_window["Volume"].sum())
            total_vol = int(hist["Volume"].sum())
            avg_per_min = total_vol / max(len(hist), 1)
            vol_burst_ratio = closing_vol / (avg_per_min * 5) if avg_per_min > 0 else 0

            action, severity, implication = _classify(price_move_pct, vol_burst_ratio)
            if action == "正常":
                continue

            alerts.append({
                "symbol": sym,
                "price_at_1325": round(start_price, 2),
                "price_at_close": round(end_price, 2),
                "price_move_pct": round(price_move_pct, 2),
                "closing_5min_volume": closing_vol,
                "vol_burst_ratio": round(vol_burst_ratio, 2),
                "action": action,
                "severity": severity,
                "implication": implication,
            })
        except Exception as e:
            fail += 1
            print(f"  ⚠️ {sym} fetch failed: {e}", flush=True)

    # 按嚴重度 + 量比排序
    sev_rank = {"high": 0, "medium": 1, "low": 2}
    alerts.sort(key=lambda x: (sev_rank.get(x["severity"], 9), -x["vol_burst_ratio"]))

    out = {
        "updated_at": NOW.strftime("%Y-%m-%d %H:%M:%S"),
        "trade_date": TODAY,
        "tracked_count": len(syms),
        "fail_count": fail,
        "alerts_count": len(alerts),
        "alerts": alerts[:30],
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"  📊 wrote {OUT_PATH} — {len(alerts)} 警示 / {len(syms)} 追蹤 / {fail} 失敗", flush=True)
    for a in alerts[:5]:
        emoji = "🚀" if a["action"] == "尾盤拉抬" else "💥" if a["action"] == "尾盤摜壓" else "⚡"
        print(f"     {emoji} {a['symbol']} {a['action']} | 價 {a['price_move_pct']:+.2f}% | 量比 {a['vol_burst_ratio']:.2f}×", flush=True)


if __name__ == "__main__":
    main()
