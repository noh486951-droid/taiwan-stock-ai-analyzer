"""red_flags_scanner.py — 地雷股紅旗掃描 + 大戶排行（v12.8.0 健檢中心後端）

紅旗來源：
  1. TWSE 注意股票（notice）/ 處置股票（punish）官方公告
  2. 散戶擁擠度：TDCC 散戶佔比 > 40%（且週增，若有 delta）
  3. 鯨魚出走：千張大戶週減 + 散戶週增（需兩週 TDCC 資料）

大戶排行（好籌碼面）：
  4. 千張大戶持股比 Top 50
  5. 千張大戶週增 Top 50（需兩週資料）

輸出：data/red_flags.json
執行：main.yml 18:07 EOD
"""
from __future__ import annotations
import os
import sys
import json
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
OUT_PATH = 'data/red_flags.json'


def _load(path, default):
    try:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"  ⚠️ load {path}: {e}", flush=True)
    return default


def _build_name_map() -> dict:
    """從 T86 history 建 code→中文名 對照（1000+ 檔）"""
    names = {}
    h = _load('data/inst_history_full.json', {})
    for day in reversed(h.get('days') or []):
        for code, s in (day.get('stocks') or {}).items():
            if code not in names and s.get('name'):
                names[code] = s['name']
    return names


def _is_stock_code(code: str) -> bool:
    """一般個股 4 碼；排除權證(6碼)/ETF(00xx)"""
    return code.isdigit() and len(code) == 4 and not code.startswith('00')


def _fetch_twse_announcements() -> tuple[list, list]:
    """抓 TWSE 注意股票 + 處置股票（僅保留一般個股）"""
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    attention, punish = [], []
    try:
        r = requests.get('https://www.twse.com.tw/rwd/zh/announcement/notice?response=json',
                         timeout=20, headers=headers)
        j = r.json()
        # 欄位: [編號, 證券代號, 證券名稱, 累計次數, 注意交易資訊, 日期, ...]
        for row in (j.get('data') or []):
            if len(row) < 6:
                continue
            code = str(row[1]).strip()
            if not _is_stock_code(code):
                continue
            attention.append({
                'code': code, 'sym': f'{code}.TW',
                'name': str(row[2]).strip(),
                'count': str(row[3]).strip(),
                'reason': str(row[4]).strip()[:120],
                'date': str(row[5]).strip(),
            })
        print(f"  ⚠️ 注意股票 {len(attention)} 檔（個股）", flush=True)
    except Exception as e:
        print(f"  ⚠️ notice fetch: {e}", flush=True)
    try:
        r = requests.get('https://www.twse.com.tw/rwd/zh/announcement/punish?response=json',
                         timeout=20, headers=headers)
        j = r.json()
        # 欄位: [編號, 公布日期, 證券代號, 證券名稱, 累計, 處置條件, 處置期間, 處置次數, 內容]
        for row in (j.get('data') or []):
            if len(row) < 7:
                continue
            code = str(row[2]).strip()
            if not _is_stock_code(code):
                continue
            punish.append({
                'code': code, 'sym': f'{code}.TW',
                'name': str(row[3]).strip(),
                'announce_date': str(row[1]).strip(),
                'period': str(row[6]).strip() if len(row) > 6 else '',
                'condition': str(row[5]).strip()[:80] if len(row) > 5 else '',
            })
        print(f"  🚫 處置股票 {len(punish)} 檔（個股）", flush=True)
    except Exception as e:
        print(f"  ⚠️ punish fetch: {e}", flush=True)
    return attention, punish


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] red_flags_scanner start", flush=True)
    names = _build_name_map()
    holders = _load('data/holders_distribution_full.json', {})
    stocks = holders.get('stocks') or {}
    as_of = holders.get('as_of_date', '')

    retail_crowded, whale_exodus, mega_top, mega_gainers = [], [], [], []
    for sym, d in stocks.items():
        code = sym.split('.')[0]
        if not _is_stock_code(code):
            continue
        # v12.8.1：只收「T86 名單內」的個股（上市有量的 ~1000 檔）
        # 排除興櫃/停牌/冷門股 — 這些常出現散戶 100% 的無效數據，且無中文名
        name = names.get(code, '')
        if not name:
            continue
        entry = {
            'sym': sym, 'code': code,
            'name': name,
            'retail_pct': d.get('retail_pct', 0),
            'mega_pct': d.get('mega_pct', 0),
            'big_pct': d.get('big_pct', 0),
        }
        wc = d.get('weekly_change') or {}
        entry['retail_delta'] = wc.get('retail')
        entry['mega_delta'] = wc.get('mega')

        # 紅旗 2：散戶擁擠（>40%）
        if entry['retail_pct'] > 40:
            retail_crowded.append(entry)
        # 紅旗 3：鯨魚出走（千張週減 ≥0.3pp + 散戶週增 ≥0.3pp）
        if (entry['mega_delta'] is not None and entry['mega_delta'] <= -0.3
                and entry['retail_delta'] is not None and entry['retail_delta'] >= 0.3):
            whale_exodus.append(entry)
        # 好籌碼 4：千張大戶高持股
        if entry['mega_pct'] > 0:
            mega_top.append(entry)
        # 好籌碼 5：千張週增
        if entry['mega_delta'] is not None and entry['mega_delta'] >= 0.2:
            mega_gainers.append(entry)

    retail_crowded.sort(key=lambda x: -(x['retail_pct'] or 0))
    whale_exodus.sort(key=lambda x: (x['mega_delta'] or 0))
    mega_top.sort(key=lambda x: -(x['mega_pct'] or 0))
    mega_gainers.sort(key=lambda x: -(x['mega_delta'] or 0))

    attention, punish = _fetch_twse_announcements()

    payload = {
        'generated_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'tdcc_as_of': as_of,
        'attention': attention,
        'punish': punish,
        'retail_crowded': retail_crowded[:50],
        'whale_exodus': whale_exodus[:50],
        'mega_top': mega_top[:50],
        'mega_gainers': mega_gainers[:50],
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"  ✅ 紅旗: 注意{len(attention)} 處置{len(punish)} 散戶擁擠{len(retail_crowded)} "
          f"鯨魚出走{len(whale_exodus)} | 大戶榜{len(mega_top[:50])} 週增榜{len(mega_gainers[:50])} → {OUT_PATH}", flush=True)


if __name__ == '__main__':
    main()
