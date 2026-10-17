"""
影子紀錄前瞻評估 — v13.3.0

問題：虛擬交易每天只進 1~3 檔，靠實際成交累積 ML 樣本太慢（每月 5~8 筆）。
      但每天有一批候選「已通過 AI 訊號與第二次確認、只因進場條件被擋」，
      它們後來的漲跌正是校準門檻所需的反事實標籤。

做法：引擎把被擋候選寫進 data/entry_shadow_log.json（只存進場關卡特徵）。
      本腳本把第 N+5 個交易日的價格 join 回去算報酬。

      價格優先用 verdict_history.json 的每日快照；對不到的改用 yfinance 補。
      v13.4.0：原本只用 verdict_history，但它只快照「使用者自選股」，而 AI
      機器人的候選池是 AI 選股每天輪動的 —— 被擋的標的隔天常已離開清單，
      上線一個月 65 筆只評估到 3 筆。

輸出：entry_shadow_log.json 就地補上 ret5，並寫入 summary（依 blocked_by 分組）。
"""
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

TW = pytz.timezone('Asia/Taipei')
NOW = datetime.now(TW)
SHADOW_PATH = 'data/entry_shadow_log.json'
EXIT_SHADOW_PATH = 'data/exit_shadow_log.json'   # v13.5.0
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


# 帶數值的阻擋原因（如 ma5_extended_7.1_over_3）要先正規化，否則每筆自成一組
_KNOWN_PREFIXES = (
    'defense_mode', 'sector_full', 'news_negative_gate', 'market_open_safety',
    'taiex_crash', 'left_whale_selling', 'left_not_near_ma60', 'left_rsi',
    'individual_daily_limit', 'etf_daily_limit', 'etf_skipped',
)


def normalize_reason(reason):
    """'ma5_extended_7.1_over_3' → 'ma5_extended'；'conf_80_below_85' → 'conf_below'"""
    r = (reason or 'unknown').strip()
    for pre in _KNOWN_PREFIXES:
        if r.startswith(pre):
            return pre
    # 只丟「純數值」片段（7.1、1/1、2026-09-10），保留 ma5 這種含數字的名稱
    toks = [t for t in r.split('_')
            if t and not re.fullmatch(r'[-+]?[\d.,/:-]+(?:pct|%)?', t)
            and t not in ('over', 'until', 'need', 'at')]
    return '_'.join(toks) or 'unknown'


def _yf_fetch_closes(symbols, start):
    """{sym: [(date_str, close), ...]}，依日期排序。失敗回 {}（不能讓排程掛掉）。"""
    try:
        import yfinance as yf
    except Exception as e:
        print(f"  ⚠️ yfinance 無法載入: {e}", flush=True)
        return {}
    out = {}
    for sym in symbols:
        try:
            df = yf.Ticker(sym).history(start=start, auto_adjust=False)
            if df is None or df.empty:
                continue
            out[sym] = [(idx.strftime('%Y-%m-%d'), float(c))
                        for idx, c in df['Close'].items() if c == c and c > 0]
        except Exception as e:
            print(f"  ⚠️ yfinance {sym}: {e}", flush=True)
    return out


def evaluate_with_series(shadow_days, series, lag=EVAL_LAG):
    """verdict_history 對不到的，用個股自己的日 K 序列補：
    以「紀錄日當天或之後第一根 K」為基準，往後第 lag 根的收盤價。"""
    filled = 0
    for day in shadow_days or []:
        d0 = day.get('date')
        for sym, rec in (day.get('records') or {}).items():
            if 'ret5' in rec or not rec.get('p'):
                continue
            bars = series.get(sym) or []
            i = next((k for k, (d, _) in enumerate(bars) if d >= d0), None)
            if i is None or i + lag >= len(bars):
                continue
            p1 = bars[i + lag][1]
            rec['ret5'] = round((p1 - rec['p']) / rec['p'] * 100, 2)
            rec['ret5_src'] = 'yfinance'
            filled += 1
    return filled


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


# v13.6.0：「已持有」不是進場關卡（已經買了），放進統計只會混淆判讀
EXCLUDE_FROM_SUMMARY = {'already_held'}


def add_market_excess(shadow_days, mkt_bars, lag=EVAL_LAG):
    """替有 ret5 的紀錄補上同期大盤 5 日報酬（mkt5）與超額報酬（ex5）。回傳補上筆數。

    v13.6.0：多頭期間幾乎每類被擋候選的 5 日報酬都是正的（同期大盤平均 +0.53%），
    只看 ret5 會讓每道關卡都像在擋好股。扣掉大盤後才看得出差別：
    信心度不足 +2.52% → +0.03%（擋得對），追高過濾 +3.66% → +2.60%（可能擋錯）。
    """
    filled = 0
    for day in shadow_days or []:
        d0 = day.get('date')
        i = next((k for k, (d, _) in enumerate(mkt_bars or []) if d >= d0), None)
        if i is None or i + lag >= len(mkt_bars):
            continue
        mkt5 = round((mkt_bars[i + lag][1] - mkt_bars[i][1]) / mkt_bars[i][1] * 100, 2)
        for rec in (day.get('records') or {}).values():
            if 'ret5' in rec and 'ex5' not in rec:
                rec['mkt5'] = mkt5
                rec['ex5'] = round(rec['ret5'] - mkt5, 2)
                filled += 1
    return filled


def summarize(shadow_days, min_samples=MIN_SAMPLES, key='blocked_by'):
    """依原因分組統計。'entered' 是實際進場的對照組。

    判讀以「扣大盤後」為準：avg_excess5 > 0 且 beat_mkt_rate 高 → 這道關卡可能擋掉好股。
    """
    groups = {}
    for day in shadow_days or []:
        for rec in (day.get('records') or {}).values():
            if 'ret5' not in rec:
                continue
            reason = normalize_reason(rec.get(key))
            if key == 'blocked_by' and reason in EXCLUDE_FROM_SUMMARY:
                continue
            groups.setdefault(reason, []).append(rec)
    out = {}
    for reason, recs in groups.items():
        rets = [r['ret5'] for r in recs]
        exs = [r['ex5'] for r in recs if 'ex5' in r]
        n = len(rets)
        row = {
            'n': n,
            'win_rate': round(sum(1 for r in rets if r > 0) / n * 100, 1),
            'avg_ret5': round(sum(rets) / n, 2),
            'reliable': n >= min_samples,
        }
        if exs:
            row['n_excess'] = len(exs)
            row['avg_excess5'] = round(sum(exs) / len(exs), 2)
            row['beat_mkt_rate'] = round(sum(1 for e in exs if e > 0) / len(exs) * 100, 1)
        out[reason] = row
    return dict(sorted(out.items(), key=lambda kv: -kv[1]['n']))


def process_log(path, key, label, price_idx):
    """對一份影子紀錄補 ret5 並寫 summary。回傳新評估筆數（無檔則 0）。"""
    log = _load(path, {'days': []})
    days = log.get('days') or []
    if not days:
        print(f"  ℹ️ [{label}] 尚無紀錄，跳過。", flush=True)
        return 0

    filled = evaluate(days, price_idx)
    # 對不到的（已離開自選股清單）用 yfinance 補
    pending = {sym for d in days for sym, r in (d.get('records') or {}).items() if 'ret5' not in r}
    if pending:
        series = _yf_fetch_closes(sorted(pending), start=days[0]['date'])
        filled += evaluate_with_series(days, series)

    # 扣大盤：加權指數同期 5 日報酬
    mkt = _yf_fetch_closes(['^TWII'], start=days[0]['date']).get('^TWII') or []
    add_market_excess(days, mkt)

    log['summary'] = summarize(days, key=key)
    log['eval_lag_days'] = EVAL_LAG
    log['updated_at'] = NOW.strftime('%Y-%m-%d %H:%M:%S')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(log, f, ensure_ascii=False, indent=1)

    print(f"  ✅ [{label}] 新評估 {filled} 筆", flush=True)
    for reason, st in list(log['summary'].items())[:8]:
        flag = '' if st['reliable'] else '（樣本不足）'
        ex = (f" | 扣大盤 {st['avg_excess5']:+.2f}% 贏大盤 {st['beat_mkt_rate']:.0f}%"
              if 'avg_excess5' in st else '')
        print(f"     {reason:26} n={st['n']:3d} 勝率 {st['win_rate']:5.1f}% "
              f"平均 {st['avg_ret5']:+.2f}%{ex}{flag}", flush=True)
    return filled


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] entry_shadow_recorder start", flush=True)
    price_idx = build_price_index(_load(VERDICT_PATH, {}).get('days'))
    if not price_idx:
        print("  ℹ️ verdict_history 無價格快照，全部改用 yfinance。", flush=True)
    process_log(SHADOW_PATH, 'blocked_by', '進場被擋', price_idx)
    # v13.5.0：出場後 5 日走勢。ret5 > 0 代表賣掉後還在漲（賣早了）；
    #   某類出場的 ret5 平均顯著 > 0，就是該規則在洗掉好部位的證據。
    process_log(EXIT_SHADOW_PATH, 'reason', '出場後走勢', price_idx)


if __name__ == '__main__':
    main()
