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
MODEL_NAME = 'gemini-2.5-flash-lite'


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
        }

    market_context = {
        "market": data.get("market", {}),
        "chips": data.get("chips", {}),
        "news": [n.get("title", "") for n in data.get("news", [])],
    }

    prompt = f"""
    你是一位專精台灣股市的資深金融分析師。
    請根據以下市場數據、三大法人籌碼、國際指數與財經新聞，提供分析：

    1. 整體市場脈動摘要 (繁體中文，150 字內)
    2. 多空研判 (Bullish / Bearish / Neutral) 及理由
    3. 5 條給散戶投資人的具體觀察與建議 (繁體中文)

    數據：
    {json.dumps(market_context, ensure_ascii=False, indent=2)}

    請用 JSON 格式回覆：
    - "summary": string
    - "sentiment": string (Bullish / Bearish / Neutral)
    - "observations": list of strings (5 條)
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
    請根據以下個股的完整資料，提供深度分析報告。

    股票：{stock_data.get('name', symbol)} ({symbol})
    目前價格：{stock_data.get('price')}
    漲跌幅：{stock_data.get('change_pct')}%
    成交量：{stock_data.get('volume')}

    技術指標：
    {json.dumps(stock_data.get('technical', {}), ensure_ascii=False, indent=2)}

    基本面：
    {json.dumps(stock_data.get('fundamental', {}), ensure_ascii=False, indent=2)}
    {news_context}

    請用 JSON 格式回覆，包含以下 key：
    - "trend": string (短線趨勢：偏多 / 偏空 / 盤整)
    - "support": string (支撐價位區間)
    - "resistance": string (壓力價位區間)
    - "risk_level": string (風險等級：低 / 中 / 高)
    - "industry_pe_avg": number (該股票所屬產業的合理平均本益比，根據你的專業判斷)
    - "analysis": string (200-300 字的深度綜合分析，繁體中文，必須包含：
        1. 技術面完整描述 - 均線排列狀態、RSI/KD 是否超買超賣、MACD 動能方向、布林通道位置
        2. 本益比與該產業平均值比較 - 目前估值偏貴還是便宜
        3. 與新聞的關聯 - 如果有相關新聞，說明可能的影響
        4. 近期可能的催化劑或風險 - 例如法說會、除息日、產業趨勢變化等)
    - "suggestion": string (具體的操作建議，包含建議進場價位、停損價位，繁體中文)
    - "highlights": list of strings (3-5 個投資重點提示，每條簡短精準，繁體中文，例如：
        "本益比 30 高於半導體產業平均 22，估值偏貴"
        "KD 值 89 進入超買區，短線拉回風險增加"
        "4/17 法說會在即，市場關注下季展望"
        "殖利率 1.2% 偏低，非存股首選")
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

    # 5. 輸出 market_pulse.json
    os.makedirs("data", exist_ok=True)

    final_output = {
        "timestamp": market_result["timestamp"],
        "market": data.get("market", {}),
        "chips": data.get("chips", {}),
        "news": data.get("news", []),
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

    print("AI Analysis completed.")


if __name__ == "__main__":
    main()
