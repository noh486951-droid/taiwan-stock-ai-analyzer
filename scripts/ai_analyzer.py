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


def analyze_market(data):
    """使用 Gemini 分析整體盤勢 (含國際市場)"""
    print("Initiating market AI analysis...")
    if not GEMINI_API_KEY:
        print("Warning: GOOGLE_API_KEY not found. Skipping real AI analysis.")
        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "summary": "AI API Key not configured.",
            "observations": [],
        }

    client = genai.Client(api_key=GEMINI_API_KEY)

    # 準備市場摘要資料 (排除 watchlist 以減少 token)
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

    請用 JSON 格式回覆，包含以下 key：
    - "summary": string (整體摘要，繁體中文)
    - "sentiment": string (Bullish / Bearish / Neutral)
    - "observations": list of strings (5 條觀察建議，繁體中文)
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


def analyze_stock(client, symbol, stock_data):
    """使用 Gemini 分析單一個股"""
    if "error" in stock_data:
        return f"資料抓取失敗：{stock_data['error']}"

    prompt = f"""
    你是一位專精台灣股市的資深技術分析師與基本面分析師。
    請根據以下個股的技術指標與基本面資料，提供完整分析。

    股票：{stock_data.get('name', symbol)} ({symbol})
    目前價格：{stock_data.get('price')}
    漲跌幅：{stock_data.get('change_pct')}%
    成交量：{stock_data.get('volume')}

    技術指標：
    {json.dumps(stock_data.get('technical', {}), ensure_ascii=False, indent=2)}

    基本面：
    {json.dumps(stock_data.get('fundamental', {}), ensure_ascii=False, indent=2)}

    請用 JSON 格式回覆，包含以下 key：
    - "trend": string (短線趨勢：偏多 / 偏空 / 盤整)
    - "support": string (支撐價位區間)
    - "resistance": string (壓力價位區間)
    - "analysis": string (100 字內的綜合分析，繁體中文)
    - "suggestion": string (操作建議，繁體中文)
    - "risk_level": string (風險等級：低 / 中 / 高)
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


def analyze_watchlist(data):
    """分析所有自選股"""
    watchlist = data.get("watchlist", {})
    if not watchlist:
        print("No watchlist stocks to analyze.")
        return {}

    if not GEMINI_API_KEY:
        print("Warning: GOOGLE_API_KEY not found. Skipping watchlist analysis.")
        return {
            symbol: {"analysis": "AI API Key 未設定"}
            for symbol in watchlist
        }

    client = genai.Client(api_key=GEMINI_API_KEY)
    results = {}

    for symbol, stock_data in watchlist.items():
        print(f"  AI analyzing: {symbol}")
        ai_result = analyze_stock(client, symbol, stock_data)
        results[symbol] = {
            **stock_data,
            "ai_analysis": ai_result,
        }

    return results


def main():
    print(f"[{current_time.strftime('%Y-%m-%d %H:%M:%S')}] Starting AI Analysis...")

    # 1. Load raw data
    try:
        with open("data/raw_data.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Error: data/raw_data.json not found. Please run fetch_all.py first.")
        return

    # 2. 整體盤勢分析
    market_result = analyze_market(data)

    # 3. 自選股分析
    watchlist_result = analyze_watchlist(data)

    # 4. 合併輸出 market_pulse.json
    final_output = {
        "timestamp": market_result["timestamp"],
        "market": data.get("market", {}),
        "chips": data.get("chips", {}),
        "news": data.get("news", []),
        "ai_analysis": market_result,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/market_pulse.json", "w", encoding="utf-8") as f:
        json.dump(final_output, f, ensure_ascii=False, indent=2)

    # 5. 自選股分析結果
    if watchlist_result:
        watchlist_output = {
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "stocks": watchlist_result,
        }
        with open("data/watchlist_analysis.json", "w", encoding="utf-8") as f:
            json.dump(watchlist_output, f, ensure_ascii=False, indent=2)
        print(f"Watchlist analysis completed. {len(watchlist_result)} stocks analyzed.")

    print("AI Analysis completed.")


if __name__ == "__main__":
    main()
