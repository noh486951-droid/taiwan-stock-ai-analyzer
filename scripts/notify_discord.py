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
# 預製卡片：進場 / 出場 / 階梯 / 鴨子 / 等等
# ──────────────────────────────────────────
def _stock_label(sym: str, name: str | None) -> str:
    if name:
        return f"{name} ({sym})"
    return sym


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
        verdict = "賺"
    elif pnl < 0:
        color = COLOR["exit_loss"]
        emoji = "📤📉"
        verdict = "賠"
    else:
        color = COLOR["exit_flat"]
        emoji = "📤"
        verdict = "持平"
    fields = [
        {"name": "進場 → 出場", "value": f"${entry_price} → ${exit_price}", "inline": True},
        {"name": f"損益（{verdict}）", "value": f"${pnl:+,.0f} ({pnl_pct:+.2f}%)", "inline": True},
        {"name": "持有", "value": f"{hold_days} 個交易日", "inline": True},
        {"name": "📋 出場原因", "value": reason_zh, "inline": False},
    ]
    if max_profit_pct is not None and max_profit_pct > pnl_pct + 1:
        fields.append({"name": "⚠️ 峰值回吐", "value": f"曾達浮盈 +{max_profit_pct:.2f}%", "inline": False})
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
    fields = [
        {"name": "💰 總資產", "value": f"${total_assets:,.0f}\n({total_ret_pct:+.2f}%)", "inline": True},
        {"name": "📊 今日損益", "value": f"${today_pnl:+,.0f}\n({today_pnl_pct:+.2f}%)", "inline": True},
        {"name": "🎯 勝率", "value": f"{win_rate:.1f}%\n({win_trades}/{total_trades})", "inline": True},
        {"name": "💵 現金", "value": f"${cash:,.0f}", "inline": True},
        {"name": "📈 持倉市值", "value": f"${positions_value:,.0f}", "inline": True},
        {"name": "持倉檔數", "value": f"{len(positions)}", "inline": True},
    ]
    if positions:
        rows = []
        for p in positions[:8]:
            sign = "+" if p["pnl_pct"] >= 0 else ""
            rows.append(f"• {p['name']} `{p['sym']}` {sign}{p['pnl_pct']:.2f}% (${p['pnl']:+,.0f})")
        fields.append({"name": "持倉一覽", "value": "\n".join(rows), "inline": False})
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
    fields = [
        {"name": "本週交易筆數", "value": f"{n}", "inline": True},
        {"name": "本週勝率", "value": f"{win_rate:.1f}% ({win_count}/{n})", "inline": True},
        {"name": "本週總損益", "value": f"${total_pnl:+,.0f}", "inline": True},
    ]
    if trades_this_week:
        sorted_t = sorted(trades_this_week, key=lambda x: -(x.get("pnl") or 0))
        winners = sorted_t[:3]
        losers = sorted_t[-3:]
        if winners:
            ws = "\n".join(f"• {t.get('name','-')} `{t.get('sym','')}` ${t.get('pnl', 0):+,.0f} ({t.get('pnl_pct', 0):+.2f}%)" for t in winners if (t.get('pnl') or 0) > 0)
            if ws:
                fields.append({"name": "🏆 本週贏家 Top 3", "value": ws, "inline": False})
        if losers and losers != winners:
            ls = "\n".join(f"• {t.get('name','-')} `{t.get('sym','')}` ${t.get('pnl', 0):+,.0f} ({t.get('pnl_pct', 0):+.2f}%)" for t in losers if (t.get('pnl') or 0) < 0)
            if ls:
                fields.append({"name": "💀 本週輸家 Top 3", "value": ls, "inline": False})
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
