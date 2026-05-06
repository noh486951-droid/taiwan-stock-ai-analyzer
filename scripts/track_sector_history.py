"""
track_sector_history.py — 產業輪動歷史追蹤 (v11.9)

每天盤後跑一次，把當日各產業漲跌幅 append 到 data/sector_history.json。

讀取來源：data/watchlist_analysis.json.sector_flow（已由 watchlist_quick.py 生成）

輸出：data/sector_history.json
{
  "updated_at": "...",
  "days": [
    {"date": "2026-05-04", "sectors": [{"name":"半導體","change_pct":1.2},...], "taiex":{"change_pct":...}},
    ...
  ],
  "summary_10d": [
    {"name":"半導體", "cum_change_pct": 5.6, "win_days": 7, "trend":"波段上漲"},
    ...
  ]
}

trend 規則：
  - cum_change_pct >= 3% 且 win_days >= 6 → "波段上漲"（值得追）
  - cum_change_pct >= 3% 但 win_days <= 4 → "煙火股"（一日行情居多，避開）
  - cum_change_pct <= -3% 且 win_days <= 4 → "波段下跌"（避開）
  - 其他 → "盤整" 或 "中性"
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

TW_TZ = pytz.timezone("Asia/Taipei")
NOW = datetime.now(TW_TZ)
TODAY = NOW.strftime("%Y-%m-%d")

WA_PATH = "data/watchlist_analysis.json"
OUT_PATH = "data/sector_history.json"

MAX_DAYS = 30   # 保留 30 天資料


def _load(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  ⚠️ load {path}: {e}", flush=True)
        return None


def _classify_trend(cum_pct: float, win_days: int) -> str:
    if cum_pct >= 3.0 and win_days >= 6:
        return "波段上漲"
    if cum_pct >= 3.0 and win_days <= 4:
        return "煙火股"
    if cum_pct <= -3.0 and win_days <= 4:
        return "波段下跌"
    if abs(cum_pct) < 1.0:
        return "盤整"
    return "中性"


def main():
    print(f"=== Sector History Tracker — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    wa = _load(WA_PATH)
    if not wa:
        print(f"  ⚠️ {WA_PATH} 不存在", flush=True)
        return

    sf = wa.get("sector_flow") or {}
    sectors = sf.get("sectors") or []
    if not sectors:
        print("  ⚠️ watchlist_analysis 沒有 sector_flow.sectors", flush=True)
        return

    today_record = {
        "date": TODAY,
        "fetched_at": NOW.strftime("%Y-%m-%d %H:%M:%S"),
        "taiex": sf.get("taiex") or {},
        "sectors": [
            {"name": s.get("name"), "change_pct": s.get("change_pct"), "strength": s.get("strength")}
            for s in sectors
        ],
    }

    # 載入既有歷史
    existing = _load(OUT_PATH) or {"days": [], "updated_at": ""}
    days = existing.get("days") or []

    # 移除今日重複（避免一天多次跑時 append 重複）
    days = [d for d in days if d.get("date") != TODAY]
    days.append(today_record)

    # 按日期排序 + 截斷到 MAX_DAYS
    days.sort(key=lambda x: x.get("date", ""))
    days = days[-MAX_DAYS:]

    # 計算最近 10 天的累積漲跌 + 上漲日數
    summary_10d = []
    last_10 = days[-10:] if len(days) >= 10 else days
    if last_10:
        # 收集所有出現過的產業名
        all_sec_names = set()
        for d in last_10:
            for s in d.get("sectors") or []:
                all_sec_names.add(s.get("name"))

        for name in all_sec_names:
            if not name:
                continue
            cum = 0.0
            win_days = 0
            present_days = 0
            for d in last_10:
                for s in d.get("sectors") or []:
                    if s.get("name") == name:
                        cp = s.get("change_pct")
                        if isinstance(cp, (int, float)):
                            cum += cp
                            present_days += 1
                            if cp > 0:
                                win_days += 1
                        break
            if present_days == 0:
                continue
            summary_10d.append({
                "name": name,
                "cum_change_pct": round(cum, 2),
                "win_days": win_days,
                "present_days": present_days,
                "trend": _classify_trend(cum, win_days),
            })
        summary_10d.sort(key=lambda x: -x["cum_change_pct"])

    out = {
        "updated_at": NOW.strftime("%Y-%m-%d %H:%M:%S"),
        "days_count": len(days),
        "days": days,
        "summary_10d": summary_10d,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"  📈 wrote {OUT_PATH} — {len(days)} days, {len(summary_10d)} sectors", flush=True)
    if summary_10d:
        print(f"  Top 3 強勢：", flush=True)
        for s in summary_10d[:3]:
            print(f"    {s['name']}: 累積 {s['cum_change_pct']:+.2f}% / 紅 {s['win_days']}/{s['present_days']} 天 [{s['trend']}]", flush=True)
        print(f"  Top 3 弱勢：", flush=True)
        for s in summary_10d[-3:]:
            print(f"    {s['name']}: 累積 {s['cum_change_pct']:+.2f}% / 紅 {s['win_days']}/{s['present_days']} 天 [{s['trend']}]", flush=True)


if __name__ == "__main__":
    main()
