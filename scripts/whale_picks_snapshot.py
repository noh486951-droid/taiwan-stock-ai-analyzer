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


def _week_key(dt: datetime) -> str:
    """ISO 週鍵：YYYY-WW，同週一律用同 key 避免每天重複 snapshot"""
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] whale_picks_snapshot start", flush=True)
    whales = _load(WHALES_PATH, {})
    history = _load(HISTORY_PATH, {'weeks': []})
    raw = _load(RAW_DATA_PATH, {})

    top = (whales.get('top') or [])[:4]   # v12.5.8：3 → 4
    is_monday = NOW.weekday() == 0  # 0=Mon
    this_week = _week_key(NOW)

    if not top:
        print("  ℹ️ whale_candidates 沒資料，跳過 snapshot", flush=True)
    else:
        # v12.5.8：只在週一 EOD 鎖定（其他天不重複寫，避免每日名單變動洗掉 weekly 追蹤）
        already_this_week = any(w.get('week_key') == this_week for w in history['weeks'])
        if not is_monday and not already_this_week:
            print(f"  ℹ️ 今天非週一且本週無 snapshot，等週一 EOD 才會鎖定本週鯨魚名單", flush=True)
        elif already_this_week:
            print(f"  ↩️ 本週 ({this_week}) snapshot 已存在，不重複寫", flush=True)
        else:
            # 週一 EOD → 鎖定本週 Top 4 picks
            picks_payload = []
            for w in top:
                sym = w['sym']
                price = _get_price(sym, raw)
                picks_payload.append({
                    'sym': sym,
                    'name': w.get('name', ''),
                    'label': w.get('label', ''),
                    'whale_score': w.get('whale_score'),
                    'entry_price': price,
                    'entry_date': TODAY,
                    'evaluated': False,
                })
            history['weeks'].append({
                'week_key': this_week,
                'snapshot_date': TODAY,
                'tdcc_as_of': whales.get('as_of_date', ''),
                'source': whales.get('source', ''),
                'picks': picks_payload,
                'evaluated': False,
            })
            print(f"  📸 已鎖定本週 ({this_week}) {len(picks_payload)} 隻鯨魚", flush=True)
            for p in picks_payload:
                print(f"    {p['label']} {p['sym']} {p.get('name','')} 進場價={p.get('entry_price')}", flush=True)

    # v12.5.8：每日更新「執行中」週的 running_return_pct（給用戶看本週鯨魚跑得如何）
    # 5 個交易日後正式 evaluated
    finalize_cutoff = (NOW - timedelta(days=5)).strftime('%Y-%m-%d')
    updated_count = 0
    finalized_count = 0
    for week in history['weeks']:
        if week.get('evaluated'):
            continue
        is_due_finalize = week.get('snapshot_date', '') <= finalize_cutoff
        all_picks_have_price = True
        for p in week.get('picks', []):
            if p.get('entry_price') in (None, 0):
                all_picks_have_price = False
                continue
            cur = _get_price(p['sym'], raw)
            if cur is None or cur == 0:
                continue
            ret_pct = round((cur - p['entry_price']) / p['entry_price'] * 100, 2)
            # 每天更新 running，5 天後鎖 exit_price
            p['running_return_pct'] = ret_pct
            p['last_price'] = cur
            p['last_update'] = TODAY
            if is_due_finalize and not p.get('evaluated'):
                p['exit_price'] = cur
                p['return_pct'] = ret_pct
                p['evaluated'] = True
                p['evaluated_date'] = TODAY
                finalized_count += 1
                print(f"  📊 {p['sym']} ({p.get('name','')}): {p['entry_price']} → {cur} = {ret_pct:+.2f}% [evaluated]", flush=True)
            else:
                updated_count += 1
        # 整週都評估完才標記 week evaluated
        if is_due_finalize and all_picks_have_price and all(p.get('evaluated') for p in week.get('picks', [])):
            week['evaluated'] = True
    if updated_count or finalized_count:
        print(f"  ✅ 每日更新 {updated_count} 筆 running、評估完成 {finalized_count} 筆", flush=True)

    # 只保留最近 26 週（半年）
    history['weeks'] = history['weeks'][-26:]
    history['updated_at'] = NOW.strftime('%Y-%m-%d %H:%M:%S')

    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"  ✅ 總 {len(history['weeks'])} 週紀錄 → {HISTORY_PATH}", flush=True)


if __name__ == '__main__':
    main()
