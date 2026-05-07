"""
fetch_macro_calendar.py — 全球總經行事曆 (v11.9)

每日跑一次，產出 data/macro_calendar.json：
  {
    "updated_at": "...",
    "today": "2026-05-04",
    "events": [
      {
        "date": "2026-05-15",
        "time": "20:30",            # 台北時間
        "category": "us_cpi",       # us_cpi / us_nfp / fomc / earnings / tw_cbc / fed_speak
        "title": "美國 4 月 CPI",
        "importance": "high",       # high / medium / low
        "expected_impact": "...",   # 對台股影響中文敘述
        "details": {...}
      }
    ],
    "next_7_days": [...],            # 同 events 但只取 7 天內 + 重要性 medium 以上
  }

來源：
  1. 硬編 2026 年 FOMC 行事曆（Fed 官方公布）
  2. 規律算 NFP（每月第 1 個星期五）+ CPI（每月第 13-15 號間）
  3. 台灣央行（每年 3/6/9/12 月第 3 個星期四）
  4. yfinance 抓 NVDA / TSM / AAPL / GOOGL / META / AMD / MSFT / AVGO 下次財報日
"""
from __future__ import annotations

import os
import sys
import json
from datetime import datetime, date, timedelta
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# v11.10: Discord
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import notify_discord as _nd
except Exception:
    _nd = None

TW_TZ = pytz.timezone("Asia/Taipei")
NOW = datetime.now(TW_TZ)
TODAY = NOW.date()

OUT_PATH = "data/macro_calendar.json"


# ──────────────────────────────────────────
# 1. FOMC 2026（官方 Fed.gov 行事曆，UTC 日期）
# ──────────────────────────────────────────
FOMC_2026 = [
    ("2026-01-28", "FOMC 利率決策（1 月）"),
    ("2026-03-18", "FOMC 利率決策 + 經濟預測 SEP（3 月）"),
    ("2026-04-29", "FOMC 利率決策（4 月）"),
    ("2026-06-17", "FOMC 利率決策 + SEP（6 月）"),
    ("2026-07-29", "FOMC 利率決策（7 月）"),
    ("2026-09-16", "FOMC 利率決策 + SEP（9 月）"),
    ("2026-11-04", "FOMC 利率決策（11 月）"),
    ("2026-12-16", "FOMC 利率決策 + SEP（12 月）"),
]


# ──────────────────────────────────────────
# 2. 美國 NFP / CPI 規律算法
# ──────────────────────────────────────────
def _first_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    # weekday(): Mon=0..Sun=6；Friday=4
    days_ahead = (4 - d.weekday()) % 7
    return d + timedelta(days=days_ahead)


def _nth_thursday(year: int, month: int, n: int) -> date:
    d = date(year, month, 1)
    days_ahead = (3 - d.weekday()) % 7   # Thursday=3
    first_thu = d + timedelta(days=days_ahead)
    return first_thu + timedelta(weeks=n - 1)


def _nfp_dates(months_ahead: int = 3) -> list[tuple[str, str]]:
    """美國非農：每月第 1 個星期五，台北時間 20:30 公布"""
    out = []
    y, m = TODAY.year, TODAY.month
    for _ in range(months_ahead + 1):
        d = _first_friday(y, m)
        out.append((d.isoformat(), f"美國 {m} 月非農就業 (NFP)"))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def _cpi_dates(months_ahead: int = 3) -> list[tuple[str, str]]:
    """美國 CPI：每月 13 ~ 15 號間第一個工作日，台北時間 20:30 公布
    精確的話須查 BLS 行事曆，這裡用 14 日為近似（誤差 ±1-2 日）"""
    out = []
    y, m = TODAY.year, TODAY.month
    for _ in range(months_ahead + 1):
        # 找該月第 14 號（若週末則往後推到下個工作日）
        d = date(y, m, 14)
        while d.weekday() >= 5:
            d += timedelta(days=1)
        out.append((d.isoformat(), f"美國 {m} 月 CPI"))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


# ──────────────────────────────────────────
# 3. 台灣央行（每年 3/6/9/12 月第 3 個星期四）
# ──────────────────────────────────────────
def _tw_cbc_dates(months_ahead: int = 12) -> list[tuple[str, str]]:
    out = []
    y, m = TODAY.year, TODAY.month
    months_done = 0
    while months_done < months_ahead:
        if m in (3, 6, 9, 12):
            d = _nth_thursday(y, m, 3)
            out.append((d.isoformat(), f"台灣央行理監事會議（{m} 月）"))
        m += 1
        months_done += 1
        if m > 12:
            m = 1
            y += 1
    return out


# ──────────────────────────────────────────
# 4. yfinance 抓重點財報
# ──────────────────────────────────────────
EARNINGS_TICKERS = [
    ("NVDA",  "輝達 (NVDA)",          "AI GPU 龍頭，台積電 / 鴻海 / 廣達 直接連動"),
    ("TSM",   "台積電 ADR (TSM)",      "美股先反應，台股次日跳空高機率"),
    ("AAPL",  "蘋果 (AAPL)",           "iPhone 供應鏈：鴻海/可成/大立光/台積電"),
    ("GOOGL", "Google (GOOGL)",        "AI 基建：TPU 由台積電代工，廣達/緯創 ODM"),
    ("META",  "Meta (META)",            "MTIA 自研晶片 + AI 伺服器（廣達/緯創）"),
    ("AMD",   "超微 (AMD)",             "MI300 GPU，台積電代工"),
    ("MSFT",  "微軟 (MSFT)",            "Azure / Maia ASIC，廣達 ODM"),
    ("AVGO",  "博通 (AVGO)",            "ASIC 晶片，欣興 ABF 載板"),
]


def _fetch_earnings_dates() -> list[dict]:
    out = []
    try:
        import yfinance as yf
    except Exception as e:
        print(f"  ⚠️ yfinance import failed: {e}", flush=True)
        return out
    for ticker_sym, zh, impact in EARNINGS_TICKERS:
        try:
            t = yf.Ticker(ticker_sym)
            cal = None
            try:
                cal = t.calendar  # 新版 yfinance 回 dict
            except Exception:
                pass
            ed = None
            if isinstance(cal, dict):
                # earnings date 可能在 'Earnings Date' key
                ed_list = cal.get('Earnings Date') or []
                if ed_list:
                    ed = ed_list[0] if hasattr(ed_list, '__getitem__') else None
            if not ed:
                # fallback：earnings_dates DataFrame
                try:
                    edf = t.get_earnings_dates(limit=4)
                    if edf is not None and len(edf):
                        # 取未來最近一筆
                        future = edf[edf.index > NOW].sort_index()
                        if len(future):
                            ed = future.index[0].date()
                except Exception:
                    pass
            if ed:
                d_iso = ed.isoformat() if hasattr(ed, 'isoformat') else str(ed)[:10]
                out.append({
                    "date": d_iso,
                    "category": "earnings",
                    "title": f"{zh} 財報",
                    "importance": "high" if ticker_sym in ("NVDA", "TSM") else "medium",
                    "expected_impact": impact,
                    "details": {"ticker": ticker_sym},
                })
        except Exception as e:
            print(f"  ⚠️ {ticker_sym} earnings failed: {e}", flush=True)
    return out


# ──────────────────────────────────────────
# 5. 整合輸出
# ──────────────────────────────────────────
def _impact_for(category: str) -> tuple[str, str]:
    """回傳 (importance, expected_impact_zh)"""
    table = {
        "fomc":   ("high",   "美國利率決策；鷹/鴿派表態直接影響全球流動性，台股次日通常跳空反應"),
        "us_cpi": ("high",   "美國 CPI 數據；高於預期 → 升息預期升溫 → 美科技股下挫 → 台股半導體承壓"),
        "us_nfp": ("medium", "美國非農就業；強勁 → 美元升值 + 殖利率走高 → 不利成長股"),
        "tw_cbc": ("medium", "台灣央行決策；對台幣匯率與金融股直接影響"),
    }
    return table.get(category, ("medium", "市場關注事件"))


def main():
    print(f"=== Macro Calendar Fetcher — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    events = []

    # FOMC
    for d, title in FOMC_2026:
        imp, impact = _impact_for("fomc")
        events.append({
            "date": d, "time": "02:00",   # 凌晨 2 點台北時間（FOMC 通常美東 14:00）
            "category": "fomc", "title": title,
            "importance": imp, "expected_impact": impact,
        })

    # NFP
    for d, title in _nfp_dates(3):
        imp, impact = _impact_for("us_nfp")
        events.append({
            "date": d, "time": "20:30",
            "category": "us_nfp", "title": title,
            "importance": imp, "expected_impact": impact,
        })

    # CPI
    for d, title in _cpi_dates(3):
        imp, impact = _impact_for("us_cpi")
        events.append({
            "date": d, "time": "20:30",
            "category": "us_cpi", "title": title,
            "importance": imp, "expected_impact": impact,
        })

    # TW CBC
    for d, title in _tw_cbc_dates(12):
        imp, impact = _impact_for("tw_cbc")
        events.append({
            "date": d, "time": "16:00",
            "category": "tw_cbc", "title": title,
            "importance": imp, "expected_impact": impact,
        })

    # 財報
    print("[macro] fetching big-tech earnings dates...", flush=True)
    events.extend(_fetch_earnings_dates())

    # 過濾未來 90 天 + 排序
    horizon = TODAY + timedelta(days=90)
    events = [e for e in events
              if TODAY.isoformat() <= e["date"] <= horizon.isoformat()]
    events.sort(key=lambda x: (x["date"], x.get("time", "00:00")))

    # next_7_days：只取重要性 medium+
    next_7 = []
    in_7 = (TODAY + timedelta(days=7)).isoformat()
    for e in events:
        if e["date"] <= in_7 and e.get("importance") in ("high", "medium"):
            next_7.append(e)

    out = {
        "updated_at": NOW.strftime("%Y-%m-%d %H:%M:%S"),
        "today": TODAY.isoformat(),
        "horizon_days": 90,
        "events": events,
        "next_7_days": next_7,
        "total_count": len(events),
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"  📅 wrote {OUT_PATH} — {len(events)} events ({len(next_7)} in next 7 days)", flush=True)
    for e in next_7[:5]:
        imp_emoji = "🔴" if e["importance"] == "high" else "🟡"
        print(f"     {imp_emoji} {e['date']} {e.get('time','')} {e['title']}", flush=True)

    # v11.10：每天傍晚（17-19 點）跑一次時，若隔天有 high/medium 事件就推 Discord
    try:
        if _nd and _nd.NOTIFY_UID and 17 <= NOW.hour <= 19:
            from datetime import timedelta as _td
            tomorrow = (TODAY + _td(days=1)).isoformat()
            tomorrow_events = [e for e in events
                               if e.get("date") == tomorrow
                               and e.get("importance") in ("high", "medium")]
            if tomorrow_events:
                _nd.card_macro_tomorrow(tomorrow_events)
                print(f"  📲 Discord 推送 {len(tomorrow_events)} 個隔日大事", flush=True)
    except Exception as e:
        print(f"  ⚠️ Discord macro push failed: {e}", flush=True)


if __name__ == "__main__":
    main()
