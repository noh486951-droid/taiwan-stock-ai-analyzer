"""
push_morning_digest.py — 把 AI 主播風格 morning_digest.json 推到 Discord (v11.12 #1)

時段：morning(7:00) / midday(10:00) / afternoon(14:30) / evening(18:00)
每次 morning_digest.json 由 ai_analyzer.py 重新生成後跑一次
推到 #🌍-總經情報 頻道

避免重複推：以 timestamp 做指紋，cache 到 data/_pushed_digest.json
"""
from __future__ import annotations

import os
import sys
import json
from datetime import datetime
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

DIGEST_PATH = "data/morning_digest.json"
STATE_PATH = "data/_pushed_digest.json"


def main():
    print(f"=== Push Morning Digest — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    if _nd is None or not _nd.NOTIFY_UID:
        print("  Discord 未設定，skip", flush=True)
        return
    if not os.path.exists(DIGEST_PATH):
        print(f"  ⚠️ {DIGEST_PATH} 不存在", flush=True)
        return
    try:
        with open(DIGEST_PATH, 'r', encoding='utf-8') as f:
            digest = json.load(f)
    except Exception as e:
        print(f"  ❌ 讀 {DIGEST_PATH} 失敗: {e}", flush=True)
        return

    if digest.get('status') != 'success':
        print(f"  ⚠️ digest status={digest.get('status')}, skip", flush=True)
        return

    # v11.13.4：fingerprint 改用 「session + 日期」（不用 timestamp）
    # 因為 ai_analyzer 每次重跑都更新 timestamp，會造成同個時段重複推送
    # 改成同一個 session 一天只推一次
    digest_ts = digest.get('timestamp', '')
    digest_session = digest.get('session', '')
    digest_date = digest_ts[:10] if digest_ts else NOW.strftime('%Y-%m-%d')
    fingerprint = f"{digest_session}|{digest_date}"

    # 讀已推過的清單（state 用 dict 記每個 session 的推送日，方便 debug）
    state = {}
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, 'r', encoding='utf-8') as f:
                state = json.load(f)
        except Exception:
            pass

    pushed_today = state.get('pushed', {})  # {session: date}
    force = os.environ.get('FORCE_MORNING_DIGEST', '').strip() in ('1', 'true', 'yes')
    if not force and pushed_today.get(digest_session) == digest_date:
        print(f"  ℹ️ {digest_session} 今天 ({digest_date}) 已推過，skip", flush=True)
        return
    if force:
        print(f"  🧪 FORCE_MORNING_DIGEST=1，強制跑（測試模式）", flush=True)

    # 推送
    try:
        ok = _nd.card_morning_digest(digest)
        print(f"  📲 Discord push: {ok}", flush=True)
        if ok:
            # v11.13.4：state 結構改成 {pushed: {session: date}}
            pushed_today[digest_session] = digest_date
            state['pushed'] = pushed_today
            state['last_pushed'] = fingerprint   # 保留舊欄位給 debug
            state['pushed_at'] = NOW.strftime('%Y-%m-%d %H:%M:%S')
            os.makedirs("data", exist_ok=True)
            with open(STATE_PATH, 'w', encoding='utf-8') as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"  ❌ push failed: {e}", flush=True)


if __name__ == "__main__":
    main()
