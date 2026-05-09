"""
monthly_report.py — 月報 (v11.12 #F)

執行時機：每月最後一個交易日 18:30 TW
觸發策略：每天 main.yml 18:00 cron 跑時，呼叫此腳本，腳本內判斷是否為月底最後一個交易日

推送內容：
  - 本月交易筆數 / 勝率 / 總損益
  - 月度贏家 / 輸家 Top 3
  - AI 月度檢討 + 1-10 分評分
  - PNG 視覺化（月度資產曲線 + 月勝率柱狀）
"""
from __future__ import annotations

import os
import sys
import json
import calendar
from datetime import datetime, timedelta
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import notify_discord as _nd
except Exception:
    _nd = None

TW_TZ = pytz.timezone("Asia/Taipei")
NOW = datetime.now(TW_TZ)


def _is_last_trading_day_of_month(today: datetime) -> bool:
    """今天是否該月最後一個交易日？
    定義：今天是工作日，且這個月之後沒有更晚的工作日"""
    if today.weekday() >= 5:
        return False
    last_day = calendar.monthrange(today.year, today.month)[1]
    # 看 today.day+1 ~ last_day 之間是否還有工作日
    for d in range(today.day + 1, last_day + 1):
        try:
            check = today.replace(day=d)
            if check.weekday() < 5:
                return False
        except ValueError:
            continue
    return True


def _fetch_user_portfolio():
    if not _nd or not _nd.NOTIFY_UID:
        return None
    worker_url = os.environ.get('WORKER_URL', 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev')
    secret = os.environ.get('PAPER_TRADE_ENGINE_SECRET', '')
    try:
        import requests
        r = requests.get(
            f"{worker_url}/api/paper-trade?uid={_nd.NOTIFY_UID}&engine=1",
            headers={'X-Engine-Secret': secret, 'X-Engine': '1'},
            timeout=10,
        )
        r.raise_for_status()
        return r.json() or {}
    except Exception as e:
        print(f"  ⚠️ fetch portfolio: {e}", flush=True)
        return None


def _ai_monthly_review(stats: dict, recent_losses: list, recent_wins: list) -> tuple[str, int | None]:
    """呼叫 Gemini 寫月度檢討 + 1-10 分。多 key 多 model fallback + 寬鬆 parse"""
    keys = [os.environ.get('GOOGLE_API_KEY'), os.environ.get('GOOGLE_API_KEY2'), os.environ.get('GOOGLE_API_KEY3')]
    keys = [k for k in keys if k]
    if not keys:
        win_rate = stats.get('win_rate', 0)
        pnl_pct = stats.get('total_pnl_pct', 0)
        fallback = f"【本月總結】交易 {stats.get('total_trades')} 筆，勝率 {win_rate}%，損益 {pnl_pct}%。\n"
        if pnl_pct > 0:
            fallback += "📈 本月表現優異，建議維持當前策略，並注意獲利鎖定。"
        elif pnl_pct < -5:
            fallback += "📉 本月虧損較重，建議檢討出場邏輯，並暫時減縮位階。"
        else:
            fallback += "⚖️ 本月表現持平，建議微調進場信心門檻。"
        return fallback, 5 if pnl_pct == 0 else (7 if pnl_pct > 0 else 4)

    prompt = f"""你是台股操盤檢討教練。看完使用者本月交易，給：
1. 月度檢討 — 找出 2-3 個最重要的模式（贏在哪、輸在哪、心態如何）
2. 評分 1-10（10 = 完美紀律、長期可期；1 = 完全憑感覺）
3. 下個月 1 個具體改進方向

本月統計：
{json.dumps(stats, ensure_ascii=False, indent=2)}

贏家：
{json.dumps(recent_wins[:3], ensure_ascii=False, indent=2)}

輸家：
{json.dumps(recent_losses[:3], ensure_ascii=False, indent=2)}

請只用 JSON 格式回覆，不要 markdown 包裹：
{{"score": 1-10 的整數, "summary": "繁中、不超過 300 字的月度檢討文字"}}"""
    import requests, re
    models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
    last_err = ''
    for model in models:
        for key in keys:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
                # 不用 responseMimeType（部分組合會 400）
                r = requests.post(url, json={
                    'contents': [{'parts': [{'text': prompt}]}],
                    'generationConfig': {'temperature': 0.4, 'maxOutputTokens': 4096},
                }, timeout=30)
                if not r.ok:
                    last_err = f"{model}/{key[:6]} HTTP {r.status_code}: {r.text[:200]}"
                    print(f"  ⚠️ AI review {last_err}", flush=True)
                    continue
                data = r.json()
                text = data.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
                if not text:
                    last_err = f"{model}/{key[:6]} empty response"
                    continue
                # 寬鬆 parse：先試直接 JSON
                parsed = None
                try:
                    parsed = json.loads(text)
                except Exception:
                    # 嘗試 regex 抓完整 {...}
                    m = re.search(r'\{[\s\S]*\}', text)
                    if m:
                        try:
                            parsed = json.loads(m.group(0))
                        except Exception:
                            pass
                if parsed and isinstance(parsed, dict):
                    summary = (parsed.get('summary') or '').strip()
                    score = parsed.get('score')
                    if summary:
                        print(f"  ✅ AI review via {model}", flush=True)
                        return summary[:900], int(score) if isinstance(score, (int, float)) else None

                # JSON 解析失敗 → 嘗試手動抓 summary 欄位（被截斷的情況）
                # 例：{"score": 9, "summary": "本月... \"
                m = re.search(r'"summary"\s*:\s*"((?:[^"\\]|\\.)*)', text)
                if m:
                    extracted = m.group(1).replace('\\n', '\n').replace('\\"', '"').strip()
                    # 最後若沒結尾標點補一個「…」表示截斷
                    if not extracted.endswith(('。', '！', '？', '.', '!', '?', '」', ')')):
                        extracted += '…'
                    score_m = re.search(r'"score"\s*:\s*(\d+)', text)
                    score = int(score_m.group(1)) if score_m else None
                    print(f"  ⚠️ AI review {model}: JSON 截斷但抽出 summary", flush=True)
                    return extracted[:900], score

                # 完全 parse 不出來 → 把純文字當 summary（去掉 JSON 包裹符號）
                clean = re.sub(r'^[\s`]*\{[^"]*"summary"\s*:\s*"', '', text)
                clean = re.sub(r'"\s*[,}].*$', '', clean, flags=re.DOTALL).strip()
                if not clean:
                    clean = text.strip()
                print(f"  ⚠️ AI review {model}/{key[:6]}: 非 JSON，清理後使用", flush=True)
                return clean[:900], None
            except Exception as e:
                last_err = f"{model}/{key[:6]} {e}"
                print(f"  ⚠️ AI review {last_err}", flush=True)
                continue
    # 最終備援
    win_rate = stats.get('win_rate', 0)
    pnl_pct = stats.get('total_pnl_pct', 0)
    fallback = f"【本月總結】交易 {stats.get('total_trades')} 筆，勝率 {win_rate}%，損益 {pnl_pct}%。\n⚖️ 目前系統負載較高，請參考以上基本統計數據進度評估。"
    return fallback, 5 if pnl_pct == 0 else (7 if pnl_pct > 0 else 4)


def main():
    print(f"=== Monthly Report — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    force = os.environ.get('FORCE_MONTHLY', '').strip() in ('1', 'true', 'yes')
    if not force and not _is_last_trading_day_of_month(NOW):
        print(f"  ⏰ 不是月底最後一個交易日 ({NOW.strftime('%Y-%m-%d')})，skip", flush=True)
        return
    if force:
        print(f"  🧪 FORCE_MONTHLY=1，強制跑（測試模式）", flush=True)
    if _nd is None or not _nd.NOTIFY_UID:
        print("  Discord 未設定，skip", flush=True)
        return
    portfolio = _fetch_user_portfolio()
    if not portfolio:
        print("  無法取得 portfolio", flush=True)
        return

    history = portfolio.get('history') or []
    if not history:
        print("  無交易歷史，skip", flush=True)
        return

    # 過濾本月交易
    month_str = NOW.strftime('%Y-%m')
    month_trades = [t for t in history if (t.get('exit_date') or '').startswith(month_str)]
    if not month_trades:
        print(f"  {month_str} 本月無平倉交易，skip", flush=True)
        return

    n = len(month_trades)
    wins = [t for t in month_trades if (t.get('pnl') or 0) > 0]
    losses = [t for t in month_trades if (t.get('pnl') or 0) < 0]
    win_rate = len(wins) / n * 100
    total_pnl = sum((t.get('pnl') or 0) for t in month_trades)
    init = (portfolio.get('settings') or {}).get('initial_capital', 1_000_000)
    total_pct = total_pnl / init * 100

    sorted_trades = sorted(month_trades, key=lambda x: -(x.get('pnl') or 0))
    best = sorted_trades[:3]
    worst = sorted_trades[-3:] if len(sorted_trades) > 3 else []

    # AI 月度檢討
    stats = {
        'month': month_str, 'total_trades': n, 'win_rate': round(win_rate, 1),
        'total_pnl': total_pnl, 'total_pnl_pct': round(total_pct, 2),
        'wins': len(wins), 'losses': len(losses),
    }
    print(f"  Stats: {stats}", flush=True)
    ai_summary, ai_score = _ai_monthly_review(stats, [t for t in worst if (t.get('pnl') or 0) < 0], best)

    # 推送
    try:
        ok = _nd.card_monthly_summary(
            month_label=month_str,
            n=n,
            win_rate=win_rate,
            total_pnl=total_pnl,
            total_pct=total_pct,
            best=best,
            worst=[t for t in worst if (t.get('pnl') or 0) < 0],
            ai_review_text=ai_summary,
            ai_score=ai_score,
        )
        print(f"  📲 monthly summary pushed: {ok}", flush=True)
    except Exception as e:
        print(f"  ❌ push failed: {e}", flush=True)

    # PNG 圖
    try:
        # 重用 daily review 的 _generate_charts_png
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from paper_trade_daily_review import _generate_charts_png
        # wa 用最新 watchlist_analysis
        wa_path = 'data/watchlist_analysis.json'
        wa = None
        if os.path.exists(wa_path):
            with open(wa_path, 'r', encoding='utf-8') as f:
                wa = json.load(f)
        png = _generate_charts_png(portfolio, wa)
        if png:
            _nd.send_with_png(
                title=f"📊 {month_str} 月度視覺化",
                description="總資產走勢 / 月勝率 / 持倉分布",
                color=0x8B5CF6,
                png_bytes=png,
                png_name=f"monthly_{month_str.replace('-', '')}.png",
                msg_type='monthly',
            )
            print(f"  📊 monthly PNG pushed", flush=True)
    except Exception as e:
        print(f"  ⚠️ monthly PNG failed: {e}", flush=True)


if __name__ == "__main__":
    main()
