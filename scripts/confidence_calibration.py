"""confidence_calibration.py — AI confidence 校準統計報表（缺口 2，v12.7.2）

背景：實測 conf 85-89 的勝率可能比 80-84 還低 — AI 給的信心分數與實際勝率
未必相關，但引擎所有門檻（進場 85、動態調整）都建立在這個數字上。

此 script 為「純觀測」階段：
  - 把已平倉交易依 entry_confidence 分桶（80-84 / 85-89 / 90-94 / 95-100）
  - 算各桶勝率、平均報酬、樣本數（全歷史 + 滾動 60 筆兩種窗口）
  - 附加維度：entry_side（左/右側）、entry_market_regime（多/空/盤整）
  - 輸出 data/confidence_calibration.json

自動調門檻的條件（未來 phase 2，本版不做）：
  - 單桶樣本 ≥ 15 筆才可信
  - 若高信心桶勝率顯著低於低信心桶 → 引擎將把 conf 視為雜訊改用固定門檻

資料來源：
  - data/ai_bot_portfolio.json（AI bot）
  - worker /api/paper-trade/all-users（真實用戶，需 PAPER_TRADE_ENGINE_SECRET）

執行時機：main.yml 18:07 EOD
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

import requests

TW = pytz.timezone('Asia/Taipei')
NOW = datetime.now(TW)
OUT_PATH = 'data/confidence_calibration.json'
WORKER_URL = "https://tw-stock-ai-proxy.noh486951-e8a.workers.dev"

BUCKETS = [(80, 84), (85, 89), (90, 94), (95, 100)]
ROLLING_N = 60


def _bucket_label(conf):
    for lo, hi in BUCKETS:
        if lo <= conf <= hi:
            return f"{lo}-{hi}"
    if conf < 80:
        return "<80"
    return None


def _gather_trades() -> list[dict]:
    """收集所有已平倉交易（AI bot + 真實用戶）"""
    trades = []

    # 1. AI bot（本地檔）
    try:
        if os.path.exists('data/ai_bot_portfolio.json'):
            p = json.load(open('data/ai_bot_portfolio.json', encoding='utf-8'))
            for t in (p.get('history') or []):
                t['_account'] = 'ai_bot'
                trades.append(t)
    except Exception as e:
        print(f"  ⚠️ load ai_bot: {e}", flush=True)

    # 2. 真實用戶（worker）
    secret = os.environ.get('PAPER_TRADE_ENGINE_SECRET', '')
    if secret:
        try:
            r = requests.get(f"{WORKER_URL}/api/paper-trade/all-users",
                             headers={'X-Engine-Secret': secret}, timeout=15)
            if r.status_code == 200:
                for u in r.json().get('users', []):
                    uid = u.get('uid') if isinstance(u, dict) else u
                    if not uid or uid == 'ai_scout_bot':
                        continue
                    pr = requests.get(f"{WORKER_URL}/api/paper-trade?uid={uid}&engine=1",
                                      headers={'X-Engine': '1', 'X-Engine-Secret': secret},
                                      timeout=10)
                    if pr.status_code == 200:
                        for t in (pr.json().get('history') or []):
                            t['_account'] = uid
                            trades.append(t)
        except Exception as e:
            print(f"  ⚠️ fetch users: {e}", flush=True)

    # 排序（依 exit_date）+ 過濾沒有 conf 或 pnl 的
    valid = []
    for t in trades:
        conf = t.get('entry_confidence')
        pnl = t.get('pnl')
        if conf is None or pnl is None:
            continue
        valid.append(t)
    valid.sort(key=lambda t: str(t.get('exit_date') or ''))
    return valid


def _bucket_stats(trades: list[dict]) -> dict:
    """依 confidence 分桶統計"""
    buckets: dict[str, dict] = {}
    for t in trades:
        label = _bucket_label(t.get('entry_confidence') or 0)
        if not label:
            continue
        b = buckets.setdefault(label, {'n': 0, 'wins': 0, 'total_pnl': 0.0, 'total_pnl_pct': 0.0})
        b['n'] += 1
        pnl = t.get('pnl') or 0
        if pnl > 0:
            b['wins'] += 1
        b['total_pnl'] += pnl
        b['total_pnl_pct'] += (t.get('pnl_pct') or 0)

    out = {}
    for label, b in buckets.items():
        n = b['n']
        out[label] = {
            'n': n,
            'win_rate': round(b['wins'] / n * 100, 1) if n else None,
            'avg_pnl_pct': round(b['total_pnl_pct'] / n, 2) if n else None,
            'total_pnl': round(b['total_pnl'], 0),
            'reliable': n >= 15,   # phase-2 自動調門檻的最低樣本
        }
    return out


def _dimension_stats(trades: list[dict], key: str) -> dict:
    """依任意欄位分組統計（entry_side / entry_market_regime）"""
    groups: dict[str, dict] = {}
    for t in trades:
        v = str(t.get(key) or 'unknown')
        g = groups.setdefault(v, {'n': 0, 'wins': 0, 'total_pnl_pct': 0.0})
        g['n'] += 1
        if (t.get('pnl') or 0) > 0:
            g['wins'] += 1
        g['total_pnl_pct'] += (t.get('pnl_pct') or 0)
    return {
        v: {
            'n': g['n'],
            'win_rate': round(g['wins'] / g['n'] * 100, 1),
            'avg_pnl_pct': round(g['total_pnl_pct'] / g['n'], 2),
        }
        for v, g in groups.items() if g['n'] > 0
    }


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] confidence_calibration start", flush=True)
    trades = _gather_trades()
    if not trades:
        print("  ℹ️ 無可用交易紀錄", flush=True)
        return
    print(f"  📋 有效交易 {len(trades)} 筆", flush=True)

    rolling = trades[-ROLLING_N:]

    payload = {
        'generated_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'total_trades': len(trades),
        'note': '缺口2 觀測階段：各 confidence 桶真實勝率。reliable=false 表樣本 <15 不足採信。'
                'phase-2（自動調門檻）需高信心桶顯著劣於低信心桶且樣本足夠才啟動。',
        'all_time': {
            'by_confidence': _bucket_stats(trades),
            'by_entry_side': _dimension_stats(trades, 'entry_side'),
            'by_regime': _dimension_stats(trades, 'entry_market_regime'),
        },
        'rolling_60': {
            'n': len(rolling),
            'by_confidence': _bucket_stats(rolling),
        },
    }

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"  ✅ 寫入 → {OUT_PATH}", flush=True)

    # console 摘要
    print("  === 全歷史 confidence 桶 ===", flush=True)
    for label in sorted(payload['all_time']['by_confidence'].keys()):
        s = payload['all_time']['by_confidence'][label]
        tag = '✓' if s['reliable'] else f"(樣本不足 n={s['n']})"
        print(f"    conf {label}: 勝率 {s['win_rate']}% / 平均 {s['avg_pnl_pct']:+.2f}% / {s['n']} 筆 {tag}", flush=True)


if __name__ == '__main__':
    main()
