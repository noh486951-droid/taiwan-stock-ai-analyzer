import os
import json
from google import genai
from google.genai import types
from datetime import datetime
import pytz

# Setup Timezone
tw_tz = pytz.timezone('Asia/Taipei')
current_time = datetime.now(tw_tz)

# Configure Gemini API
GEMINI_API_KEY = os.environ.get("GOOGLE_API_KEY")
MODEL_NAME = 'gemini-3-flash'


def get_client():
    if not GEMINI_API_KEY:
        return None
    return genai.Client(api_key=GEMINI_API_KEY)


# ============================================================
# 1. 整體盤勢分析
# ============================================================

def analyze_market(client, data):
    """使用 Gemini 分析整體盤勢"""
    print("Initiating market AI analysis...")
    if not client:
        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "summary": "AI API Key not configured.",
            "observations": [],
            "verdict": "Neutral",
            "confidence": 0,
            "reasons": [],
            "scores": {"chip": 0, "technical": 0, "sentiment": 0, "macro": 0},
        }

    # 計算 SOX + TSMC ADR 連動指標
    market = data.get("market", {})
    sox_adr_linkage = {}
    sox = market.get("SOX", {})
    tsmc_tw = market.get("TSMC", {})
    tsmc_adr = market.get("TSMC_ADR", {})
    if sox.get("change_pct") is not None and tsmc_tw.get("change_pct") is not None:
        sox_change = sox["change_pct"]
        tsmc_tw_change = tsmc_tw["change_pct"]
        tsmc_adr_change = tsmc_adr.get("change_pct", 0)

        # 背離檢測
        divergence = ""
        if sox_change > 1.0 and tsmc_tw_change < -0.5:
            divergence = "費半漲但台積電跌，背離警告"
        elif sox_change < -1.0 and tsmc_tw_change > 0.5:
            divergence = "費半跌但台積電漲，抗跌或補跌風險"
        elif abs(sox_change) > 2.0:
            divergence = f"費半大幅波動 {sox_change}%，台股半導體族群注意"

        # ADR 溢折價
        adr_premium = 0
        if tsmc_tw.get("price") and tsmc_adr.get("price"):
            usd_twd = market.get("USD/TWD", {}).get("price", 32)
            adr_in_twd = tsmc_adr["price"] * usd_twd / 5  # 1 ADR = 5 台股
            adr_premium = round((adr_in_twd - tsmc_tw["price"]) / tsmc_tw["price"] * 100, 2)

        sox_adr_linkage = {
            "sox_change": sox_change,
            "tsmc_tw_change": tsmc_tw_change,
            "tsmc_adr_change": tsmc_adr_change,
            "adr_premium_pct": adr_premium,
            "divergence": divergence,
        }

    market_context = {
        "market": market,
        "chips": data.get("chips", {}),
        "margin": data.get("margin", {}),
        "breadth": data.get("breadth", {}),
        "futures": data.get("futures", {}),
        "pcr": data.get("pcr", {}),
        "sox_adr_linkage": sox_adr_linkage,
        "news": [n.get("title", "") for n in data.get("news", [])],
    }

    prompt = f"""
    你是一位專精台灣股市的資深金融分析師，具備籌碼分析、技術分析、消息面判讀的能力。
    請根據以下市場數據，提供結構化的分析報告。

    數據：
    {json.dumps(market_context, ensure_ascii=False, indent=2)}

    請用 JSON 格式回覆，嚴格遵守以下結構：
    {{
        "verdict": "Bullish" | "Bearish" | "Neutral",
        "confidence": 0-100 的整數，代表你對此研判的信心程度,
        "summary": "150 字內的整體市場脈動摘要（繁體中文）",
        "reasons": [
            {{
                "type": "chip" | "technical" | "sentiment" | "macro",
                "text": "具體理由（繁體中文）",
                "weight": 0.0-1.0 的浮點數，代表此理由對研判的重要性
            }}
        ],
        "scores": {{
            "chip": -3 到 +3 的整數，籌碼面分數（正=偏多，負=偏空）,
            "technical": -3 到 +3 的整數，技術面分數,
            "sentiment": -3 到 +3 的整數，消息面/情緒面分數,
            "macro": -3 到 +3 的整數，總體經濟/國際面分數
        }},
        "observations": ["5 條具體觀察與建議（繁體中文）"]
    }}

    注意：
    - reasons 至少 4 條，涵蓋 chip/technical/sentiment/macro 各面向
    - confidence 要反映資料完整度與市場不確定性
    - scores 的各維度要與 reasons 中的分析一致
    """

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.5,
            ),
        )
        result = json.loads(response.text)
        result["status"] = "success"
        result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
        return result
    except Exception as e:
        print(f"Error during market analysis: {e}")
        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "summary": f"分析失敗：{str(e)}",
            "observations": [],
        }


# ============================================================
# 2. 晨間 AI 財經快報 (5-10 分鐘閱讀量)
# ============================================================

def generate_morning_digest(client, data):
    """產生晨間 AI 財經快報，約 5-10 分鐘閱讀量"""
    print("Generating morning digest...")
    if not client:
        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "content": "AI API Key 未設定。",
        }

    # 準備完整資料
    market = data.get("market", {})
    chips = data.get("chips", {})
    news = data.get("news", [])
    watchlist = data.get("watchlist", {})

    # 自選股摘要
    watchlist_summary = {}
    for sym, info in watchlist.items():
        if "error" not in info:
            watchlist_summary[sym] = {
                "name": info.get("name", sym),
                "price": info.get("price"),
                "change_pct": info.get("change_pct"),
                "volume": info.get("volume"),
                "RSI": info.get("technical", {}).get("RSI"),
                "PE": info.get("fundamental", {}).get("PE"),
            }

    context = {
        "market_indices": market,
        "institutional_chips": chips,
        "margin_trading": data.get("margin", {}),
        "market_breadth": data.get("breadth", {}),
        "futures_oi": data.get("futures", {}),
        "put_call_ratio": data.get("pcr", {}),
        "news_headlines": [n.get("title", "") for n in news],
        "watchlist_stocks": watchlist_summary,
        "current_date": current_time.strftime('%Y年%m月%d日 %A'),
    }

    prompt = f"""
    你是「台股早安」節目的王牌主播，每天早上 8 點為散戶投資人錄製一段約 5-10 分鐘的晨間財經快報。
    你的風格是專業但口語化，會用生動的比喻讓複雜的金融概念變得好懂。

    請根據以下完整資料，撰寫今日的晨間快報。

    資料：
    {json.dumps(context, ensure_ascii=False, indent=2)}

    請用 JSON 格式回覆，包含以下 key：

    - "title": string (今日快報標題，吸引人的，像新聞標題，���體中文)
    - "greeting": string (開場白，1-2 句，像主播開場)
    - "sections": list of objects，每個 object 包含：
        - "heading": string (段落標題)
        - "body": string (段落內容，每段 100-200 字)
    要求的段落（按順序）：
        1. 國際局勢快覽 - 美股三大指數表現、VIX、匯率、重大國際事件對台股的影響
        2. 台股盤勢重點 - 加權指數、成交量、三大法人動向、今日多空研判
        3. 熱門族群與個股 - 根據新聞和數據，哪些產業/個股值得關注、為什麼
        4. 自選股體檢 - 逐檔分析追蹤中的自選股（價格、漲跌、技術面狀態、需要注意什麼）
        5. 今日操作建議 - 整體建議、風險提醒、關鍵價位提示
    - "risk_alerts": list of strings (今日風險警示，1-3 條)
    - "closing": string (結語，像主播收尾，鼓勵投資人)
    """

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.7,
            ),
        )
        result = json.loads(response.text)
        result["status"] = "success"
        result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
        return result
    except Exception as e:
        print(f"Error generating morning digest: {e}")
        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "content": f"晨間快報產生失敗：{str(e)}",
        }


# ============================================================
# 3. 個股 AI 分析
# ============================================================

def analyze_stock(client, symbol, stock_data, news_titles=None):
    """使用 Gemini 深度分析單一個股"""
    if "error" in stock_data:
        return {"analysis": f"資料抓取失敗：{stock_data['error']}"}

    news_context = ""
    if news_titles:
        news_context = f"""
    今日財經新聞標題（請找出與此股票相關的新聞並在分析中提及）：
    {json.dumps(news_titles, ensure_ascii=False)}
    """

    prompt = f"""
    你是一位專精台灣股市的資深分析師，擁有 20 年的技術分析與產業研究經驗。
    請根據以下個股的完整資料，提供結構化的深度分析報告。

    股票：{stock_data.get('name', symbol)} ({symbol})
    目前價格：{stock_data.get('price')}
    漲跌幅：{stock_data.get('change_pct')}%
    成交量：{stock_data.get('volume')}

    技術指標：
    {json.dumps(stock_data.get('technical', {}), ensure_ascii=False, indent=2)}

    基本面：
    {json.dumps(stock_data.get('fundamental', {}), ensure_ascii=False, indent=2)}

    籌碼集中度：
    {json.dumps(stock_data.get('chip_concentration', {}), ensure_ascii=False, indent=2)}
    {news_context}

    請用 JSON 格式回覆，嚴格遵守以下結構：
    {{
        "verdict": "Bullish" | "Bearish" | "Neutral",
        "confidence": 0-100 的整數,
        "trend": "偏多" | "偏空" | "盤整",
        "support": "支撐價位區間",
        "resistance": "壓力價位區間",
        "risk_level": "低" | "中" | "高",
        "industry_pe_avg": 該產業合理平均本益比（數字）,
        "reasons": [
            {{
                "type": "chip" | "technical" | "sentiment" | "macro",
                "text": "具體理由（繁體中文）",
                "weight": 0.0-1.0
            }}
        ],
        "scores": {{
            "chip": -3 到 +3,
            "technical": -3 到 +3,
            "sentiment": -3 到 +3,
            "macro": -3 到 +3
        }},
        "analysis": "200-300 字深度分析（繁體中文），涵蓋：技術面均線/RSI/KD/MACD/布林狀態、本益比與產業比較、相關新聞影響、近期催化劑或風險",
        "suggestion": "具體操作建議，含進場價位與停損價位（繁體中文）",
        "highlights": ["3-5 個投資重點提示（繁體中文）"]
    }}

    注意：
    - reasons 至少 3 條，涵蓋不同面向
    - confidence 反映分析資料的完整度
    - scores 各維度要與 reasons 分析一致
    """

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.4,
            ),
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"  Error analyzing {symbol}: {e}")
        return {"analysis": f"分析失敗：{str(e)}"}


def analyze_watchlist(client, data):
    """分析所有自選股"""
    watchlist = data.get("watchlist", {})
    if not watchlist:
        print("No watchlist stocks to analyze.")
        return {}

    if not client:
        return {
            symbol: {**sdata, "ai_analysis": {"analysis": "AI API Key 未設定"}}
            for symbol, sdata in watchlist.items()
        }

    # 取得新聞標題供個股分析參考
    news_titles = [n.get("title", "") for n in data.get("news", [])]

    results = {}
    for symbol, stock_data in watchlist.items():
        print(f"  AI analyzing: {symbol}")
        ai_result = analyze_stock(client, symbol, stock_data, news_titles)
        results[symbol] = {
            **stock_data,
            "ai_analysis": ai_result,
        }
    return results


def generate_sector_map(client, data):
    """AI 族群分層地圖 — 產業鏈分析"""
    print("Generating sector map...")
    if not client:
        return {"status": "error", "content": "AI API Key 未設定"}

    market = data.get("market", {})
    news = data.get("news", [])
    watchlist = data.get("watchlist", {})

    # 準備產業相關資訊
    sector_context = {
        "market_indices": {
            "TAIEX": market.get("TAIEX", {}),
            "SOX": market.get("SOX", {}),
        },
        "news_titles": [n.get("title", "") for n in news],
        "watchlist_stocks": {
            sym: {
                "name": info.get("name", sym),
                "price": info.get("price"),
                "change_pct": info.get("change_pct"),
                "PE": info.get("fundamental", {}).get("PE"),
                "volume": info.get("volume"),
            }
            for sym, info in watchlist.items()
            if "error" not in info
        },
    }

    # 載入行事曆事件
    try:
        events_path = "data/events_calendar.json"
        if os.path.exists(events_path):
            with open(events_path, "r", encoding="utf-8") as f:
                events_data = json.load(f)
            # 只取未來 14 天的事件
            today = current_time.strftime('%Y-%m-%d')
            from datetime import timedelta
            future_date = (current_time + timedelta(days=14)).strftime('%Y-%m-%d')
            upcoming = [
                e for e in events_data.get("events", [])
                if today <= e.get("date", "") <= future_date
            ]
            sector_context["upcoming_events"] = upcoming
    except Exception as e:
        print(f"  Error loading events calendar: {e}")

    prompt = f"""
    你是一位台灣股市產業分析專家，擁有深厚的台灣產業鏈知識。
    請根據以下資料，產出一份台股族群分層地圖分析。

    資料：
    {json.dumps(sector_context, ensure_ascii=False, indent=2)}

    請用 JSON 格式回覆，嚴格遵守以下結構：
    {{
        "timestamp": "分析時間",
        "market_theme": "今日市場主題（一句話）",
        "sectors": [
            {{
                "name": "族群名稱（如：半導體、金融、航運...）",
                "trend": "強勢" | "中性" | "弱勢",
                "heat": 1-5 的整數（5=最熱門）,
                "key_stocks": ["代表性個股代碼"],
                "catalyst": "近期催化劑或利空（繁體中文）",
                "outlook": "短期展望一句話（繁體中文）"
            }}
        ],
        "supply_chain": [
            {{
                "chain_name": "產業鏈名稱（如：AI 供應鏈、蘋果供應鏈...）",
                "upstream": ["上游廠商代碼或名稱"],
                "midstream": ["中游廠商"],
                "downstream": ["下游廠商"],
                "status": "受惠" | "受壓" | "觀望",
                "reason": "原因（繁體中文）"
            }}
        ],
        "rotation_signal": "資金輪動方向描述（繁體中文，50字內）",
        "upcoming_catalysts": [
            {{
                "date": "日期",
                "event": "事件名稱",
                "affected_sectors": ["受影響族群"],
                "expected_impact": "預期影響（繁體中文）"
            }}
        ]
    }}

    注意：
    - sectors 至少包含 6 個主要族群
    - 每個族群的 heat 要反映當前市場熱度
    - supply_chain 至少 2 條重要產業鏈
    - 如有 upcoming_events，請整合到 upcoming_catalysts 中
    """

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.5,
            ),
        )
        result = json.loads(response.text)
        result["status"] = "success"
        result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
        return result
    except Exception as e:
        print(f"Error generating sector map: {e}")
        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "content": f"族群分析產生失敗：{str(e)}",
        }


# ============================================================
# 主程式
# ============================================================

def main():
    print(f"[{current_time.strftime('%Y-%m-%d %H:%M:%S')}] Starting AI Analysis...")

    # 1. Load raw data
    try:
        with open("data/raw_data.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Error: data/raw_data.json not found. Please run fetch_all.py first.")
        return

    client = get_client()

    # 2. 整體盤勢分析
    market_result = analyze_market(client, data)

    # 3. 自選股分析
    watchlist_result = analyze_watchlist(client, data)

    # 4. 晨間 AI 快報
    digest_result = generate_morning_digest(client, data)

    # 5. AI 族群分層地圖
    sector_map = generate_sector_map(client, data)

    # 5. 輸出 market_pulse.json
    os.makedirs("data", exist_ok=True)

    final_output = {
        "timestamp": market_result["timestamp"],
        "market": data.get("market", {}),
        "chips": data.get("chips", {}),
        "margin": data.get("margin", {}),
        "breadth": data.get("breadth", {}),
        "futures": data.get("futures", {}),
        "pcr": data.get("pcr", {}),
        "news": data.get("news", []),
        "alerts": data.get("alerts", []),
        "ai_analysis": market_result,
    }
    with open("data/market_pulse.json", "w", encoding="utf-8") as f:
        json.dump(final_output, f, ensure_ascii=False, indent=2)

    # 6. 輸出 watchlist_analysis.json
    if watchlist_result:
        watchlist_output = {
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "stocks": watchlist_result,
        }
        with open("data/watchlist_analysis.json", "w", encoding="utf-8") as f:
            json.dump(watchlist_output, f, ensure_ascii=False, indent=2)
        print(f"Watchlist analysis completed. {len(watchlist_result)} stocks analyzed.")

    # 7. 輸出 morning_digest.json
    with open("data/morning_digest.json", "w", encoding="utf-8") as f:
        json.dump(digest_result, f, ensure_ascii=False, indent=2)
    print("Morning digest generated.")

    # 8. 輸出 sector_map.json
    with open("data/sector_map.json", "w", encoding="utf-8") as f:
        json.dump(sector_map, f, ensure_ascii=False, indent=2)
    print("Sector map generated.")

    print("AI Analysis completed.")


if __name__ == "__main__":
    main()
