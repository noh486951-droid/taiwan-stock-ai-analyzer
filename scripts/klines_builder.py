"""klines_builder.py — 為「持倉中」及「歷史交易過」的股票抓 60 日 K 線

每天盤後跑一次，輸出 data/klines/{sym}.json：
{
  "symbol": "2330.TW",
  "fetched_at": "...",
  "ohlc": [
    {"date": "2026-05-01", "o": 1050, "h": 1080, "l": 1045, "c": 1075, "v": 45000000},
    ...
  ]
}

掃描來源：
- ai_bot_portfolio.json: positions + history
- 透過 worker /api/paper-trade/all-users 拿真實用戶: positions + history
"""
from __future__ import annotations
import os
import sys
import json
import time as _time
from datetime import datetime
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import yfinance as yf
import pandas as pd
import requests

TW = pytz.timezone('Asia/Taipei')
NOW = datetime.now(TW)
OUT_DIR = 'data/klines'
WORKER_URL = "https://tw-stock-ai-proxy.noh486951-e8a.workers.dev"


def _gather_target_symbols() -> set[str]:
    """收集所有需要抓 K 線的 symbol"""
    syms = set()

    # 1. AI bot portfolio
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

    # 2. 真實用戶（透過 worker）
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

    return syms


def _fetch_klines(symbols: list[str]) -> dict:
    """批次抓 yfinance 60 日 K 線"""
    if not symbols:
        return {}
    print(f"  📈 yfinance batch 抓 {len(symbols)} 檔 60 日 K …", flush=True)
    try:
        df = yf.download(
            tickers=' '.join(symbols),
            period='90d',
            interval='1d',
            group_by='ticker',
            progress=False,
            threads=True,
            auto_adjust=False,
        )
    except Exception as e:
        print(f"  ❌ yfinance batch failed: {e}", flush=True)
        return {}

    result = {}
    for sym in symbols:
        try:
            if isinstance(df.columns, pd.MultiIndex) and sym in df.columns.get_level_values(0):
                sub = df[sym]
            else:
                sub = df
            if 'Close' not in sub:
                continue
            sub = sub.dropna(subset=['Close']).tail(60)
            ohlc = []
            for idx, row in sub.iterrows():
                try:
                    ohlc.append({
                        'date': idx.strftime('%Y-%m-%d'),
                        'o': round(float(row['Open']), 2) if pd.notna(row['Open']) else None,
                        'h': round(float(row['High']), 2) if pd.notna(row['High']) else None,
                        'l': round(float(row['Low']), 2) if pd.notna(row['Low']) else None,
                        'c': round(float(row['Close']), 2),
                        'v': int(row['Volume']) if pd.notna(row['Volume']) else 0,
                    })
                except Exception:
                    continue
            if ohlc:
                result[sym] = ohlc
        except Exception:
            continue
    return result


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] klines_builder start", flush=True)
    syms = _gather_target_symbols()
    if not syms:
        print("  ℹ️ 無需要抓的 symbol", flush=True)
        return
    sym_list = sorted(syms)
    print(f"  📋 需要抓 {len(sym_list)} 檔: {sym_list[:10]}{'...' if len(sym_list) > 10 else ''}", flush=True)

    klines = _fetch_klines(sym_list)
    if not klines:
        print("  ❌ 沒抓到任何 K 線", flush=True)
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    written = 0
    for sym, ohlc in klines.items():
        try:
            payload = {
                'symbol': sym,
                'fetched_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
                'ohlc': ohlc,
            }
            safe = sym.replace('/', '_')
            with open(os.path.join(OUT_DIR, f'{safe}.json'), 'w', encoding='utf-8') as f:
                json.dump(payload, f, ensure_ascii=False)
            written += 1
        except Exception as e:
            print(f"  ⚠️ write {sym}: {e}", flush=True)
    print(f"  ✅ 已寫入 {written} 個 K 線檔到 {OUT_DIR}/", flush=True)


if __name__ == '__main__':
    main()
