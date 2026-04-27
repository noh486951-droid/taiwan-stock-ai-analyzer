"""
fetch_corporate_events.py — 個股「未來事件」抓取（v11.5）

來源：
  1. 股東會 + 配息預告：TWSE OpenAPI t187ap38_L（UTF-8 JSON）
  2. 法人說明會：MOPS ajax_t100sb02_1（Big5 HTML，POST）
  3. 已實施除權息：TWSE rwd TWT49U（過去資料，僅做日曆參考）

輸出：data/corp_events.json
{
  "updated_at": "...",
  "events": {
     "2330.TW": [
       {"type": "shareholders_meeting", "date": "2025-06-10", "title": "..."},
       {"type": "investor_conf",        "date": "2025-05-22", "time": "14:00", "title":"...", "url":"..."},
       {"type": "ex_dividend_planned",  "date": "...", "cash":4.5, "stock":0}
     ]
  },
  "by_date": { "2025-05-22": [{"symbol": "2330.TW", "type":"investor_conf", ...}] }
}

每週日 + 每日盤後跑都可以；資料量小（<200KB）。
"""
from __future__ import annotations

import os
import sys
import json
import re
import time
from datetime import datetime, date, timedelta
from typing import Any

import requests
import pytz
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

TW_TZ = pytz.timezone("Asia/Taipei")
NOW = datetime.now(TW_TZ)
TODAY = NOW.date()

OUT_PATH = "data/corp_events.json"

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


# ─────────────────────────────────────────────
# 工具
# ─────────────────────────────────────────────
def _roc_to_iso(s: str) -> str | None:
    """115/05/22 or 1150522 → 2026-05-22"""
    if not s:
        return None
    s = s.strip().replace("/", "")
    if not s.isdigit() or len(s) != 7:
        return None
    try:
        y = int(s[:3]) + 1911
        m = int(s[3:5])
        d = int(s[5:7])
        return f"{y:04d}-{m:02d}-{d:02d}"
    except Exception:
        return None


def _is_future_or_today(iso: str | None, days_ahead: int = 90) -> bool:
    if not iso:
        return False
    try:
        d = datetime.strptime(iso, "%Y-%m-%d").date()
        return TODAY <= d <= TODAY + timedelta(days=days_ahead)
    except Exception:
        return False


# ─────────────────────────────────────────────
# 1. 股東會 + 配息預告
# ─────────────────────────────────────────────
def fetch_shareholders_meetings() -> list[dict]:
    """t187ap38_L — 股東會召開資訊 + 預擬配息（多為當年 3-7 月公告）"""
    print("[events] fetching shareholders meetings (t187ap38_L)...", flush=True)
    out = []
    for src in ["sii", "otc"]:
        # OpenAPI 只暴露 sii 主資料表
        if src != "sii":
            continue
        try:
            url = "https://openapi.twse.com.tw/v1/opendata/t187ap38_L"
            r = requests.get(url, timeout=30, headers=UA, verify=False)
            data = r.json() if r.text.strip().startswith("[") else []
            for row in data:
                code = (row.get("公司代號") or "").strip()
                if not code.isdigit():
                    continue
                meet_date = _roc_to_iso(row.get("股東常(臨時)會日期-日期"))
                cash = (row.get("預擬配發現金(股利)(元/股)-盈餘") or "").strip()
                stock = (row.get("預擬配股(元/股)-盈餘") or "").strip()
                cash_v = float(cash) if cash and cash.replace(".", "").isdigit() else 0
                stock_v = float(stock) if stock and stock.replace(".", "").isdigit() else 0

                sym = code + ".TW"
                if meet_date and _is_future_or_today(meet_date, 120):
                    out.append({
                        "symbol": sym,
                        "code": code,
                        "name": (row.get("公司名稱") or "").strip(),
                        "type": "shareholders_meeting",
                        "date": meet_date,
                        "title": "股東" + (row.get("股東常(臨時)會日期-常或臨時") or "常") + "會",
                    })
                # 預擬配息（無實際除息日，但提示市場）
                if (cash_v or stock_v) and meet_date:
                    out.append({
                        "symbol": sym,
                        "code": code,
                        "name": (row.get("公司名稱") or "").strip(),
                        "type": "dividend_planned",
                        "date": meet_date,
                        "title": f"預擬配息：現金 {cash_v:.2f} + 股票 {stock_v:.2f}",
                        "cash": cash_v,
                        "stock": stock_v,
                    })
            print(f"  ✅ shareholders meetings: {len(out)} entries", flush=True)
        except Exception as e:
            print(f"  ⚠️ shareholders fetch failed: {e}", flush=True)
    return out


# ─────────────────────────────────────────────
# 2. 法人說明會
# ─────────────────────────────────────────────
def fetch_investor_conferences() -> list[dict]:
    """從 MOPS 抓未來 3 個月（含本月）法說會排程"""
    print("[events] fetching investor conferences (MOPS)...", flush=True)
    out = []
    yyyymm_list = []
    for delta in range(0, 3):
        d = TODAY.replace(day=1) + timedelta(days=delta * 31)
        roc_year = d.year - 1911
        yyyymm_list.append((roc_year, d.month))

    for typek in ["sii", "otc"]:
        for roc_year, mm in yyyymm_list:
            try:
                r = requests.post(
                    "https://mopsov.twse.com.tw/mops/web/ajax_t100sb02_1",
                    headers={**UA, "Content-Type": "application/x-www-form-urlencoded"},
                    data={
                        "encodeURIComponent": "1",
                        "step": "1",
                        "firstin": "true",
                        "off": "1",
                        "TYPEK": typek,
                        "year": str(roc_year),
                        "month": f"{mm:02d}",
                        "co_id": "",
                    },
                    timeout=25, verify=False,
                )
                # 編碼：MOPS 大多是 UTF-8 但有時 Big5
                html = None
                for enc in ("utf-8", "big5", "cp950"):
                    try:
                        html = r.content.decode(enc)
                        if "公司代號" in html or "TD" in html:
                            break
                    except Exception:
                        continue
                if not html:
                    continue
                # 找出表格 <tr>...</tr>
                rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)
                for row in rows:
                    cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.DOTALL)
                    cells = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
                    if len(cells) < 5:
                        continue
                    code = cells[0]
                    if not code.isdigit() or len(code) != 4:
                        continue
                    name = cells[1]
                    date_s = cells[2]                # 115/05/22
                    time_s = cells[3] if len(cells) > 3 else ""
                    location_or_url = cells[4] if len(cells) > 4 else ""
                    title = cells[5] if len(cells) > 5 else "法人說明會"
                    iso = _roc_to_iso(date_s)
                    if not iso:
                        continue
                    if not _is_future_or_today(iso, 100):
                        continue
                    sym = code + (".TWO" if typek == "otc" else ".TW")
                    out.append({
                        "symbol": sym,
                        "code": code,
                        "name": name,
                        "type": "investor_conf",
                        "date": iso,
                        "time": time_s,
                        "title": title[:80] or "法人說明會",
                        "location": location_or_url[:120],
                    })
                time.sleep(0.7)  # 對 MOPS 客氣一點
            except Exception as e:
                print(f"  ⚠️ MOPS {typek} {roc_year}/{mm:02d} failed: {e}", flush=True)

    # 去重
    dedup = {}
    for ev in out:
        k = (ev["symbol"], ev["date"], ev["title"][:30])
        dedup[k] = ev
    out = list(dedup.values())
    print(f"  ✅ investor conferences: {len(out)} entries", flush=True)
    return out


# ─────────────────────────────────────────────
# 3. 已實施除權息（過去 90 日）— 給歷史回顧用
# ─────────────────────────────────────────────
def fetch_ex_dividend_history(days_back: int = 30) -> list[dict]:
    """TWSE rwd TWT49U — 取最近 N 天已實施除權息資料"""
    print("[events] fetching ex-dividend history...", flush=True)
    out = []
    for d_offset in range(0, days_back, 5):
        d = TODAY - timedelta(days=d_offset)
        if d.weekday() >= 5:
            continue
        date_s = d.strftime("%Y%m%d")
        try:
            r = requests.get(
                f"https://www.twse.com.tw/rwd/zh/exRight/TWT49U?response=json&strDate={date_s}&endDate={date_s}",
                headers=UA, timeout=20, verify=False,
            )
            j = r.json()
            if j.get("stat") != "OK":
                continue
            for row in j.get("data", []):
                if len(row) < 7:
                    continue
                roc = row[0]
                code = row[1].strip()
                if not code.isdigit():
                    continue
                iso = _roc_to_iso(roc.replace("年", "/").replace("月", "/").replace("日", ""))
                cat = row[6]  # 權/息
                out.append({
                    "symbol": code + ".TW",
                    "code": code,
                    "name": row[2].strip(),
                    "type": "ex_dividend",
                    "date": iso,
                    "title": f"已除{cat}",
                    "ref_price": row[4] if len(row) > 4 else None,
                })
        except Exception as e:
            print(f"  ⚠️ TWT49U {date_s} failed: {e}", flush=True)
        time.sleep(0.3)
    print(f"  ✅ ex-dividend history: {len(out)} entries", flush=True)
    return out


# ─────────────────────────────────────────────
# 整合 + 輸出
# ─────────────────────────────────────────────
def main():
    print(f"=== Corporate Events Fetcher — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    all_events = []
    all_events += fetch_shareholders_meetings()
    all_events += fetch_investor_conferences()
    all_events += fetch_ex_dividend_history(days_back=14)  # 只回顧 2 週

    # 按 symbol 分組
    by_symbol: dict[str, list] = {}
    for ev in all_events:
        sym = ev.get("symbol")
        if not sym:
            continue
        by_symbol.setdefault(sym, []).append({k: v for k, v in ev.items() if k != "symbol"})
    # 每檔按日期排序
    for sym, lst in by_symbol.items():
        lst.sort(key=lambda x: x.get("date") or "")

    # 按日期分組（給日曆 UI）
    by_date: dict[str, list] = {}
    for ev in all_events:
        d = ev.get("date")
        if not d:
            continue
        by_date.setdefault(d, []).append({
            "symbol": ev.get("symbol"),
            "code": ev.get("code"),
            "name": ev.get("name"),
            "type": ev.get("type"),
            "title": ev.get("title"),
        })

    out = {
        "updated_at": NOW.strftime("%Y-%m-%d %H:%M:%S"),
        "today": TODAY.strftime("%Y-%m-%d"),
        "total_events": len(all_events),
        "events_by_symbol": by_symbol,
        "events_by_date": dict(sorted(by_date.items())),
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"  📅 wrote {OUT_PATH} — {len(all_events)} events across {len(by_symbol)} stocks", flush=True)


if __name__ == "__main__":
    main()
