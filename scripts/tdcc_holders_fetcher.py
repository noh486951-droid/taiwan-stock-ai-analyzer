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

# v12.7.5 修：正確 id 是 '1-5'（集保戶股權分散表）
# 之前用的數字 id 1792898967 是 data.gov.tw 的 dataset 編號，TDCC 端全回 'No Data!'
TDCC_URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5"


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
    """抓 TDCC 集保戶股權分散表 CSV

    v12.5.5：TDCC 的 SSL 證書缺 Subject Key Identifier，標準 Python urllib/requests 會擋。
    用 verify=False（公開資料、政府 API、無敏感資訊，可接受）+ 抑制警告。
    """
    print(f"  📡 GET {TDCC_URL[:60]}…", flush=True)
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass
    try:
        r = requests.get(
            TDCC_URL,
            timeout=60,
            allow_redirects=True,
            verify=False,  # TDCC 證書缺 SKI，標準 SSL 鏈無法驗證
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


def _parse_all_stocks(rows: list[list[str]]) -> dict:
    """v12.4.8：parse 全市場（不過濾 target）→ 給尋找大鯨魚用"""
    header = rows[0]
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
        return {}
    as_of = ''
    data_by_code: dict[str, dict[int, float]] = {}
    for row in rows[1:]:
        if not row or len(row) <= max(col_code, col_lvl, col_pct):
            continue
        code = str(row[col_code]).strip()
        # 跳過 ETF/債券（一般 4 碼數字）
        if not (code.isdigit() and len(code) == 4):
            continue
        try:
            lvl = int(str(row[col_lvl]).strip())
            pct = float(str(row[col_pct]).strip())
        except Exception:
            continue
        if col_date >= 0 and not as_of:
            as_of = str(row[col_date]).strip()
        data_by_code.setdefault(code, {})[lvl] = pct
    return {'as_of_date': as_of, 'by_code': data_by_code}


def _load_t86_names() -> dict:
    """v12.9.2：從 T86 history 建 code→中文名（同 red_flags v12.8.1 做法）
    雙重用途：補中文名 + 過濾興櫃/上櫃誤標/冷門股（不在 T86 主板名單就跳過）"""
    names = {}
    try:
        if os.path.exists('data/inst_history_full.json'):
            h = json.load(open('data/inst_history_full.json', encoding='utf-8'))
            for day in reversed(h.get('days') or []):
                for code, s in (day.get('stocks') or {}).items():
                    if code not in names and s.get('name'):
                        names[code] = s['name']
    except Exception as e:
        print(f"  ⚠️ load t86 names: {e}", flush=True)
    return names


def _filter_overheated(candidates: list, top_n: int) -> list:
    """v12.9.2 過熱過濾：5 日已漲 > 12% 的剔除（追已噴案例：中石化 +24% 隔週被再選 → -12%）
    只對前 top_n*3 檔查價（yfinance batch），省 API"""
    if not candidates:
        return candidates
    check = candidates[:top_n * 3]
    try:
        import yfinance as yf
        tickers = [c['sym'] for c in check]
        df = yf.download(tickers=' '.join(tickers), period='10d', interval='1d',
                         group_by='ticker', progress=False, threads=True, auto_adjust=False)
        import pandas as pd
        kept = []
        for c in check:
            sym = c['sym']
            try:
                sub = df[sym] if isinstance(df.columns, pd.MultiIndex) else df
                closes = sub['Close'].dropna()
                if len(closes) >= 6:
                    chg5 = (closes.iloc[-1] - closes.iloc[-6]) / closes.iloc[-6] * 100
                    c['price_chg_5d'] = round(float(chg5), 2)
                    if chg5 > 12.0:
                        print(f"  🔥 過熱剔除 {sym} {c.get('name','')}（5日已漲 {chg5:+.1f}%）", flush=True)
                        continue
            except Exception:
                pass  # 抓不到價就保留（不因資料缺失誤殺）
            kept.append(c)
        return kept[:top_n]
    except Exception as e:
        print(f"  ⚠️ 過熱過濾失敗（保留原名單）: {e}", flush=True)
        return candidates[:top_n]


def _build_whale_candidates(all_codes: dict, prev_all: dict, top_n: int = 20) -> list:
    """從全市場資料挑出鯨魚訊號 — 千張大戶週增最強的前 N 檔
    v12.5.7：金融股 (28XX) 排除
    v12.9.2：只收 T86 主板名單（補中文名 + 排除上櫃誤標）+ 過熱過濾
    """
    t86_names = _load_t86_names()
    candidates = []
    for code, lp in all_codes.items():
        # 金融股排除
        if code.startswith('28'):
            continue
        # v12.9.2：不在 T86 主板名單 → 跳過（無名 + yfinance .TW 抓不到價）
        name = t86_names.get(code, '')
        if not name:
            continue
        buckets = _bucketize(lp)
        sym = f"{code}.TW"
        prev_b = prev_all.get(sym) or {}
        if not prev_b:
            continue  # 沒舊資料無法算 delta
        mega_delta = round(buckets['mega_pct'] - prev_b.get('mega_pct', 0), 2)
        big_delta = round(buckets['big_pct'] - prev_b.get('big_pct', 0), 2)
        retail_delta = round(buckets['retail_pct'] - prev_b.get('retail_pct', 0), 2)
        # 鯨魚訊號：千張+大戶 共同進場 + 散戶被甩出
        whale_score = mega_delta * 2 + big_delta * 0.7 - retail_delta * 0.5
        if mega_delta < 0.05 and big_delta < 0.05:
            continue  # 沒明顯動作就略過
        # 訊號分級
        if mega_delta >= 0.3 and retail_delta < 0:
            signal = 'strong_accumulation'
            label = '🐳 強吸'
        elif mega_delta >= 0.1:
            signal = 'accumulation'
            label = '🐟 加碼'
        elif big_delta >= 0.2:
            signal = 'big_holder_in'
            label = '💪 大戶進'
        else:
            continue
        candidates.append({
            'sym': sym,
            'code': code,
            'name': name,
            'signal': signal,
            'label': label,
            'whale_score': round(whale_score, 3),
            'mega_pct': buckets['mega_pct'],
            'big_pct': buckets['big_pct'],
            'retail_pct': buckets['retail_pct'],
            'mega_delta': mega_delta,
            'big_delta': big_delta,
            'retail_delta': retail_delta,
        })
    candidates.sort(key=lambda x: x['whale_score'], reverse=True)
    # v12.9.2：過熱過濾（5 日已漲 >12% 剔除）
    return _filter_overheated(candidates, top_n)


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] tdcc_holders_fetcher start", flush=True)
    target = _gather_target_symbols()
    print(f"  📋 追蹤股 {len(target)} 檔 + 全市場掃描", flush=True)

    rows = _fetch_tdcc_csv()
    if not rows:
        print("  ❌ 沒拿到 TDCC 資料，保留舊檔不覆寫", flush=True)
        return

    # v12.4.8：先 parse 全市場，再分流給「追蹤股」+「鯨魚候選」
    full = _parse_all_stocks(rows)
    if not full.get('by_code'):
        print("  ❌ 解析後沒資料，保留舊檔", flush=True)
        return

    # 讀舊「全市場」做週對週變化
    # v12.9.2 修：改用獨立的 prev_week 檔 — 之前直接比 full 檔，
    # 同週第二次執行時 full 已被覆蓋成本週 → delta 全部算不出來（破壞性比較）
    PREV_WEEK_PATH = 'data/holders_distribution_prev_week.json'
    prev_all = {}
    try:
        cur_as_of = ''
        old = {}
        if os.path.exists('data/holders_distribution_full.json'):
            with open('data/holders_distribution_full.json', 'r', encoding='utf-8') as f:
                old = json.load(f) or {}
            cur_as_of = old.get('as_of_date', '')
        if cur_as_of and cur_as_of != full.get('as_of_date'):
            # 換週：現在的 full 變成上週基準 → 存到 prev_week 檔
            prev_all = (old.get('stocks') or {})
            with open(PREV_WEEK_PATH, 'w', encoding='utf-8') as f:
                json.dump(old, f, ensure_ascii=False)
            print(f"  📦 週轉換 {cur_as_of} → {full.get('as_of_date')}，上週基準已存 prev_week", flush=True)
        elif os.path.exists(PREV_WEEK_PATH):
            # 同週重跑：從 prev_week 檔取上週基準（delta 可重算）
            with open(PREV_WEEK_PATH, 'r', encoding='utf-8') as f:
                pw = json.load(f) or {}
            if pw.get('as_of_date') and pw.get('as_of_date') != full.get('as_of_date'):
                prev_all = (pw.get('stocks') or {})
                print(f"  📦 同週重跑，用 prev_week 基準 ({pw.get('as_of_date')})", flush=True)
    except Exception as e:
        print(f"  ⚠️ prev week 處理: {e}", flush=True)

    # 全市場 buckets（給 whale candidates 用，也存檔給下次比較）
    all_stocks = {}
    for code, lp in full['by_code'].items():
        sym = f"{code}.TW"
        buckets = _bucketize(lp)
        change = {}
        if sym in prev_all:
            for k in ('retail_pct', 'mid_pct', 'big_pct', 'mega_pct'):
                if k in prev_all[sym]:
                    change[k.replace('_pct', '')] = round(buckets[k] - prev_all[sym][k], 2)
        all_stocks[sym] = {**buckets, 'weekly_change': change}

    # 1. 追蹤股 → data/holders_distribution.json（給自選股 modal 用）
    out_target = {sym: data for sym, data in all_stocks.items()
                  if sym.split('.')[0] in target}

    target_payload = {
        'as_of_date': full.get('as_of_date', ''),
        'fetched_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'source': 'TDCC opendata id=1792898967',
        'stocks': out_target,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(target_payload, f, ensure_ascii=False, indent=2)
    print(f"  ✅ 追蹤股 {len(out_target)} 檔 → {OUT_PATH}", flush=True)

    # 2. 全市場 → data/holders_distribution_full.json（給下次比較）
    full_payload = {
        'as_of_date': full.get('as_of_date', ''),
        'fetched_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'stocks': all_stocks,
    }
    with open('data/holders_distribution_full.json', 'w', encoding='utf-8') as f:
        json.dump(full_payload, f, ensure_ascii=False)
    print(f"  ✅ 全市場 {len(all_stocks)} 檔 → data/holders_distribution_full.json", flush=True)

    # 3. 鯨魚候選名單 → data/whale_candidates.json
    # v12.7.5：TDCC 候選為空（如首週無上週資料可比）→ 不覆寫，保留 pseudo T86 名單
    whales = _build_whale_candidates(full['by_code'], prev_all, top_n=20)
    if not whales:
        print("  ℹ️ TDCC 鯨魚候選為空（首週無比較基準），保留既有 whale_candidates.json (pseudo T86)", flush=True)
        return
    whale_payload = {
        'as_of_date': full.get('as_of_date', ''),
        'fetched_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'source': 'tdcc',
        'note': '千張大戶加碼 + 散戶被甩出 = 鯨魚吸籌訊號',
        'top': whales,
    }
    with open('data/whale_candidates.json', 'w', encoding='utf-8') as f:
        json.dump(whale_payload, f, ensure_ascii=False, indent=2)
    print(f"  🐳 鯨魚候選 {len(whales)} 檔 → data/whale_candidates.json", flush=True)
    for w in whales[:5]:
        print(f"    {w['label']} {w['sym']} 千張{w['mega_pct']:.2f}% ({w['mega_delta']:+.2f}pp) score={w['whale_score']}", flush=True)


if __name__ == '__main__':
    main()
