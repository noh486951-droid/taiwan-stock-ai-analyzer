"""momentum_scanner.py — 全市場日/週/月漲幅榜 (v11.14.14)

每天盤後跑一次，輸出 data/momentum_rankings.json：
{
  "fetched_at": "...",
  "as_of_date": "20260520",
  "day":   [{code, name, close, pct}, ...],
  "week":  [...],     # 過去 5 個交易日累積漲幅
  "month": [...],     # 過去 20 個交易日累積漲幅
  "tw":   { "day": [...], "week": [...], "month": [...] },   # 台股版（同上）
  "us":   { "day": [...], "week": [...], "month": [...] },   # 美股版（VOO/QQQ 等）
}

實作：用 yfinance batch download 取 ~30 天 K 線一次抓 ~2000 支，本地算 5d/20d。
"""
from __future__ import annotations
import os
import sys
import json
import time
from datetime import datetime
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import yfinance as yf
import pandas as pd

TW = pytz.timezone('Asia/Taipei')
NOW = datetime.now(TW)
TODAY = NOW.strftime('%Y%m%d')

OUT_PATH = 'data/momentum_rankings.json'

# 美股 momentum 用熱門大盤股（ETF + Magnificent 7 + 半導體龍頭）
US_TICKERS = [
    'SPY', 'QQQ', 'DIA', 'IWM', 'VOO',          # 大盤 ETF
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
    'AMD', 'AVGO', 'TSM', 'ASML', 'INTC', 'QCOM',  # 半導體
    'ORCL', 'CRM', 'NFLX', 'ADBE', 'PYPL',
    'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLI',  # 產業 ETF
    'SOXX', 'SMH',                              # 半導體 ETF
]


def _load_tw_symbols() -> list[str]:
    """從 raw_data.json 或 watchlist_analysis.json 撈出全市場台股 symbols"""
    candidates = ['data/raw_data.json', 'data/daily_base_data.json']
    syms = set()
    for path in candidates:
        if not os.path.exists(path):
            continue
        try:
            with open(path, 'r', encoding='utf-8') as f:
                d = json.load(f) or {}
            # 找 chips / market_breadth / active_stocks 之類
            for key in ('active_stocks', 'stocks'):
                items = d.get(key)
                if isinstance(items, list):
                    for s in items:
                        code = s.get('code') if isinstance(s, dict) else None
                        if code:
                            # 補上 .TW（先試）
                            syms.add(f"{code}.TW")
                elif isinstance(items, dict):
                    for sym in items.keys():
                        syms.add(sym if ('.' in sym) else f"{sym}.TW")
        except Exception as e:
            print(f"  ⚠️ load {path}: {e}", flush=True)

    # 從 watchlist_analysis 加上 .TWO 上櫃版本
    try:
        if os.path.exists('data/watchlist_analysis.json'):
            with open('data/watchlist_analysis.json', 'r', encoding='utf-8') as f:
                wa = json.load(f) or {}
            for sym in (wa.get('stocks') or {}).keys():
                syms.add(sym)
    except Exception:
        pass

    return sorted(syms)


def _yf_batch_download(tickers: list[str], period_days: int = 35) -> dict:
    """批次抓 yfinance 收盤價，回傳 {ticker: [close_list]}"""
    if not tickers:
        return {}
    period = f"{period_days}d"
    out = {}
    BATCH = 150
    total_batches = (len(tickers) + BATCH - 1) // BATCH
    for i in range(0, len(tickers), BATCH):
        chunk = tickers[i:i + BATCH]
        batch_no = i // BATCH + 1
        print(f"  📥 batch {batch_no}/{total_batches}: {len(chunk)} symbols...", flush=True)
        try:
            df = yf.download(
                tickers=' '.join(chunk),
                period=period,
                interval='1d',
                group_by='ticker',
                progress=False,
                threads=True,
                auto_adjust=False,
            )
        except Exception as e:
            print(f"  ⚠️ batch {batch_no} failed: {e}", flush=True)
            continue

        for sym in chunk:
            try:
                if isinstance(df.columns, pd.MultiIndex) and sym in df.columns.get_level_values(0):
                    sub = df[sym]
                else:
                    sub = df
                closes = sub['Close'].dropna() if 'Close' in sub else None
                if closes is None or len(closes) < 2:
                    continue
                out[sym] = closes.tolist()
            except Exception:
                continue
        # yfinance rate-limit safety
        time.sleep(0.2)
    return out


def _compute_returns(closes: list[float]) -> dict:
    """計算 1d / 5d / 20d 收益率"""
    if not closes or len(closes) < 2:
        return {}
    out = {}
    last = closes[-1]
    if len(closes) >= 2:
        prev = closes[-2]
        if prev > 0:
            out['day'] = round((last - prev) / prev * 100, 2)
    if len(closes) >= 6:
        prev = closes[-6]
        if prev > 0:
            out['week'] = round((last - prev) / prev * 100, 2)
    if len(closes) >= 21:
        prev = closes[-21]
        if prev > 0:
            out['month'] = round((last - prev) / prev * 100, 2)
    out['close'] = round(last, 2)
    return out


def _load_name(sym: str, code: str) -> str:
    """從 stock_names.js / monthly_revenue / raw 找中文名"""
    # 最快：raw_data.json 應該有
    try:
        with open('data/raw_data.json', 'r', encoding='utf-8') as f:
            raw = json.load(f) or {}
        for s in (raw.get('active_stocks') or []):
            if s.get('code') == code:
                return s.get('name') or code
    except Exception:
        pass
    return code


def _rank_top(results: dict, period: str, top_n: int = 30) -> list[dict]:
    """results = {sym: {day, week, month, close}}, 取 period 排序"""
    rows = []
    for sym, r in results.items():
        v = r.get(period)
        if v is None:
            continue
        code = sym.replace('.TW', '').replace('.TWO', '')
        rows.append({
            'symbol': sym,
            'code': code,
            'name': _load_name(sym, code),
            'pct': v,
            'close': r.get('close'),
        })
    rows.sort(key=lambda x: -x['pct'])
    return rows[:top_n]


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] momentum_scanner start", flush=True)

    # === 台股 ===
    tw_syms = _load_tw_symbols()
    print(f"  📋 TW symbols: {len(tw_syms)}", flush=True)
    tw_closes = _yf_batch_download(tw_syms, period_days=35)
    print(f"  ✓ TW: got history for {len(tw_closes)}/{len(tw_syms)}", flush=True)
    tw_results = {sym: _compute_returns(closes) for sym, closes in tw_closes.items()}

    tw_out = {
        'day':   _rank_top(tw_results, 'day',   30),
        'week':  _rank_top(tw_results, 'week',  30),
        'month': _rank_top(tw_results, 'month', 30),
    }

    # === 美股 ===
    print(f"  📋 US symbols: {len(US_TICKERS)}", flush=True)
    us_closes = _yf_batch_download(US_TICKERS, period_days=35)
    print(f"  ✓ US: got history for {len(us_closes)}/{len(US_TICKERS)}", flush=True)
    us_results = {sym: _compute_returns(closes) for sym, closes in us_closes.items()}
    # 美股 name = ticker（沒中文）
    for sym in us_results:
        pass
    us_out = {}
    for period in ('day', 'week', 'month'):
        rows = []
        for sym, r in us_results.items():
            v = r.get(period)
            if v is None:
                continue
            rows.append({
                'symbol': sym,
                'code': sym,
                'name': sym,
                'pct': v,
                'close': r.get('close'),
            })
        rows.sort(key=lambda x: -x['pct'])
        us_out[period] = rows[:30]

    # 寫檔
    output = {
        'fetched_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'as_of_date': TODAY,
        # 預設 view = 台股
        'day':   tw_out['day'],
        'week':  tw_out['week'],
        'month': tw_out['month'],
        'tw':    tw_out,
        'us':    us_out,
    }
    os.makedirs('data', exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"  ✅ wrote {OUT_PATH} (TW day={len(tw_out['day'])}/week={len(tw_out['week'])}/month={len(tw_out['month'])})", flush=True)


if __name__ == '__main__':
    main()
