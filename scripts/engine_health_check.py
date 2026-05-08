"""
engine_health_check.py — 引擎健康檢查 (v11.11 E)

每次 main.yml 跑時都呼叫一次，檢查：
  - 你個人帳戶 last_engine_status.timestamp 是否在 2 小時內
  - 不在 → 推「🚨 引擎異常」到 Discord HEALTH 頻道
"""
from __future__ import annotations

import os
import sys
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


def main():
    print(f"=== Engine Health Check — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    if _nd is None or not _nd.NOTIFY_UID:
        print("  Discord 未設定，skip", flush=True)
        return
    # 只在交易時段檢查（盤後 / 假日不報警）
    if NOW.weekday() >= 5:
        print("  週末，skip", flush=True)
        return
    if not (9 <= NOW.hour < 14):
        print(f"  非交易時段 {NOW.hour}:xx，skip", flush=True)
        return

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
        data = r.json() or {}
    except Exception as e:
        print(f"  ⚠️ fetch portfolio failed: {e}", flush=True)
        return

    last_run = data.get('engine_updated_at') or ''
    if not last_run:
        print("  尚無 engine_updated_at，skip", flush=True)
        return

    try:
        last_dt = TW_TZ.localize(datetime.strptime(last_run, '%Y-%m-%d %H:%M:%S'))
    except Exception:
        try:
            last_dt = datetime.fromisoformat(last_run)
        except Exception:
            print(f"  無法解析 last_run: {last_run}", flush=True)
            return

    delta = NOW - last_dt
    if delta > timedelta(hours=2):
        print(f"  🚨 引擎已 {delta} 沒更新，推警示", flush=True)
        try:
            _nd.card_engine_alert(
                message=f"⚠️ 引擎已 **{int(delta.total_seconds() / 3600)} 小時**沒更新（可能 GH cron drop / workflow 失敗）",
                last_run=last_run,
            )
        except Exception as e:
            print(f"  ⚠️ alert push failed: {e}", flush=True)
    else:
        print(f"  ✅ 引擎健康（最後 {int(delta.total_seconds() / 60)} 分鐘前更新）", flush=True)


if __name__ == "__main__":
    main()
