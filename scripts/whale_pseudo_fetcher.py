"""whale_pseudo_fetcher.py — Pseudo Whale 主力資金追蹤（T86 daily 替代 TDCC）

當 TDCC opendata 服務不穩時，用 TWSE T86 三大法人日資料推估鯨魚動向。
本質不同：TDCC 看「千張持股 %」(靜態股權)，T86 看「法人買賣超」(動態資金流)
實務上：主力進場 → 千張上升，所以兩者高度相關

輸出：data/whale_candidates.json (同 TDCC fetcher 一致 schema)
  source: "pseudo_t86"  ← 標記資料源

執行：每天 EOD 跑（在 fetch_all 後、tdcc_holders_fetcher 前）

數據累積：data/inst_history_full.json (全市場 T86 history，最近 10 天)
- 第一次跑：累積 1 天就先有粗略訊號
- 累積 5+ 天後：完整 5 日累計 + 連續日數
"""
from __future__ import annotations
import os
import sys
import json
from datetime import datetime, timedelta
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import requests

TW = pytz.timezone('Asia/Taipei')
NOW = datetime.now(TW)
TODAY = NOW.strftime('%Y%m%d')

HISTORY_FULL_PATH = 'data/inst_history_full.json'
WHALE_OUT_PATH = 'data/whale_candidates.json'
KEEP_DAYS = 10


def _parse_int(s):
    try:
        return int(str(s).replace(',', '').replace(' ', ''))
    except Exception:
        return 0


def _fetch_t86_today() -> dict:
    """抓 T86 全市場三大法人 — 回最新可用日期的資料"""
    print(f"  📡 T86 全市場下載…", flush=True)
    dates_to_try = [(NOW - timedelta(days=i)).strftime('%Y%m%d') for i in range(0, 8)]
    for try_date in dates_to_try:
        try:
            url = f"https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date={try_date}&selectType=ALL"
            res = requests.get(url, timeout=30, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            })
            data = res.json()
            if data.get('stat') == 'OK' and data.get('data'):
                stocks = {}
                for row in data['data']:
                    if len(row) < 19:
                        continue
                    code = str(row[0]).strip()
                    if not (code.isdigit() and len(code) == 4):
                        continue
                    name = str(row[1]).strip()
                    foreign_net = _parse_int(row[4]) + _parse_int(row[7])
                    trust_net = _parse_int(row[10])
                    dealer_net = _parse_int(row[11])
                    stocks[code] = {
                        'name': name,
                        'foreign': foreign_net,
                        'trust': trust_net,
                        'dealer': dealer_net,
                    }
                print(f"  ✅ T86 抓到 {len(stocks)} 檔（日期 {try_date}）", flush=True)
                return {'date': try_date, 'stocks': stocks}
        except Exception as e:
            print(f"  ⚠️ T86 {try_date} fail: {e}", flush=True)
    return {}


def _load_history():
    if os.path.exists(HISTORY_FULL_PATH):
        try:
            with open(HISTORY_FULL_PATH, 'r', encoding='utf-8') as f:
                return json.load(f) or {'days': []}
        except Exception as e:
            print(f"  ⚠️ load history fail: {e}", flush=True)
    return {'days': []}


def _save_history(h):
    os.makedirs(os.path.dirname(HISTORY_FULL_PATH), exist_ok=True)
    with open(HISTORY_FULL_PATH, 'w', encoding='utf-8') as f:
        json.dump(h, f, ensure_ascii=False)


def _compute_pseudo_whales(history: dict, top_n: int = 20) -> list:
    """從 history.days 計算 pseudo whale signals

    分數 = (外資 + 投信 5日累計) × streak因子 − 散戶推估反向阻力
         主力分     × 持續性     − 籌碼換手抗性
    """
    days = history.get('days') or []
    if len(days) == 0:
        return []

    # 取最近 5 天累計
    last5 = days[-5:]
    last3 = days[-3:]

    # 累積 net flow per stock
    cum5: dict[str, dict] = {}  # code → {name, foreign5, trust5, dealer5}
    for day in last5:
        for code, s in (day.get('stocks') or {}).items():
            if code not in cum5:
                cum5[code] = {'name': s.get('name', ''), 'foreign5': 0, 'trust5': 0, 'dealer5': 0,
                              'days': 0, 'foreign_streak': 0, 'trust_streak': 0}
            cum5[code]['foreign5'] += s.get('foreign', 0)
            cum5[code]['trust5'] += s.get('trust', 0)
            cum5[code]['dealer5'] += s.get('dealer', 0)
            cum5[code]['days'] += 1

    # 連續日數（從最近往前算）
    for day in reversed(days):
        for code, c in cum5.items():
            sd = (day.get('stocks') or {}).get(code)
            if not sd:
                continue
            f, t = sd.get('foreign', 0), sd.get('trust', 0)
            # 外資 streak
            if c['foreign_streak'] >= 0:
                if f > 0:
                    c['foreign_streak'] += 1
                else:
                    c['foreign_streak'] = -abs(c['foreign_streak'])  # 鎖定
            elif f < 0:
                c['foreign_streak'] -= 1
            # 投信 streak
            if c['trust_streak'] >= 0:
                if t > 0:
                    c['trust_streak'] += 1
                else:
                    c['trust_streak'] = -abs(c['trust_streak'])
            elif t < 0:
                c['trust_streak'] -= 1

    # 算分數 + 排序
    candidates = []
    for code, c in cum5.items():
        if c['days'] < 1:
            continue
        # 主力 5 日合計（張）
        smart_lots = round((c['foreign5'] + c['trust5']) / 1000)
        retail_lots = round(-(c['foreign5'] + c['trust5'] + c['dealer5']) / 1000)
        # 過濾雜訊：主力 5 日 < 500 張 (or < 200 if days<3) 直接跳
        threshold = 500 if c['days'] >= 5 else 200
        if smart_lots < threshold:
            continue
        # 連續日數因子（連續買越久越強）
        streak_factor = 1.0
        if c['foreign_streak'] >= 3:
            streak_factor += 0.3
        if c['trust_streak'] >= 3:
            streak_factor += 0.2
        if c['foreign_streak'] >= 5:
            streak_factor += 0.2
        # 分數
        whale_score = round(smart_lots * streak_factor - max(0, retail_lots) * 0.3, 1)

        # 三級訊號
        if c['foreign_streak'] >= 3 and c['trust_streak'] >= 1:
            signal, label = 'strong_smart_money', '🐳 主力強吸'
        elif c['foreign_streak'] >= 3:
            signal, label = 'foreign_accumulation', '🐟 外資加碼'
        elif smart_lots >= 2000:
            signal, label = 'big_smart_money', '💪 法人重押'
        else:
            signal, label = 'mild_accumulation', '🟢 主力進場'

        candidates.append({
            'sym': f"{code}.TW",
            'code': code,
            'name': c['name'],
            'signal': signal,
            'label': label,
            'whale_score': whale_score,
            'foreign_5d_lots': round(c['foreign5'] / 1000),
            'trust_5d_lots': round(c['trust5'] / 1000),
            'dealer_5d_lots': round(c['dealer5'] / 1000),
            'smart_money_5d_lots': smart_lots,
            'retail_estimate_5d_lots': retail_lots,
            'foreign_streak': c['foreign_streak'],
            'trust_streak': c['trust_streak'],
            'days_available': c['days'],
        })

    candidates.sort(key=lambda x: x['whale_score'], reverse=True)
    return candidates[:top_n]


def main():
    print(f"[{NOW.strftime('%H:%M:%S')}] whale_pseudo_fetcher start", flush=True)

    today = _fetch_t86_today()
    if not today.get('stocks'):
        print("  ❌ T86 沒抓到，跳過 (用上次 history)", flush=True)
        history = _load_history()
    else:
        history = _load_history()
        # 移除同日重複，再 append
        history['days'] = [d for d in history['days'] if d.get('date') != today['date']]
        history['days'].append(today)
        # 保留最近 N 天
        history['days'] = history['days'][-KEEP_DAYS:]
        _save_history(history)
        print(f"  📊 history 累積 {len(history['days'])} 天 → {HISTORY_FULL_PATH}", flush=True)

    candidates = _compute_pseudo_whales(history, top_n=20)
    if not candidates:
        print("  ℹ️ 目前沒有 pseudo whale 訊號（資料不足或市場無明顯主力動作）", flush=True)

    # 若 TDCC 已寫入過 whale_candidates 且 source 是 tdcc，今天又抓到資料 → 別覆寫
    # 但我們希望：TDCC 抓到時優先（tdcc_holders_fetcher 在後面跑覆寫），抓不到時用我們的 pseudo
    payload = {
        'fetched_at': NOW.strftime('%Y-%m-%d %H:%M:%S'),
        'as_of_date': history['days'][-1].get('date', TODAY) if history.get('days') else TODAY,
        'source': 'pseudo_t86',
        'note': '基於 TWSE T86 三大法人日資料推估，當 TDCC opendata 不穩時的替代訊號。'
                '指標含意：外資+投信 5 日合計買超 (張)、連續日數、散戶推估反向阻力。',
        'top': candidates,
    }
    os.makedirs(os.path.dirname(WHALE_OUT_PATH), exist_ok=True)
    with open(WHALE_OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"  🐳 寫入 {len(candidates)} 隻 pseudo whales → {WHALE_OUT_PATH}", flush=True)
    for w in candidates[:5]:
        print(f"    {w['label']} {w['sym']} {w['name']} "
              f"主力5日 {w['smart_money_5d_lots']:+,}張 (外{w['foreign_streak']:+d}日,投{w['trust_streak']:+d}日) "
              f"score={w['whale_score']}", flush=True)


if __name__ == '__main__':
    main()
