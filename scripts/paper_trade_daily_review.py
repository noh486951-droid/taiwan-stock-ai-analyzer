"""
v10.9 虛擬投資盤後 AI Review（每日 18:00 執行一次）

設計重點（見 docs/paper_trade_daily_review.md）：
  - 只對「已啟用 enable_ai_review=true」的 user 執行
  - 每個持倉丟一次 Gemini，要求回 JSON: {action, new_stop_loss, new_target_price, confidence, reason}
  - 硬性防呆：
      · confidence < 70 不採納
      · stop_loss 只能往上（trailing）
      · new_stop 不能超過現價 ×0.99（太緊）
      · new_stop 不能高於最近 3 日低點 ×0.98（給波動空間）
      · new_target 必須 ≥ 現價 ×1.02
      · new_target 不能超過 entry ×2.5
      · 最小持有日前不調整
  - 每次調整寫入 position['adjustments'] 陣列供 UI 顯示與審計
  - 不碰出場邏輯：AI 只能建議調整停損/目標，真正出場仍由盤中引擎的 6 硬規則判斷
"""
import os
import sys
import json
import time
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import pytz
import requests

# 重用 stock_names 做中文對照
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from stock_names import cn_name
except Exception:
    def cn_name(sym, fallback=None):
        return fallback or sym

tw_tz = pytz.timezone('Asia/Taipei')
now = datetime.now(tw_tz)
today_str = now.strftime('%Y-%m-%d')

WORKER_URL = os.environ.get('WORKER_URL', 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev')
ENGINE_SECRET = os.environ.get('PAPER_TRADE_ENGINE_SECRET', '')

# Gemini keys（盤後 review 壓力小，用 secondary 為主，其他 fallback）
KEY_CHAIN = [
    os.environ.get('GOOGLE_API_KEY2'),
    os.environ.get('GOOGLE_API_KEY3'),
    os.environ.get('GOOGLE_API_KEY'),
]
KEY_CHAIN = [k for k in KEY_CHAIN if k]
MODEL_CHAIN = ['gemini-3.1-flash-lite-preview', 'gemini-2.5-flash']

print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] Paper Trade Daily Review starting...", flush=True)

if not ENGINE_SECRET:
    print("  ⚠️ PAPER_TRADE_ENGINE_SECRET not set — skipping.", flush=True)
    sys.exit(0)
if not KEY_CHAIN:
    print("  ⚠️ 無任何 Gemini key — skipping.", flush=True)
    sys.exit(0)
if now.weekday() >= 5:
    print(f"  ⏰ Weekend ({now.strftime('%A')}), skipping.", flush=True)
    sys.exit(0)


# ============================================================
# 工具
# ============================================================

def _load_json(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"  ⚠️ load {path} failed: {e}", flush=True)
        return None


def _safe_json_loads(text):
    import re
    if not isinstance(text, str):
        return None
    s = text.strip()
    if s.startswith('```'):
        s = s.split('\n', 1)[1] if '\n' in s else s
        if s.rstrip().endswith('```'):
            s = s.rstrip()[:-3]
    try:
        return json.loads(s)
    except Exception:
        pass
    m = re.search(r'\{.*\}', s, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def call_gemini(prompt, max_attempts_per_key=1):
    """跑 key×model 矩陣，回傳解析後的 JSON dict 或 None"""
    for model in MODEL_CHAIN:
        for key in KEY_CHAIN:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            body = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.3,
                    "maxOutputTokens": 600,
                    "responseMimeType": "application/json",
                },
            }
            try:
                r = requests.post(url, json=body, timeout=30)
                if r.status_code in (429, 503):
                    print(f"    ⚠️ {model} key={key[:6]} {r.status_code}, 換下一把", flush=True)
                    time.sleep(2)
                    continue
                r.raise_for_status()
                data = r.json()
                text = data.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
                parsed = _safe_json_loads(text)
                if parsed:
                    return parsed
                print(f"    ⚠️ {model} JSON 解析失敗，原文: {text[:200]}", flush=True)
            except Exception as e:
                print(f"    ⚠️ {model} key={key[:6]} 錯誤: {e}", flush=True)
    return None


def get_all_users():
    url = f"{WORKER_URL}/api/paper-trade/all-users"
    try:
        r = requests.get(url, headers={'X-Engine-Secret': ENGINE_SECRET}, timeout=15)
        r.raise_for_status()
        return r.json().get('users', [])
    except Exception as e:
        print(f"  ⚠️ Fetch users failed: {e}", flush=True)
        return []


def get_portfolio(uid):
    url = f"{WORKER_URL}/api/paper-trade?uid={uid}&engine=1"
    headers = {"X-Engine": "1", "X-Engine-Secret": ENGINE_SECRET}
    try:
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  ⚠️ Get portfolio {uid} failed: {e}", flush=True)
        return None


def save_portfolio(uid, portfolio):
    url = f"{WORKER_URL}/api/paper-trade"
    body = {
        "uid": uid,
        "engine": True,
        "engine_secret": ENGINE_SECRET,
        "positions": portfolio.get('positions'),
        "last_review_status": portfolio.get('last_review_status'),
    }
    try:
        r = requests.post(url, json=body, timeout=15)
        r.raise_for_status()
        return True
    except Exception as e:
        print(f"  ⚠️ Save portfolio {uid} failed: {e}", flush=True)
        return False


# ============================================================
# 決策邏輯
# ============================================================

def _recent_3d_low(stock_data):
    """從 watchlist 資料中找最近 3 天收盤低點，作為停損下限保護"""
    if not stock_data:
        return None
    hist = stock_data.get('history') or stock_data.get('price_history') or []
    lows = []
    for bar in hist[-3:] if isinstance(hist, list) else []:
        v = bar.get('low') if isinstance(bar, dict) else None
        if isinstance(v, (int, float)) and v > 0:
            lows.append(v)
    if lows:
        return min(lows)
    # fallback：用現價 ×0.95 粗估
    price = stock_data.get('price')
    if isinstance(price, (int, float)):
        return price * 0.95
    return None


def _trading_days_held(entry_date):
    from datetime import date, timedelta
    try:
        a = datetime.strptime(entry_date[:10], '%Y-%m-%d').date()
    except Exception:
        return 0
    today = now.date()
    n, d = 0, a
    while d < today:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def build_review_prompt(sym, pos, stock_data):
    """組出給 Gemini 的 prompt — 強調「真實操盤手」語氣 + 結構化 JSON 回傳"""
    ai = (stock_data or {}).get('ai_analysis') or {}
    tech = (stock_data or {}).get('technical') or {}
    inst = (stock_data or {}).get('institutional') or {}
    news_sent = (stock_data or {}).get('news_sentiment') or {}
    price = (stock_data or {}).get('price')
    change_pct = (stock_data or {}).get('change_pct')
    held = _trading_days_held(pos.get('entry_date', today_str))
    pnl_pct = None
    if price and pos.get('entry_price'):
        pnl_pct = round((price - pos['entry_price']) / pos['entry_price'] * 100, 2)
    name = cn_name(sym, pos.get('name') or sym)

    context = {
        "symbol": sym,
        "name": name,
        "entry_date": pos.get('entry_date'),
        "entry_price": pos.get('entry_price'),
        "held_trading_days": held,
        "current_price": price,
        "today_change_pct": change_pct,
        "unrealized_pnl_pct": pnl_pct,
        "current_stop_loss": pos.get('stop_loss'),
        "current_target_price": pos.get('target_price'),
        "entry_verdict": pos.get('entry_verdict'),
        "entry_confidence": pos.get('entry_confidence'),
        "today_ai_verdict": ai.get('verdict'),
        "today_ai_confidence": ai.get('confidence'),
        "today_ai_summary": (ai.get('summary') or '')[:200],
        "technical": {
            "RSI": tech.get('RSI'), "MA5": tech.get('MA5'), "MA20": tech.get('MA20'),
            "MACD_hist": tech.get('MACD_hist'),
        },
        "institutional_today": {
            "foreign_today": (inst.get('foreign') or {}).get('today'),
            "trust_today": (inst.get('trust') or {}).get('today'),
            "dealer_today": (inst.get('dealer') or {}).get('today'),
        } if inst else None,
        "news_sentiment": news_sent.get('verdict') if news_sent else None,
        "existing_adjustments_count": len(pos.get('adjustments', [])),
    }

    return f"""你是一位真實的台股操盤手，正在盤後（18:00）檢討自己今天持倉的交易紀律。
這一檔是你自己進場的，停損/目標是你自己當初設的，現在請根據今日最新收盤資料決定：
  1. 停損要不要上拉（trailing stop，只能往上不能往下）
  2. 目標價要不要調整（可上可下，但要有邏輯）

【今日這檔持倉的完整資料】
{json.dumps(context, ensure_ascii=False, indent=2)}

【你必須回傳的 JSON 格式（不要用 markdown 包，不要多餘文字）】
{{
  "action": "hold" | "tighten_stop" | "raise_target" | "both",
  "new_stop_loss": <number 或 null>,     // 若不動就填 null
  "new_target_price": <number 或 null>,  // 若不動就填 null
  "confidence": <0-100 整數>,            // 對這個建議的信心度
  "reason": "<100 字內中文說明>"
}}

【決策原則】
- 如果股價已獲利 ≥5%：強烈考慮把停損上拉到成本價附近（保本）
- 如果股價已獲利 ≥10%：停損上拉到成本 +3~5%，鎖住部分利潤
- 如果法人今日大買（外資+投信 > 0）：可考慮上修目標價
- 如果 RSI > 80 且出現爆量：可上修目標並拉緊停損
- 如果訊號轉中性/偏空但尚未翻黑：建議 hold，讓引擎盤中規則處理
- 若整體沒有明確變化：action=hold，兩個數字都 null，confidence 可以低

只回 JSON，不要說任何其他話。
"""


def apply_guardrails(pos, proposal, current_price, recent_3d_low):
    """對 AI 建議套硬性防呆，回傳實際套用的變更列表 [(field, old, new, reason)]"""
    entry = pos.get('entry_price')
    cur_stop = pos.get('stop_loss')
    cur_target = pos.get('target_price')
    conf = proposal.get('confidence') or 0

    if conf < 70:
        return [], f"AI 信心度 {conf} 不足 70，不採納"

    applied = []
    new_stop = proposal.get('new_stop_loss')
    if isinstance(new_stop, (int, float)) and new_stop > 0 and cur_stop:
        reason_reject = None
        if new_stop < cur_stop:
            reason_reject = f"違反 trailing（新停損 {new_stop} < 舊停損 {cur_stop}）"
        elif current_price and new_stop > current_price * 0.99:
            reason_reject = f"太緊（新停損 {new_stop} > 現價 {current_price} × 0.99）"
        elif recent_3d_low and new_stop > recent_3d_low * 0.98:
            reason_reject = f"高於最近 3 日低點 × 0.98 ({round(recent_3d_low*0.98,2)})，易被洗掉"
        else:
            applied.append(('stop_loss', cur_stop, round(new_stop, 2), '✓ 通過'))
        if reason_reject:
            applied.append(('stop_loss', cur_stop, None, f"✗ 拒絕：{reason_reject}"))

    new_target = proposal.get('new_target_price')
    if isinstance(new_target, (int, float)) and new_target > 0 and cur_target and entry:
        reason_reject = None
        if current_price and new_target < current_price * 1.02:
            reason_reject = f"新目標 {new_target} < 現價 × 1.02，無上漲空間"
        elif new_target > entry * 2.5:
            reason_reject = f"新目標 {new_target} > 成本 × 2.5 ({round(entry*2.5,2)})，畫大餅"
        else:
            applied.append(('target_price', cur_target, round(new_target, 2), '✓ 通過'))
        if reason_reject:
            applied.append(('target_price', cur_target, None, f"✗ 拒絕：{reason_reject}"))

    return applied, None


def review_position(uid, sym, pos, watchlist_analysis, min_hold_days):
    stocks = (watchlist_analysis or {}).get('stocks') or {}
    sd = stocks.get(sym)
    if not sd:
        return {'status': 'no_data', 'sym': sym}

    held = _trading_days_held(pos.get('entry_date', today_str))
    if held < min_hold_days:
        return {'status': 'too_young', 'sym': sym, 'held': held}

    prompt = build_review_prompt(sym, pos, sd)
    proposal = call_gemini(prompt)
    if not proposal:
        return {'status': 'ai_failed', 'sym': sym}

    current_price = sd.get('price')
    recent_low = _recent_3d_low(sd)
    applied, reject_msg = apply_guardrails(pos, proposal, current_price, recent_low)

    # 真正套用通過的那些（非 ✗）
    changes_made = []
    for field, old, new, note in applied:
        if new is not None and note.startswith('✓'):
            pos[field] = new
            changes_made.append({'field': field, 'old': old, 'new': new})

    if changes_made:
        # 寫入 adjustments 歷史
        pos.setdefault('adjustments', []).append({
            'ts': now.strftime('%Y-%m-%d %H:%M:%S'),
            'source': 'daily_ai_review',
            'changes': changes_made,
            'ai_confidence': proposal.get('confidence'),
            'ai_reason': proposal.get('reason', ''),
        })
        # 標記此 position 是否曾被 AI 調整（讓出場時能寫 mode=adjusted）
        pos['ai_adjusted'] = True

    return {
        'status': 'ok',
        'sym': sym,
        'action': proposal.get('action'),
        'confidence': proposal.get('confidence'),
        'reason': proposal.get('reason', '')[:100],
        'guardrail_log': applied,
        'changes_applied': len(changes_made),
        'reject_msg': reject_msg,
    }


# ============================================================
# 主流程
# ============================================================

# ============================================================
# v11.6：失敗交易模式讀回（Post-mortem）
# ============================================================

def _rule_based_postmortem(history: list) -> dict:
    """純規則的失敗模式統計，無需 AI（避免空跑）。
    回傳 {
      total_loss, total_win, winrate,
      worst_reason, worst_regime,
      reason_breakdown: {reason: {count, avg_pnl}},
      regime_breakdown, hold_days_breakdown,
      verdicts_breakdown, signal_strength_breakdown,
      summary_zh
    }
    """
    if not history:
        return {"total": 0, "summary_zh": "尚無已平倉交易"}
    losses = [t for t in history if (t.get('pnl') or 0) < 0]
    wins = [t for t in history if (t.get('pnl') or 0) > 0]
    flat = [t for t in history if (t.get('pnl') or 0) == 0]
    n = len(history)
    winrate = round(len(wins) / n * 100, 1) if n else 0

    def _bucket(items, key, value_fn=None):
        agg = {}
        for t in items:
            k = key(t)
            if k is None:
                continue
            d = agg.setdefault(k, {"count": 0, "pnl_sum": 0.0})
            d["count"] += 1
            d["pnl_sum"] += t.get('pnl') or 0
        return {
            k: {"count": v["count"],
                "avg_pnl": round(v["pnl_sum"] / v["count"], 0)}
            for k, v in agg.items()
        }

    reason_breakdown = _bucket(losses, lambda t: t.get('exit_reason'))
    regime_breakdown = _bucket(losses, lambda t: t.get('entry_market_regime'))
    verdicts = _bucket(losses, lambda t: t.get('entry_verdict'))
    strength = _bucket(losses, lambda t: t.get('signal_strength'))

    # 持有天數分桶
    def _hold_bucket(t):
        h = t.get('hold_days') or 0
        if h <= 1: return "1 日內"
        if h <= 3: return "2-3 日"
        if h <= 7: return "4-7 日"
        return "8+ 日"
    hold_breakdown = _bucket(losses, _hold_bucket)

    # 找最痛的原因 / 盤勢
    worst_reason = max(reason_breakdown.items(),
                       key=lambda x: x[1]["count"], default=(None, None))[0]
    worst_regime = max(regime_breakdown.items(),
                       key=lambda x: x[1]["count"], default=(None, None))[0]

    bits = []
    if losses:
        avg_loss = sum(t.get('pnl') or 0 for t in losses) / len(losses)
        bits.append(f"已平倉 {n} 筆，勝率 {winrate}%（贏 {len(wins)} / 輸 {len(losses)}），平均虧損 {avg_loss:+.0f} 元")
    if worst_reason:
        c = reason_breakdown[worst_reason]["count"]
        bits.append(f"最常見虧損出場：{worst_reason}（{c} 次）")
    if worst_regime and worst_regime != 'unknown':
        c = regime_breakdown[worst_regime]["count"]
        bits.append(f"虧損集中在「{worst_regime}」盤勢（{c} 次）")
    summary_zh = "；".join(bits) if bits else "尚無顯著模式"

    return {
        "total": n,
        "wins": len(wins),
        "losses": len(losses),
        "flat": len(flat),
        "winrate_pct": winrate,
        "worst_exit_reason": worst_reason,
        "worst_regime": worst_regime,
        "reason_breakdown": reason_breakdown,
        "regime_breakdown": regime_breakdown,
        "verdicts_breakdown": verdicts,
        "signal_strength_breakdown": strength,
        "hold_days_breakdown": hold_breakdown,
        "summary_zh": summary_zh,
    }


def _ai_postmortem_summary(stats: dict, recent_losses: list) -> dict:
    """送到 Gemini 寫一段散戶可讀的反省 + 改進建議。
    失敗時回 None；只是輔助。
    """
    if not stats or stats.get('total', 0) < 5:
        return None  # 樣本不夠就不浪費 AI quota
    try:
        # 精簡只送虧損列表
        losses_brief = []
        for t in (recent_losses or [])[-15:]:
            losses_brief.append({
                "sym": t.get('sym'),
                "name": t.get('name'),
                "entry_price": t.get('entry_price'),
                "exit_price": t.get('exit_price'),
                "pnl_pct": t.get('pnl_pct'),
                "hold_days": t.get('hold_days'),
                "exit_reason": t.get('exit_reason'),
                "entry_verdict": t.get('entry_verdict'),
                "entry_confidence": t.get('entry_confidence'),
                "signal_strength": t.get('signal_strength'),
                "entry_market_regime": t.get('entry_market_regime'),
            })
        prompt = f"""
你是一位資深交易檢討教練。以下是某虛擬投資組合的歷史交易統計與最近虧損明細。
請用「客觀、可執行」的口吻，找出 2-4 個共同的失敗模式，並給出具體的改進規則。

統計摘要（規則式）：
{json.dumps(stats, ensure_ascii=False, indent=2)}

最近虧損明細（最多 15 筆）：
{json.dumps(losses_brief, ensure_ascii=False, indent=2)}

請以 JSON 回覆：
{{
  "patterns": [  // 2-4 條
    {{
      "pattern": "失敗模式（一句話，繁中）",
      "evidence": "支持證據（具體引用統計）",
      "fix_rule": "可執行的改進規則（例：『盤整盤勢時提高 confidence_threshold 到 85』）"
    }}
  ],
  "top_advice": "1 句最重要的調整建議（繁中）"
}}
        """
        return call_gemini(prompt)
    except Exception as e:
        print(f"  ⚠️ AI postmortem failed: {e}", flush=True)
        return None


def run_postmortem(portfolio: dict) -> dict | None:
    history = portfolio.get('history') or []
    if len(history) < 3:
        return None
    stats = _rule_based_postmortem(history)
    losses = [t for t in history if (t.get('pnl') or 0) < 0]
    ai_part = _ai_postmortem_summary(stats, losses)
    return {
        "ts": now.strftime('%Y-%m-%d %H:%M:%S'),
        "stats": stats,
        "ai_review": ai_part or {},
    }


def process_user(uid, watchlist_analysis):
    portfolio = get_portfolio(uid)
    if not portfolio:
        return
    settings = portfolio.get('settings') or {}
    if not settings.get('enable_ai_review', False):
        print(f"  ℹ️ [{uid}] enable_ai_review=off, skipping", flush=True)
        return
    positions = portfolio.get('positions') or {}
    # v11.6：即使無持倉，仍跑 post-mortem 統計
    if not positions:
        print(f"  ℹ️ [{uid}] no positions; running post-mortem only", flush=True)
        try:
            pm = run_postmortem(portfolio)
            if pm:
                portfolio['post_mortem'] = pm
                save_portfolio(uid, portfolio)
                print(f"  📊 [{uid}] post-mortem: {pm['stats'].get('summary_zh', '-')}", flush=True)
        except Exception as e:
            print(f"  ⚠️ [{uid}] post-mortem failed: {e}", flush=True)
        return

    min_hold = settings.get('min_hold_trading_days', 3)
    reviews = []
    for sym in list(positions.keys()):
        result = review_position(uid, sym, positions[sym], watchlist_analysis, min_hold)
        reviews.append(result)
        status = result.get('status')
        name = cn_name(sym, positions[sym].get('name') or sym)
        if status == 'ok':
            print(f"  [{uid}] {name} ({sym}): action={result['action']} conf={result['confidence']} "
                  f"applied={result['changes_applied']} | {result['reason']}", flush=True)
            for (field, old, new, note) in result.get('guardrail_log', []):
                print(f"      {field}: {old} → {new}  {note}", flush=True)
        else:
            print(f"  · [{uid}] {name} ({sym}): {status}", flush=True)
        time.sleep(1.5)  # 節流：避開 Gemini 免費 QPS

    # v11.6：失敗模式讀回（每日盤後跑一次，無倉也跑）
    try:
        pm = run_postmortem(portfolio)
        if pm:
            portfolio['post_mortem'] = pm
            print(f"  📊 [{uid}] post-mortem: {pm['stats'].get('summary_zh', '-')}", flush=True)
    except Exception as e:
        print(f"  ⚠️ [{uid}] post-mortem failed: {e}", flush=True)

    portfolio['last_review_status'] = {
        'timestamp': now.strftime('%Y-%m-%d %H:%M:%S'),
        'reviewed': len(reviews),
        'applied_count': sum(1 for r in reviews if r.get('changes_applied', 0) > 0),
        'summary': [
            {
                'sym': r.get('sym'),
                'action': r.get('action'),
                'changes': r.get('changes_applied', 0),
                'reason': r.get('reason', '')[:60],
            }
            for r in reviews if r.get('status') == 'ok'
        ],
    }
    save_portfolio(uid, portfolio)


def main():
    wa = _load_json('data/watchlist_analysis.json')
    if not wa:
        print("  ⚠️ 無 watchlist_analysis.json", flush=True)
        return
    users = get_all_users()
    if not users:
        print("  ℹ️ 無 paper_trade 使用者", flush=True)
        return
    print(f"  👥 檢查 {len(users)} 個使用者", flush=True)
    for uid in users:
        try:
            process_user(uid, wa)
        except Exception as e:
            print(f"  ❌ user {uid} failed: {e}", flush=True)
        time.sleep(1)
    print(f"[{now.strftime('%H:%M:%S')}] Daily Review done.", flush=True)


if __name__ == '__main__':
    main()
