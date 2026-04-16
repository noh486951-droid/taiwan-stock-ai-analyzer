import yfinance as yf
import requests
import feedparser
import json
import os
import random
import time
from datetime import datetime
import pytz
import pandas as pd
import numpy as np

# Setup Timezone
tw_tz = pytz.timezone('Asia/Taipei')
current_time = datetime.now(tw_tz)


# ============================================================
# 共用 Session：模擬真實瀏覽器行為，避免被 TWSE/TAIFEX 封鎖
# ============================================================

def create_tw_session():
    """建立帶完整瀏覽器 headers 的 requests Session"""
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
    })
    session.verify = False
    return session


def tw_request(session, method, url, referer=None, **kwargs):
    """帶隨機延遲和 Referer 的請求包裝"""
    time.sleep(random.uniform(1.5, 4.0))  # 隨機延遲避免被判定為機器人
    if referer:
        session.headers.update({'Referer': referer})
    kwargs.setdefault('timeout', 20)
    if method == 'GET':
        return session.get(url, **kwargs)
    else:
        return session.post(url, **kwargs)


# 全域 session
_tw_session = None

def get_tw_session():
    global _tw_session
    if _tw_session is None:
        _tw_session = create_tw_session()
        # 先訪問首頁取得 cookies
        try:
            _tw_session.get('https://www.twse.com.tw/zh/', timeout=15)
            time.sleep(random.uniform(1, 2))
        except Exception:
            pass
    return _tw_session


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


TWSE_PROXY_URL = "https://tw-stock-ai-proxy.noh486951-e8a.workers.dev/api/twse-proxy"


def fetch_chip_data():
    """抓取三大法人籌碼資料 (透過 Worker 代理)"""
    print("Fetching chip data...")
    chip_data = {}
    try:
        # 透過 Cloudflare Worker 代理抓取（避免 GitHub Actions IP 被封鎖）
        res = requests.get(f"{TWSE_PROXY_URL}?target=chip", timeout=20)
        data = res.json()
        if data.get("stat") == "OK":
            chip_data["date"] = data.get("date", "")
            chip_data["summary"] = data.get("data", [])
        else:
            chip_data["error"] = data.get("error", "API stat not OK")
            print(f"  Chip data: {chip_data['error']}")
    except Exception as e:
        print(f"  Error fetching chip data via proxy: {e}")
        chip_data["error"] = str(e)
    return chip_data


def _parse_int(val):
    """安全解析可能帶逗號的整數字串"""
    try:
        return int(str(val).replace(',', '').strip()) if val else 0
    except (ValueError, TypeError):
        return 0


def fetch_margin_data():
    """抓取融資融券資料 (TWSE OpenAPI — 直接 JSON，不需代理)"""
    print("Fetching margin trading data (TWSE OpenAPI)...")
    margin_data = {}
    try:
        # TWSE OpenAPI：直接回傳乾淨 JSON 陣列，全球可存取
        try:
            res = requests.get(
                "https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN",
                timeout=30,
                headers={'Accept': 'application/json'},
            )
        except requests.exceptions.SSLError:
            # 部分環境 SSL 憑證不完整，加 verify=False 重試
            res = requests.get(
                "https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN",
                timeout=30,
                headers={'Accept': 'application/json'},
                verify=False,
            )
        if res.status_code != 200:
            raise Exception(f"TWSE OpenAPI HTTP {res.status_code}")

        raw = res.json()
        if not raw or not isinstance(raw, list):
            raise Exception("回傳非陣列格式")

        total_margin_buy = 0
        total_margin_sell = 0
        total_margin_balance = 0
        total_short_sell = 0
        total_short_buy = 0
        total_short_balance = 0

        for row in raw:
            total_margin_buy += _parse_int(row.get("融資買進"))
            total_margin_sell += _parse_int(row.get("融資賣出"))
            total_margin_balance += _parse_int(row.get("融資今日餘額"))
            total_short_sell += _parse_int(row.get("融券賣出"))
            total_short_buy += _parse_int(row.get("融券買進"))
            total_short_balance += _parse_int(row.get("融券今日餘額"))

        margin_data["date"] = current_time.strftime('%Y%m%d')
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
        if total_margin_balance > 0:
            margin_data["summary"]["short_margin_ratio"] = round(
                total_short_balance / total_margin_balance * 100, 2
            )
        margin_data["stock_count"] = len(raw)
        print(f"  ✅ Margin: {len(raw)} stocks, balance={total_margin_balance:,}")

    except Exception as e:
        print(f"  ⚠️ TWSE OpenAPI failed: {e}, trying Worker proxy fallback...")
        margin_data = _fetch_margin_via_proxy()
    return margin_data


def _fetch_margin_via_proxy():
    """融資融券 — Worker 代理 fallback"""
    date_str = current_time.strftime('%Y%m%d')
    margin_data = {}
    try:
        res = requests.get(f"{TWSE_PROXY_URL}?target=margin&date={date_str}", timeout=30)
        data = res.json()
        if data.get("stat") == "OK":
            margin_data["date"] = data.get("date", "")
            raw = data.get("data", [])
            total_mb, total_ms, total_mbal = 0, 0, 0
            total_ss, total_sb, total_sbal = 0, 0, 0
            for row in raw:
                try:
                    total_mb += _parse_int(row[2])
                    total_ms += _parse_int(row[3])
                    total_mbal += _parse_int(row[6])
                    total_ss += _parse_int(row[8])
                    total_sb += _parse_int(row[9])
                    total_sbal += _parse_int(row[12])
                except (ValueError, IndexError):
                    continue
            margin_data["summary"] = {
                "margin_buy": total_mb, "margin_sell": total_ms,
                "margin_balance": total_mbal, "margin_change": total_mb - total_ms,
                "short_sell": total_ss, "short_buy": total_sb,
                "short_balance": total_sbal, "short_change": total_ss - total_sb,
            }
            if total_mbal > 0:
                margin_data["summary"]["short_margin_ratio"] = round(total_sbal / total_mbal * 100, 2)
            margin_data["stock_count"] = len(raw)
            print(f"  ✅ Margin (proxy fallback): {len(raw)} stocks")
        else:
            margin_data["error"] = data.get("error", f"stat: {data.get('stat')}")
    except Exception as e:
        margin_data["error"] = str(e)
    return margin_data


def fetch_market_breadth():
    """抓取漲跌家數比 (TWSE OpenAPI — 從 STOCK_DAY_ALL 計算)"""
    print("Fetching market breadth (TWSE OpenAPI)...")

    try:
        # TWSE OpenAPI：全部個股當日行情（含漲跌）
        try:
            res = requests.get(
                "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
                timeout=30,
                headers={'Accept': 'application/json'},
            )
        except requests.exceptions.SSLError:
            res = requests.get(
                "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
                timeout=30,
                headers={'Accept': 'application/json'},
                verify=False,
            )
        if res.status_code != 200:
            raise Exception(f"TWSE OpenAPI HTTP {res.status_code}")

        raw = res.json()
        if not raw or not isinstance(raw, list):
            raise Exception("回傳非陣列格式")

        up_count = 0
        down_count = 0
        unchanged_count = 0
        up_limit = 0
        down_limit = 0

        for stock in raw:
            try:
                change = float(str(stock.get("Change", "0")).replace(",", "").strip())
                closing = float(str(stock.get("ClosingPrice", "0")).replace(",", "").strip())
            except (ValueError, TypeError):
                continue

            if change > 0:
                up_count += 1
                # 漲停判斷：漲幅 >= 9.5%（台股漲跌幅限制 10%）
                if closing > 0:
                    prev_close = closing - change
                    if prev_close > 0 and (change / prev_close) >= 0.095:
                        up_limit += 1
            elif change < 0:
                down_count += 1
                if closing > 0:
                    prev_close = closing - change
                    if prev_close > 0 and (change / prev_close) <= -0.095:
                        down_limit += 1
            else:
                unchanged_count += 1

        result = {
            "date": current_time.strftime('%Y%m%d'),
            "summary": {
                "up": up_count,
                "down": down_count,
                "unchanged": unchanged_count,
                "up_limit": up_limit,
                "down_limit": down_limit,
                "advance_decline_ratio": round(up_count / down_count, 2) if down_count > 0 else 999,
            },
        }
        print(f"  ✅ Breadth: ↑{up_count} ↓{down_count} ＝{unchanged_count} (漲停{up_limit}/跌停{down_limit})")
        return result

    except Exception as e:
        print(f"  ⚠️ TWSE OpenAPI failed: {e}, trying Worker proxy fallback...")
        return _fetch_breadth_via_proxy()


def _fetch_breadth_via_proxy():
    """漲跌家數 — Worker 代理 fallback"""
    date_str = current_time.strftime('%Y%m%d')
    try:
        res = requests.get(f"{TWSE_PROXY_URL}?target=breadth&date={date_str}", timeout=30)
        data = res.json()
        if data.get("stat") == "OK":
            stats_table = None
            for key in ["data7", "data8", "data9", "data1"]:
                if key in data and data[key] and any("上漲" in str(row) for row in data[key]):
                    stats_table = data[key]
                    break
            if stats_table:
                up_count = down_count = unchanged_count = up_limit = down_limit = 0
                for row in stats_table:
                    if not row or len(row) < 2: continue
                    label = str(row[0])
                    count_str = str(row[1]).replace(',', '').split('(')[0].strip()
                    count = int(count_str) if count_str.isdigit() else 0
                    if "漲停" in label: up_limit = count
                    elif "跌停" in label: down_limit = count
                    elif "上漲" in label or "漲" in label: up_count = count
                    elif "下跌" in label or "跌" in label: down_count = count
                    elif "平盤" in label or "不變" in label: unchanged_count = count
                final_up = up_count + up_limit
                final_down = down_count + down_limit
                return {
                    "date": data.get("date", date_str),
                    "summary": {
                        "up": final_up, "down": final_down, "unchanged": unchanged_count,
                        "up_limit": up_limit, "down_limit": down_limit,
                        "advance_decline_ratio": round(final_up / final_down, 2) if final_down > 0 else 999,
                    },
                }
    except Exception as e:
        print(f"  Breadth proxy fallback also failed: {e}")

    return {"error": "無法取得漲跌家數資料", "summary": {"up": 0, "down": 0, "unchanged": 0, "up_limit": 0, "down_limit": 0, "advance_decline_ratio": 999}}


def fetch_futures_oi():
    """抓取外資期貨未平倉量 (Worker 代理 — 優先 HTML 解析，fallback CSV)"""
    print("Fetching futures open interest...")
    date_str = current_time.strftime('%Y/%m/%d')
    futures_data = {}

    # 方法1：Worker HTML 解析（更穩定）
    try:
        res = requests.get(f"{TWSE_PROXY_URL}?target=futures-html&date={date_str}", timeout=30)
        data = res.json()
        if data.get("stat") == "OK" and data.get("foreign_investor"):
            futures_data = data
            print(f"  ✅ Futures OI (HTML): 外資淨部位 {data['foreign_investor'].get('net_oi', 0):,}")
            return futures_data
        else:
            print(f"  ⚠️ Futures HTML parse: {data.get('error', 'no data')}")
    except Exception as e:
        print(f"  ⚠️ Futures HTML failed: {e}")

    # 方法2：原始 CSV fallback
    try:
        res = requests.get(f"{TWSE_PROXY_URL}?target=futures&date={date_str}", timeout=30)
        data = res.json()
        if data.get("stat") == "OK" and data.get("csv"):
            text = data["csv"]
            lines = text.strip().split('\n')
            for line in lines:
                cols = [c.strip().strip('"') for c in line.split(',')]
                if len(cols) >= 11:
                    if '外資' in cols[1] or '外資及陸資' in cols[1]:
                        try:
                            long_oi = _parse_int(cols[7])
                            short_oi = _parse_int(cols[8])
                            net_oi = _parse_int(cols[9])
                            futures_data["foreign_investor"] = {
                                "long_oi": long_oi, "short_oi": short_oi, "net_oi": net_oi,
                                "bias": "偏多" if net_oi > 0 else "偏空" if net_oi < 0 else "中性",
                            }
                        except (ValueError, IndexError):
                            pass
                    if '自營商' in cols[1]:
                        try:
                            futures_data["dealer"] = {
                                "long_oi": _parse_int(cols[7]),
                                "short_oi": _parse_int(cols[8]),
                                "net_oi": _parse_int(cols[9]),
                            }
                        except (ValueError, IndexError):
                            pass
            futures_data["date"] = date_str
            if futures_data.get("foreign_investor"):
                print(f"  ✅ Futures OI (CSV fallback)")
    except Exception as e:
        print(f"  CSV fallback also failed: {e}")

    if not futures_data.get("foreign_investor"):
        futures_data["error"] = "無法解析期貨資料（可能非交易日）"
    return futures_data


def _add_pcr_sentiment(pcr_data):
    """根據 PCR 數值添加情緒判斷"""
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


def fetch_put_call_ratio():
    """抓取 Put/Call Ratio (Worker 代理 — 優先 HTML 解析，fallback CSV)"""
    print("Fetching put/call ratio...")
    date_str = current_time.strftime('%Y/%m/%d')
    pcr_data = {}

    # 方法1：Worker HTML 解析（更穩定）
    try:
        res = requests.get(f"{TWSE_PROXY_URL}?target=pcr-html&date={date_str}", timeout=30)
        data = res.json()
        if data.get("stat") == "OK" and (data.get("volume_pcr") or data.get("oi_pcr")):
            pcr_data = data
            _add_pcr_sentiment(pcr_data)
            print(f"  ✅ PCR (HTML): vol={pcr_data.get('volume_pcr')}, oi={pcr_data.get('oi_pcr')}")
            return pcr_data
        else:
            print(f"  ⚠️ PCR HTML parse: {data.get('error', 'no data')}")
    except Exception as e:
        print(f"  ⚠️ PCR HTML failed: {e}")

    # 方法2：原始 CSV fallback
    try:
        res = requests.get(f"{TWSE_PROXY_URL}?target=pcr&date={date_str}", timeout=30)
        data = res.json()
        if data.get("stat") == "OK" and data.get("csv"):
            text = data["csv"]
            lines = text.strip().split('\n')
            total_call_vol = total_put_vol = total_call_oi = total_put_oi = 0
            for line in lines:
                cols = [c.strip().strip('"') for c in line.split(',')]
                if len(cols) >= 5:
                    try:
                        row_text = ' '.join(cols)
                        if 'Call' in row_text or '買權' in row_text:
                            total_call_vol += _parse_int(cols[-3])
                            total_call_oi += _parse_int(cols[-1])
                        elif 'Put' in row_text or '賣權' in row_text:
                            total_put_vol += _parse_int(cols[-3])
                            total_put_oi += _parse_int(cols[-1])
                    except (ValueError, IndexError):
                        continue
            if total_call_vol > 0:
                pcr_data["volume_pcr"] = round(total_put_vol / total_call_vol, 3)
            if total_call_oi > 0:
                pcr_data["oi_pcr"] = round(total_put_oi / total_call_oi, 3)
            pcr_data.update({"call_volume": total_call_vol, "put_volume": total_put_vol,
                             "call_oi": total_call_oi, "put_oi": total_put_oi, "date": date_str})
            _add_pcr_sentiment(pcr_data)
            if pcr_data.get("volume_pcr"):
                print(f"  ✅ PCR (CSV fallback)")
    except Exception as e:
        print(f"  CSV fallback also failed: {e}")

    if not pcr_data.get("volume_pcr") and not pcr_data.get("oi_pcr"):
        pcr_data["error"] = "無法解析 PCR 資料（可能非交易日）"
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

        # 支撐壓力位
        sr_levels = calculate_support_resistance(symbol, hist)

        result = {
            "symbol": symbol,
            "name": name,
            "price": round(last_close, 2),
            "change_pct": round(change_pct, 2),
            "volume": volume,
            "date": hist.index[-1].strftime('%Y-%m-%d'),
            "technical": technical,
            "fundamental": fundamental,
        }
        if sr_levels:
            result["support_resistance"] = sr_levels
        return result
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


def fetch_stock_institutional(symbols):
    """抓取自選股的三大法人買賣超（外資 + 投信 + 自營商）— TWSE API
    並累積 5 日歷史到 stock_inst_history.json"""
    print("Fetching per-stock institutional data (TWSE)...", flush=True)
    session = get_tw_session()

    # 只抓台股代碼（.TW / .TWO）
    tw_symbols = {s.replace('.TW', '').replace('.TWO', ''): s for s in symbols if '.TW' in s}
    if not tw_symbols:
        print("  No TW stocks to fetch institutional data for.", flush=True)
        return {}

    # API 對照表
    apis = [
        ('foreign', 'TWT38U'),
        ('trust',   'TWT44U'),
        ('dealer',  'TWT43U'),
    ]

    today_str = current_time.strftime('%Y%m%d')
    today_data = {}  # {full_symbol: {foreign: N, trust: N, dealer: N}}

    for investor_type, endpoint in apis:
        try:
            url = f"https://www.twse.com.tw/fund/{endpoint}?response=json&date={today_str}"
            res = tw_request(session, 'GET', url, referer='https://www.twse.com.tw/zh/trading/fund/TWT38U.html')
            data = res.json()
            if data.get('stat') != 'OK' or not data.get('data'):
                print(f"  ⚠️ {endpoint} no data (maybe non-trading day)", flush=True)
                continue

            for row in data['data']:
                if len(row) < 7:
                    continue
                code = str(row[1]).strip()
                if code not in tw_symbols:
                    continue

                full_symbol = tw_symbols[code]
                if full_symbol not in today_data:
                    today_data[full_symbol] = {'foreign': 0, 'trust': 0, 'dealer': 0}

                if endpoint == 'TWT43U':
                    net_shares = _parse_int(row[4]) + (_parse_int(row[7]) if len(row) > 7 else 0)
                else:
                    net_shares = _parse_int(row[5]) if len(row) > 5 else 0

                today_data[full_symbol][investor_type] = net_shares

            print(f"  ✅ {endpoint} ({investor_type}): parsed {len(data['data'])} rows", flush=True)

        except Exception as e:
            print(f"  ⚠️ {endpoint} fetch failed: {e}", flush=True)

    if not today_data:
        print("  ⚠️ No institutional data fetched today.", flush=True)
        return _load_inst_history_as_result(symbols)

    # ── 累積到 stock_inst_history.json（保留 5 天）──
    history = _load_inst_history()

    # 寫入今日資料（避免同日重複）
    for sym, vals in today_data.items():
        if sym not in history:
            history[sym] = []
        # 移除同日舊資料
        history[sym] = [d for d in history[sym] if d.get('date') != today_str]
        history[sym].append({
            'date': today_str,
            'foreign': vals['foreign'],
            'trust': vals['trust'],
            'dealer': vals['dealer'],
        })
        # 只保留最近 5 天
        history[sym] = history[sym][-5:]

    _save_inst_history(history)

    # ── 組裝結果（含 5 日累計）──
    result = {}
    for sym in [tw_symbols[c] for c in tw_symbols]:
        days = history.get(sym, [])
        if not days:
            continue

        latest = days[-1]
        f_5d = sum(d.get('foreign', 0) for d in days)
        t_5d = sum(d.get('trust', 0) for d in days)
        d_5d = sum(d.get('dealer', 0) for d in days)

        result[sym] = {
            'foreign': {
                'today': latest.get('foreign', 0),
                '5d_total': f_5d,
                'history': [d.get('foreign', 0) for d in days],
            },
            'trust': {
                'today': latest.get('trust', 0),
                '5d_total': t_5d,
                'history': [d.get('trust', 0) for d in days],
            },
            'dealer': {
                'today': latest.get('dealer', 0),
                '5d_total': d_5d,
                'history': [d.get('dealer', 0) for d in days],
            },
            'total_today': latest.get('foreign', 0) + latest.get('trust', 0) + latest.get('dealer', 0),
            'total_5d': f_5d + t_5d + d_5d,
            'days_count': len(days),
            'daily': days,  # 前端可用來畫圖
        }

    print(f"  ✅ Institutional data: {len(result)} stocks, history {len(days)} days", flush=True)
    return result


INST_HISTORY_PATH = "data/stock_inst_history.json"

def _load_inst_history():
    """載入個股法人歷史"""
    if os.path.exists(INST_HISTORY_PATH):
        try:
            with open(INST_HISTORY_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _save_inst_history(history):
    """儲存個股法人歷史"""
    os.makedirs("data", exist_ok=True)
    with open(INST_HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

def _load_inst_history_as_result(symbols):
    """非交易日時，從歷史檔載入最近資料"""
    history = _load_inst_history()
    result = {}
    for sym in symbols:
        days = history.get(sym, [])
        if not days:
            continue
        latest = days[-1]
        f_5d = sum(d.get('foreign', 0) for d in days)
        t_5d = sum(d.get('trust', 0) for d in days)
        d_5d = sum(d.get('dealer', 0) for d in days)
        result[sym] = {
            'foreign': {'today': latest.get('foreign', 0), '5d_total': f_5d, 'history': [d.get('foreign', 0) for d in days]},
            'trust': {'today': latest.get('trust', 0), '5d_total': t_5d, 'history': [d.get('trust', 0) for d in days]},
            'dealer': {'today': latest.get('dealer', 0), '5d_total': d_5d, 'history': [d.get('dealer', 0) for d in days]},
            'total_today': latest.get('foreign', 0) + latest.get('trust', 0) + latest.get('dealer', 0),
            'total_5d': f_5d + t_5d + d_5d,
            'days_count': len(days),
            'daily': days,
        }
    return result


def accumulate_chip_history(chip_data):
    """將當日三大法人數據累積到 chip_history.json（保留最近 10 天）"""
    history_path = "data/chip_history.json"
    history = []

    if os.path.exists(history_path):
        try:
            with open(history_path, "r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = []

    if not chip_data or not chip_data.get("summary"):
        return history

    today_str = chip_data.get("date", current_time.strftime('%Y%m%d'))

    # 避免重複寫入同一天
    history = [h for h in history if h.get("date") != today_str]

    # 解析三大法人買賣超
    entry = {"date": today_str}
    for row in chip_data.get("summary", []):
        if not row or len(row) < 4:
            continue
        name = str(row[0]).strip()
        amount = _parse_int(row[3]) if len(row) > 3 else 0
        if "外資" in name or "外陸資" in name:
            entry["外資"] = amount
        elif "投信" in name:
            entry["投信"] = amount
        elif "自營商" in name:
            entry["自營商"] = amount

    if any(k in entry for k in ["外資", "投信", "自營商"]):
        history.append(entry)

    # 只保留最近 10 天
    history = history[-10:]

    os.makedirs("data", exist_ok=True)
    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

    print(f"  ✅ Chip history: {len(history)} days saved")
    return history


def fetch_cloud_watchlist_symbols():
    """從 Worker KV 拉取所有使用者的自選股清單，合併為唯一清單"""
    print("Fetching cloud watchlist from Worker KV...")
    all_symbols = set()
    try:
        worker_url = "https://tw-stock-ai-proxy.noh486951-e8a.workers.dev/api/watchlist/all-symbols"
        res = requests.get(worker_url, timeout=15)
        if res.status_code == 200:
            data = res.json()
            symbols = data.get("symbols", [])
            for s in symbols:
                all_symbols.add(s)
            print(f"  Cloud watchlist: {len(all_symbols)} unique stocks from all users")
        else:
            print(f"  Cloud watchlist API returned {res.status_code}, falling back to local")
    except Exception as e:
        print(f"  Cloud watchlist fetch failed: {e}, falling back to local")
    return list(all_symbols)


def fetch_watchlist_data():
    """讀取自選股清單（雲端優先 + 本地 fallback）並抓取所有自選股資料"""
    print("Fetching watchlist data...")

    # 1. 從雲端拉取所有使用者的自選股
    cloud_symbols = fetch_cloud_watchlist_symbols()

    # 2. 本地 watchlist.json 作為 fallback / 補充
    watchlist_path = "data/watchlist.json"
    local_symbols = []
    if os.path.exists(watchlist_path):
        try:
            with open(watchlist_path, "r", encoding="utf-8") as f:
                local_symbols = json.load(f)
        except Exception:
            pass

    # 3. 合併去重
    all_symbols = list(dict.fromkeys(cloud_symbols + local_symbols))  # 保持順序去重

    if not all_symbols:
        print("  No watchlist stocks found (cloud + local).")
        return {}

    print(f"  Total watchlist: {len(all_symbols)} stocks → {all_symbols}")

    # 4. 更新本地 watchlist.json（讓 ai_analyzer 也能讀到完整清單）
    with open(watchlist_path, "w", encoding="utf-8") as f:
        json.dump(all_symbols, f, ensure_ascii=False)

    result = {}
    for symbol in all_symbols:
        print(f"  Fetching: {symbol}")
        result[symbol] = fetch_stock_detail(symbol)

    # 計算籌碼集中度
    chip_conc = fetch_chip_concentration(all_symbols)
    for symbol, conc in chip_conc.items():
        if symbol in result:
            result[symbol]["chip_concentration"] = conc

    return result


def detect_anomalies(market_data, breadth_data, margin_data, pcr_data, futures_data):
    """異常波動預警系統 — 複合觸發條件偵測"""
    print("Running anomaly detection...")
    alerts = []

    # 1. 大盤異常波動
    taiex = market_data.get("TAIEX", {})
    if taiex.get("change_pct") is not None:
        change = abs(taiex["change_pct"])
        if change >= 3.0:
            alerts.append({
                "level": "critical",
                "type": "market_crash",
                "title": f"大盤劇烈波動 {'暴跌' if taiex['change_pct'] < 0 else '暴漲'} {taiex['change_pct']}%",
                "description": f"加權指數單日變動超過 3%，目前 {taiex.get('price', '-')} 點",
                "action": "檢視持股風險，考慮停損或減碼",
            })
        elif change >= 1.5:
            alerts.append({
                "level": "warning",
                "type": "market_volatile",
                "title": f"大盤波動加劇 {'+' if taiex['change_pct'] > 0 else ''}{taiex['change_pct']}%",
                "description": f"加權指數波動超過 1.5%，建議提高警覺",
                "action": "關注量能變化與法人動向",
            })

    # 2. VIX 恐慌指標
    vix = market_data.get("VIX", {})
    if vix.get("price") is not None:
        if vix["price"] >= 30:
            alerts.append({
                "level": "critical",
                "type": "vix_panic",
                "title": f"VIX 恐慌指數飆升至 {vix['price']}",
                "description": "VIX > 30 代表市場極度恐慌，全球股市可能劇烈震盪",
                "action": "避免追高，保留現金部位，等待恐慌消退",
            })
        elif vix["price"] >= 20:
            alerts.append({
                "level": "warning",
                "type": "vix_elevated",
                "title": f"VIX 指數偏高 {vix['price']}",
                "description": "VIX 20-30 區間代表市場不安情緒上升",
                "action": "降低槓桿，注意防禦性配置",
            })

    # 3. 漲跌家數比異常
    breadth = breadth_data.get("summary", {})
    if breadth.get("up") and breadth.get("down"):
        ratio = breadth["advance_decline_ratio"] if breadth.get("advance_decline_ratio") else 0
        if ratio > 5.0:
            alerts.append({
                "level": "info",
                "type": "breadth_extreme_bull",
                "title": f"全面上漲 漲跌比 {ratio}",
                "description": f"漲 {breadth['up']} / 跌 {breadth['down']}，市場情緒極度樂觀",
                "action": "短線可能過熱，追高需謹慎",
            })
        elif ratio < 0.2:
            alerts.append({
                "level": "critical",
                "type": "breadth_extreme_bear",
                "title": f"全面下跌 漲跌比僅 {ratio}",
                "description": f"漲 {breadth['up']} / 跌 {breadth['down']}，市場恐慌性殺盤",
                "action": "不宜抄底，等待止跌訊號",
            })
        if breadth.get("up_limit", 0) >= 30:
            alerts.append({
                "level": "warning",
                "type": "limit_up_surge",
                "title": f"漲停家數異常 ({breadth['up_limit']} 檔)",
                "description": "大量個股漲停，可能有重大利多或軋空行情",
                "action": "追蹤漲停族群，但避免追漲停板",
            })
        if breadth.get("down_limit", 0) >= 30:
            alerts.append({
                "level": "critical",
                "type": "limit_down_surge",
                "title": f"跌停家數異常 ({breadth['down_limit']} 檔)",
                "description": "大量個股跌停，市場信心崩潰",
                "action": "停損優先，不要攤平",
            })

    # 4. 融資斷頭風險
    margin = margin_data.get("summary", {})
    if margin.get("margin_change") is not None:
        if margin["margin_change"] < -5000:
            alerts.append({
                "level": "warning",
                "type": "margin_call",
                "title": f"融資大減 {margin['margin_change']:,} 張",
                "description": "融資大幅減少可能代表散戶被迫斷頭",
                "action": "市場下方可能有止穩支撐，但仍需觀察",
            })

    # 5. PCR 極端值
    pcr = pcr_data or {}
    vol_pcr = pcr.get("volume_pcr", 0)
    if vol_pcr > 1.5:
        alerts.append({
            "level": "info",
            "type": "pcr_extreme_fear",
            "title": f"PCR 極高 {vol_pcr} — 極度恐慌",
            "description": "Put/Call 比率異常高，市場避險情緒濃厚（通常為反向指標）",
            "action": "歷史經驗顯示 PCR 極端後常有反彈",
        })
    elif vol_pcr > 0 and vol_pcr < 0.4:
        alerts.append({
            "level": "warning",
            "type": "pcr_extreme_greed",
            "title": f"PCR 極低 {vol_pcr} — 極度樂觀",
            "description": "市場過度樂觀，通常是反向指標，小心回檔",
            "action": "不宜追高，考慮部分獲利了結",
        })

    # 6. 外資期貨淨部位突變
    futures = futures_data or {}
    fi = futures.get("foreign_investor", {})
    if fi.get("net_oi") is not None:
        net = fi["net_oi"]
        if abs(net) > 30000:
            bias = "大幅偏多" if net > 0 else "大幅偏空"
            alerts.append({
                "level": "warning",
                "type": "futures_extreme",
                "title": f"外資期貨淨部位極端 {'+' if net > 0 else ''}{net:,} 口",
                "description": f"外資期貨 {bias}，影響隔日台股走勢",
                "action": f"外資{'看多' if net > 0 else '看空'}態度明確，順勢操作",
            })

    # 7. 美股大幅波動
    sp500 = market_data.get("S&P500", {})
    nasdaq = market_data.get("NASDAQ", {})
    for idx_name, idx in [("S&P500", sp500), ("NASDAQ", nasdaq)]:
        if idx.get("change_pct") is not None and abs(idx["change_pct"]) >= 2.0:
            alerts.append({
                "level": "warning",
                "type": "us_market_volatile",
                "title": f"{idx_name} 大幅{'上漲' if idx['change_pct'] > 0 else '下跌'} {idx['change_pct']}%",
                "description": f"美股劇烈波動，台股開盤恐受影響",
                "action": "注意台股開盤跳空風險",
            })

    # Sort by severity
    level_order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda x: level_order.get(x.get("level", "info"), 3))

    return alerts


def calculate_support_resistance(symbol, hist):
    """計算支撐壓力位與停損建議"""
    try:
        closes = hist['Close']
        highs = hist['High']
        lows = hist['Low']
        last_close = float(closes.iloc[-1])

        if len(closes) < 20:
            return None

        # 1. 布林通道支撐壓力
        ma20 = float(closes.rolling(20).mean().iloc[-1])
        std20 = float(closes.rolling(20).std().iloc[-1])
        boll_upper = round(ma20 + 2 * std20, 2)
        boll_lower = round(ma20 - 2 * std20, 2)

        # 2. 近期高低點
        recent_high_20 = round(float(highs.iloc[-20:].max()), 2)
        recent_low_20 = round(float(lows.iloc[-20:].min()), 2)
        recent_high_60 = round(float(highs.iloc[-60:].max()), 2) if len(highs) >= 60 else recent_high_20
        recent_low_60 = round(float(lows.iloc[-60:].min()), 2) if len(lows) >= 60 else recent_low_20

        # 3. 均線支撐壓力
        ma_levels = {}
        for period in [5, 10, 20, 60, 120]:
            if len(closes) >= period:
                ma_val = round(float(closes.rolling(period).mean().iloc[-1]), 2)
                ma_levels[f"MA{period}"] = ma_val

        # 4. 識別支撐位（價格下方最近的關鍵位）
        supports = []
        resistances = []

        key_levels = list(ma_levels.values()) + [boll_lower, recent_low_20, recent_low_60]
        for lv in sorted(set(key_levels)):
            if lv < last_close * 0.995:  # 比現價低 0.5% 以上
                supports.append(round(lv, 2))

        key_highs = list(ma_levels.values()) + [boll_upper, recent_high_20, recent_high_60]
        for lv in sorted(set(key_highs)):
            if lv > last_close * 1.005:  # 比現價高 0.5% 以上
                resistances.append(round(lv, 2))

        # 取最近 3 個支撐和壓力
        supports = sorted(supports, reverse=True)[:3]  # 從高到低
        resistances = sorted(resistances)[:3]  # 從低到高

        # 5. 停損建議
        # 保守停損：最近支撐位下方 2%
        # 積極停損：最近支撐位下方 1%
        nearest_support = supports[0] if supports else boll_lower
        stop_loss_conservative = round(nearest_support * 0.98, 2)
        stop_loss_aggressive = round(nearest_support * 0.99, 2)

        # 停損百分比
        stop_pct_conservative = round((last_close - stop_loss_conservative) / last_close * 100, 2)
        stop_pct_aggressive = round((last_close - stop_loss_aggressive) / last_close * 100, 2)

        # 6. 目標價（最近壓力位）
        target_price = resistances[0] if resistances else boll_upper
        target_pct = round((target_price - last_close) / last_close * 100, 2)

        # 7. 風險報酬比
        risk = last_close - stop_loss_conservative
        reward = target_price - last_close
        risk_reward = round(reward / risk, 2) if risk > 0 else 0

        return {
            "supports": supports,
            "resistances": resistances,
            "boll_upper": boll_upper,
            "boll_lower": boll_lower,
            "recent_high_20d": recent_high_20,
            "recent_low_20d": recent_low_20,
            "recent_high_60d": recent_high_60,
            "recent_low_60d": recent_low_60,
            "ma_levels": ma_levels,
            "stop_loss": {
                "conservative": stop_loss_conservative,
                "conservative_pct": stop_pct_conservative,
                "aggressive": stop_loss_aggressive,
                "aggressive_pct": stop_pct_aggressive,
            },
            "target": {
                "price": target_price,
                "upside_pct": target_pct,
            },
            "risk_reward_ratio": risk_reward,
        }
    except Exception as e:
        print(f"  Error calculating S/R for {symbol}: {e}")
        return None


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

    # 個股法人買賣超
    if watchlist_data:
        tw_symbols = [s for s in watchlist_data.keys() if '.TW' in s]
        if tw_symbols:
            institutional_data = fetch_stock_institutional(tw_symbols)
            for sym, inst in institutional_data.items():
                if sym in watchlist_data:
                    watchlist_data[sym]["institutional"] = inst

    # 累積三大法人歷史資料
    chip_history = accumulate_chip_history(chip_data)

    # 異常波動預警
    anomaly_alerts = detect_anomalies(market_data, breadth_data, margin_data, pcr_data, futures_data)

    output = {
        "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
        "market": market_data,
        "chips": chip_data,
        "chip_history": chip_history,
        "margin": margin_data,
        "breadth": breadth_data,
        "futures": futures_data,
        "pcr": pcr_data,
        "alerts": anomaly_alerts,
        "news": news_data,
        "watchlist": watchlist_data,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/raw_data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("Data fetch completed. Saved to data/raw_data.json")


if __name__ == "__main__":
    main()
