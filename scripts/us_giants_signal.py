"""
us_giants_signal.py — 美股龍頭 vs 台股供應鏈 隔夜訊號（v11.5）

讀 raw_data.json 的 market_data（已含 NVDA / AAPL / TSLA / AVGO / META / AMD / MU / GOOGL / MSFT
+ TSMC_ADR + SOX 等），對映台股供應鏈，產生：
  data/us_giants_signal.json
  {
    "updated_at": "...",
    "giants": [{ name, change_pct, severity, ... }, ...],
    "supply_chain_alerts": [
       { "us": "NVDA", "us_change_pct": -5.2,
         "tw_targets": [{symbol, name, role, expected_impact}],
         "severity": "high" }
    ],
    "summary": "..."
  }

severity 規則：
  |change_pct| >= 5   → high
  |change_pct| >= 3   → medium
  |change_pct| >= 1.5 → low
  其餘忽略
"""
from __future__ import annotations

import os
import json
import sys
from datetime import datetime
import pytz

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

TW_TZ = pytz.timezone("Asia/Taipei")
NOW = datetime.now(TW_TZ)

OUT_PATH = "data/us_giants_signal.json"
RAW_PATH = "data/raw_data.json"

# 美股龍頭 → 台股供應鏈對映
# role：客戶 / 競爭 / 同概念 / 代工 / 上游
SUPPLY_CHAIN = {
    "NVDA": [
        ("2330.TW", "台積電", "代工",   "AI GPU 晶圓代工，最大營收貢獻"),
        ("2317.TW", "鴻海",   "AI 伺服器",  "GB200/HGX 主要組裝廠"),
        ("3017.TW", "奇鋐",   "散熱",    "GPU 板卡與機殼散熱方案"),
        ("3653.TW", "健策",   "散熱",    "VC 均熱板"),
        ("3596.TW", "智易",   "AI 伺服器",  "Switch / NIC 模組"),
        ("2382.TW", "廣達",   "AI 伺服器",  "GB200 主要 ODM"),
        ("3231.TW", "緯創",   "AI 伺服器",  "NVDA L10/L11 ODM"),
        ("3008.TW", "大立光", "光通訊",  "CPO / 光模組（間接）"),
        ("6669.TW", "緯穎",   "AI 伺服器",  "Hyperscaler ODM"),
    ],
    "AAPL": [
        ("2330.TW", "台積電", "代工",   "A 系列 / M 系列 SoC 獨家代工"),
        ("2317.TW", "鴻海",   "代工",   "iPhone 主要組裝"),
        ("2382.TW", "廣達",   "代工",   "Mac / 部份 iPhone ODM"),
        ("4938.TW", "和碩",   "代工",   "iPhone 第二供應商"),
        ("3008.TW", "大立光", "光學",    "iPhone 鏡頭主力"),
        ("3037.TW", "欣興",   "PCB",    "ABF / SLP 載板"),
        ("2474.TW", "可成",   "機殼",    "iPhone / iPad 機殼"),
        ("2454.TW", "聯發科", "競爭",    "高階 SoC 競爭關係"),
    ],
    "TSLA": [
        ("2308.TW", "台達電", "電源",    "車用充電 / 電源模組"),
        ("2354.TW", "鴻準",   "機構件",  "電池外殼 / 機構件"),
        ("3034.TW", "聯詠",   "車用 IC", "車用顯示驅動"),
        ("2317.TW", "鴻海",   "代工",   "Cybertruck / 4680 電池模組部分供應"),
        ("6446.TW", "藥華藥", "_skip_", ""),  # 過濾掉
        ("1303.TW", "南亞",   "上游",    "電池銅箔基板上游"),
        ("2049.TW", "上銀",   "機械",    "電動車產線設備"),
    ],
    "AVGO": [
        ("2330.TW", "台積電", "代工",   "ASIC / 網通晶片代工"),
        ("3037.TW", "欣興",   "PCB",    "ASIC 載板"),
        ("2382.TW", "廣達",   "AI 伺服器",  "TPU 系列 ODM"),
        ("6669.TW", "緯穎",   "AI 伺服器",  "Hyperscaler ODM"),
    ],
    "META": [
        ("2382.TW", "廣達",   "AI 伺服器",  "Meta MTIA ODM"),
        ("3231.TW", "緯創",   "AI 伺服器",  "Meta 自研晶片伺服器"),
        ("2330.TW", "台積電", "代工",   "Meta 自研 ASIC 代工"),
    ],
    "AMD": [
        ("2330.TW", "台積電", "代工",   "MI300 / EPYC 代工"),
        ("3037.TW", "欣興",   "PCB",    "EPYC ABF 載板"),
        ("2382.TW", "廣達",   "AI 伺服器",  "MI300 ODM"),
    ],
    "MU": [
        ("2408.TW", "南亞科", "競爭",    "DRAM 全球競爭"),
        ("3702.TW", "大聯大", "通路",    "記憶體通路"),
    ],
    "GOOGL": [
        ("2330.TW", "台積電", "代工",   "TPU v5/v6 代工"),
        ("2382.TW", "廣達",   "AI 伺服器",  "GCP / TPU ODM"),
        ("3231.TW", "緯創",   "AI 伺服器",  "GCP ODM"),
    ],
    "MSFT": [
        ("2330.TW", "台積電", "代工",   "Maia / Cobalt ASIC 代工"),
        ("2382.TW", "廣達",   "AI 伺服器",  "Azure ODM"),
        ("6669.TW", "緯穎",   "AI 伺服器",  "Hyperscaler ODM"),
    ],
    "SOX": [
        # SOX 是費半指數，整體半導體訊號
        ("2330.TW", "台積電", "權值",    "費半指數權重股"),
        ("2454.TW", "聯發科", "IC 設計",  "全球前 5 大 fabless"),
        ("2303.TW", "聯電",   "代工",   "8 吋 / 28nm 主力"),
        ("3037.TW", "欣興",   "PCB",    "ABF 載板龍頭"),
        ("3008.TW", "大立光", "光學",    "光學鏡頭"),
        ("2408.TW", "南亞科", "DRAM",   "DRAM 廠商"),
    ],
}


def _severity(change_pct: float) -> str | None:
    a = abs(change_pct or 0)
    if a >= 5:
        return "high"
    if a >= 3:
        return "medium"
    if a >= 1.5:
        return "low"
    return None


def _direction_zh(change_pct: float) -> str:
    return "重挫" if change_pct <= -3 else "下跌" if change_pct < 0 else "大漲" if change_pct >= 3 else "上漲"


def main():
    print(f"=== US Giants Signal — {NOW.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    if not os.path.exists(RAW_PATH):
        print(f"  ⚠️ {RAW_PATH} not found; run fetch_all.py first", flush=True)
        return
    with open(RAW_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    market = raw.get("market_data") or raw.get("market") or {}

    giants_summary = []
    alerts = []
    for us_name, mapping in SUPPLY_CHAIN.items():
        info = market.get(us_name) or {}
        cp = info.get("change_pct")
        if cp is None:
            continue
        sev = _severity(cp)
        giants_summary.append({
            "name": us_name,
            "price": info.get("price"),
            "change_pct": cp,
            "severity": sev,
            "date": info.get("date"),
        })
        if sev is None:
            continue
        # 篩掉 _skip_ 項目
        targets = [
            {"symbol": s, "name": n, "role": role, "note": note}
            for s, n, role, note in mapping if role != "_skip_"
        ]
        alerts.append({
            "us": us_name,
            "us_change_pct": cp,
            "us_direction": _direction_zh(cp),
            "severity": sev,
            "tw_targets": targets,
            "expected_impact": (
                f"⚠️ {us_name} 隔夜{_direction_zh(cp)} {cp:+.2f}%，台股供應鏈開盤可能承壓"
                if cp < 0
                else f"🚀 {us_name} 隔夜{_direction_zh(cp)} {cp:+.2f}%，台股供應鏈開盤受激勵"
            ),
        })

    # 排嚴重度
    sev_rank = {"high": 0, "medium": 1, "low": 2}
    alerts.sort(key=lambda x: (sev_rank.get(x["severity"], 9), -abs(x["us_change_pct"])))

    summary = ""
    if alerts:
        big = [a for a in alerts if a["severity"] in ("high", "medium")]
        if big:
            top = big[0]
            summary = (
                f"昨夜 {top['us']} {top['us_direction']} {top['us_change_pct']:+.2f}%"
                f"（{top['severity']} 級訊號）— 留意 {len(top['tw_targets'])} 檔台股供應鏈開盤反應"
            )
        else:
            summary = f"昨夜 {len(alerts)} 檔美股龍頭出現中等以下波動，台股供應鏈影響有限"
    else:
        summary = "昨夜美股龍頭波動平穩，無顯著供應鏈訊號"

    out = {
        "updated_at": NOW.strftime("%Y-%m-%d %H:%M:%S"),
        "giants": giants_summary,
        "supply_chain_alerts": alerts,
        "summary": summary,
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"  ✅ wrote {OUT_PATH}", flush=True)
    print(f"     {summary}", flush=True)
    for a in alerts[:3]:
        print(f"     - {a['us']} {a['us_change_pct']:+.2f}% [{a['severity']}] → {len(a['tw_targets'])} TW targets", flush=True)


if __name__ == "__main__":
    main()
