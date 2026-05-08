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

DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
NOTIFY_UID = os.environ.get("NOTIFY_UID", "明芳").strip()

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
    return bool(DISCORD_WEBHOOK_URL)


def should_notify_uid(uid: str) -> bool:
    """檢查當前 uid 是否在通知名單（只推 NOTIFY_UID 指定的人）"""
    if not _is_enabled():
        return False
    if not uid or not NOTIFY_UID:
        return False
    return uid == NOTIFY_UID


def _post(payload: dict, retries: int = 2) -> bool:
    """送 webhook，失敗最多重試 N 次（指數退避），全程吃掉例外"""
    if not _is_enabled():
        return False
    for attempt in range(retries + 1):
        try:
            r = requests.post(
                DISCORD_WEBHOOK_URL,
                json=payload,
                timeout=10,
                headers={"Content-Type": "application/json"},
            )
            if r.status_code in (200, 204):
                return True
            if r.status_code == 429:
                # rate limit
                retry_after = float((r.json() if r.text else {}).get("retry_after", 1))
                time.sleep(min(retry_after, 5))
                continue
            print(f"  ⚠️ Discord {r.status_code}: {r.text[:200]}", flush=True)
            return False
        except Exception as e:
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            print(f"  ⚠️ Discord push exception: {e}", flush=True)
            return False
    return False


def send_text(content: str) -> bool:
    """純文字訊息（< 2000 字元）"""
    if not content:
        return False
    return _post({"content": content[:1900]})


def send_embed(
    title: str,
    description: str = "",
    color: int = 0x3B82F6,
    fields: list[dict] | None = None,
    footer: str = "",
    thumbnail: str = "",
    content: str = "",
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
    return _post(payload)


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
    )


if __name__ == "__main__":
    # 自我測試
    print(f"DISCORD_WEBHOOK_URL = {'set' if DISCORD_WEBHOOK_URL else 'NOT SET'}")
    print(f"NOTIFY_UID = {NOTIFY_UID}")
    if DISCORD_WEBHOOK_URL:
        ok = send_text("✅ Discord webhook 連線測試成功 — notify_discord.py")
        print(f"test push: {ok}")
