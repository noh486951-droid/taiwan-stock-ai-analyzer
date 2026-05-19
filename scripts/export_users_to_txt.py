"""export_users_to_txt.py — 把舊暱稱使用者的資料各別存成 txt (v12 prep)

流程：
  1. 跑這個 script 之前，先打 worker endpoint 把資料抓下來：
     curl "https://tw-stock-ai-proxy.noh486951-e8a.workers.dev/api/admin/export-all-users?admin_pw=XXX" \
       -o users_export.json

  2. 跑這個 script：
     python scripts/export_users_to_txt.py users_export.json

  3. 會在 backups/users/ 下產生：
     - 明芳.txt
     - test.txt
     - ai_bot.txt
     - ... (每個用戶一個 txt)

  4. 你可以把這些 txt 寄給對應的人（如果有用 Discord ID 對應），
     或保留作備份。

txt 格式：
  ============================================================
  暱稱：明芳
  最後更新：2026-05-20 ...
  ============================================================

  📋 自選股清單（共 17 檔）
  ───────────────────────
  分組 1：核心持股
    - 2330.TW 台積電
    - 2454.TW 聯發科
    ...
  分組 2：觀察
    - 6770.TW 力積電
    ...

  💼 持倉成本（共 3 檔）
  ───────────────────────
  - 2330.TW 台積電
    成本 600.5 / 持股 1000 股 / 入場 2026-04-15
    投資總額 600,500 元
    備註：AI 諮詢後加碼

  📜 交易紀錄（共 5 筆，累積損益 +12,345 元）
  ───────────────────────
  ...
"""
import os
import sys
import json
from datetime import datetime


def fmt_money(n):
    if n is None:
        return '-'
    try:
        n = float(n)
        return f"{n:+,.0f}" if n < 0 else f"+{n:,.0f}"
    except Exception:
        return str(n)


def render_user_txt(uid: str, data: dict) -> str:
    lines = []
    push = lines.append

    bar = "=" * 60
    push(bar)
    push(f"暱稱：{uid}")
    push(f"最後更新：{data.get('updated_at', '未知')}")
    push(f"已加入排行榜：{'是' if data.get('leaderboard_opt_in') else '否'}")
    push(bar)
    push("")

    # === 自選股 ===
    groups = data.get('groups') or []
    watchlists = data.get('watchlists') or {}
    total_stocks = sum(len(v) for v in watchlists.values() if isinstance(v, list))
    push(f"📋 自選股清單（共 {total_stocks} 檔）")
    push("─" * 40)
    if not watchlists:
        push("  (無資料)")
    else:
        for grp in groups:
            grp_name = grp.get('name', 'default') if isinstance(grp, dict) else str(grp)
            grp_id = grp.get('id', grp_name) if isinstance(grp, dict) else str(grp)
            stocks = watchlists.get(grp_id, [])
            push(f"\n  分組「{grp_name}」（{len(stocks)} 檔）")
            for s in stocks:
                if isinstance(s, dict):
                    sym = s.get('symbol', '?')
                    name = s.get('name', '')
                    push(f"    - {sym}  {name}")
                else:
                    push(f"    - {s}")
        # 顯示沒分組的
        all_groupd_ids = {g.get('id') if isinstance(g, dict) else g for g in groups}
        for k, v in watchlists.items():
            if k not in all_groupd_ids:
                push(f"\n  (未分組「{k}」, {len(v)} 檔)")
                for s in v:
                    push(f"    - {s if not isinstance(s, dict) else s.get('symbol', '?')}")
    push("")

    # === 持倉 ===
    positions = data.get('positions') or {}
    push(f"💼 持倉成本（共 {len(positions)} 檔）")
    push("─" * 40)
    if not positions:
        push("  (無持倉)")
    else:
        for sym, pos in positions.items():
            cost = pos.get('cost')
            shares = pos.get('shares', 0)
            total_cost = pos.get('total_cost') or (cost * shares if cost else 0)
            entry_date = pos.get('entry_date', '-')
            notes = pos.get('notes', '')
            push(f"\n  - {sym}")
            push(f"    成本 {cost} / 持股 {shares} 股 / 入場 {entry_date}")
            push(f"    投資總額 {total_cost:,.0f} 元")
            if notes:
                push(f"    備註：{notes}")
    push("")

    # === 交易紀錄 ===
    trade_log = data.get('trade_log') or []
    total_pnl = sum((t.get('pnl_abs') or t.get('pnl') or 0) for t in trade_log)
    push(f"📜 交易紀錄（共 {len(trade_log)} 筆，累積損益 {fmt_money(total_pnl)} 元）")
    push("─" * 40)
    if not trade_log:
        push("  (無紀錄)")
    else:
        # 按 exit_date 倒序
        sorted_trades = sorted(trade_log, key=lambda t: t.get('exit_date') or '', reverse=True)
        for t in sorted_trades:
            sym = t.get('symbol', '?')
            name = t.get('name', '')
            entry_p = t.get('entry_price', '-')
            exit_p = t.get('exit_price', '-')
            entry_d = t.get('entry_date', '-')
            exit_d = t.get('exit_date', '-')
            shares = t.get('shares', '-')
            pnl = t.get('pnl_abs') or t.get('pnl') or 0
            pnl_pct = t.get('pnl_pct', 0)
            reason = t.get('exit_reason', '-')
            push(f"\n  - {sym} {name}")
            push(f"    買入 {entry_p} ({entry_d}) → 賣出 {exit_p} ({exit_d})")
            push(f"    {shares} 股，損益 {fmt_money(pnl)} 元（{pnl_pct:+.2f}%），原因：{reason}")
    push("")

    push(bar)
    push("⚠️ 此檔案由系統匯出供備份用。v12 上線後請註冊新帳號並用「從舊暱稱匯入」功能。")
    push(bar)

    return '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print("用法：python scripts/export_users_to_txt.py users_export.json [output_dir]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) >= 3 else 'backups/users'

    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    users = data.get('users') or []
    if not users:
        print("⚠️ 沒有使用者資料")
        return

    os.makedirs(output_dir, exist_ok=True)
    print(f"📁 輸出目錄：{output_dir}")
    print(f"👥 共 {len(users)} 位使用者")

    for u in users:
        uid = u.get('uid') or 'unknown'
        # 清掉檔名不允許的字元
        safe_uid = ''.join(c for c in uid if c not in '<>:"/\\|?*')
        path = os.path.join(output_dir, f"{safe_uid}.txt")
        try:
            content = render_user_txt(uid, u)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"  ✅ {path}")
        except Exception as e:
            print(f"  ❌ {uid}: {e}")

    print(f"\n🎉 完成。{len(users)} 個 txt 在 {output_dir}/")


if __name__ == '__main__':
    main()
