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


_YF_PRICE_CACHE: dict[str, float] = {}


def _get_price(sym: str, raw: dict) -> float | None:
    """先從 raw_data.json 取，找不到 fallback 到 yfinance（鯨魚多為非自選股）"""
    stocks = (raw.get('stocks') or {})
    s = stocks.get(sym)
    if isinstance(s, dict):
        for k in ('price', 'close', 'last_close'):
            v = s.get(k)
            if isinstance(v, (int, float)) and v > 0:
                return float(v)

    # v12.6.5: yfinance fallback（多為市場全部股，raw_data 沒有）
    if sym in _YF_PRICE_CACHE:
        return _YF_PRICE_CACHE[sym]
    try:
        import yfinance as yf
        t = yf.Ticker(sym)
        hist = t.history(period='5d')
        if len(hist) > 0:
            price = float(hist['Close'].iloc[-1])
            if price > 0:
                _YF_PRICE_CACHE[sym] = price
                return price
    except Exception as e:
        print(f"  ⚠️ yfinance {sym}: {e}", flush=True)
    _YF_PRICE_CACHE[sym] = None
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

    # v13.0.0：追蹤數 4 → 10（加速學習資料累積，AI bot 進場仍只用前 4）
    #   4/週 → Phase3(120筆) 要 9 個月；10/週 → 約 3 個月
    top = (whales.get('top') or [])[:10]
    is_weekday = NOW.weekday() < 5  # 0-4 = Mon-Fri
    this_week = _week_key(NOW)

    if not top:
        print("  ℹ️ whale_candidates 沒資料，跳過 snapshot", flush=True)
    else:
        # v12.6.4：「本週尚未鎖定 + 今天平日」就鎖定（不限週一）
        #   原本太嚴只准週一 → 若週一抓不到 T86 或 GH Action 異常，整週就漏鎖
        #   現改成：週一優先，週二~週五補抓，週末跳過
        already_this_week = any(w.get('week_key') == this_week for w in history['weeks'])
        if not is_weekday:
            print(f"  ℹ️ 今天週末，跳過 snapshot", flush=True)
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
                    # v13.0.0 特徵記錄（未來學習燃料）— 從 candidates 帶過來
                    'features': {
                        'mega_delta': w.get('mega_delta'),
                        'big_delta': w.get('big_delta'),
                        'retail_delta': w.get('retail_delta'),
                        'mega_pct': w.get('mega_pct'),
                        'price_chg_5d': w.get('price_chg_5d'),
                        'dist_from_low5': w.get('dist_from_low5'),
                        'ma5_slope': w.get('ma5_slope'),
                        'rsi14': w.get('rsi14'),
                        'source': whales.get('source', ''),
                    },
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
    # v12.6.5：若舊 snapshot 的 entry_price 為空 (raw_data 沒有的個股)，本日用 yfinance 回補
    finalize_cutoff = (NOW - timedelta(days=5)).strftime('%Y-%m-%d')
    updated_count = 0
    finalized_count = 0
    backfilled_count = 0
    for week in history['weeks']:
        if week.get('evaluated'):
            continue
        is_due_finalize = week.get('snapshot_date', '') <= finalize_cutoff
        all_picks_have_price = True
        for p in week.get('picks', []):
            if p.get('entry_price') in (None, 0):
                # v12.6.5: 回補 entry_price（用今天的價當進場價，退而求其次）
                back_price = _get_price(p['sym'], raw)
                if back_price and back_price > 0:
                    p['entry_price'] = back_price
                    p['entry_date'] = p.get('entry_date') or TODAY
                    p['backfilled'] = True
                    backfilled_count += 1
                    print(f"  🔧 回補 {p['sym']} entry_price={back_price}", flush=True)
                else:
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

    # v13.0.0：保留 52 週（1 年）— 學習需要累積樣本，不要太早丟
    history['weeks'] = history['weeks'][-52:]
    history['updated_at'] = NOW.strftime('%Y-%m-%d %H:%M:%S')

    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"  ✅ 總 {len(history['weeks'])} 週紀錄 → {HISTORY_PATH}", flush=True)

    # v13.0.0：Phase 2/3 里程碑自動觸發（資料驅動，不靠外部排程）
    _check_milestones_and_learn(history)


# ============================================================
# v13.0.0：學習里程碑 — 樣本數到門檻自動執行 Phase 2 / 提醒 Phase 3
# ============================================================
PHASE2_THRESHOLD = 50    # 統計加權：50 筆啟動
PHASE3_THRESHOLD = 120   # ML 模型：120 筆提醒（6 特徵 × ~20 筆）


def _push_discord(title, msg):
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import notify_discord as _nd
        if _nd and getattr(_nd, 'NOTIFY_UID', None):
            _nd.push_health_or_summary(title, msg) if hasattr(_nd, 'push_health_or_summary') else None
        # 直接打 webhook（最穩）
        url = os.environ.get('DISCORD_WEBHOOK_SUMMARY') or os.environ.get('DISCORD_WEBHOOK_URL')
        if url:
            import requests
            requests.post(url, json={'embeds': [{'title': title, 'description': msg[:3500], 'color': 0x8B5CF6}]}, timeout=10)
    except Exception as e:
        print(f"  ⚠️ discord push: {e}", flush=True)


def _collect_evaluated(history):
    """收集所有已評估的 picks（含特徵）"""
    out = []
    for w in history.get('weeks', []):
        for p in w.get('picks', []):
            if p.get('return_pct') is not None and p.get('features'):
                out.append({**p['features'], 'ret': p['return_pct'], 'win': p['return_pct'] > 0})
    return out


def _phase2_learn(samples):
    """統計加權：算各特徵「高/低值」的勝率差 → 推薦權重方向
    輸出 data/whale_learning.json（whale_pseudo/tdcc 下次可讀來調權重）"""
    import statistics
    feats = ['mega_delta', 'big_delta', 'retail_delta', 'price_chg_5d',
             'dist_from_low5', 'ma5_slope', 'rsi14']
    report = {}
    for f in feats:
        vals = [(s[f], s['win']) for s in samples if s.get(f) is not None]
        if len(vals) < 20:
            continue
        med = statistics.median(v for v, _ in vals)
        hi = [w for v, w in vals if v >= med]
        lo = [w for v, w in vals if v < med]
        if not hi or not lo:
            continue
        hi_wr = sum(hi) / len(hi) * 100
        lo_wr = sum(lo) / len(lo) * 100
        report[f] = {
            'median': round(med, 3),
            'high_winrate': round(hi_wr, 1),
            'low_winrate': round(lo_wr, 1),
            'edge': round(hi_wr - lo_wr, 1),   # 正=高值較好、負=低值較好
        }
    payload = {
        'generated_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'sample_size': len(samples),
        'note': '各特徵高於中位數 vs 低於中位數的勝率差(edge)。|edge|越大代表該特徵越有鑑別力。',
        'features': report,
    }
    with open('data/whale_learning.json', 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    # 找最強鑑別特徵
    strong = sorted(report.items(), key=lambda x: -abs(x[1]['edge']))[:3]
    lines = [f"• {k}: 高值勝率{v['high_winrate']}% vs 低值{v['low_winrate']}% (edge {v['edge']:+.0f})" for k, v in strong]
    return payload, lines


def _check_milestones_and_learn(history):
    samples = _collect_evaluated(history)
    n = len(samples)
    fired = history.get('milestones_fired') or []
    print(f"  📊 學習樣本累積：{n} 筆（Phase2 門檻 {PHASE2_THRESHOLD} / Phase3 門檻 {PHASE3_THRESHOLD}）", flush=True)

    # Phase 2：每次 ≥50 都重算（持續更新權重報告），首次跨門檻推 Discord
    if n >= PHASE2_THRESHOLD:
        try:
            payload, lines = _phase2_learn(samples)
            print(f"  🧠 Phase2 統計加權已更新 → data/whale_learning.json", flush=True)
            if 'phase2' not in fired:
                _push_discord('🧠 鯨魚學習 Phase 2 啟動',
                              f'樣本達 {n} 筆，統計加權分析上線。最具鑑別力特徵：\n' + '\n'.join(lines))
                fired.append('phase2')
        except Exception as e:
            print(f"  ⚠️ phase2 learn: {e}", flush=True)

    # Phase 3：達門檻只提醒一次（ML 建模需人工設計）
    if n >= PHASE3_THRESHOLD and 'phase3' not in fired:
        _push_discord('🎓 鯨魚學習 Phase 3 條件達成',
                      f'樣本已達 {n} 筆，足以訓練學習模型（邏輯回歸）。\n'
                      f'請找 Claude 說「鯨魚 Phase 3」開始建模。')
        fired.append('phase3')

    if fired != (history.get('milestones_fired') or []):
        history['milestones_fired'] = fired
        with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
