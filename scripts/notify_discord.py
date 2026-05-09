"""
notify_discord.py — Discord webhook 推送 (v11.10)

提供給其他 script 引用：
  from notify_discord import send_embed, send_text, NOTIFY_UID, should_notify_uid

設計原則：
  - 永遠 try/except 包起來（推送失敗不能讓引擎崩潰）
  - 環境變數：DISCORD_WEBHOOK_URL（必要）+ NOTIFY_UID（預設 '明芳'，限制只推這個 uid）
  - 全套台股配色：紅=漲、綠=跌（不是西方）
"""
from __future__ import annotations

import os
import json
import time
from datetime import datetime
from typing import Any
import requests

NOTIFY_UID = os.environ.get("NOTIFY_UID", "明芳").strip()

# v11.11：多頻道分流
# 6 個專屬 webhook + 1 個保留 fallback
WEBHOOK_TRADES   = os.environ.get("DISCORD_WEBHOOK_TRADES", "").strip()
WEBHOOK_ALERTS   = os.environ.get("DISCORD_WEBHOOK_ALERTS", "").strip()
WEBHOOK_SUMMARY  = os.environ.get("DISCORD_WEBHOOK_SUMMARY", "").strip()
WEBHOOK_MACRO    = os.environ.get("DISCORD_WEBHOOK_MACRO", "").strip()
WEBHOOK_CONSULT  = os.environ.get("DISCORD_WEBHOOK_CONSULT", "").strip()
WEBHOOK_HEALTH   = os.environ.get("DISCORD_WEBHOOK_HEALTH", "").strip()
WEBHOOK_FALLBACK = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()  # 保留：未分類訊息退回此

# 訊息 type → 對應 webhook
ROUTE = {
    'entry':            WEBHOOK_TRADES,
    'exit':             WEBHOOK_TRADES,
    'ai_adjust':        WEBHOOK_TRADES,
    'ladder':           WEBHOOK_ALERTS,
    'duck':             WEBHOOK_ALERTS,
    'volume_surge':     WEBHOOK_ALERTS,
    'closing_dump':     WEBHOOK_ALERTS,
    'losing_streak':    WEBHOOK_ALERTS,
    'news_alert':       WEBHOOK_ALERTS,
    'breakout':         WEBHOOK_ALERTS,
    'morning_brief':    WEBHOOK_SUMMARY,
    'closing_brief':    WEBHOOK_SUMMARY,
    'daily_summary':    WEBHOOK_SUMMARY,
    'weekly':           WEBHOOK_SUMMARY,
    'monthly':          WEBHOOK_SUMMARY,   # v11.12 #9 月報
    'celebrate':        WEBHOOK_SUMMARY,   # v11.12 慶祝推送
    'macro':            WEBHOOK_MACRO,
    'us_giants':        WEBHOOK_MACRO,
    'morning_digest':   WEBHOOK_MACRO,     # v11.12 #1 AI 早安主播
    'consult':          WEBHOOK_CONSULT,
    'cron_heartbeat':   WEBHOOK_HEALTH,
    'engine_alert':     WEBHOOK_HEALTH,
    'deploy':           WEBHOOK_HEALTH,
}


def _resolve_webhook(msg_type: str) -> str:
    """依訊息類型挑 webhook，找不到就用 fallback"""
    return ROUTE.get(msg_type) or WEBHOOK_FALLBACK

# v11.10.7：股名中文化
try:
    from stock_names import cn_name as _cn_name
except Exception:
    def _cn_name(sym, fallback=None):
        return fallback or sym


def _zh_name(sym: str, fallback: str | None = None) -> str:
    """先查 stock_names，找不到才用 fallback（通常是 yfinance 英文名）"""
    if not sym:
        return fallback or '-'
    zh = _cn_name(sym, None)
    # cn_name 找不到時可能回傳 sym 本身或代碼，需濾掉
    if zh and zh != sym and not zh.endswith('.TW') and not zh.endswith('.TWO'):
        return zh
    return fallback or sym.replace('.TW', '').replace('.TWO', '')

# Taiwan color scheme (red = up, green = down)
COLOR = {
    "entry":          0x3B82F6,  # 藍 進場
    "exit_profit":    0xEF4444,  # 紅 賺錢出場（台股紅=漲）
    "exit_loss":      0x22C55E,  # 綠 虧損出場（台股綠=跌）
    "exit_flat":      0x9CA3AF,  # 灰 持平
    "ai_adjust":      0xF59E0B,  # 橘 AI 調整
    "daily_summary":  0xA855F7,  # 紫 每日總結
    "weekly_summary": 0x8B5CF6,  # 深紫 週報
    "ladder_up":      0xFBBF24,  # 黃 階梯（獲利方向）
    "ladder_down":    0x60A5FA,  # 淡藍 階梯（虧損方向，但不警示等級高）
    "duck":           0xDC2626,  # 深紅 鴨子飛了
    "volume_surge":   0xFBBF24,  # 黃 量能激增
    "closing_dump":   0xEF4444,  # 紅 尾盤摜壓
    "macro":          0xEAB308,  # 黃 總經提醒
    "consult":        0x6366F1,  # 藍紫 AI 諮詢
    "warning":        0xFB923C,  # 橘 一般預警
}


def _is_enabled() -> bool:
    """v11.11：任一 webhook 設定就視為啟用"""
    return any([
        WEBHOOK_TRADES, WEBHOOK_ALERTS, WEBHOOK_SUMMARY,
        WEBHOOK_MACRO, WEBHOOK_CONSULT, WEBHOOK_HEALTH, WEBHOOK_FALLBACK,
    ])


def should_notify_uid(uid: str) -> bool:
    """檢查當前 uid 是否在通知名單（只推 NOTIFY_UID 指定的人）"""
    if not _is_enabled():
        return False
    if not uid or not NOTIFY_UID:
        return False
    return uid == NOTIFY_UID


def _post(payload: dict, msg_type: str = '', retries: int = 2) -> bool:
    """送 webhook，依 msg_type 選頻道；失敗最多重試 N 次"""
    url = _resolve_webhook(msg_type)
    if not url:
        if msg_type:
            print(f"  ⚠️ Discord webhook 未設定 (type={msg_type})", flush=True)
        return False
    for attempt in range(retries + 1):
        try:
            r = requests.post(
                url, json=payload, timeout=10,
                headers={"Content-Type": "application/json"},
            )
            if r.status_code in (200, 204):
                return True
            if r.status_code == 429:
                retry_after = float((r.json() if r.text else {}).get("retry_after", 1))
                time.sleep(min(retry_after, 5))
                continue
            print(f"  ⚠️ Discord [{msg_type}] {r.status_code}: {r.text[:200]}", flush=True)
            return False
        except Exception as e:
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            print(f"  ⚠️ Discord [{msg_type}] push exception: {e}", flush=True)
            return False
    return False


def send_text(content: str, msg_type: str = '') -> bool:
    """純文字訊息（< 2000 字元）"""
    if not content:
        return False
    return _post({"content": content[:1900]}, msg_type=msg_type)


def send_embed(
    title: str,
    description: str = "",
    color: int = 0x3B82F6,
    fields: list[dict] | None = None,
    footer: str = "",
    thumbnail: str = "",
    content: str = "",
    msg_type: str = '',
    components: list[dict] | None = None,   # v11.12 D：按鈕
) -> bool:
    """送 Embed 卡片
    fields: [{"name": "...", "value": "...", "inline": True/False}, ...]
    """
    embed = {
        "title": title[:256],
        "color": color,
        "timestamp": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if description:
        embed["description"] = description[:4000]
    if fields:
        embed["fields"] = [
            {
                "name": (f.get("name") or "")[:256],
                "value": (str(f.get("value") or "—"))[:1024],
                "inline": bool(f.get("inline", False)),
            }
            for f in fields[:25]
        ]
    if footer:
        embed["footer"] = {"text": footer[:2048]}
    if thumbnail:
        embed["thumbnail"] = {"url": thumbnail}

    payload = {"embeds": [embed]}
    if content:
        payload["content"] = content[:1900]
    if components:
        payload["components"] = components[:5]   # Discord 上限：5 個 action row
    return _post(payload, msg_type=msg_type)


# ──────────────────────────────────────────
# v11.12 D：按鈕產生器
# Discord button styles: 1=Primary 藍 / 2=Secondary 灰 / 3=Success 綠 / 4=Danger 紅 / 5=Link
# ──────────────────────────────────────────
def _btn(label: str, custom_id: str, style: int = 2, emoji: str = None) -> dict:
    btn = {"type": 2, "label": label[:80], "style": style, "custom_id": custom_id[:100]}
    if emoji:
        btn["emoji"] = {"name": emoji}
    return btn


def _link_btn(label: str, url: str, emoji: str = None) -> dict:
    btn = {"type": 2, "label": label[:80], "style": 5, "url": url}
    if emoji:
        btn["emoji"] = {"name": emoji}
    return btn


def _action_row(buttons: list[dict]) -> dict:
    return {"type": 1, "components": buttons[:5]}


# ──────────────────────────────────────────
# v11.10.6：ANSI 著色（台股配色：紅漲綠跌）
# Discord 在 ```ansi 區塊內支援 ANSI escape codes
#   [1;31m = 粗體紅 / [1;32m = 粗體綠 / [1;33m = 粗體黃 / [0m = 重置
# ──────────────────────────────────────────
ANSI_TW_UP = "[1;31m"      # 漲 = 紅
ANSI_TW_DOWN = "[1;32m"    # 跌 = 綠
ANSI_BOLD = "[1;37m"
ANSI_RESET = "[0m"


def _ansi_block(text: str) -> str:
    """把字串包成 Discord ANSI code block"""
    return f"```ansi\n{text}\n```"


def _color_pnl(pnl: float, pnl_pct: float) -> str:
    """台股配色：賺 = 紅、賠 = 綠、持平 = 白；包成 ANSI block"""
    if pnl > 0:
        c = ANSI_TW_UP
    elif pnl < 0:
        c = ANSI_TW_DOWN
    else:
        c = ANSI_BOLD
    sign = "+" if pnl >= 0 else ""
    return _ansi_block(f"{c}{sign}{pnl:,.0f} 元 ({sign}{pnl_pct:.2f}%){ANSI_RESET}")


def _color_pct(pct: float, suffix: str = "%") -> str:
    """單純百分比著色"""
    if pct > 0:
        c = ANSI_TW_UP
    elif pct < 0:
        c = ANSI_TW_DOWN
    else:
        c = ANSI_BOLD
    sign = "+" if pct >= 0 else ""
    return _ansi_block(f"{c}{sign}{pct:.2f}{suffix}{ANSI_RESET}")


# ──────────────────────────────────────────
# 預製卡片：進場 / 出場 / 階梯 / 鴨子 / 等等
# ──────────────────────────────────────────
def _stock_label(sym: str, name: str | None) -> str:
    """v11.10.7：永遠優先用中文股名"""
    zh = _zh_name(sym, name)
    return f"{zh} ({sym})"


def card_entry(sym: str, name: str, shares: int, price: float,
               target: float | None, stop: float | None,
               confidence: int | float | None, signal_strength: str | None,
               regime_zh: str | None, sector: str | None,
               cost: int | None) -> bool:
    label = _stock_label(sym, name)
    target_pct = ((target - price) / price * 100) if (target and price) else None
    stop_pct = ((stop - price) / price * 100) if (stop and price) else None
    fields = [
        {"name": "張數", "value": f"{shares} 股" if shares < 1000 or shares % 1000 else f"{shares // 1000} 張", "inline": True},
        {"name": "進場價", "value": f"${price}", "inline": True},
        {"name": "成本", "value": f"${cost:,}" if cost else "—", "inline": True},
        {"name": "🎯 目標", "value": f"${target} ({target_pct:+.1f}%)" if target else "—", "inline": True},
        {"name": "🛑 停損", "value": f"${stop} ({stop_pct:+.1f}%)" if stop else "—", "inline": True},
        {"name": "信心 / 強度", "value": f"{confidence}% / {signal_strength or '—'}", "inline": True},
    ]
    if regime_zh or sector:
        fields.append({"name": "盤勢 / 族群", "value": f"{regime_zh or '-'} · {sector or '-'}", "inline": False})
    return send_embed(
        title=f"📥 進場 {label}",
        color=COLOR["entry"],
        fields=fields,
        footer="台股 AI 虛擬投資 · 進場通知",
        msg_type='entry',
        components=[_action_row([
            _btn("📊 查現況", f"quote:{sym}", style=1, emoji="📊"),
            _btn("📜 看交易紀錄", "history:", style=2, emoji="📜"),
            _link_btn("🌐 網頁", "https://noh486951-droid.github.io/taiwan-stock-ai-analyzer/paper_trade.html", emoji="🌐"),
        ])],
    )


def card_exit(sym: str, name: str, shares: int, entry_price: float,
              exit_price: float, pnl: float, pnl_pct: float,
              reason_zh: str, hold_days: int, max_profit_pct: float | None,
              entry_date: str) -> bool:
    label = _stock_label(sym, name)
    if pnl > 0:
        color = COLOR["exit_profit"]
        emoji = "📤📈"
        verdict = "賺 🔴"      # 台股紅 = 漲
    elif pnl < 0:
        color = COLOR["exit_loss"]
        emoji = "📤📉"
        verdict = "賠 🟢"      # 台股綠 = 跌
    else:
        color = COLOR["exit_flat"]
        emoji = "📤"
        verdict = "持平 ⚪"
    # v11.10.6：金額用 ANSI 著色（紅漲綠跌）讓一眼看出
    fields = [
        {"name": "進場 → 出場", "value": f"${entry_price} → ${exit_price}", "inline": False},
        {"name": f"損益（{verdict}）", "value": _color_pnl(pnl, pnl_pct), "inline": False},
        {"name": "持有", "value": f"{hold_days} 個交易日", "inline": True},
        {"name": "📋 出場原因", "value": reason_zh, "inline": True},
    ]
    if max_profit_pct is not None and max_profit_pct > pnl_pct + 1:
        fields.append({"name": "⚠️ 峰值回吐", "value": f"曾達浮盈 +{max_profit_pct:.2f}%（回吐 {(max_profit_pct - pnl_pct):.2f} pp）", "inline": False})
    return send_embed(
        title=f"{emoji} 出場 {label}",
        color=color,
        fields=fields,
        footer=f"進場日 {entry_date} · 台股 AI 虛擬投資",
        msg_type='exit',
        components=[_action_row([
            _btn("📜 看歷史紀錄", "history:", style=2, emoji="📜"),
            _btn("🔬 風險穿透", "risk:", style=2, emoji="🔬"),
        ])],
    )


def card_ai_adjust(sym: str, name: str, changes: list[dict],
                   ai_reason: str, confidence: int | None) -> bool:
    label = _stock_label(sym, name)
    lines = []
    for c in changes:
        field = c.get("field")
        old = c.get("old")
        new = c.get("new")
        zh = {"stop_loss": "停損", "target_price": "目標"}.get(field, field)
        lines.append(f"• **{zh}**：{old} → **{new}**")
    return send_embed(
        title=f"🔧 AI 調整 {label}",
        description="\n".join(lines),
        color=COLOR["ai_adjust"],
        fields=[
            {"name": "AI 信心", "value": f"{confidence}%" if confidence else "—", "inline": True},
            {"name": "AI 理由", "value": (ai_reason or "—")[:200], "inline": False},
        ],
        footer="盤後 AI Review",
        msg_type='ai_adjust',
    )


def card_ladder(sym: str, name: str, level_pct: float, current_pnl_pct: float,
                target_pct: float | None, stop_pct: float | None,
                price: float, max_pnl_pct: float | None) -> bool:
    label = _stock_label(sym, name)
    going_up = level_pct > 0
    color = COLOR["ladder_up"] if going_up else COLOR["ladder_down"]
    emoji = "📈" if going_up else "📉"
    title = f"⚠️ {emoji} {label} 觸及 {level_pct:+.1f}% 階梯"
    fields = [
        {"name": "現價", "value": f"${price}", "inline": True},
        {"name": "當前浮盈", "value": f"{current_pnl_pct:+.2f}%", "inline": True},
        {"name": "歷史峰值", "value": f"+{max_pnl_pct:.2f}%" if max_pnl_pct else "—", "inline": True},
    ]
    if target_pct is not None:
        fields.append({"name": "距停利目標", "value": f"{target_pct - current_pnl_pct:+.1f}pp", "inline": True})
    if stop_pct is not None:
        fields.append({"name": "距停損", "value": f"{stop_pct - current_pnl_pct:+.1f}pp", "inline": True})
    return send_embed(
        title=title,
        color=color,
        fields=fields,
        footer="階梯預警 · 可手動評估提早出場",
        msg_type='ladder',
        components=[_action_row([
            _btn("💬 問 AI 怎麼辦", f"consult:{sym}", style=1, emoji="💬"),
            _btn("📊 看現況", f"quote:{sym}", style=2, emoji="📊"),
            _btn("🔇 24h 靜音", f"mute:ladder:{sym}", style=2, emoji="🔇"),
        ])],
    )


def card_duck(sym: str, name: str, max_pnl_pct: float, current_pnl_pct: float,
              price: float) -> bool:
    """🦆 鴨子要飛了：曾達高峰但回吐"""
    label = _stock_label(sym, name)
    return send_embed(
        title=f"🦆🚨 {label} 鴨子要飛了！",
        description=f"**峰值 +{max_pnl_pct:.2f}% → 現只剩 {current_pnl_pct:+.2f}%**\n建議到頁面點 💬 AI 持倉諮詢，問 AI 要不要先跑",
        color=COLOR["duck"],
        fields=[
            {"name": "現價", "value": f"${price}", "inline": True},
            {"name": "回吐幅度", "value": f"{(max_pnl_pct - current_pnl_pct):.2f}pp", "inline": True},
        ],
        footer="峰值回吐警示",
        msg_type='duck',
        components=[_action_row([
            _btn("💬 問 AI 怎麼辦", f"consult:{sym}", style=4, emoji="💬"),
            _btn("📊 看現況", f"quote:{sym}", style=2, emoji="📊"),
        ])],
    )


def card_daily_summary(date_str: str, total_assets: float, init_capital: float,
                       cash: float, positions_value: float,
                       today_pnl: float, today_pnl_pct: float,
                       win_trades: int, loss_trades: int, total_trades: int,
                       positions: list[dict],
                       tomorrow_macro: list[dict] | None = None) -> bool:
    """每日盤後總結卡片"""
    total_ret_pct = (total_assets - init_capital) / init_capital * 100
    win_rate = win_trades / total_trades * 100 if total_trades else 0
    # v11.10.6：總資產 + 今日損益用 ANSI 著色
    fields = [
        {"name": f"💰 總資產 ${total_assets:,.0f}", "value": _color_pct(total_ret_pct), "inline": True},
        {"name": "📊 今日損益", "value": _color_pnl(today_pnl, today_pnl_pct), "inline": True},
        {"name": "🎯 勝率", "value": f"{win_rate:.1f}%\n({win_trades}/{total_trades})", "inline": True},
        {"name": "💵 現金", "value": f"${cash:,.0f}", "inline": True},
        {"name": "📈 持倉市值", "value": f"${positions_value:,.0f}", "inline": True},
        {"name": "持倉檔數", "value": f"{len(positions)}", "inline": True},
    ]
    if positions:
        # v11.10.6/7：每筆持倉用 ANSI block，紅漲綠跌一目了然 + 中文股名
        lines = []
        for p in positions[:8]:
            pct = p['pnl_pct']
            pnl_amt = p['pnl']
            c = ANSI_TW_UP if pct > 0 else ANSI_TW_DOWN if pct < 0 else ANSI_BOLD
            sign = "+" if pct >= 0 else ""
            zh = _zh_name(p.get('sym', ''), p.get('name'))
            lines.append(f"{c}{zh:<6} {sign}{pct:6.2f}%  {sign}{pnl_amt:>8,.0f}{ANSI_RESET}")
        fields.append({
            "name": "持倉一覽（紅漲綠跌）",
            "value": _ansi_block("\n".join(lines)),
            "inline": False,
        })
    if tomorrow_macro:
        rows = []
        for e in tomorrow_macro[:3]:
            imp = "🔴" if e.get("importance") == "high" else "🟡"
            rows.append(f"{imp} {e.get('date')} {e.get('time','')} {e.get('title','')}")
        fields.append({"name": "🌍 隔日大事", "value": "\n".join(rows), "inline": False})
    return send_embed(
        title=f"📊 收盤總結 {date_str}",
        color=COLOR["daily_summary"],
        fields=fields,
        footer="台股 AI 虛擬投資 · 每日盤後",
        msg_type='daily_summary',
    )


def card_weekly_summary(week_label: str, trades_this_week: list[dict],
                        win_count: int, loss_count: int, total_pnl: float) -> bool:
    """每週五盤後總結"""
    n = len(trades_this_week)
    win_rate = win_count / n * 100 if n else 0
    pnl_pct_week = (total_pnl / 1_000_000) * 100  # 對 100 萬基準的百分比
    fields = [
        {"name": "本週交易筆數", "value": f"{n}", "inline": True},
        {"name": "本週勝率", "value": f"{win_rate:.1f}% ({win_count}/{n})", "inline": True},
        {"name": "本週總損益", "value": _color_pnl(total_pnl, pnl_pct_week), "inline": False},
    ]
    if trades_this_week:
        sorted_t = sorted(trades_this_week, key=lambda x: -(x.get("pnl") or 0))
        winners = sorted_t[:3]
        losers = sorted_t[-3:]
        # v11.10.6/7：用 ANSI block 紅漲綠跌 + 中文股名
        def _line(t):
            pct = t.get('pnl_pct') or 0
            amt = t.get('pnl') or 0
            c = ANSI_TW_UP if amt > 0 else ANSI_TW_DOWN if amt < 0 else ANSI_BOLD
            sign = "+" if amt >= 0 else ""
            sym = t.get('sym') or t.get('symbol') or ''
            zh = _zh_name(sym, t.get('name'))[:8]
            return f"{c}{zh:<8} {sign}{amt:>8,.0f}  ({sign}{pct:.2f}%){ANSI_RESET}"
        if winners and any((t.get('pnl') or 0) > 0 for t in winners):
            ws_lines = [_line(t) for t in winners if (t.get('pnl') or 0) > 0]
            fields.append({"name": "🏆 本週贏家 Top 3", "value": _ansi_block("\n".join(ws_lines)), "inline": False})
        if losers and losers != winners:
            ls_lines = [_line(t) for t in losers if (t.get('pnl') or 0) < 0]
            if ls_lines:
                fields.append({"name": "💀 本週輸家 Top 3", "value": _ansi_block("\n".join(ls_lines)), "inline": False})
    return send_embed(
        title=f"📅 週報 {week_label}",
        color=COLOR["weekly_summary"],
        fields=fields,
        footer="台股 AI 虛擬投資 · 週五盤後",
        msg_type='weekly',
    )


def card_volume_surge(sym: str, name: str, ratio: float, price: float,
                      change_pct: float, ai_verdict: str | None,
                      ai_confidence: int | None, verdict_tag: str) -> bool:
    label = _stock_label(sym, name)
    return send_embed(
        title=f"⚡ {label} {verdict_tag}",
        description=f"**量能比 {ratio:.2f}× 5 日均量**（時間校正後）",
        color=COLOR["volume_surge"],
        fields=[
            {"name": "現價", "value": f"${price}", "inline": True},
            {"name": "漲跌", "value": f"{change_pct:+.2f}%", "inline": True},
            {"name": "AI 判讀", "value": f"{ai_verdict or '—'} ({ai_confidence or '—'}%)", "inline": True},
        ],
        footer="自選股盤中量能激增",
        msg_type='volume_surge',
    )


def card_closing_dump(sym: str, name: str, action: str, price_move_pct: float,
                      vol_burst_ratio: float, implication: str) -> bool:
    label = _stock_label(sym, name)
    color = COLOR["closing_dump"] if "摜壓" in (action or "") else COLOR["volume_surge"]
    return send_embed(
        title=f"🌅 持倉預警 {label} {action}",
        description=implication,
        color=color,
        fields=[
            {"name": "13:25 → 收盤 5min", "value": f"{price_move_pct:+.2f}%", "inline": True},
            {"name": "量爆比", "value": f"{vol_burst_ratio:.2f}×", "inline": True},
        ],
        footer="尾盤 5 分鐘量價監控",
        msg_type='closing_dump',
    )


def card_macro_tomorrow(events: list[dict]) -> bool:
    """隔日總經事件提醒（前一晚或當日早上推一次）"""
    if not events:
        return False
    desc_lines = []
    for e in events[:5]:
        imp = "🔴 重大" if e.get("importance") == "high" else "🟡 中等"
        desc_lines.append(f"**{e.get('date','')} {e.get('time','')}** [{imp}] {e.get('title','')}")
        if e.get("expected_impact"):
            desc_lines.append(f"  → {e['expected_impact']}")
    return send_embed(
        title=f"🌍 隔日總經事件提醒（{len(events)} 件）",
        description="\n".join(desc_lines)[:4000],
        color=COLOR["macro"],
        footer="提早調整持倉部位 / 警惕跳空風險",
        msg_type='macro',
    )


def card_consult_summary(verdict: str, suggestions: str, positions_count: int) -> bool:
    """AI 持倉諮詢結果摘要"""
    return send_embed(
        title="💬 AI 持倉諮詢結果",
        description=suggestions[:1500],
        color=COLOR["consult"],
        fields=[
            {"name": "整體判讀", "value": verdict or "—", "inline": True},
            {"name": "持倉檔數", "value": f"{positions_count}", "inline": True},
        ],
        footer="使用者主動諮詢",
        msg_type='consult',
    )


# ============================================================
# v11.11：新增卡片
# ============================================================

# A. 個股新聞重大警示（持倉 / 自選股 high impact 新聞）
def card_news_alert(sym: str, name: str, headlines: list[str],
                    sentiment: str, importance: str = 'high',
                    is_holding: bool = False) -> bool:
    label = _stock_label(sym, name)
    sent_emoji = {'positive': '🟢 利多', 'negative': '🔴 利空', 'neutral': '⚪ 中性'}.get(sentiment, '⚪')
    color = 0xEF4444 if sentiment == 'negative' else 0x22C55E if sentiment == 'positive' else 0x9CA3AF
    holding_tag = " 【持倉】" if is_holding else ""
    desc = "\n".join(f"• {h[:100]}" for h in headlines[:5])
    return send_embed(
        title=f"📰 {label}{holding_tag} 新聞警示",
        description=desc[:3500],
        color=color,
        fields=[
            {"name": "情緒判讀", "value": sent_emoji, "inline": True},
            {"name": "重要性", "value": importance, "inline": True},
        ],
        footer="持倉 / 自選股 高影響新聞",
        msg_type='news_alert',
    )


# B. 連續虧損警告
def card_losing_streak(streak: int, recent_trades: list[dict],
                        total_loss: float, total_loss_pct: float) -> bool:
    lines = []
    for t in recent_trades[-streak:]:
        sym = t.get('sym') or t.get('symbol') or ''
        zh = _zh_name(sym, t.get('name'))[:8]
        lines.append(f"{ANSI_TW_DOWN}{zh:<6} {t.get('pnl_pct', 0):+6.2f}%  {t.get('pnl', 0):>+,.0f}{ANSI_RESET}")
    return send_embed(
        title=f"🚨 連 {streak} 筆虧損警示",
        description="連續虧損出場，建議到頁面看 **🔍 失敗模式讀回**，找出共通問題並調整策略",
        color=0xDC2626,
        fields=[
            {"name": "近期虧損", "value": _ansi_block("\n".join(lines)), "inline": False},
            {"name": "累計虧損", "value": _color_pnl(total_loss, total_loss_pct), "inline": False},
        ],
        footer="風險管理 · 連敗時應減倉觀察",
        msg_type='losing_streak',
    )


# C. 盤前準備卡（08:30 推）
def card_morning_brief(date_str: str,
                       us_overnight: dict,
                       futures_night: dict,
                       today_macro: list[dict],
                       positions: list[dict],
                       ai_picks: list[dict]) -> bool:
    """每日早 08:30 推送盤前準備卡"""
    # 美股摘要
    us_lines = []
    for k in ['NVDA', 'SOX', 'AAPL', 'TSM', 'DJI', 'NDX']:
        info = us_overnight.get(k)
        if not info or info.get('change_pct') is None:
            continue
        cp = info['change_pct']
        c = ANSI_TW_UP if cp > 0 else ANSI_TW_DOWN
        sign = '+' if cp >= 0 else ''
        us_lines.append(f"{c}{k:<6} {sign}{cp:.2f}%{ANSI_RESET}")
    us_block = _ansi_block("\n".join(us_lines)) if us_lines else "—"

    # 持倉
    pos_lines = []
    for p in positions[:6]:
        sym = p.get('sym', '')
        zh = _zh_name(sym, p.get('name'))[:6]
        last_close = p.get('last_close') or p.get('entry_price', '—')
        pnl_pct = p.get('pnl_pct', 0)
        c = ANSI_TW_UP if pnl_pct >= 0 else ANSI_TW_DOWN
        sign = '+' if pnl_pct >= 0 else ''
        pos_lines.append(f"{c}{zh:<6} ${last_close:>7}  {sign}{pnl_pct:6.2f}%{ANSI_RESET}")
    pos_block = _ansi_block("\n".join(pos_lines)) if pos_lines else "—"

    # AI 自選 top
    pick_lines = []
    for p in ai_picks[:5]:
        sym = (p.get('symbol') or '').replace('.TW', '').replace('.TWO', '')
        zh = _zh_name(p.get('symbol', ''), p.get('name'))[:8]
        pick_lines.append(f"• {zh} ({sym}) — {(p.get('reason') or '')[:30]}")
    picks_block = "\n".join(pick_lines) if pick_lines else "—"

    # 今日大事
    macro_lines = []
    for e in today_macro[:4]:
        imp = "🔴" if e.get("importance") == "high" else "🟡"
        macro_lines.append(f"{imp} {e.get('time', '')} {e.get('title', '')}")
    macro_block = "\n".join(macro_lines) if macro_lines else "✅ 無重大事件"

    futures_str = "—"
    if futures_night and futures_night.get('change') is not None:
        ch = futures_night['change']
        c = ANSI_TW_UP if ch >= 0 else ANSI_TW_DOWN
        sign = '+' if ch >= 0 else ''
        futures_str = _ansi_block(f"{c}台指期夜盤  {sign}{ch:.0f} 點{ANSI_RESET}")

    return send_embed(
        title=f"🌅 盤前準備 {date_str}",
        color=0xF59E0B,
        fields=[
            {"name": "🌎 美股昨夜", "value": us_block, "inline": False},
            {"name": "🇹🇼 台指期夜盤", "value": futures_str, "inline": False},
            {"name": "📅 今日大事", "value": macro_block, "inline": False},
            {"name": "📈 持倉昨收", "value": pos_block, "inline": False},
            {"name": "🎯 AI 自選 Top 5", "value": picks_block, "inline": False},
        ],
        footer="開盤前準備 · 08:30 自動推送",
        msg_type='morning_brief',
    )


# D. 收盤即時簡訊（13:30 推）
def card_closing_brief(date_str: str, taiex_change_pct: float,
                       today_pnl: float, today_pnl_pct: float,
                       entries_count: int, exits_count: int) -> bool:
    return send_embed(
        title=f"📉 收盤剛剛 {date_str}",
        color=0xA855F7,
        fields=[
            {"name": "加權指數", "value": _color_pct(taiex_change_pct), "inline": True},
            {"name": "今日損益", "value": _color_pnl(today_pnl, today_pnl_pct), "inline": True},
            {"name": "進出場", "value": f"進 {entries_count} / 出 {exits_count}", "inline": True},
        ],
        footer="📊 詳細總結 18:00 推送 · 收盤即時簡訊",
        msg_type='closing_brief',
    )


# E. 心跳 / 引擎異常
def card_cron_heartbeat(workflow: str, ts: str) -> bool:
    """每次 worker cron 觸發 dispatch 後 ping 一次"""
    return send_embed(
        title=f"✅ Cron 觸發 {workflow}",
        description=f"`{ts}`",
        color=0x10B981,
        msg_type='cron_heartbeat',
    )


def card_engine_alert(message: str, last_run: str | None = None) -> bool:
    return send_embed(
        title="🚨 引擎異常",
        description=message,
        color=0xDC2626,
        fields=[
            {"name": "上次成功執行", "value": last_run or "—", "inline": False},
        ],
        msg_type='engine_alert',
    )


# F. 自選股突破警示
def card_breakout(sym: str, name: str, kind: str, price: float,
                   threshold: float, extra: str = "") -> bool:
    """kind: 'high_30d' | 'break_ma60' | 'volume_3day'"""
    label = _stock_label(sym, name)
    titles = {
        'high_30d':    f"🚀 {label} 突破 30 日新高",
        'break_ma60':  f"📉 {label} 跌破 MA60",
        'volume_3day': f"⚡ {label} 連 3 日量能放大",
    }
    colors = {
        'high_30d': 0xEF4444,    # 紅
        'break_ma60': 0x22C55E,  # 綠
        'volume_3day': 0xFBBF24, # 黃
    }
    return send_embed(
        title=titles.get(kind, f"突破警示 {label}"),
        color=colors.get(kind, 0x60A5FA),
        fields=[
            {"name": "現價", "value": f"${price}", "inline": True},
            {"name": "關鍵價", "value": f"${threshold}", "inline": True},
            {"name": "備註", "value": extra or "—", "inline": False},
        ],
        footer="自選股技術突破監控",
        msg_type='breakout',
    )


# v11.12 #1：AI 早安主播 / 主播風格快報（推到 #🌍-總經情報）
def card_morning_digest(digest: dict) -> bool:
    """把 AI 主播風格的 morning_digest.json 推到 Discord
    digest 結構：{title, greeting, sections:[{heading, body}], risk_alerts, closing}
    """
    if not digest:
        return False
    title = digest.get('title') or '台股 AI 主播'
    show_name = digest.get('show_name') or 'AI 主播'
    session = digest.get('session') or ''
    greeting = (digest.get('greeting') or '').strip()
    sections = digest.get('sections') or []
    risk_alerts = digest.get('risk_alerts') or []
    closing = (digest.get('closing') or '').strip()

    session_emoji = {
        'morning':   '🌅',
        'midday':    '🌞',
        'afternoon': '🌇',
        'evening':   '🌙',
    }.get(session, '📻')

    sent = 0
    # 第一張：標題 + 開場 + 前 2 個 section
    fields1 = []
    for sec in sections[:2]:
        head = (sec.get('heading') or '')[:80]
        body = (sec.get('body') or '')[:1000]
        if head and body:
            fields1.append({"name": f"📍 {head}", "value": body, "inline": False})
    ok1 = send_embed(
        title=f"{session_emoji} {show_name} — {title[:120]}",
        description=greeting[:1500] if greeting else '',
        color=COLOR['macro'],
        fields=fields1,
        footer=f"AI 主播 · {session} · 1/?",
        msg_type='morning_digest',
    )
    if ok1:
        sent += 1

    # 第二張：剩下的 sections
    if len(sections) > 2:
        fields2 = []
        for sec in sections[2:5]:
            head = (sec.get('heading') or '')[:80]
            body = (sec.get('body') or '')[:1000]
            if head and body:
                fields2.append({"name": f"📍 {head}", "value": body, "inline": False})
        if fields2:
            ok2 = send_embed(
                title=f"{session_emoji} {show_name} — 接續",
                color=COLOR['macro'],
                fields=fields2,
                msg_type='morning_digest',
            )
            if ok2:
                sent += 1

    # 第三張：剩下的 sections + 風險警示 + 結語
    fields3 = []
    if len(sections) > 5:
        for sec in sections[5:7]:
            head = (sec.get('heading') or '')[:80]
            body = (sec.get('body') or '')[:1000]
            if head and body:
                fields3.append({"name": f"📍 {head}", "value": body, "inline": False})
    if risk_alerts:
        rs = "\n".join(f"⚠️ {r[:200]}" for r in risk_alerts[:5])
        fields3.append({"name": "🚨 風險警示", "value": rs[:1024], "inline": False})
    if closing:
        fields3.append({"name": "👋 結語", "value": closing[:1024], "inline": False})
    if fields3:
        ok3 = send_embed(
            title=f"{session_emoji} {show_name} — 結尾",
            color=COLOR['macro'],
            fields=fields3,
            footer="AI 主播 · 完整版到網頁看",
            msg_type='morning_digest',
        )
        if ok3:
            sent += 1
    return sent > 0


# v11.12 慶祝推送（雖然 user 沒選但保留，月報會用）
def card_celebrate(kind: str, headline: str, detail: str) -> bool:
    color = {
        'new_high':     0xFBBF24,  # 金黃
        'win_streak':   0xEF4444,  # 紅
        'big_win':      0xF59E0B,  # 橘
    }.get(kind, 0xFBBF24)
    return send_embed(
        title=headline,
        description=detail,
        color=color,
        msg_type='celebrate',
    )


# v11.12 #9 月報
def card_monthly_summary(month_label: str, n: int, win_rate: float,
                          total_pnl: float, total_pct: float,
                          best: list[dict], worst: list[dict],
                          ai_review_text: str, ai_score: int | None,
                          file_attachment_name: str = None) -> bool:
    fields = [
        {"name": "本月交易筆數", "value": f"{n}", "inline": True},
        {"name": "本月勝率", "value": f"{win_rate:.1f}%", "inline": True},
        {"name": "本月總損益", "value": _color_pnl(total_pnl, total_pct), "inline": False},
    ]
    if ai_score is not None:
        fields.append({"name": "🎯 AI 評分", "value": f"{ai_score}/10", "inline": True})

    def _line(t):
        amt = t.get('pnl') or 0
        pct = t.get('pnl_pct') or 0
        c = ANSI_TW_UP if amt > 0 else ANSI_TW_DOWN if amt < 0 else ANSI_BOLD
        sign = "+" if amt >= 0 else ""
        sym = t.get('sym') or t.get('symbol') or ''
        zh = _zh_name(sym, t.get('name'))[:8]
        return f"{c}{zh:<8} {sign}{amt:>8,.0f}  ({sign}{pct:.2f}%){ANSI_RESET}"

    if best:
        fields.append({"name": "🏆 月度贏家 Top 3", "value": _ansi_block("\n".join(_line(t) for t in best[:3])), "inline": False})
    if worst:
        fields.append({"name": "💀 月度輸家 Top 3", "value": _ansi_block("\n".join(_line(t) for t in worst[:3])), "inline": False})
    if ai_review_text:
        fields.append({"name": "🤖 AI 月度檢討", "value": ai_review_text[:1024], "inline": False})

    return send_embed(
        title=f"📅 月報 {month_label}",
        color=COLOR.get('weekly_summary', 0x8B5CF6),
        fields=fields,
        footer="台股 AI 虛擬投資 · 月度回顧",
        msg_type='monthly',
    )


# v11.12 PNG 附件推送（給 #4 視覺化用）
def send_with_png(title: str, description: str, color: int,
                   png_bytes: bytes, png_name: str = 'chart.png',
                   msg_type: str = '') -> bool:
    """送 embed + 附 PNG 圖檔"""
    url = _resolve_webhook(msg_type)
    if not url:
        return False
    embed = {
        "title": title[:256],
        "color": color,
        "image": {"url": f"attachment://{png_name}"},
    }
    if description:
        embed["description"] = description[:4000]
    payload = {"embeds": [embed]}
    # multipart/form-data
    try:
        boundary = "----DiscordBoundary" + str(int(time.time()))
        body = []
        # part 1: payload_json
        body.append(f"--{boundary}\r\n")
        body.append('Content-Disposition: form-data; name="payload_json"\r\n')
        body.append('Content-Type: application/json\r\n\r\n')
        body.append(json.dumps(payload, ensure_ascii=False) + '\r\n')
        # part 2: file
        body.append(f"--{boundary}\r\n")
        body.append(f'Content-Disposition: form-data; name="files[0]"; filename="{png_name}"\r\n')
        body.append('Content-Type: image/png\r\n\r\n')
        # body 是 list of strings + bytes，要分別處理
        body_bytes = b''.join([s.encode('utf-8') if isinstance(s, str) else s for s in body])
        body_bytes += png_bytes
        body_bytes += f"\r\n--{boundary}--\r\n".encode('utf-8')
        r = requests.post(
            url,
            data=body_bytes,
            headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
            timeout=15,
        )
        if r.status_code in (200, 204):
            return True
        print(f"  ⚠️ Discord PNG [{msg_type}] {r.status_code}: {r.text[:200]}", flush=True)
        return False
    except Exception as e:
        print(f"  ⚠️ Discord PNG push exception: {e}", flush=True)
        return False


if __name__ == "__main__":
    # 自我測試
    print(f"_is_enabled = {_is_enabled()}")
    print(f"NOTIFY_UID = {NOTIFY_UID}")
    print(f"WEBHOOK_TRADES set: {bool(WEBHOOK_TRADES)}")
    print(f"WEBHOOK_ALERTS set: {bool(WEBHOOK_ALERTS)}")
    print(f"WEBHOOK_SUMMARY set: {bool(WEBHOOK_SUMMARY)}")
    print(f"WEBHOOK_MACRO set: {bool(WEBHOOK_MACRO)}")
    print(f"WEBHOOK_CONSULT set: {bool(WEBHOOK_CONSULT)}")
    print(f"WEBHOOK_HEALTH set: {bool(WEBHOOK_HEALTH)}")
    print(f"WEBHOOK_FALLBACK set: {bool(WEBHOOK_FALLBACK)}")
    if WEBHOOK_HEALTH or WEBHOOK_FALLBACK:
        ok = send_text("✅ Discord 連線測試 — notify_discord.py", msg_type='cron_heartbeat')
        print(f"test push: {ok}")
