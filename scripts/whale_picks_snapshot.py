"""whale_picks_snapshot.py — 鯨魚名單回測追蹤（每週五 EOD 跑）

流程：
  1. 讀 data/whale_candidates.json 取本週 Top 3
  2. 抓這 3 檔目前收盤價（從 raw_data.json 或 yfinance）
  3. 寫入 data/whale_picks_history.json 的 weeks[] 陣列
  4. 同時評估 1 週前的 picks：算當時收盤 → 今天收盤的報酬率

輸出格式 data/whale_picks_history.json：
{
  "weeks": [
    {
      "snapshot_date": "2026-06-19",
      "tdcc_as_of": "2026-06-13",
      "picks": [
        { "sym": "2330.TW", "entry_price": 1050,
          "exit_price": 1080, "return_pct": 2.86, "evaluated": true,
          "evaluated_date": "2026-06-26" },
        ...
      ],
      "evaluated": true
    },
    ...
  ]
}

執行時機：main.yml 18:07 EOD 跑（每週五就會有評估動作）
"""
from __future__ import annotations
import os
import sys
import json
from datetime import datetime, timedelta
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

TW = pytz.timezone('Asia/Taipei')
NOW = datetime.now(TW)
TODAY = NOW.strftime('%Y-%m-%d')

WHALES_PATH = 'data/whale_candidates.json'
HISTORY_PATH = 'data/whale_picks_history.json'
RAW_DATA_PATH = 'data/raw_data.json'


def _load(path, default):
    try:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"  ⚠️ load {path} fail: {e}", flush=True)
    return default


def _get_price(sym: str, raw: dict) -> float | None:
    """從 raw_data.json 取最新收盤價"""
    stocks = (raw.get('stocks') or {})
    s = stocks.get(sym)
    if isinstance(s, dict):
        for k in ('price', 'close', 'last_close'):
            v = s.get(k)
            if isinstance(v, (int, float)) and v > 0:
                return float(v)
    return None


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] whale_picks_snapshot start", flush=True)
    whales = _load(WHALES_PATH, {})
    history = _load(HISTORY_PATH, {'weeks': []})
    raw = _load(RAW_DATA_PATH, {})

    top = (whales.get('top') or [])[:3]
    if not top:
        print("  ℹ️ whale_candidates 沒資料，跳過 snapshot", flush=True)
    else:
        # 避免同週重複寫入：用 tdcc_as_of 當 key
        as_of = whales.get('as_of_date', TODAY)
        already = any(w.get('tdcc_as_of') == as_of for w in history['weeks'])
        if already:
            print(f"  ↩️ {as_of} 的 snapshot 已存在，不重複寫", flush=True)
        else:
            picks_payload = []
            for w in top:
                sym = w['sym']
                price = _get_price(sym, raw)
                picks_payload.append({
                    'sym': sym,
                    'label': w.get('label', ''),
                    'whale_score': w.get('whale_score'),
                    'mega_delta': w.get('mega_delta'),
                    'entry_price': price,
                    'entry_date': TODAY,
                    'evaluated': False,
                })
            history['weeks'].append({
                'snapshot_date': TODAY,
                'tdcc_as_of': as_of,
                'picks': picks_payload,
                'evaluated': False,
            })
            print(f"  📸 已 snapshot {len(picks_payload)} 隻鯨魚 ({as_of})", flush=True)
            for p in picks_payload:
                print(f"    {p['label']} {p['sym']} 進場價={p.get('entry_price')}", flush=True)

    # 評估上週/上上週的 picks（snapshot_date >= 5 個交易日前且尚未 evaluated）
    cutoff = (NOW - timedelta(days=5)).strftime('%Y-%m-%d')
    evaluated_count = 0
    for week in history['weeks']:
        if week.get('evaluated'):
            continue
        if week.get('snapshot_date', '') > cutoff:
            continue  # 還沒到 5 天，下次再評估
        any_evaluated = False
        for p in week.get('picks', []):
            if p.get('evaluated') or p.get('entry_price') in (None, 0):
                continue
            cur = _get_price(p['sym'], raw)
            if cur is None or cur == 0:
                continue
            ret_pct = round((cur - p['entry_price']) / p['entry_price'] * 100, 2)
            p['exit_price'] = cur
            p['return_pct'] = ret_pct
            p['evaluated'] = True
            p['evaluated_date'] = TODAY
            any_evaluated = True
            evaluated_count += 1
            print(f"  📊 {p['sym']}: {p['entry_price']} → {cur} = {ret_pct:+.2f}%", flush=True)
        if any_evaluated and all(p.get('evaluated') for p in week.get('picks', [])):
            week['evaluated'] = True

    # 只保留最近 26 週（半年）
    history['weeks'] = history['weeks'][-26:]
    history['updated_at'] = NOW.strftime('%Y-%m-%d %H:%M:%S')

    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"  ✅ 評估了 {evaluated_count} 筆，總 {len(history['weeks'])} 週紀錄 → {HISTORY_PATH}", flush=True)


if __name__ == '__main__':
    main()
