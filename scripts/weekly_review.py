"""weekly_review.py — 每週敗筆檢討（v11.14.12 #4）

每週一早上跑（前一週的交易紀錄）：
- 從 data/ai_bot_portfolio.json 抓上週 exit 的交易
- 排出最虧 3 筆 + 最賺 3 筆
- 餵給 Gemini，請 AI 對比分析「為什麼贏的贏 / 輸的輸」
- 輸出共通 pattern → 存到 data/weekly_review.json + 推 Discord SUMMARY

執行：
  python scripts/weekly_review.py        # 跑前 7 天（依今天回推）
  FORCE_WEEKLY=1 ...                     # 強制跑（測試）
"""
from __future__ import annotations
import os
import sys
import json
import re
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

PORTFOLIO_PATH = 'data/ai_bot_portfolio.json'
OUTPUT_PATH = 'data/weekly_review.json'


def _load_portfolio() -> dict:
    if not os.path.exists(PORTFOLIO_PATH):
        return {}
    try:
        with open(PORTFOLIO_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"  ❌ 讀 {PORTFOLIO_PATH} 失敗：{e}", flush=True)
        return {}


def _last_week_trades(history: list) -> list:
    """回傳前 7 個自然日的 exit 交易（含 partial）"""
    cutoff = (NOW - timedelta(days=7)).strftime('%Y-%m-%d')
    week = [t for t in (history or []) if (t.get('exit_date') or '') >= cutoff]
    return week


def _build_prompt(wins: list, losses: list, week_summary: dict) -> str:
    def _fmt(t):
        return (
            f"- {t.get('sym')} ({t.get('name', '?')}): "
            f"進場 {t.get('entry_price')} @ {t.get('entry_date')} → "
            f"出場 {t.get('exit_price')} @ {t.get('exit_date')} "
            f"(持 {t.get('hold_days', '-')}天, 出場原因={t.get('exit_reason', '-')})\n"
            f"  進場信心 {t.get('entry_confidence', '-')}% / 訊號強度 {t.get('signal_strength', '-')} / "
            f"當時盤勢 {t.get('entry_market_regime', '-')}\n"
            f"  最終損益：{t.get('pnl_pct', 0):+.2f}% ({t.get('pnl', 0):+,.0f} 元)"
        )

    wins_str = '\n'.join(_fmt(t) for t in wins) or '(本週無贏家)'
    losses_str = '\n'.join(_fmt(t) for t in losses) or '(本週無輸家)'

    return f"""你是一位專精台股的資深量化策略師。請對比分析虛擬投資 AI 機器人「上週 {week_summary.get('start')} 至 {week_summary.get('end')}」的最賺與最虧 3 筆交易，找出可量化的成功與失敗 pattern。

## 本週統計
- 總筆數：{week_summary.get('total')} 筆（含分批止盈）
- 勝率：{week_summary.get('win_rate'):.1f}%
- 總損益：{week_summary.get('total_pnl'):+,.0f} 元

## 🟢 最賺 3 筆
{wins_str}

## 🔴 最虧 3 筆
{losses_str}

## 請以下結構回覆（繁體中文、約 400-600 字）

### 🎯 成功 pattern（贏家共通點）
1-3 點具體可量化的觀察（例：「都是 confidence ≥ 85 + signal_strength=strong」、「都在 bull regime 下進場」）。

### 💀 失敗 pattern（輸家共通點）
1-3 點具體可量化的觀察（例：「都在持倉 3 天內就 day_crash」、「都是 confidence 75-80 邊緣值」、「都在族群弱勢時硬進場」）。

### 🔧 下週可立刻調整的建議
給 1-2 個能直接修改 settings 的建議，例如：
- 把 confidence_threshold 從 80 上調到 85
- 把 enable_semi_us_link_filter 改用 -2% 而非 -3%
- 把 daily_entry_limit 從 3 降到 2

請務必基於上面真實數字推論，**不要編造**，不要說空話如「謹慎評估」。"""


def _call_gemini(prompt: str) -> str | None:
    """走 ai_analyzer 的 Gemini chain；失敗回 None"""
    try:
        sys.path.insert(0, os.path.dirname(__file__))
        from ai_analyzer import get_client, gemini_generate_with_retry, MODEL_FALLBACK_CHAIN
        client = get_client('market')
        if not client:
            print("  ❌ 沒有 Gemini client", flush=True)
            return None
        response = gemini_generate_with_retry(
            client, prompt,
            model=MODEL_FALLBACK_CHAIN[-1],  # 用穩定 GA 模型
            temperature=0.5,
            response_mime_type='text/plain',
            role='market',
        )
        return response.text if response else None
    except Exception as e:
        print(f"  ❌ Gemini 失敗：{e}", flush=True)
        return None


def _push_discord(summary: dict, ai_text: str):
    try:
        sys.path.insert(0, os.path.dirname(__file__))
        import notify_discord as nd
        if not hasattr(nd, 'send_to'):
            return
        title = f"📊 上週交易檢討 {summary.get('start')} ~ {summary.get('end')}"
        body = (
            f"**勝率** {summary.get('win_rate', 0):.1f}% | "
            f"**總損益** {summary.get('total_pnl', 0):+,.0f} | "
            f"**筆數** {summary.get('total', 0)}\n\n"
            f"{ai_text}"
        )
        nd.send_to('SUMMARY', body[:1900], title=title)
        print("  📤 推到 Discord SUMMARY", flush=True)
    except Exception as e:
        print(f"  ⚠️ Discord 推送失敗：{e}", flush=True)


def main():
    force = os.environ.get('FORCE_WEEKLY', '').strip() in ('1', 'true', 'yes')

    # 預設每週一跑（也允許 FORCE 跳過日期檢查）
    if NOW.weekday() != 0 and not force:
        print(f"  ⏭️ 今天 weekday={NOW.weekday()}（非週一），跳過。要強制跑請設 FORCE_WEEKLY=1", flush=True)
        return

    portfolio = _load_portfolio()
    history = portfolio.get('history') or []
    if not history:
        print("  ⚠️ 沒有交易歷史可檢討", flush=True)
        return

    week_trades = _last_week_trades(history)
    if not week_trades:
        print("  ⚠️ 上週沒有交易紀錄", flush=True)
        return

    # 排序
    week_trades.sort(key=lambda t: t.get('pnl', 0))
    losses = [t for t in week_trades if (t.get('pnl') or 0) < 0][:3]
    wins = [t for t in week_trades if (t.get('pnl') or 0) > 0][-3:][::-1]   # 賺最多

    # 統計
    total = len(week_trades)
    wins_count = sum(1 for t in week_trades if (t.get('pnl') or 0) > 0)
    total_pnl = sum(t.get('pnl') or 0 for t in week_trades)
    summary = {
        'start': (NOW - timedelta(days=7)).strftime('%Y-%m-%d'),
        'end': TODAY,
        'total': total,
        'win_trades': wins_count,
        'win_rate': (wins_count / total * 100) if total else 0,
        'total_pnl': total_pnl,
        'biggest_win': max((t.get('pnl') or 0) for t in week_trades),
        'biggest_loss': min((t.get('pnl') or 0) for t in week_trades),
    }

    print(f"  📊 上週統計：{total} 筆 / 勝率 {summary['win_rate']:.1f}% / 總損益 {total_pnl:+,.0f}", flush=True)

    prompt = _build_prompt(wins, losses, summary)
    ai_text = _call_gemini(prompt)
    if not ai_text:
        ai_text = '（AI 檢討產生失敗，僅輸出原始數據）'

    output = {
        'generated_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'summary': summary,
        'wins': wins,
        'losses': losses,
        'ai_review': ai_text,
    }

    os.makedirs('data', exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"  ✅ 已寫入 {OUTPUT_PATH}", flush=True)

    _push_discord(summary, ai_text)


if __name__ == '__main__':
    main()
