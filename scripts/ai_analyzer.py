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
# Assuming GOOGLE_API_KEY is safely stored in GitHub Secrets or environment
GEMINI_API_KEY = os.environ.get("GOOGLE_API_KEY")
MODEL_NAME = 'gemini-2.5-flash-lite' # Latest available fast model

def analyze_market(data):
    """Analyzes market data using Gemini."""
    print("Initiating AI Analysis...")
    if not GEMINI_API_KEY:
        print("Warning: GOOGLE_API_KEY not found. Skipping real AI analysis.")
        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "summary": "AI API Key not configured.",
            "recommendations": []
        }
        
    client = genai.Client(api_key=GEMINI_API_KEY)
    
    prompt = f"""
    You are an expert financial analyst in the Taiwan Stock Market. 
    Analyze the following market data, institutional data, and financial news, and provide:
    1. A short summary of the current market pulse.
    2. Sentiment analysis (Bullish, Bearish, or Neutral) and why.
    3. 3 actionable observations for retail investors.
    
    Data:
    {json.dumps(data, ensure_ascii=False, indent=2)}
    
    Please return your response in JSON format with the following keys:
    - "summary": string (overall short summary in Traditional Chinese)
    - "sentiment": string (Bullish, Bearish, or Neutral)
    - "observations": list of strings (actionable observations in Traditional Chinese)
    """
    
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.5
            )
        )
        result = json.loads(response.text)
        result["status"] = "success"
        result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
        return result
    except Exception as e:
        print(f"Error during AI analysis: {e}")
        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "summary": f"Analysis failed: {str(e)}",
            "recommendations": []
        }

def main():
    print(f"[{current_time.strftime('%Y-%m-%d %H:%M:%S')}] Starting AI Analysis...")
    
    # 1. Load data/raw_data.json
    try:
        with open("data/raw_data.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Error: data/raw_data.json not found. Please run fetch_all.py first.")
        return
        
    # 2. Run analysis
    result = analyze_market(data)
    
    # Merge with original data for front-end
    final_output = {
        "timestamp": result["timestamp"],
        "market": data.get("market", {}),
        "chips": data.get("chips", {}),
        "news": data.get("news", []),
        "ai_analysis": result
    }
    
    # 3. Save to data/market_pulse.json
    os.makedirs("data", exist_ok=True)
    with open("data/market_pulse.json", "w", encoding="utf-8") as f:
        json.dump(final_output, f, ensure_ascii=False, indent=2)
        
    print("AI Analysis completed. Saved to data/market_pulse.json.")

if __name__ == "__main__":
    main()
