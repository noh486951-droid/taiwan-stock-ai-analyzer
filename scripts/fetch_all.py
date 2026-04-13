import yfinance as yf
import requests
import feedparser
import json
import os
from datetime import datetime
import pytz

# Setup Timezone
tw_tz = pytz.timezone('Asia/Taipei')
current_time = datetime.now(tw_tz)

def fetch_market_data():
    """Fetches TAIEX, SOX, and TSMC data."""
    print("Fetching market data...")
    symbols = {
        "TAIEX": "^TWII",
        "SOX": "^SOX",
        "TSMC": "2330.TW",
        "USD/TWD": "USDTWD=X"
    }
    market_data = {}
    for name, symbol in symbols.items():
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="5d")
            if not hist.empty:
                last_close = float(hist['Close'].iloc[-1])
                prev_close = float(hist['Close'].iloc[-2]) if len(hist) > 1 else last_close
                change_pct = ((last_close - prev_close) / prev_close) * 100
                market_data[name] = {
                    "price": round(last_close, 2),
                    "change_pct": round(change_pct, 2),
                    "date": hist.index[-1].strftime('%Y-%m-%d')
                }
        except Exception as e:
            print(f"Error fetching {name}: {e}")
            market_data[name] = {"error": str(e)}
    return market_data

def fetch_chip_data():
    """Fetches TWSE institutional investor data."""
    print("Fetching chip data...")
    # Fetching TWSE foreign investor net buy/sell. Using modern TWSE API
    url = "https://www.twse.com.tw/fund/BFI82U?response=json"
    chip_data = {}
    try:
        # Ignore SSL warning
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        
        res = requests.get(url, timeout=10, verify=False)
        data = res.json()
        if data.get("stat") == "OK":
            # Structure: ['單位名稱', '買進金額', '賣出金額', '買賣差額']
            # Only keep the total difference for major institutions
            chip_data["date"] = data.get("date", "")
            chip_data["summary"] = data.get("data", [])
    except Exception as e:
        print(f"Error fetching chip data: {e}")
        chip_data["error"] = str(e)
    return chip_data

def fetch_news():
    """Fetches RSS feeds from major Taiwan financial news."""
    print("Fetching news data...")
    # Yahoo Taiwan Stock RSS
    url = "https://tw.stock.yahoo.com/rss?category=tw-market"
    news_data = []
    try:
        feed = feedparser.parse(url)
        for entry in feed.entries[:10]: # Top 10 news
            news_data.append({
                "title": entry.title,
                "link": entry.link,
                "published": entry.published if hasattr(entry, 'published') else ""
            })
    except Exception as e:
        print(f"Error fetching news: {e}")
    return news_data

def main():
    print(f"[{current_time.strftime('%Y-%m-%d %H:%M:%S')}] Starting data fetch...")
    
    market_data = fetch_market_data()
    chip_data = fetch_chip_data()
    news_data = fetch_news()
    
    output = {
        "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
        "market": market_data,
        "chips": chip_data,
        "news": news_data
    }
    
    os.makedirs("data", exist_ok=True)
    with open("data/raw_data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        
    print("Data fetch completed. Saved to data/raw_data.json")

if __name__ == "__main__":
    main()
