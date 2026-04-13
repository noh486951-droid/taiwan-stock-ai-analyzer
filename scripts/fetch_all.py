import yfinance as yf
import requests
import feedparser
import json
import os
from datetime import datetime
import pytz
import pandas as pd
import numpy as np

# Setup Timezone
tw_tz = pytz.timezone('Asia/Taipei')
current_time = datetime.now(tw_tz)


# ============================================================
# 技術指標計算
# ============================================================

def calculate_ma(closes, periods=[5, 10, 20, 60, 120, 240]):
    """計算移動平均線"""
    result = {}
    for p in periods:
        if len(closes) >= p:
            ma = closes.rolling(window=p).mean()
            if not pd.isna(ma.iloc[-1]):
                result[f"MA{p}"] = round(float(ma.iloc[-1]), 2)
    return result


def calculate_rsi(closes, period=14):
    """計算 RSI 相對強弱指標"""
    if len(closes) < period + 1:
        return None
    deltas = closes.diff()
    gains = deltas.where(deltas > 0, 0.0)
    losses = (-deltas).where(deltas < 0, 0.0)
    avg_gain = gains.rolling(window=period, min_periods=period).mean()
    avg_loss = losses.rolling(window=period, min_periods=period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    val = rsi.iloc[-1]
    return round(float(val), 2) if not pd.isna(val) else None


def calculate_kd(hist, period=9):
    """計算 KD 隨機指標"""
    if len(hist) < period:
        return None, None
    lows = hist['Low'].rolling(window=period).min()
    highs = hist['High'].rolling(window=period).max()
    rsv = (hist['Close'] - lows) / (highs - lows) * 100

    k_val = 50.0
    d_val = 50.0
    for i in range(len(rsv)):
        if not pd.isna(rsv.iloc[i]):
            k_val = (2 / 3) * k_val + (1 / 3) * rsv.iloc[i]
            d_val = (2 / 3) * d_val + (1 / 3) * k_val
    return round(k_val, 2), round(d_val, 2)


def calculate_macd(closes, fast=12, slow=26, signal=9):
    """計算 MACD 指標"""
    if len(closes) < slow + signal:
        return None, None, None
    ema_fast = closes.ewm(span=fast, adjust=False).mean()
    ema_slow = closes.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    if pd.isna(macd_line.iloc[-1]):
        return None, None, None
    return (
        round(float(macd_line.iloc[-1]), 2),
        round(float(signal_line.iloc[-1]), 2),
        round(float(histogram.iloc[-1]), 2),
    )


def calculate_bollinger(closes, period=20, std_dev=2):
    """計算布林通道"""
    if len(closes) < period:
        return None, None, None
    ma = closes.rolling(window=period).mean()
    std = closes.rolling(window=period).std()
    upper = ma + std_dev * std
    lower = ma - std_dev * std
    return (
        round(float(upper.iloc[-1]), 2),
        round(float(ma.iloc[-1]), 2),
        round(float(lower.iloc[-1]), 2),
    )


# ============================================================
# 資料抓取
# ============================================================

def fetch_market_data():
    """抓取台股與國際指數 (含成交量)"""
    print("Fetching market data...")
    symbols = {
        "TAIEX": "^TWII",
        "SOX": "^SOX",
        "TSMC": "2330.TW",
        "USD/TWD": "USDTWD=X",
        "S&P500": "^GSPC",
        "NASDAQ": "^IXIC",
        "DOW": "^DJI",
        "VIX": "^VIX",
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
                volume = int(hist['Volume'].iloc[-1]) if 'Volume' in hist.columns and hist['Volume'].iloc[-1] > 0 else 0
                market_data[name] = {
                    "price": round(last_close, 2),
                    "change_pct": round(change_pct, 2),
                    "volume": volume,
                    "date": hist.index[-1].strftime('%Y-%m-%d'),
                }
        except Exception as e:
            print(f"  Error fetching {name}: {e}")
            market_data[name] = {"error": str(e)}
    return market_data


def fetch_chip_data():
    """抓取三大法人籌碼資料 (TWSE)"""
    print("Fetching chip data...")
    url = "https://www.twse.com.tw/fund/BFI82U?response=json"
    chip_data = {}
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        res = requests.get(url, timeout=10, verify=False)
        data = res.json()
        if data.get("stat") == "OK":
            chip_data["date"] = data.get("date", "")
            chip_data["summary"] = data.get("data", [])
    except Exception as e:
        print(f"  Error fetching chip data: {e}")
        chip_data["error"] = str(e)
    return chip_data


def fetch_margin_data():
    """抓取融資融券資料 (TWSE MI_MARGN)"""
    print("Fetching margin trading data...")
    date_str = current_time.strftime('%Y%m%d')
    url = f"https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date={date_str}&selectType=ALL"
    margin_data = {}
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        res = requests.get(url, timeout=15, verify=False)
        data = res.json()
        if data.get("stat") == "OK":
            margin_data["date"] = data.get("date", "")
            # creditList 為個股融資融券明細
            raw = data.get("data", [])
            # 彙總：取最後一行 (合計)
            summary_fields = data.get("fields", [])

            # 計算整體市場融資融券
            total_margin_buy = 0      # 融資買進
            total_margin_sell = 0     # 融資賣出
            total_margin_balance = 0  # 融資餘額(張)
            total_margin_amount = 0   # 融資金額(千元)
            total_short_sell = 0      # 融券賣出
            total_short_buy = 0       # 融券買進
            total_short_balance = 0   # 融券餘額

            for row in raw:
                try:
                    # 欄位順序：股票代號,股票名稱,融資買進,融資賣出,融資現金償還,融資前日餘額,融資今日餘額,融資限額,融券賣出,融券買進,融券現券償還,融券前日餘額,融券今日餘額,融券限額,資券互抵,備註
                    margin_buy = int(str(row[2]).replace(',', '')) if row[2] else 0
                    margin_sell = int(str(row[3]).replace(',', '')) if row[3] else 0
                    margin_bal = int(str(row[6]).replace(',', '')) if row[6] else 0
                    short_sell = int(str(row[8]).replace(',', '')) if row[8] else 0
                    short_buy = int(str(row[9]).replace(',', '')) if row[9] else 0
                    short_bal = int(str(row[12]).replace(',', '')) if row[12] else 0

                    total_margin_buy += margin_buy
                    total_margin_sell += margin_sell
                    total_margin_balance += margin_bal
                    total_short_sell += short_sell
                    total_short_buy += short_buy
                    total_short_balance += short_bal
                except (ValueError, IndexError):
                    continue

            margin_data["summary"] = {
                "margin_buy": total_margin_buy,
                "margin_sell": total_margin_sell,
                "margin_balance": total_margin_balance,
                "margin_change": total_margin_buy - total_margin_sell,
                "short_sell": total_short_sell,
                "short_buy": total_short_buy,
                "short_balance": total_short_balance,
                "short_change": total_short_sell - total_short_buy,
            }

            # 券資比
            if total_margin_balance > 0:
                margin_data["summary"]["short_margin_ratio"] = round(
                    total_short_balance / total_margin_balance * 100, 2
                )

            margin_data["stock_count"] = len(raw)
        else:
            margin_data["error"] = f"API stat: {data.get('stat', 'unknown')}"
    except Exception as e:
        print(f"  Error fetching margin data: {e}")
        margin_data["error"] = str(e)
    return margin_data


def fetch_market_breadth():
    """抓取漲跌家數比 (TWSE MI_INDEX)"""
    print("Fetching market breadth data...")
    date_str = current_time.strftime('%Y%m%d')
    url = f"https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date={date_str}&type=ALL"
    breadth_data = {}
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        import time
        time.sleep(3)  # 避免被 TWSE 擋
        res = requests.get(url, timeout=15, verify=False)
        data = res.json()
        if data.get("stat") == "OK":
            breadth_data["date"] = data.get("date", "")

            # 從 data8 或 data9 取得個股漲跌資料
            # MI_INDEX 回傳 groups 中會有漲跌統計
            groups = data.get("groups", [])

            # 直接從個股資料計算
            stock_data = None
            for key in ["data8", "data9", "data7"]:
                if key in data and data[key]:
                    stock_data = data[key]
                    break

            up_count = 0
            down_count = 0
            unchanged_count = 0
            up_limit = 0    # 漲停
            down_limit = 0  # 跌停

            if stock_data:
                for row in stock_data:
                    try:
                        # 漲跌欄位通常在 index 9 或 10
                        change_str = str(row[9]).replace(',', '') if len(row) > 9 else "0"
                        # 判斷漲跌：+ 開頭為漲，- 為跌
                        if change_str.startswith('+') or (change_str.replace('.','').isdigit() and float(change_str) > 0):
                            up_count += 1
                        elif change_str.startswith('-') or (change_str.replace('.','').replace('-','').isdigit() and float(change_str) < 0):
                            down_count += 1
                        else:
                            unchanged_count += 1

                        # 漲停/跌停判定（漲跌幅接近10%）
                        close_str = str(row[8]).replace(',', '') if len(row) > 8 else "0"
                        open_str = str(row[5]).replace(',', '') if len(row) > 5 else "0"
                        try:
                            close_val = float(close_str)
                            change_val = float(change_str.replace('+', ''))
                            if close_val > 0:
                                change_pct = abs(change_val) / (close_val - change_val) * 100
                                if change_pct >= 9.5:
                                    if change_val > 0:
                                        up_limit += 1
                                    else:
                                        down_limit += 1
                        except (ValueError, ZeroDivisionError):
                            pass
                    except (IndexError, ValueError):
                        continue

            total = up_count + down_count + unchanged_count
            breadth_data["summary"] = {
                "up": up_count,
                "down": down_count,
                "unchanged": unchanged_count,
                "up_limit": up_limit,
                "down_limit": down_limit,
                "total": total,
                "advance_decline_ratio": round(up_count / down_count, 2) if down_count > 0 else 999,
            }
        else:
            breadth_data["error"] = f"API stat: {data.get('stat', 'unknown')}"
    except Exception as e:
        print(f"  Error fetching market breadth: {e}")
        breadth_data["error"] = str(e)
    return breadth_data


def fetch_news():
    """抓取 Yahoo 台股即時新聞 RSS"""
    print("Fetching news data...")
    url = "https://tw.stock.yahoo.com/rss?category=tw-market"
    news_data = []
    try:
        feed = feedparser.parse(url)
        for entry in feed.entries[:10]:
            news_data.append({
                "title": entry.title,
                "link": entry.link,
                "published": entry.published if hasattr(entry, 'published') else "",
            })
    except Exception as e:
        print(f"  Error fetching news: {e}")
    return news_data


def fetch_stock_detail(symbol):
    """抓取個股完整資料 (技術面 + 基本面)"""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1y")
        if hist.empty:
            return {"symbol": symbol, "error": "無法取得歷史資料"}

        closes = hist['Close']
        last_close = float(closes.iloc[-1])
        prev_close = float(closes.iloc[-2]) if len(closes) > 1 else last_close
        change_pct = ((last_close - prev_close) / prev_close) * 100
        volume = int(hist['Volume'].iloc[-1]) if 'Volume' in hist.columns else 0

        # 技術指標
        ma = calculate_ma(closes)
        rsi = calculate_rsi(closes)
        k, d = calculate_kd(hist)
        macd, macd_signal, macd_hist = calculate_macd(closes)
        boll_upper, boll_mid, boll_lower = calculate_bollinger(closes)

        technical = {**ma}
        if rsi is not None:
            technical["RSI"] = rsi
        if k is not None:
            technical["K"] = k
            technical["D"] = d
        if macd is not None:
            technical["MACD"] = macd
            technical["MACD_signal"] = macd_signal
            technical["MACD_hist"] = macd_hist
        if boll_upper is not None:
            technical["BOLL_upper"] = boll_upper
            technical["BOLL_mid"] = boll_mid
            technical["BOLL_lower"] = boll_lower

        # 基本面
        info = {}
        try:
            info = ticker.info or {}
        except Exception:
            pass

        fundamental = {}
        field_map = {
            "PE": "trailingPE",
            "forward_PE": "forwardPE",
            "PB": "priceToBook",
            "EPS": "trailingEps",
            "market_cap": "marketCap",
            "52w_high": "fiftyTwoWeekHigh",
            "52w_low": "fiftyTwoWeekLow",
        }
        for key, yf_key in field_map.items():
            val = info.get(yf_key)
            if val is not None:
                fundamental[key] = round(val, 2) if isinstance(val, float) else val

        div_yield = info.get("dividendYield")
        if div_yield is not None:
            fundamental["dividend_yield"] = round(div_yield * 100, 2)

        name = info.get("shortName") or info.get("longName") or symbol

        return {
            "symbol": symbol,
            "name": name,
            "price": round(last_close, 2),
            "change_pct": round(change_pct, 2),
            "volume": volume,
            "date": hist.index[-1].strftime('%Y-%m-%d'),
            "technical": technical,
            "fundamental": fundamental,
        }
    except Exception as e:
        print(f"  Error fetching {symbol}: {e}")
        return {"symbol": symbol, "error": str(e)}


def fetch_watchlist_data():
    """讀取 watchlist.json 並抓取所有自選股資料"""
    print("Fetching watchlist data...")
    watchlist_path = "data/watchlist.json"
    if not os.path.exists(watchlist_path):
        print("  No watchlist.json found, skipping.")
        return {}

    with open(watchlist_path, "r", encoding="utf-8") as f:
        symbols = json.load(f)

    if not symbols:
        print("  Watchlist is empty.")
        return {}

    result = {}
    for symbol in symbols:
        print(f"  Analyzing: {symbol}")
        result[symbol] = fetch_stock_detail(symbol)
    return result


# ============================================================
# 主程式
# ============================================================

def main():
    print(f"[{current_time.strftime('%Y-%m-%d %H:%M:%S')}] Starting data fetch...")

    market_data = fetch_market_data()
    chip_data = fetch_chip_data()
    margin_data = fetch_margin_data()
    breadth_data = fetch_market_breadth()
    news_data = fetch_news()
    watchlist_data = fetch_watchlist_data()

    output = {
        "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
        "market": market_data,
        "chips": chip_data,
        "margin": margin_data,
        "breadth": breadth_data,
        "news": news_data,
        "watchlist": watchlist_data,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/raw_data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("Data fetch completed. Saved to data/raw_data.json")


if __name__ == "__main__":
    main()
