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

    digest_ts = digest.get('timestamp', '')
    digest_session = digest.get('session', '')
    fingerprint = f"{digest_session}|{digest_ts}"

    # 讀已推過的清單
    state = {}
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, 'r', encoding='utf-8') as f:
                state = json.load(f)
        except Exception:
            pass
    force = os.environ.get('FORCE_MORNING_DIGEST', '').strip() in ('1', 'true', 'yes')
    if not force and state.get('last_pushed') == fingerprint:
        print(f"  ℹ️ 該 digest 已推過 ({fingerprint})，skip", flush=True)
        return
    if force:
        print(f"  🧪 FORCE_MORNING_DIGEST=1，強制跑（測試模式）", flush=True)

    # 推送
    try:
        ok = _nd.card_morning_digest(digest)
        print(f"  📲 Discord push: {ok}", flush=True)
        if ok:
            state['last_pushed'] = fingerprint
            state['pushed_at'] = NOW.strftime('%Y-%m-%d %H:%M:%S')
            os.makedirs("data", exist_ok=True)
            with open(STATE_PATH, 'w', encoding='utf-8') as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"  ❌ push failed: {e}", flush=True)


if __name__ == "__main__":
    main()
