"""update_tw_holidays.py — 自動抓 TWSE 官方休市日曆

來源：證交所「休市日期表」官方 endpoint
  https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&queryYear=YYY

YYY = ROC 年（西元 - 1911）

輸出：data/tw_holidays.json
{
  "fetched_at": "2026-06-19 10:00:00",
  "years": [2026, 2027],
  "holidays": ["2026-01-01", "2026-02-16", ...]
}

跑點：
  - 每年自動抓「今年」+「明年」
  - 透過 main.yml 每天 18:07 順手跑一次（資料量小，~10KB）
  - 即使 TWSE 還沒公佈隔年（通常 11~12 月才出），會 fallback 只寫今年

引擎讀法：
  paper_trade_engine.py 先讀此檔，讀不到 fallback 到內建 set
"""
from __future__ import annotations
import os
import sys
import json
import re
from datetime import datetime
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import requests

TW = pytz.timezone('Asia/Taipei')
NOW = datetime.now(TW)
OUT_PATH = 'data/tw_holidays.json'

TWSE_URL = "https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule"


def _fetch_year(year_ad: int) -> list[str]:
    """抓某年的休市日清單，回傳 ['YYYY-MM-DD', ...]"""
    roc_year = year_ad - 1911
    params = {'response': 'json', 'queryYear': str(roc_year)}
    print(f"  📡 抓 {year_ad}（民國 {roc_year}）…", flush=True)
    try:
        r = requests.get(TWSE_URL, params=params, timeout=20,
                         headers={'User-Agent': 'Mozilla/5.0 (tw-stock-ai-analyzer)'})
        r.raise_for_status()
        j = r.json()
    except Exception as e:
        print(f"    ❌ fetch fail: {e}", flush=True)
        return []

    data = j.get('data') or []
    if not data:
        print(f"    ℹ️ TWSE 尚未公佈 {year_ad} 行事曆", flush=True)
        return []

    dates: set[str] = set()
    # 格式：[日期(西元 YYYY-MM-DD), 名稱, 說明]
    # 排除：名稱含「開始交易」「結束交易」「最後交易」「結算交割」（這些是非休市標註）
    date_re = re.compile(r'(\d{4})-(\d{1,2})-(\d{1,2})')
    EXCLUDE_KW = ('開始交易', '最後交易', '結算交割')

    for row in data:
        if not row or not isinstance(row, list) or len(row) < 2:
            continue
        raw_date = str(row[0])
        name = str(row[1]) if len(row) > 1 else ''
        if any(kw in name for kw in EXCLUDE_KW):
            continue
        m = date_re.match(raw_date.strip())
        if not m:
            continue
        try:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            dates.add(f"{y:04d}-{mo:02d}-{d:02d}")
        except Exception:
            continue

    print(f"    ✅ 抓到 {len(dates)} 個休市日", flush=True)
    return sorted(dates)


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] update_tw_holidays start", flush=True)
    this_year = NOW.year
    next_year = this_year + 1

    all_holidays: set[str] = set()
    years_ok: list[int] = []

    for y in (this_year, next_year):
        ds = _fetch_year(y)
        if ds:
            all_holidays.update(ds)
            years_ok.append(y)

    # 保留舊資料的未來日期（避免 TWSE 暫時抓不到時誤刪）
    if os.path.exists(OUT_PATH):
        try:
            with open(OUT_PATH, 'r', encoding='utf-8') as f:
                old = json.load(f) or {}
            old_h = old.get('holidays') or []
            today_s = NOW.strftime('%Y-%m-%d')
            for d in old_h:
                if d >= today_s:
                    all_holidays.add(d)
        except Exception as e:
            print(f"  ⚠️ 讀舊檔失敗（不致命）: {e}", flush=True)

    if not all_holidays:
        print("  ❌ 沒抓到任何資料，保留舊檔不覆寫", flush=True)
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    payload = {
        'fetched_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'source': 'twse.com.tw/rwd/zh/holidaySchedule',
        'years': years_ok,
        'holidays': sorted(all_holidays),
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"  ✅ 寫入 {len(all_holidays)} 個休市日 → {OUT_PATH}", flush=True)


if __name__ == '__main__':
    main()
