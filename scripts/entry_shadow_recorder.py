"""
影子紀錄前瞻評估 — v13.3.0

問題：虛擬交易每天只進 1~3 檔，靠實際成交累積 ML 樣本太慢（每月 5~8 筆）。
      但每天有一批候選「已通過 AI 訊號與第二次確認、只因進場條件被擋」，
      它們後來的漲跌正是校準門檻所需的反事實標籤。

做法：引擎把被擋候選寫進 data/entry_shadow_log.json（只存進場關卡特徵）。
      本腳本把第 N+5 個交易日的價格 join 回去算報酬。

      價格不自己抓 —— 直接用 verdict_history.json，它本來就每天對全部
      自選股做價格快照，避免重複打 API，也保證兩份資料的價格基準一致。

輸出：entry_shadow_log.json 就地補上 ret5，並寫入 summary（依 blocked_by 分組）。
"""
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
SHADOW_PATH = 'data/entry_shadow_log.json'
VERDICT_PATH = 'data/verdict_history.json'
EVAL_LAG = 5      # 與 verdict_recorder 一致：5 個交易日後對答案
MIN_SAMPLES = 10  # 低於此樣本數不列入 summary，避免被雜訊誤導


def _load(path, default):
    try:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f) or default
    except Exception as e:
        print(f"  ⚠️ load {path}: {e}", flush=True)
    return default


def build_price_index(verdict_days):
    """{date: {sym: price}} — 來自 verdict_history 的每日全量快照。"""
    idx = {}
    for d in verdict_days or []:
        date = d.get('date')
        if not date:
            continue
        idx[date] = {sym: rec.get('p') for sym, rec in (d.get('records') or {}).items()
                     if isinstance(rec.get('p'), (int, float)) and rec.get('p') > 0}
    return idx


def evaluate(shadow_days, price_idx, lag=EVAL_LAG):
    """用第 i+lag 個「有快照的交易日」價格補上 ret5。回傳新評估筆數。"""
    dates = sorted(price_idx.keys())
    pos = {d: i for i, d in enumerate(dates)}
    filled = 0
    for day in shadow_days or []:
        d0 = day.get('date')
        i = pos.get(d0)
        if i is None or i + lag >= len(dates):
            continue
        future = price_idx[dates[i + lag]]
        for sym, rec in (day.get('records') or {}).items():
            if 'ret5' in rec:
                continue
            p0, p1 = rec.get('p'), future.get(sym)
            if not p0 or not p1:
                continue
            rec['ret5'] = round((p1 - p0) / p0 * 100, 2)
            filled += 1
    return filled


def summarize(shadow_days, min_samples=MIN_SAMPLES):
    """依 blocked_by 分組統計勝率與平均報酬。'entered' 是實際進場的對照組。"""
    groups = {}
    for day in shadow_days or []:
        for rec in (day.get('records') or {}).values():
            if 'ret5' not in rec:
                continue
            groups.setdefault(rec.get('blocked_by', 'unknown'), []).append(rec['ret5'])
    out = {}
    for reason, rets in groups.items():
        n = len(rets)
        out[reason] = {
            'n': n,
            'win_rate': round(sum(1 for r in rets if r > 0) / n * 100, 1),
            'avg_ret5': round(sum(rets) / n, 2),
            'reliable': n >= min_samples,
        }
    return dict(sorted(out.items(), key=lambda kv: -kv[1]['n']))


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] entry_shadow_recorder start", flush=True)
    log = _load(SHADOW_PATH, {'days': []})
    days = log.get('days') or []
    if not days:
        print("  ℹ️ 尚無影子紀錄，跳過。", flush=True)
        return

    price_idx = build_price_index(_load(VERDICT_PATH, {}).get('days'))
    if not price_idx:
        print("  ⚠️ verdict_history 無價格快照，無法評估。", flush=True)
        return

    filled = evaluate(days, price_idx)
    log['summary'] = summarize(days)
    log['eval_lag_days'] = EVAL_LAG
    log['updated_at'] = NOW.strftime('%Y-%m-%d %H:%M:%S')

    with open(SHADOW_PATH, 'w', encoding='utf-8') as f:
        json.dump(log, f, ensure_ascii=False, indent=1)

    print(f"  ✅ 新評估 {filled} 筆", flush=True)
    for reason, st in list(log['summary'].items())[:8]:
        flag = '' if st['reliable'] else '（樣本不足）'
        print(f"     {reason:34} n={st['n']:3d} 勝率 {st['win_rate']:5.1f}% "
              f"平均 {st['avg_ret5']:+.2f}%{flag}", flush=True)


if __name__ == '__main__':
    main()
