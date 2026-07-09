"""verdict_recorder.py — AI verdict 每日快照 + 5 日後對答案（v12.8.0 AI 成績單後端）

每天 EOD：
  1. 把 watchlist_analysis.json 各股的 (verdict, confidence, price) 存一筆快照
  2. 對 5 個交易日前的快照「對答案」：
     - Bullish 命中 = 5 日後價格上漲（>0%）
     - Bearish 命中 = 5 日後價格下跌（<0%）
     - Neutral 不評分
  3. 產出 per-stock 準確率 summary（AI 對哪些股準、哪些股常錯）

答案價格直接用「本檔案內 5 個交易日後那天的快照價」— 不需外部 API。

輸出：data/verdict_history.json
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

TW = pytz.timezone('Asia/Taipei')
NOW = datetime.now(TW)
TODAY = NOW.strftime('%Y-%m-%d')
OUT_PATH = 'data/verdict_history.json'
KEEP_DAYS = 120
EVAL_LAG = 5   # 幾個「快照日」後對答案（快照只在交易日產生 ≈ 交易日）


def _load(path, default):
    try:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"  ⚠️ load {path}: {e}", flush=True)
    return default


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] verdict_recorder start", flush=True)
    wa = _load('data/watchlist_analysis.json', {})
    stocks = wa.get('stocks') or {}
    hist = _load(OUT_PATH, {'days': []})
    days = hist.get('days') or []

    # 1. 今日快照（同日重跑 → 覆蓋）
    records = {}
    for sym, sd in stocks.items():
        ai = sd.get('ai_analysis') or sd.get('ai') or {}
        verdict = ai.get('verdict') or sd.get('verdict')
        conf = ai.get('confidence') or sd.get('confidence')
        price = sd.get('price')
        if not verdict or not isinstance(price, (int, float)) or price <= 0:
            continue
        records[sym] = {'v': verdict, 'c': conf, 'p': price}
    if records:
        days = [d for d in days if d.get('date') != TODAY]
        days.append({'date': TODAY, 'records': records})
        days.sort(key=lambda d: d['date'])
        print(f"  📸 今日快照 {len(records)} 檔", flush=True)
    else:
        print("  ℹ️ watchlist_analysis 無可快照資料", flush=True)

    days = days[-KEEP_DAYS:]

    # 2. 對答案：第 i 天的快照用第 i+EVAL_LAG 天的價格
    evaluated = 0
    for i, day in enumerate(days):
        if i + EVAL_LAG >= len(days):
            break
        future = days[i + EVAL_LAG].get('records') or {}
        for sym, rec in (day.get('records') or {}).items():
            if 'ret5' in rec:
                continue
            fut = future.get(sym)
            if not fut or not fut.get('p') or not rec.get('p'):
                continue
            ret5 = round((fut['p'] - rec['p']) / rec['p'] * 100, 2)
            rec['ret5'] = ret5
            v = rec.get('v')
            if v == 'Bullish':
                rec['hit'] = ret5 > 0
            elif v == 'Bearish':
                rec['hit'] = ret5 < 0
            evaluated += 1

    # 3. per-stock summary（只算已評分的 Bullish/Bearish）
    summary = {}
    for day in days:
        for sym, rec in (day.get('records') or {}).items():
            if 'hit' not in rec:
                continue
            s = summary.setdefault(sym, {'n': 0, 'hits': 0, 'bullish_n': 0, 'bullish_hits': 0,
                                          'sum_ret5_after_bullish': 0.0})
            s['n'] += 1
            if rec['hit']:
                s['hits'] += 1
            if rec.get('v') == 'Bullish':
                s['bullish_n'] += 1
                if rec['hit']:
                    s['bullish_hits'] += 1
                s['sum_ret5_after_bullish'] += rec.get('ret5') or 0

    summary_out = {}
    for sym, s in summary.items():
        summary_out[sym] = {
            'n': s['n'],
            'accuracy': round(s['hits'] / s['n'] * 100, 1),
            'bullish_n': s['bullish_n'],
            'bullish_accuracy': round(s['bullish_hits'] / s['bullish_n'] * 100, 1) if s['bullish_n'] else None,
            'avg_ret5_after_bullish': round(s['sum_ret5_after_bullish'] / s['bullish_n'], 2) if s['bullish_n'] else None,
        }

    total_n = sum(s['n'] for s in summary.values())
    total_hits = sum(s['hits'] for s in summary.values())
    hist_out = {
        'updated_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'eval_lag_days': EVAL_LAG,
        'overall': {
            'n': total_n,
            'accuracy': round(total_hits / total_n * 100, 1) if total_n else None,
        },
        'summary': summary_out,
        'days': days,
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(hist_out, f, ensure_ascii=False)
    print(f"  ✅ 累積 {len(days)} 天快照、本次評分 {evaluated} 筆、"
          f"整體命中率 {hist_out['overall']['accuracy']}% (n={total_n}) → {OUT_PATH}", flush=True)


if __name__ == '__main__':
    main()
