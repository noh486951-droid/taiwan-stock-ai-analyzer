"""tdcc_holders_fetcher.py — 抓 TDCC 集保戶股權分散表（週級資料）

每週六台股休市，TDCC 公布前一週五的快照。
此 script 在每週六晚 18:07 EOD 跑（main.yml 觸發），但平日跑也無害（沿用上週）。

資料來源：
  TDCC 開放資料 https://opendata.tdcc.com.tw/getOD.ashx?id=1792898967
  欄位（CSV）: 資料日期, 證券代號, 持股分級, 人數, 股數, 占集保庫存數比例%

持股分級對照（轉成「散戶/中實戶/大戶/千張」四桶）：
  level 1-3 (1~10張)             → 散戶
  level 4-11 (10~400張)          → 中實戶
  level 12-14 (400~1000張)       → 大戶
  level 15 (>1000張)             → 千張大戶
  level 16,17                    → 差異/合計（捨棄）

輸出：data/holders_distribution.json
{
  "as_of_date": "20260613",
  "fetched_at": "...",
  "stocks": {
    "2330.TW": {
      "retail_pct": 28.3,       # 散戶
      "mid_pct": 18.6,          # 中實戶
      "big_pct": 8.0,           # 400~1000張大戶
      "mega_pct": 22.1,         # 千張大戶
      "official_pct": 23.0,     # 一般法人(剩餘=100-上面四項)
      "weekly_change": {
        "retail": -0.4,
        "mega": +0.1
      }
    },
    ...
  }
}

掃描來源：自選股 + AI bot + 真實用戶持倉/歷史
"""
from __future__ import annotations
import os
import sys
import json
import io
import csv
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
OUT_PATH = 'data/holders_distribution.json'
WORKER_URL = "https://tw-stock-ai-proxy.noh486951-e8a.workers.dev"

TDCC_URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1792898967"


def _gather_target_symbols() -> set[str]:
    """收集所有需追蹤的台股代號（不含 .TW 後綴的純數字代碼集合）"""
    syms = set()

    # 1. 自選股 (從 watchlist_quick 用的同一個來源)
    try:
        if os.path.exists('data/watchlist_analysis.json'):
            with open('data/watchlist_analysis.json', 'r', encoding='utf-8') as f:
                j = json.load(f) or {}
            for s in (j.get('stocks') or {}).keys():
                syms.add(s)
    except Exception as e:
        print(f"  ⚠️ load watchlist_analysis: {e}", flush=True)

    # 2. AI bot
    try:
        if os.path.exists('data/ai_bot_portfolio.json'):
            with open('data/ai_bot_portfolio.json', 'r', encoding='utf-8') as f:
                p = json.load(f) or {}
            for s in (p.get('positions') or {}).keys():
                syms.add(s)
            for t in (p.get('history') or []):
                s = t.get('sym') or t.get('symbol')
                if s:
                    syms.add(s)
    except Exception as e:
        print(f"  ⚠️ load ai_bot: {e}", flush=True)

    # 3. 真實用戶（透過 worker）
    try:
        secret = os.environ.get('PAPER_TRADE_ENGINE_SECRET', '')
        if secret:
            r = requests.get(f"{WORKER_URL}/api/paper-trade/all-users",
                             headers={'X-Engine-Secret': secret}, timeout=15)
            if r.status_code == 200:
                users = r.json().get('users', [])
                for u in users:
                    uid = u.get('uid') if isinstance(u, dict) else u
                    if not uid or uid == 'ai_scout_bot':
                        continue
                    pr = requests.get(f"{WORKER_URL}/api/paper-trade?uid={uid}&engine=1",
                                      headers={'X-Engine': '1', 'X-Engine-Secret': secret},
                                      timeout=10)
                    if pr.status_code == 200:
                        pp = pr.json() or {}
                        for s in (pp.get('positions') or {}).keys():
                            syms.add(s)
                        for t in (pp.get('history') or []):
                            s = t.get('sym') or t.get('symbol')
                            if s:
                                syms.add(s)
    except Exception as e:
        print(f"  ⚠️ fetch users: {e}", flush=True)

    # 4. 轉成純代碼（拿掉 .TW/.TWO 後綴），TDCC 用純代碼
    codes = set()
    for s in syms:
        c = s.split('.')[0].strip()
        if c.isdigit() and 4 <= len(c) <= 6:
            codes.add(c)
    return codes


def _fetch_tdcc_csv() -> list[list[str]] | None:
    """抓 TDCC 集保戶股權分散表 CSV"""
    print(f"  📡 GET {TDCC_URL[:60]}…", flush=True)
    try:
        # 加 allow_redirects 控制 + 多 user-agent 嘗試
        r = requests.get(
            TDCC_URL,
            timeout=60,
            allow_redirects=True,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/csv,application/csv,*/*',
            },
        )
        r.raise_for_status()
    except Exception as e:
        print(f"  ❌ TDCC fetch fail: {e}", flush=True)
        return None

    # 嘗試多種編碼
    text = None
    for enc in ('utf-8-sig', 'utf-8', 'big5', 'cp950'):
        try:
            text = r.content.decode(enc)
            break
        except Exception:
            continue
    if not text:
        print("  ❌ TDCC CSV decode failed", flush=True)
        return None

    print(f"  📥 收到 {len(text):,} 字元", flush=True)
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        print("  ❌ TDCC CSV 內容為空", flush=True)
        return None
    return rows


def _parse_tdcc(rows: list[list[str]], target_codes: set[str]) -> dict:
    """把 TDCC CSV 轉成 {code: {level: pct}} 結構

    CSV 欄位（推測）: 資料日期, 證券代號, 持股分級, 人數, 股數, 占集保庫存數比例%
    第一列是表頭。
    """
    header = rows[0]
    print(f"  📋 表頭: {header}", flush=True)

    # 找欄位 index（容錯）
    def _find_col(keys):
        for i, h in enumerate(header):
            for k in keys:
                if k in str(h):
                    return i
        return -1

    col_date = _find_col(['資料日期', '日期'])
    col_code = _find_col(['證券代號', '代號', '代碼'])
    col_lvl = _find_col(['持股分級', '分級'])
    col_pct = _find_col(['占集保庫存', '比例', '佔比'])

    if min(col_code, col_lvl, col_pct) < 0:
        print(f"  ❌ 欄位辨識失敗: code={col_code} lvl={col_lvl} pct={col_pct}", flush=True)
        return {}

    as_of = ''
    data_by_code: dict[str, dict[int, float]] = {}
    for row in rows[1:]:
        if not row or len(row) <= max(col_code, col_lvl, col_pct):
            continue
        code = str(row[col_code]).strip()
        if code not in target_codes:
            continue
        try:
            lvl = int(str(row[col_lvl]).strip())
            pct = float(str(row[col_pct]).strip())
        except Exception:
            continue
        if col_date >= 0 and not as_of:
            as_of = str(row[col_date]).strip()
        data_by_code.setdefault(code, {})[lvl] = pct

    print(f"  ✅ 解析到 {len(data_by_code)} 檔（as_of={as_of}）", flush=True)
    return {'as_of_date': as_of, 'by_code': data_by_code}


def _bucketize(level_pct: dict[int, float]) -> dict:
    """把 15 個 level 折成 4 桶 + 法人推估"""
    retail = sum(level_pct.get(i, 0) for i in (1, 2, 3))         # 1-10張
    mid = sum(level_pct.get(i, 0) for i in range(4, 12))         # 10-400張
    big = sum(level_pct.get(i, 0) for i in (12, 13, 14))         # 400-1000張
    mega = level_pct.get(15, 0)                                   # >1000張
    total = retail + mid + big + mega
    # 一般法人 (含政府/外資/投信專戶) ≈ 100 - 上述 (但集保不一定全部歸入散戶/大戶，所以保留差額)
    leftover = max(0.0, 100.0 - total) if total > 0 else 0.0
    return {
        'retail_pct': round(retail, 2),
        'mid_pct': round(mid, 2),
        'big_pct': round(big, 2),
        'mega_pct': round(mega, 2),
        'other_pct': round(leftover, 2),
    }


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] tdcc_holders_fetcher start", flush=True)
    target = _gather_target_symbols()
    if not target:
        print("  ℹ️ 沒有要追蹤的個股，結束", flush=True)
        return
    print(f"  📋 追蹤 {len(target)} 檔", flush=True)

    rows = _fetch_tdcc_csv()
    if not rows:
        print("  ❌ 沒拿到 TDCC 資料，保留舊檔不覆寫", flush=True)
        return

    parsed = _parse_tdcc(rows, target)
    if not parsed.get('by_code'):
        print("  ❌ 解析後沒資料，保留舊檔", flush=True)
        return

    # 讀舊檔做週對週變化
    prev = {}
    try:
        if os.path.exists(OUT_PATH):
            with open(OUT_PATH, 'r', encoding='utf-8') as f:
                old = json.load(f) or {}
            if old.get('as_of_date') and old.get('as_of_date') != parsed.get('as_of_date'):
                prev = (old.get('stocks') or {})
    except Exception:
        pass

    out_stocks = {}
    for code, lp in parsed['by_code'].items():
        sym = f"{code}.TW"  # 上市；上櫃會由 watchlist_quick 端 fallback 處理
        buckets = _bucketize(lp)
        change = {}
        if sym in prev:
            for k in ('retail_pct', 'mid_pct', 'big_pct', 'mega_pct'):
                if k in prev[sym]:
                    change[k.replace('_pct', '')] = round(buckets[k] - prev[sym][k], 2)
        out_stocks[sym] = {**buckets, 'weekly_change': change}

    payload = {
        'as_of_date': parsed.get('as_of_date', ''),
        'fetched_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'source': 'TDCC opendata id=1792898967',
        'stocks': out_stocks,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"  ✅ 寫入 {len(out_stocks)} 檔 → {OUT_PATH}", flush=True)


if __name__ == '__main__':
    main()
