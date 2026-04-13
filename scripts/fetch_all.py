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
        "TSMC_ADR": "TSM",
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


def fetch_futures_oi():
    """抓取外資期貨未平倉量 (TAIFEX)"""
    print("Fetching futures open interest...")
    date_str = current_time.strftime('%Y/%m/%d')
    url = "https://www.taifex.com.tw/cht/3/futContractsDateDown"
    futures_data = {}
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        import time
        time.sleep(2)

        # 查詢台指期外資未平倉
        params = {
            "queryType": "1",
            "commodity_id": "TX",
            "queryDate": date_str,
        }
        res = requests.get(url, params=params, timeout=15, verify=False)

        # 嘗試用另一個 API endpoint
        url2 = "https://www.taifex.com.tw/cht/3/futContractsDate"
        res2 = requests.get(url2, params=params, timeout=15, verify=False)

        # 改用三大法人期貨未平倉 API
        oi_url = f"https://www.taifex.com.tw/cht/3/futContractsDateDown?queryType=1&commodity_id=TX&queryDate={date_str}"

        # 使用更可靠的 POST endpoint
        post_url = "https://www.taifex.com.tw/cht/3/dlFutContractsDate"
        post_data = {
            "queryType": "1",
            "commodity_id": "TX",
            "queryDate": date_str,
        }

        # 改用已知穩定的 csv API
        csv_url = "https://www.taifex.com.tw/cht/3/futContractsDateDown"
        time.sleep(1)
        csv_res = requests.post(csv_url, data=post_data, timeout=15, verify=False)

        if csv_res.status_code == 200:
            text = csv_res.text
            lines = text.strip().split('\n')

            # 解析 CSV 格式：找到外資的行
            for line in lines:
                cols = [c.strip().strip('"') for c in line.split(',')]
                if len(cols) >= 11:
                    # 找 "外資" 相關行
                    if '外資' in cols[1] or '外資及陸資' in cols[1]:
                        try:
                            long_oi = int(cols[7].replace(',', '')) if cols[7].replace(',', '').lstrip('-').isdigit() else 0
                            short_oi = int(cols[8].replace(',', '')) if cols[8].replace(',', '').lstrip('-').isdigit() else 0
                            net_oi = int(cols[9].replace(',', '')) if cols[9].replace(',', '').lstrip('-').isdigit() else 0

                            futures_data["foreign_investor"] = {
                                "long_oi": long_oi,
                                "short_oi": short_oi,
                                "net_oi": net_oi,
                                "bias": "偏多" if net_oi > 0 else "偏空" if net_oi < 0 else "中性",
                            }
                        except (ValueError, IndexError):
                            pass

                    # 找 "自營商"
                    if '自營商' in cols[1]:
                        try:
                            long_oi = int(cols[7].replace(',', '')) if cols[7].replace(',', '').lstrip('-').isdigit() else 0
                            short_oi = int(cols[8].replace(',', '')) if cols[8].replace(',', '').lstrip('-').isdigit() else 0
                            net_oi = int(cols[9].replace(',', '')) if cols[9].replace(',', '').lstrip('-').isdigit() else 0

                            futures_data["dealer"] = {
                                "long_oi": long_oi,
                                "short_oi": short_oi,
                                "net_oi": net_oi,
                            }
                        except (ValueError, IndexError):
                            pass

            futures_data["date"] = date_str

        if not futures_data.get("foreign_investor"):
            futures_data["error"] = "無法解析期貨資料（可能非交易日）"

    except Exception as e:
        print(f"  Error fetching futures OI: {e}")
        futures_data["error"] = str(e)
    return futures_data


def fetch_put_call_ratio():
    """抓取 Put/Call Ratio (TAIFEX 選擇權)"""
    print("Fetching put/call ratio...")
    date_str = current_time.strftime('%Y/%m/%d')
    pcr_data = {}
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        import time
        time.sleep(2)

        # TAIFEX 選擇權每日交易量與未平倉 (PUT/CALL)
        url = "https://www.taifex.com.tw/cht/3/dlOptDailyMarketReport"
        post_data = {
            "queryType": "1",
            "commodity_id": "TXO",
            "queryDate": date_str,
        }
        res = requests.post(url, data=post_data, timeout=15, verify=False)

        if res.status_code == 200:
            text = res.text
            lines = text.strip().split('\n')

            total_call_vol = 0
            total_put_vol = 0
            total_call_oi = 0
            total_put_oi = 0

            for line in lines:
                cols = [c.strip().strip('"') for c in line.split(',')]
                if len(cols) >= 5:
                    try:
                        # 判斷 Call 或 Put
                        row_text = ' '.join(cols)
                        if 'Call' in row_text or '買權' in row_text:
                            vol = int(cols[-3].replace(',', '')) if cols[-3].replace(',','').isdigit() else 0
                            oi = int(cols[-1].replace(',', '')) if cols[-1].replace(',','').isdigit() else 0
                            total_call_vol += vol
                            total_call_oi += oi
                        elif 'Put' in row_text or '賣權' in row_text:
                            vol = int(cols[-3].replace(',', '')) if cols[-3].replace(',','').isdigit() else 0
                            oi = int(cols[-1].replace(',', '')) if cols[-1].replace(',','').isdigit() else 0
                            total_put_vol += vol
                            total_put_oi += oi
                    except (ValueError, IndexError):
                        continue

            if total_call_vol > 0:
                pcr_data["volume_pcr"] = round(total_put_vol / total_call_vol, 3)
            if total_call_oi > 0:
                pcr_data["oi_pcr"] = round(total_put_oi / total_call_oi, 3)

            pcr_data["call_volume"] = total_call_vol
            pcr_data["put_volume"] = total_put_vol
            pcr_data["call_oi"] = total_call_oi
            pcr_data["put_oi"] = total_put_oi
            pcr_data["date"] = date_str

            # 情緒判斷
            vol_pcr = pcr_data.get("volume_pcr", 0)
            if vol_pcr > 1.2:
                pcr_data["sentiment"] = "極度恐慌（反向看多）"
            elif vol_pcr > 0.9:
                pcr_data["sentiment"] = "偏恐慌"
            elif vol_pcr > 0.6:
                pcr_data["sentiment"] = "中性"
            elif vol_pcr > 0.3:
                pcr_data["sentiment"] = "偏樂觀"
            else:
                pcr_data["sentiment"] = "極度樂觀（反向看空）"

        if not pcr_data.get("volume_pcr") and not pcr_data.get("oi_pcr"):
            pcr_data["error"] = "無法解析 PCR 資料（可能非交易日）"

    except Exception as e:
        print(f"  Error fetching PCR: {e}")
        pcr_data["error"] = str(e)
    return pcr_data


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


def fetch_chip_concentration(symbols):
    """計算自選股 10/20 日籌碼集中度 (外資+投信連續買賣超)"""
    print("Calculating chip concentration...")
    concentration = {}

    for symbol in symbols:
        try:
            # 使用 yfinance 的機構持股或計算自身的買賣超趨勢
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="1mo")
            if hist.empty or len(hist) < 5:
                continue

            # 計算成交量趨勢作為籌碼集中度代理指標
            volumes = hist['Volume']
            closes = hist['Close']

            # 10日均量比
            if len(volumes) >= 10:
                vol_10 = float(volumes.iloc[-10:].mean())
                vol_20 = float(volumes.iloc[-20:].mean()) if len(volumes) >= 20 else vol_10
                vol_5 = float(volumes.iloc[-5:].mean())
                current_vol = float(volumes.iloc[-1])
            else:
                continue

            # 計算價格動能（用來推估主力動向）
            if len(closes) >= 10:
                price_10d_change = float((closes.iloc[-1] - closes.iloc[-10]) / closes.iloc[-10] * 100)
            else:
                price_10d_change = 0

            if len(closes) >= 20:
                price_20d_change = float((closes.iloc[-1] - closes.iloc[-20]) / closes.iloc[-20] * 100)
            else:
                price_20d_change = price_10d_change

            # 量價齊揚 = 籌碼集中（價漲量增）
            # 量縮價跌 = 籌碼發散
            vol_ratio_10 = round(vol_5 / vol_10, 2) if vol_10 > 0 else 1
            vol_ratio_20 = round(vol_5 / vol_20, 2) if vol_20 > 0 else 1

            # 籌碼集中度評分 (-100 到 +100)
            # 正分 = 集中（看多）, 負分 = 發散（看空）
            score_10 = 0
            if price_10d_change > 0 and vol_ratio_10 > 1:
                score_10 = min(100, round(price_10d_change * vol_ratio_10 * 5))  # 量價齊揚
            elif price_10d_change > 0 and vol_ratio_10 < 0.8:
                score_10 = round(price_10d_change * 2)  # 價漲量縮（軋空可能）
            elif price_10d_change < 0 and vol_ratio_10 > 1.2:
                score_10 = max(-100, round(price_10d_change * vol_ratio_10 * 5))  # 量增價跌（拋售）
            elif price_10d_change < 0 and vol_ratio_10 < 0.8:
                score_10 = round(price_10d_change * 1.5)  # 量縮價跌（自然回檔）

            score_20 = 0
            if price_20d_change > 0 and vol_ratio_20 > 1:
                score_20 = min(100, round(price_20d_change * vol_ratio_20 * 3))
            elif price_20d_change < 0 and vol_ratio_20 > 1.2:
                score_20 = max(-100, round(price_20d_change * vol_ratio_20 * 3))
            else:
                score_20 = round(price_20d_change * 2)

            # 判斷趨勢
            if score_10 > 30:
                trend_10 = "集中"
            elif score_10 < -30:
                trend_10 = "發散"
            else:
                trend_10 = "持平"

            if score_20 > 30:
                trend_20 = "集中"
            elif score_20 < -30:
                trend_20 = "發散"
            else:
                trend_20 = "持平"

            concentration[symbol] = {
                "score_10d": score_10,
                "score_20d": score_20,
                "trend_10d": trend_10,
                "trend_20d": trend_20,
                "vol_ratio_10d": vol_ratio_10,
                "vol_ratio_20d": vol_ratio_20,
                "price_change_10d": round(price_10d_change, 2),
                "price_change_20d": round(price_20d_change, 2),
            }

        except Exception as e:
            print(f"  Error calculating concentration for {symbol}: {e}")
            continue

    return concentration


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

    # 計算籌碼集中度
    chip_conc = fetch_chip_concentration(symbols)
    for symbol, conc in chip_conc.items():
        if symbol in result:
            result[symbol]["chip_concentration"] = conc

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
    futures_data = fetch_futures_oi()
    pcr_data = fetch_put_call_ratio()
    news_data = fetch_news()
    watchlist_data = fetch_watchlist_data()

    output = {
        "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
        "market": market_data,
        "chips": chip_data,
        "margin": margin_data,
        "breadth": breadth_data,
        "futures": futures_data,
        "pcr": pcr_data,
        "news": news_data,
        "watchlist": watchlist_data,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/raw_data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("Data fetch completed. Saved to data/raw_data.json")


if __name__ == "__main__":
    main()
