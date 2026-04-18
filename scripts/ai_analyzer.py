import os
import json
from google import genai
from google.genai import types
from datetime import datetime
import pytz
import time

import requests
# Setup Timezone
tw_tz = pytz.timezone('Asia/Taipei')
current_time = datetime.now(tw_tz)


# ============================================================
# 多模型 AI 策略 (v10.4)
# ============================================================
# 任務              | 模型                         | 原因
# ─────────────────|─────────────────────────────|──────────────────────
# 晨間快報          | Groq (Llama 3 70B)          | 高速長文本，不佔 Gemini 額度
# 個股批次分析(≤50) | Gemini 3.1 Flash-Lite        | 批次 50 檔一個 Request
# 大盤/族群分析     | Gemini 3.1 Flash-Lite        | 統一模型，簡化管理
# 備援              | Mistral Small               | Gemini 不可用時切換
# ============================================================

# ============================================================
# Gemini 設定 — v10.6 Role-based Key Pool
# ============================================================
# 三把 key 的角色分工（非 round-robin，避免同時刻打到過載節點）：
#   KEY1 (primary)   — watchlist batch 全自動診斷（每 10 分鐘）
#   KEY2 (secondary) — 市場脈動 / 晨間快報 / 財務分析
#   KEY3 (backup)    — sector_map 族群地圖 (每週 1 次) + 其他 key 的共用備援
# ============================================================
GEMINI_KEY_POOL = {
    "primary":   os.environ.get("GOOGLE_API_KEY"),
    "secondary": os.environ.get("GOOGLE_API_KEY2"),
    "backup":    os.environ.get("GOOGLE_API_KEY3"),
}
# 移除空 key
GEMINI_KEY_POOL = {k: v for k, v in GEMINI_KEY_POOL.items() if v}

# 每個 role 的 fallback 優先序（遇到 503/429 時往後切）
ROLE_CHAIN = {
    "watchlist":  ["primary", "backup", "secondary"],
    "market":     ["secondary", "backup", "primary"],
    "sector":     ["backup", "secondary", "primary"],
    "financial":  ["secondary", "backup", "primary"],
    "default":    ["primary", "secondary", "backup"],
}

# 向下相容：舊程式碼直接 import GEMINI_API_KEYS / GEMINI_API_KEY 時仍可用
GEMINI_API_KEYS = list(GEMINI_KEY_POOL.values())
GEMINI_API_KEY = GEMINI_API_KEYS[0] if GEMINI_API_KEYS else None

# 模型名稱
MODEL_FLASH = 'gemini-3.1-flash-lite-preview'       # 全面改用 3.1 Flash-Lite
MODEL_FLASH_LITE = 'gemini-3.1-flash-lite-preview'  # 全面改用 3.1 Flash-Lite

# Groq 設定（晨間快報用）
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = 'llama-3.3-70b-versatile'  # 高速推理
GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

# Mistral 設定（備援）
MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY")
MISTRAL_MODEL = 'mistral-small-latest'

MAX_RETRIES = 3
RETRY_DELAYS = [5, 15, 30]
# Groq 專用（免費 TPM 容易爆，退避時間拉長）
GROQ_RETRY_DELAYS = [15, 45, 90]

# (v10.6 後棄用：改用 role-based chain，保留變數避免舊 import 炸掉)
_current_key_idx = 0


def _safe_json_loads(text):
    """容錯 JSON 解析：處理 Gemini/Groq 偶發的「JSON 後面多垃圾」問題

    常見情況：
    - 回傳用 ```json ... ``` 包裹
    - 合法 JSON 後面多幾行文字（ExtraData）
    - 前面多一段說明文字

    做法：先 strip markdown fence，再用 raw_decode 取第一個 JSON 物件。
    """
    if not isinstance(text, str):
        raise ValueError("Expected string input")

    s = text.strip()
    # 去掉 ```json ... ``` / ``` ... ```
    if s.startswith('```'):
        # 去第一行的 ``` 或 ```json
        s = s.split('\n', 1)[1] if '\n' in s else s
        # 去尾端 ```
        if s.rstrip().endswith('```'):
            s = s.rstrip()[:-3]
        s = s.strip()

    # 嘗試直接解析
    try:
        return json.loads(s)
    except json.JSONDecodeError as first_err:
        # fallback 1: 找第一個 { 或 [ 開始的位置，用 raw_decode 只取第一個物件
        try:
            decoder = json.JSONDecoder()
            # 找第一個 JSON 開始字元
            for start_char in ('{', '['):
                idx = s.find(start_char)
                if idx >= 0:
                    try:
                        obj, _end = decoder.raw_decode(s[idx:])
                        return obj
                    except json.JSONDecodeError:
                        continue
        except Exception:
            pass
        raise first_err


def _build_client(key_name):
    """依 key_name 建立 Gemini client（key_name ∈ {primary, secondary, backup}）"""
    api_key = GEMINI_KEY_POOL.get(key_name)
    if not api_key:
        return None
    return genai.Client(
        api_key=api_key,
        http_options={"timeout": 120_000},
    )


def get_client(role="default", key_index=None):
    """取得 Gemini client

    新版：支援 role-based 取用。傳 role="watchlist" / "market" / "sector" / "financial"
    舊版相容：傳 key_index (int) 仍然可用，會退到 ROLE_CHAIN["default"]
    """
    if not GEMINI_KEY_POOL:
        return None

    # 舊版呼叫: get_client(0) / get_client(1)
    if isinstance(role, int) or key_index is not None:
        idx = role if isinstance(role, int) else key_index
        chain = ROLE_CHAIN["default"]
        if idx is not None and 0 <= idx < len(chain):
            return _build_client(chain[idx])
        return _build_client(chain[0])

    chain = ROLE_CHAIN.get(role, ROLE_CHAIN["default"])
    # 回傳該 role 的第一優先 key 的 client
    for name in chain:
        if name in GEMINI_KEY_POOL:
            return _build_client(name)
    return None


def _next_client_in_chain(role, current_key_name):
    """遇到 503/429 時，在該 role 的 chain 裡找下一把 key"""
    chain = ROLE_CHAIN.get(role, ROLE_CHAIN["default"])
    # 過濾只留可用的 key
    available = [k for k in chain if k in GEMINI_KEY_POOL]
    if not available:
        return None, None
    # 找下一把
    try:
        idx = available.index(current_key_name)
        next_name = available[(idx + 1) % len(available)]
    except ValueError:
        next_name = available[0]
    if next_name == current_key_name:
        return None, None  # 已經繞一圈了
    return next_name, _build_client(next_name)


def _client_key_name(client):
    """從 client 反查目前用哪把 key (比對 api_key 字串)"""
    if client is None:
        return None
    try:
        api_key = getattr(client, "_api_client", None) and getattr(client._api_client, "_api_key", None)
    except Exception:
        api_key = None
    if not api_key:
        return None
    for name, key in GEMINI_KEY_POOL.items():
        if key == api_key:
            return name
    return None


def gemini_generate_with_retry(client, prompt, model=None, temperature=0.5, response_mime_type="application/json", role="default"):
    """帶重試邏輯 + role-based Key 自動切換的 Gemini API 呼叫

    role: 遇到 503/429 時依這個 role 的 chain 切下一把 key
    """
    last_error = None
    use_model = model or MODEL_FLASH

    current_key_name = _client_key_name(client) or ROLE_CHAIN.get(role, ROLE_CHAIN["default"])[0]

    for attempt in range(MAX_RETRIES):
        try:
            print(f"  🔵 Calling {use_model} [role={role}, key={current_key_name}] (attempt {attempt+1}/{MAX_RETRIES})...", flush=True)
            response = client.models.generate_content(
                model=use_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type=response_mime_type,
                    temperature=temperature,
                ),
            )
            print(f"  ✅ {use_model} responded OK (key={current_key_name})", flush=True)
            return response
        except Exception as e:
            last_error = e
            err_str = str(e)
            retriable = any(code in err_str for code in
                ['503', '504', '429', 'UNAVAILABLE', 'DEADLINE_EXCEEDED',
                 'overloaded', 'high demand', 'RESOURCE_EXHAUSTED'])
            if retriable:
                # 503/429 → 直接切下一把 key（同 role chain），不 retry 同一把
                if len(GEMINI_KEY_POOL) > 1:
                    next_name, next_client = _next_client_in_chain(role, current_key_name)
                    if next_client is not None:
                        print(f"  🔄 [{role}] Key {current_key_name} 503/429，切換至 {next_name}", flush=True)
                        client = next_client
                        current_key_name = next_name
                delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
                print(f"  ⚠️ API 暫時不可用 (attempt {attempt+1}/{MAX_RETRIES})，{delay}s 後重試... Error: {err_str[:100]}", flush=True)
                time.sleep(delay)
            else:
                print(f"  ❌ 不可重試的錯誤: {err_str[:200]}", flush=True)
                raise
    raise last_error


def groq_generate(prompt, temperature=0.7):
    """使用 Groq API (Llama 3) 生成內容 — 適合高速長文本任務"""
    if not GROQ_API_KEY:
        return None

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                GROQ_API_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": "你是一位專精台灣股市的資深金融分析師。請用 JSON 格式回覆，直接回傳 JSON 字串，不要用 markdown code block 包裹。"},
                        {"role": "user", "content": prompt},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": temperature,
                    "max_tokens": 4096,
                },
                timeout=60,
            )

            if response.status_code == 200:
                content = response.json()['choices'][0]['message']['content']
                return _safe_json_loads(content)
            elif response.status_code == 429:
                # 優先讀 Groq 回傳的 Retry-After header（秒）
                retry_after = response.headers.get('retry-after') or response.headers.get('Retry-After')
                try:
                    delay = int(float(retry_after)) if retry_after else GROQ_RETRY_DELAYS[min(attempt, len(GROQ_RETRY_DELAYS) - 1)]
                except (ValueError, TypeError):
                    delay = GROQ_RETRY_DELAYS[min(attempt, len(GROQ_RETRY_DELAYS) - 1)]
                # 上限 120 秒，避免 GH Actions 卡太久
                delay = min(delay, 120)
                print(f"  ⚠️ Groq 429, {delay}s 後重試 (attempt {attempt+1}/{MAX_RETRIES})...", flush=True)
                time.sleep(delay)
            else:
                print(f"  Groq API Error: {response.status_code} {response.text[:200]}")
                return None
        except Exception as e:
            print(f"  Groq Exception: {e}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(GROQ_RETRY_DELAYS[attempt])

    return None


# ============================================================
# 1. 整體盤勢分析
# ============================================================

def analyze_market(client, data):
    """使用 Gemini 分析整體盤勢"""
    print("Initiating market AI analysis...", flush=True)
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
        # 大盤分析用 Gemini Flash（複雜推理）
        response = gemini_generate_with_retry(client, prompt, model=MODEL_FLASH, temperature=0.5, role="market")
        result = _safe_json_loads(response.text)
        result["status"] = "success"
        result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
        result["model_used"] = MODEL_FLASH
        return result
    except Exception as e:
        print(f"Error during market analysis: {e}")
        # Mistral fallback for market analysis
        if MISTRAL_API_KEY:
            print("  Attempting Mistral fallback for market analysis...")
            try:
                mres = requests.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {MISTRAL_API_KEY}", "Content-Type": "application/json"},
                    json={
                        "model": MISTRAL_MODEL,
                        "messages": [
                            {"role": "system", "content": "You are a professional Taiwan stock market analyst. Respond ONLY with raw JSON."},
                            {"role": "user", "content": prompt},
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.5,
                    },
                    timeout=60,
                )
                if mres.status_code == 200:
                    result = _safe_json_loads(mres.json()['choices'][0]['message']['content'])
                    result["status"] = "success"
                    result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
                    result["model_used"] = f"mistral:{MISTRAL_MODEL}"
                    return result
            except Exception as me:
                print(f"  Mistral market fallback also failed: {me}")
        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "summary": f"分析失敗：{str(e)}",
            "observations": [],
        }


# ============================================================
# 2. 晨間 AI 財經快報 (5-10 分鐘閱讀量)
# ============================================================

def _get_session_info():
    """根據台灣時間判斷當前時段，回傳 (session_id, show_name, role_desc)"""
    hour = current_time.hour
    if hour < 9:
        return "morning", "台股早安", "每天早上 8 點為散戶投資人錄製盤前分析快報。重點在國際市場收盤後的影響、今日開盤預判。"
    elif hour < 12:
        return "midday", "台股盤中快訊", "盤中 10 點為投資人即時更新。重點在盤中走勢變化、量能觀察、盤中異動。"
    elif hour < 16:
        return "afternoon", "台股午安", "收盤後 14:30 為投資人總結今日盤勢。重點在收盤數據、法人買賣超、今日贏家輸家。"
    else:
        return "evening", "台股晚安", "晚間 18 點為投資人做盤後深度總結。重點在完整數據回顧、明日展望、美股盤前動態。"


def generate_morning_digest(client, data):
    """產生 AI 財經快報 — 依時段自動切換 (早安/盤中/午安/晚安)"""
    session_id, show_name, role_desc = _get_session_info()
    print(f"Generating digest [{show_name}]...", flush=True)
    if not client and not GROQ_API_KEY:
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

    # 取得新聞追蹤清單
    news_tracking = data.get("news_tracking_stocks", [])

    context = {
        "market_indices": market,
        "institutional_chips": chips,
        "margin_trading": data.get("margin", {}),
        "market_breadth": data.get("breadth", {}),
        "futures_oi": data.get("futures", {}),
        "put_call_ratio": data.get("pcr", {}),
        "news_headlines": [n.get("title", "") for n in news],
        "watchlist_stocks": watchlist_summary,
        "news_tracking_stocks": news_tracking,
        "current_date": current_time.strftime('%Y年%m月%d日 %A'),
        "session": session_id,
    }

    prompt = f"""
    你是「{show_name}」節目的王牌主播，{role_desc}
    你的風格是專業但口語化，會用生動的比喻讓複雜的金融概念變得好懂。
    現在時間：{current_time.strftime('%H:%M')}（台灣時間）

    請根據以下完整資料，撰寫這一時段的財經快報。

    資料：
    {json.dumps(context, ensure_ascii=False, indent=2)}

    請用 JSON 格式回覆，包含以下 key：

    - "session": "{session_id}" (時段標識)
    - "show_name": "{show_name}"
    - "title": string (今日快報標題，吸引人的，像新聞標題，繁體中文)
    - "greeting": string (開場白，1-2 句，像主播開場，用「{show_name}」打招呼)
    - "sections": list of objects，每個 object 包含：
        - "heading": string (段落標題)
        - "body": string (段落內容，每段 100-200 字)
    要求的段落（按順序）：
        1. 國際局勢快覽 - 美股三大指數表現、VIX、匯率、重大國際事件對台股的影響
        2. 台股盤勢重點 - 加權指數、成交量、三大法人動向、今日多空研判
        3. 熱門族群與個股 - 根據新聞和數據，哪些產業/個股值得關注、為什麼
        4. 自選股體檢 - 逐檔分析追蹤中的自選股（價格、漲跌、技術面狀態、需要注意什麼）
        5. 📰 個股新聞追蹤 - 使用者特別關注以下個股的相關新聞（news_tracking_stocks），請逐檔搜尋新聞標題中是否有相關內容，有的話詳細說明，沒有的話明確寫「近期無相關新聞」
        6. 今日操作建議 - 整體建議、風險提醒、關鍵價位提示
    - "risk_alerts": list of strings (今日風險警示，1-3 條)
    - "closing": string (結語，像主播收尾，用符合「{show_name}」氛圍的方式結尾)
    """

    # 策略：Groq (高速) → Gemini Flash (fallback)
    # Groq 的推論速度極快（>800 token/s），適合長文本摘要，且不佔 Gemini 額度
    if GROQ_API_KEY:
        print("  Using Groq API (Llama 3 70B) for morning digest...")
        result = groq_generate(prompt, temperature=0.7)
        if result:
            result["status"] = "success"
            result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
            result["model_used"] = f"groq:{GROQ_MODEL}"
            print(f"  ✅ Morning digest generated via Groq")
            return result
        print("  ⚠️ Groq failed, falling back to Gemini...")

    try:
        response = gemini_generate_with_retry(client, prompt, model=MODEL_FLASH, temperature=0.7, role="market")
        result = _safe_json_loads(response.text)
        result["status"] = "success"
        result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
        result["model_used"] = MODEL_FLASH
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
    """使用 Gemini 深度分析單一個股（fallback 用，正常走 batch）"""
    if "error" in stock_data:
        return {"analysis": f"資料抓取失敗：{stock_data['error']}"}

    news_context = ""
    if news_titles:
        news_context = f"""
    今日財經新聞標題（請找出與此股票相關的新聞並在分析中提及）：
    {json.dumps(news_titles, ensure_ascii=False)}
    """

    # 法人買賣超資料
    inst_context = ""
    inst = stock_data.get('institutional', {})
    if inst:
        inst_context = f"""
    三大法人買賣超（股）：
    - 外資今日: {inst.get('foreign',{}).get('today',0):,} / 5日累計: {inst.get('foreign',{}).get('5d_total',0):,}
    - 投信今日: {inst.get('trust',{}).get('today',0):,} / 5日累計: {inst.get('trust',{}).get('5d_total',0):,}
    - 自營商今日: {inst.get('dealer',{}).get('today',0):,} / 5日累計: {inst.get('dealer',{}).get('5d_total',0):,}
    - 三大法人合計今日: {inst.get('total_today',0):,} / 5日累計: {inst.get('total_5d',0):,}
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
    {inst_context}
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
        "analysis": "200-300 字深度分析（繁體中文），涵蓋：技術面均線/RSI/KD/MACD/布林狀態、本益比與產業比較、三大法人動向解讀、相關新聞影響、近期催化劑或風險",
        "suggestion": "具體操作建議，含進場價位與停損價位（繁體中文）",
        "highlights": ["3-5 個投資重點提示（繁體中文）"]
    }}

    注意：
    - reasons 至少 3 條，涵蓋不同面向（特別是法人籌碼面）
    - confidence 反映分析資料的完整度
    - scores 各維度要與 reasons 分析一致
    """

    try:
        response = gemini_generate_with_retry(client, prompt, model=MODEL_FLASH_LITE, temperature=0.4, role="watchlist")
        result = _safe_json_loads(response.text)
        result["model_used"] = MODEL_FLASH_LITE
        return result
    except Exception as e:
        print(f"  Flash-Lite Error analyzing {symbol}: {e}")
        if MISTRAL_API_KEY:
            print(f"  Attempting Mistral fallback for {symbol}...")
            return analyze_stock_with_mistral(symbol, stock_data, news_titles)
        return {"analysis": f"AI 分析失敗（Flash-Lite + Mistral 皆不可用）：{str(e)}"}


def analyze_stock_with_mistral(symbol, stock_data, news_titles=None):
    """當 Gemini 額度用完時，使用 Mistral 作為個股分析備援"""
    news_context = ""
    if news_titles:
        news_context = f"今日財經新聞標題：{json.dumps(news_titles, ensure_ascii=False)}"

    prompt = f"""
    你是一位專精台灣股市的資深分析師。請根據以下個股資料，提供嚴格的 JSON 格式深度分析報告。
    股票：{stock_data.get('name', symbol)} ({symbol})
    目前價格：{stock_data.get('price')}
    漲跌幅：{stock_data.get('change_pct')}%
    技術指標：{json.dumps(stock_data.get('technical', {}), ensure_ascii=False)}
    基本面：{json.dumps(stock_data.get('fundamental', {}), ensure_ascii=False)}
    {news_context}

    請回傳 JSON 結構（嚴禁 markdown block，直接回傳 JSON 字串）：
    {{
        "verdict": "Bullish" | "Bearish" | "Neutral",
        "confidence": 0-100,
        "trend": "偏多" | "偏空" | "盤整",
        "support": "支撐區間",
        "resistance": "壓力區間",
        "risk_level": "低" | "中" | "高",
        "industry_pe_avg": 數字,
        "reasons": [{{ "type": "chip"|"technical"|"sentiment"|"macro", "text": "理由", "weight": 0.0-1.0 }}],
        "scores": {{ "chip": -3~3, "technical": -3~3, "sentiment": -3~3, "macro": -3~3 }},
        "analysis": "200-300 字深度分析",
        "suggestion": "操作建議",
        "highlights": ["3-5個重點"]
    }}
    """

    try:
        # 增加延遲以符合 Mistral API 的速率限制 (Rate Limit)
        print(f"  Mistral analysis start (2s cool-down)...")
        time.sleep(2)
        response = requests.post(
            "https://api.mistral.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {MISTRAL_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": MISTRAL_MODEL,
                "messages": [
                    {"role": "system", "content": "You are a professional stock analyst. Respond ONLY with raw JSON."},
                    {"role": "user", "content": prompt}
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.3
            },
            timeout=30
        )
        if response.status_code == 200:
            content = response.json()['choices'][0]['message']['content']
            return _safe_json_loads(content)
        else:
            print(f"  Mistral API Error: {response.status_code} {response.text}")
            return {"analysis": f"Mistral 分析失敗：HTTP {response.status_code}"}
    except Exception as e:
        print(f"  Mistral Exception: {e}")
        return {"analysis": f"Mistral 異常：{str(e)}"}


BATCH_SIZE = 5  # 每批最多 5 檔，避免 504 DEADLINE_EXCEEDED


def _build_stock_entry(symbol, stock_data):
    """將個股資料包裝為 AI prompt 用的精簡格式"""
    entry = {
        "name": stock_data.get("name", symbol),
        "price": stock_data.get("price"),
        "change_pct": stock_data.get("change_pct"),
        "volume": stock_data.get("volume"),
        "technical": stock_data.get("technical", {}),
        "fundamental": stock_data.get("fundamental", {}),
        "chip_concentration": stock_data.get("chip_concentration", {}),
    }
    inst = stock_data.get("institutional", {})
    if inst:
        entry["institutional"] = {
            "foreign_today": inst.get("foreign", {}).get("today", 0),
            "foreign_5d": inst.get("foreign", {}).get("5d_total", 0),
            "trust_today": inst.get("trust", {}).get("today", 0),
            "trust_5d": inst.get("trust", {}).get("5d_total", 0),
            "dealer_today": inst.get("dealer", {}).get("today", 0),
            "dealer_5d": inst.get("dealer", {}).get("5d_total", 0),
            "total_today": inst.get("total_today", 0),
            "total_5d": inst.get("total_5d", 0),
        }
    # v10.5: 量能比資訊（若 watchlist_quick.py 有計算就帶上）
    vol_info = stock_data.get("volume_analysis")
    if vol_info:
        entry["volume_analysis"] = vol_info
    # v10.5: 財務預警系統
    fin_alerts = stock_data.get("financial_alerts")
    if fin_alerts:
        entry["financial_alerts"] = fin_alerts
    # v10.6 功能 1: 每月營收快報（有 anomaly 才帶，省 prompt token）
    mr = stock_data.get("monthly_revenue")
    if mr and mr.get("anomaly"):
        entry["monthly_revenue"] = {
            "month": mr.get("month"),
            "yoy_pct": mr.get("yoy_pct"),
            "mom_pct": mr.get("mom_pct"),
            "cumulative_yoy_pct": mr.get("cumulative_yoy_pct"),
            "anomaly": mr.get("anomaly"),
            "anomaly_reason": mr.get("anomaly_reason"),
        }
    return entry


def _build_batch_prompt(stocks_payload, news_titles):
    """產生批次分析用的 prompt (v10.5: 加入量價關係研判規則)"""
    return f"""
    你是一位專精台灣股市的資深分析師，擁有 20 年的技術分析與產業研究經驗。
    請一次分析以下 {len(stocks_payload)} 檔個股，每檔都要提供完整的結構化分析報告。

    今日財經新聞標題：
    {json.dumps(news_titles, ensure_ascii=False)}

    所有個股資料（含 volume_analysis 欄位時務必解讀量價關係）：
    {json.dumps(stocks_payload, ensure_ascii=False, indent=2)}

    ─────────────────────────────────────────────
    【量價關係研判規則 — 必須套用到每檔有 volume_analysis 的個股】
    ─────────────────────────────────────────────
    volume_analysis.ratio = 當前成交量 / MA5 日均量（已做盤中時間校正）
    判讀原則：
      • ratio > 1.5 且 change_pct > +2%    → 「量增價揚」主力進場，趨勢轉強，偏多訊號
      • ratio > 1.5 且 change_pct < -2%    → 「量增價跌」有人倒貨，籌碼鬆動，偏空警訊
      • ratio < 0.5                        → 「量縮價穩」盤整洗盤，市場觀望，中性
      • ratio > 3.0                        → 「高檔爆量」若位於高檔須提醒短線過熱風險
      • 1.5 < ratio ≤ 3.0 且漲幅不大        → 「量增價穩」蓄勢待發或分批進貨
      • 0.5 ≤ ratio ≤ 1.5                  → 量能正常，以技術面其他指標為主

    若 volume_analysis.note == "skipped_no_base"，表示沒有基準可算，請跳過量價研判。
    若 volume_analysis.intraday_adjusted == true，表示是盤中時間校正後的比值，
    比盤前/盤後的即時觀察更有意義，可以在 analysis 與 highlights 強調。
    ─────────────────────────────────────────────

    ─────────────────────────────────────────────
    【財務預警研判規則 — 若個股含 financial_alerts 欄位必須引用】
    ─────────────────────────────────────────────
    financial_alerts.severity ∈ {{"low","medium","high"}}
      • severity == "high" → risk_level 至少「中」，且 reasons 必須包含一條 type=="macro" 或 "chip" 引用警訊代碼
      • severity == "medium" → 在 analysis 段落提醒，但 risk_level 不一定升級
      • severity == "low" → 僅在 highlights 補充觀察
    警訊代碼對照：
      2 = 淨值偏低且虧損
      3 = 財務結構惡化（淨值低+高負債+流動比弱）
      9 = 營收大幅衰退（YoY<-30%）
      PM = 毛利率為負
      ROE = ROE 為負
      L3 = 連三年虧損
    在 financial_alert_summary 欄位用一句話（20 字內）摘要，無警訊填「無重大財務警訊」。
    ─────────────────────────────────────────────

    ─────────────────────────────────────────────
    【每月營收研判規則 — 若個股含 monthly_revenue 欄位必須引用】
    ─────────────────────────────────────────────
    monthly_revenue.anomaly ∈ {{"surge","decline","divergence","watch_positive"}}
      • surge (🔥 爆發)      → 在 reasons 加 type=="fundamental" 引用 YoY/MoM 數字；highlights 加一條
      • decline (📉 衰退)    → risk_level 至少「中」；reasons 必須警示；suggestion 應降格
      • watch_positive       → highlights 可提及「營收動能轉強」
      • divergence (背離)    → 若股價與營收方向相反，analysis 需解釋（利多出盡 or 提前反應）
    將 monthly_revenue.anomaly_reason 的一句話濃縮後填入 revenue_summary 欄位（15 字內），
    若無 monthly_revenue 則填 "無營收資料"。
    ─────────────────────────────────────────────

    請用 JSON 格式回覆，最外層 key 為股票代碼，每檔股票的結構如下：
    {{
        "2330.TW": {{
            "verdict": "Bullish" | "Bearish" | "Neutral",
            "confidence": 0-100,
            "trend": "偏多" | "偏空" | "盤整",
            "support": "支撐價位區間",
            "resistance": "壓力價位區間",
            "risk_level": "低" | "中" | "高",
            "industry_pe_avg": 數字,
            "volume_verdict": "量增價揚"|"量增價跌"|"量縮價穩"|"高檔爆量"|"量增價穩"|"量能正常"|"無基準",   ← v10.5 新增
            "financial_alert_summary": "字串（20字內）",   ← v10.5 新增
            "revenue_summary": "字串（15字內）",   ← v10.6 新增（每月營收摘要）
            "reasons": [
                {{"type": "chip"|"technical"|"sentiment"|"macro", "text": "具體理由", "weight": 0.0-1.0}}
            ],
            "scores": {{"chip": -3~3, "technical": -3~3, "sentiment": -3~3, "macro": -3~3}},
            "analysis": "300-500 字深度分析",
            "suggestion": "操作建議含進場價位與停損",
            "highlights": ["4-5 個重點"]
        }}
    }}

    重要注意事項（務必遵守）：
    1. 每檔 analysis 必須 300-500 字，涵蓋技術面(均線/RSI/KD/MACD/布林)、基本面(PE/EPS)、籌碼面(法人動向)、消息面，**及量價關係**
    2. reasons 至少 4 條，涵蓋 chip/technical/sentiment/macro；若 volume_analysis 存在，technical 類型的 reason 必須引用 ratio 數字
    3. highlights 至少 4 個重點；若觸發「量增價揚」或「高檔爆量」必須放進 highlights
    4. suggestion 含具體進場價位、停損價位、目標價位
    5. 如有 institutional 數據，必須在 chip reason 中具體引用數字
    6. volume_verdict 欄位必填，若無 volume_analysis 則填 "無基準"
    7. 所有文字用繁體中文
    """


# ============================================================
# v10.5: Groq 新聞情感分析 — 雙意見輸出（Gemini 技術+基本面 vs Groq 新聞情感）
# ============================================================

def groq_analyze_news_sentiment(symbol, stock_name, news_titles):
    """使用 Groq (Llama 3) 分析個股新聞情感，回傳簡短 verdict + reason

    Groq 優勢：800+ token/s，短文判讀極快，不佔 Gemini 額度
    回傳: {"verdict": "bullish"|"bearish"|"neutral", "reason": "...", "matched_titles": [...]}
    """
    if not GROQ_API_KEY:
        return None
    if not news_titles:
        return {"verdict": "neutral", "reason": "今日無相關新聞標題", "matched_titles": []}

    prompt = f"""
    請針對台股個股「{stock_name}（{symbol}）」的「新聞情感面」做極簡判讀。

    今日財經新聞標題（可能混雜其他股票）：
    {json.dumps(news_titles, ensure_ascii=False)}

    任務：
    1. 先找出與此股票直接或間接相關的新聞（公司名、產業鏈、供應鏈夥伴、同業等）。
    2. 再針對這些新聞綜合判讀情感。
    3. 若沒有相關新聞，verdict=neutral 並在 reason 註明。

    請用 JSON 格式回覆（嚴禁 markdown，直接回 JSON）：
    {{
        "verdict": "bullish" | "bearish" | "neutral",
        "reason": "60 字內的繁體中文理由，要提到具體事件或邏輯",
        "matched_titles": ["實際匹配到的新聞標題（最多 3 條）"]
    }}
    """

    try:
        result = groq_generate(prompt, temperature=0.3)
        if not result:
            return None
        # 標準化 verdict
        v = str(result.get("verdict", "")).lower().strip()
        if v not in ("bullish", "bearish", "neutral"):
            v = "neutral"
        result["verdict"] = v
        result.setdefault("reason", "")
        result.setdefault("matched_titles", [])
        result["model"] = f"groq:{GROQ_MODEL}"
        return result
    except Exception as e:
        print(f"  Groq sentiment {symbol} failed: {e}", flush=True)
        return None


def groq_batch_news_sentiment(stocks_map, news_titles):
    """批次 Groq 新聞情感分析 — 一次 API call 處理多檔股票

    stocks_map: {symbol: {"name": "台積電", ...}, ...}
    news_titles: ["新聞標題1", "新聞標題2", ...]
    回傳: {symbol: {"verdict": "...", "reason": "...", "matched_titles": [...]}}
    """
    if not GROQ_API_KEY or not stocks_map:
        return {}
    if not news_titles:
        return {sym: {"verdict": "neutral", "reason": "今日無財經新聞", "matched_titles": []}
                for sym in stocks_map}

    symbol_name_list = [{"symbol": s, "name": d.get("name", s)} for s, d in stocks_map.items()]

    prompt = f"""
    請針對以下台股自選股的「新聞情感面」做極簡判讀。

    股票清單：
    {json.dumps(symbol_name_list, ensure_ascii=False)}

    今日財經新聞標題（可能混雜其他股票）：
    {json.dumps(news_titles, ensure_ascii=False)}

    任務：對每一檔股票，找出直接或間接相關的新聞（公司名、產業鏈、供應鏈、同業），
    綜合判讀是利多還是利空。若無相關新聞，verdict=neutral。

    請用 JSON 格式回覆（最外層 key 是股票代碼）：
    {{
        "2330.TW": {{
            "verdict": "bullish" | "bearish" | "neutral",
            "reason": "60 字內繁體中文理由",
            "matched_titles": ["匹配到的新聞（最多 3 條）"]
        }},
        ...
    }}
    """
    try:
        result = groq_generate(prompt, temperature=0.3)
        if not result:
            return {}
        # 標準化 + 補齊
        normalized = {}
        for sym in stocks_map:
            entry = result.get(sym) or {}
            v = str(entry.get("verdict", "")).lower().strip()
            if v not in ("bullish", "bearish", "neutral"):
                v = "neutral"
            normalized[sym] = {
                "verdict": v,
                "reason": entry.get("reason", ""),
                "matched_titles": entry.get("matched_titles", []),
                "model": f"groq:{GROQ_MODEL}",
            }
        return normalized
    except Exception as e:
        print(f"  Groq batch sentiment failed: {e}", flush=True)
        return {}


def analyze_watchlist(client, data):
    """分批分析所有自選股 — 每 {BATCH_SIZE} 檔一個 Request，避免 504"""
    watchlist = data.get("watchlist", {})
    if not watchlist:
        print("No watchlist stocks to analyze.", flush=True)
        return {}

    if not client:
        return {
            symbol: {**sdata, "ai_analysis": {"analysis": "AI API Key 未設定"}}
            for symbol, sdata in watchlist.items()
        }

    news_titles = [n.get("title", "") for n in data.get("news", [])]
    total = len(watchlist)

    # 建立有效個股清單
    valid_stocks = {sym: sd for sym, sd in watchlist.items() if "error" not in sd}
    if not valid_stocks:
        return {s: {**d, "ai_analysis": {"analysis": "資料抓取失敗"}} for s, d in watchlist.items()}

    # 分批（每批 BATCH_SIZE 檔）
    stock_items = list(valid_stocks.items())
    chunks = [stock_items[i:i + BATCH_SIZE] for i in range(0, len(stock_items), BATCH_SIZE)]
    print(f"  📦 Batch analysis: {total} stocks → {len(chunks)} batches × {BATCH_SIZE} (model: {MODEL_FLASH_LITE})", flush=True)

    results = {}
    for batch_idx, chunk in enumerate(chunks, 1):
        chunk_symbols = [s for s, _ in chunk]
        print(f"  🔄 Batch {batch_idx}/{len(chunks)}: {chunk_symbols}", flush=True)

        # 建立這批的 payload
        chunk_payload = {}
        for sym, sd in chunk:
            chunk_payload[sym] = _build_stock_entry(sym, sd)

        prompt = _build_batch_prompt(chunk_payload, news_titles)

        try:
            response = gemini_generate_with_retry(client, prompt, model=MODEL_FLASH_LITE, temperature=0.4, role="watchlist")
            batch_result = _safe_json_loads(response.text)
            print(f"  ✅ Batch {batch_idx} OK: {len(batch_result)} stocks", flush=True)

            for sym, sd in chunk:
                ai_result = batch_result.get(sym, {"analysis": "批次分析未回傳此股票結果"})
                ai_result["model_used"] = f"{MODEL_FLASH_LITE} (batch-{BATCH_SIZE})"
                results[sym] = {**sd, "ai_analysis": ai_result}

        except Exception as e:
            print(f"  ❌ Batch {batch_idx} failed: {e}", flush=True)
            print(f"  🔄 Fallback: analyzing {len(chunk)} stocks individually...", flush=True)
            for sym, sd in chunk:
                ai_result = analyze_stock(client, sym, sd, news_titles)
                results[sym] = {**sd, "ai_analysis": ai_result}
                time.sleep(4)

        # 批次間間隔 2 秒，避免 RPM
        if batch_idx < len(chunks):
            print(f"  ⏳ 2s cooldown before next batch...", flush=True)
            time.sleep(2)

    # 補上 error 個股
    for sym, sd in watchlist.items():
        if sym not in results:
            results[sym] = {**sd, "ai_analysis": {"analysis": "資料抓取失敗或未分析"}}

    # v10.5: Groq 新聞情感分析（一次 API call 涵蓋所有 valid 個股）
    if GROQ_API_KEY and valid_stocks:
        print(f"   Groq news sentiment batch ({len(valid_stocks)} stocks)...", flush=True)
        try:
            sentiment_map = groq_batch_news_sentiment(valid_stocks, news_titles)
            for sym, sent in sentiment_map.items():
                if sym in results:
                    results[sym].setdefault("ai_analysis", {})
                    results[sym]["news_sentiment"] = sent
            print(f"  ✅ Groq sentiment done: {len(sentiment_map)} stocks", flush=True)
        except Exception as e:
            print(f"  ⚠️ Groq sentiment batch failed: {e}", flush=True)

    return results


def _should_refresh_sector_map():
    """sector_map 日頻節流規則（v10.6.1）

    台股族群輪動是每日節奏，一週一次會錯過波段；改為每天 1 次、只在當日第一個 cron 跑。
    觸發條件（任一成立就重算）：
      1. data/sector_map.json 不存在
      2. 既有檔案的 date 不是今天（代表今天還沒跑過）
      3. 檔案損壞 / 無 timestamp

    其他時段（同一天內第 2、3、4 次 cron）一律略過，讀既有檔。
    """
    import os as _os
    path = "data/sector_map.json"
    today = current_time.strftime('%Y-%m-%d')

    if not _os.path.exists(path):
        print("  🗺️ sector_map.json 不存在 → 重算", flush=True)
        return True

    try:
        with open(path, "r", encoding="utf-8") as f:
            existing = json.load(f)
        ts_str = existing.get("timestamp", "")
        if not ts_str:
            print("  🗺️ sector_map 無 timestamp → 重算", flush=True)
            return True
        # timestamp 格式: '2026-04-18 07:00:00'
        last_date = ts_str.split(" ")[0]
        if last_date != today:
            print(f"  🗺️ sector_map 上次更新 {last_date} ≠ 今天 {today} → 重算（日頻第一跑）", flush=True)
            return True
        print(f"  🗺️ sector_map 今天 {last_date} 已更新過 → 跳過（今日後續 cron 讀快取）", flush=True)
        return False
    except Exception as e:
        print(f"  ⚠️ sector_map 節流檢查失敗: {e} → 重算", flush=True)
        return True


def _load_existing_sector_map():
    """讀取既有 sector_map.json，回傳時加上 _rewrite=False 標記"""
    try:
        with open("data/sector_map.json", "r", encoding="utf-8") as f:
            existing = json.load(f)
        existing["_rewrite"] = False
        return existing
    except Exception:
        return {"status": "no_cache", "_rewrite": False}


def _generate_sector_map_if_due(client, data):
    """節流包裝：只在該重算時呼叫 generate_sector_map"""
    if not _should_refresh_sector_map():
        return _load_existing_sector_map()
    result = generate_sector_map(client, data)
    if result is None:
        return _load_existing_sector_map()
    # 標記要寫檔
    if isinstance(result, dict):
        result["_rewrite"] = True
    return result


def generate_sector_map(client, data):
    """AI 族群分層地圖 — 產業鏈分析"""
    print("Generating sector map...", flush=True)
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
        # 族群分析用 Gemini Flash（複雜推理）
        response = gemini_generate_with_retry(client, prompt, model=MODEL_FLASH, temperature=0.5, role="sector")
        result = _safe_json_loads(response.text)
        result["status"] = "success"
        result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
        result["model_used"] = MODEL_FLASH
        return result
    except Exception as e:
        print(f"  ⚠️ Gemini Flash sector map failed: {e}")

        # v10.5: fallback 優先順序改為 Mistral → Groq
        # 原因：主流程已連續用過 Groq（morning_digest + news_sentiment），
        #       此時再打 Groq 幾乎必中 429；Mistral 獨立配額，比較可靠。

        # Mistral fallback（優先）
        if MISTRAL_API_KEY:
            print("  🔄 Switching to Mistral for sector map...")
            try:
                mres = requests.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {MISTRAL_API_KEY}", "Content-Type": "application/json"},
                    json={
                        "model": MISTRAL_MODEL,
                        "messages": [
                            {"role": "system", "content": "You are a professional Taiwan stock market sector analyst. Respond ONLY with raw JSON."},
                            {"role": "user", "content": prompt},
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.5,
                    },
                    timeout=60,
                )
                if mres.status_code == 200:
                    result = _safe_json_loads(mres.json()['choices'][0]['message']['content'])
                    result["status"] = "success"
                    result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
                    result["model_used"] = f"mistral:{MISTRAL_MODEL}"
                    print(f"  ✅ Sector map generated via Mistral")
                    return result
                else:
                    print(f"  Mistral HTTP {mres.status_code}: {mres.text[:150]}")
            except Exception as me:
                print(f"  Mistral sector fallback failed: {me}")

        # Groq fallback（最後嘗試；前面 Mistral 沒救才用）
        if GROQ_API_KEY:
            print("  🔄 Switching to Groq for sector map (last resort, 延遲 20 秒避開 TPM)...")
            time.sleep(20)  # 避開剛才 Groq 連發造成的 TPM 爆
            groq_result = groq_generate(prompt, temperature=0.5)
            if groq_result:
                groq_result["status"] = "success"
                groq_result["timestamp"] = current_time.strftime('%Y-%m-%d %H:%M:%S')
                groq_result["model_used"] = f"groq:{GROQ_MODEL}"
                print(f"  ✅ Sector map generated via Groq")
                return groq_result
            print("  ⚠️ Groq sector map also failed")

        return {
            "status": "error",
            "timestamp": current_time.strftime('%Y-%m-%d %H:%M:%S'),
            "content": f"族群分析產生失敗：{str(e)}",
        }


# ============================================================
# 主程式
# ============================================================

def main():
    print(f"[{current_time.strftime('%Y-%m-%d %H:%M:%S')}] Starting AI Analysis...", flush=True)
    print(f"  📋 Multi-Model Strategy:", flush=True)
    print(f"     晨間快報: {'Groq (' + GROQ_MODEL + ')' if GROQ_API_KEY else 'Gemini Flash (no Groq key)'}", flush=True)
    print(f"     個股分析: Gemini {MODEL_FLASH_LITE}", flush=True)
    print(f"     大盤/族群: Gemini {MODEL_FLASH}", flush=True)
    print(f"     備援: {'Mistral (' + MISTRAL_MODEL + ')' if MISTRAL_API_KEY else 'None'}", flush=True)
    print(f"     Gemini Keys: {len(GEMINI_KEY_POOL)} available ({', '.join(GEMINI_KEY_POOL.keys())})", flush=True)
    print(f"     Role chain: watchlist=primary→backup, market=secondary→backup, sector=backup→secondary", flush=True)

    # 1. Load raw data
    try:
        with open("data/raw_data.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Error: data/raw_data.json not found. Please run fetch_all.py first.")
        return

    # v10.6: Role-based client — 各階段用各自的主 key
    client_market = get_client("market")
    client_watchlist = get_client("watchlist")
    client_sector = get_client("sector")
    client = client_watchlist  # 向下相容（舊的單一 client 變數）

    # 1b. 從 Worker 取得新聞追蹤清單
    try:
        worker_url = "https://tw-stock-ai-proxy.noh486951-e8a.workers.dev/api/news-tracking"
        nt_res = requests.get(worker_url, timeout=10)
        if nt_res.status_code == 200:
            news_tracking = nt_res.json().get("stocks", [])
            data["news_tracking_stocks"] = news_tracking
            print(f"  News tracking stocks: {news_tracking}")
        else:
            data["news_tracking_stocks"] = []
    except Exception as e:
        print(f"  Failed to fetch news tracking: {e}")
        data["news_tracking_stocks"] = []

    # 2. 整體盤勢分析（Gemini: secondary）
    market_result = analyze_market(client_market, data)

    # 3. 自選股分析（Gemini: primary batch + Groq 新聞情感批次）
    watchlist_result = analyze_watchlist(client_watchlist, data)

    # v10.5: Groq 連打防 TPM 爆 — 這裡 analyze_watchlist 結尾用了 Groq，
    # 下一步 generate_morning_digest 還要用 Groq，必須間隔
    if GROQ_API_KEY:
        print("  ⏳ Groq TPM cooldown (15s) before morning digest...", flush=True)
        time.sleep(15)

    # 4. 晨間 AI 快報（Groq 主 / Gemini secondary 備援）
    digest_result = generate_morning_digest(client_market, data)

    # 5. AI 族群分層地圖（v10.6.1: 日頻節流 — 每天第一個 cron 才重算）
    #    用 KEY3 (backup) 為主，當天後續 cron 讀既有 data/sector_map.json
    sector_map = _generate_sector_map_if_due(client_sector, data)

    # 5. 輸出 market_pulse.json
    os.makedirs("data", exist_ok=True)

    final_output = {
        "timestamp": market_result["timestamp"],
        "market": data.get("market", {}),
        "chips": data.get("chips", {}),
        "chip_history": data.get("chip_history", []),
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

    # 8. 輸出 sector_map.json（僅在節流判定要重算時才覆寫）
    if sector_map and sector_map.get("_rewrite", False):
        # 清掉內部標記再寫
        sector_map.pop("_rewrite", None)
        with open("data/sector_map.json", "w", encoding="utf-8") as f:
            json.dump(sector_map, f, ensure_ascii=False, indent=2)
        print("Sector map generated (today's first run).")
    else:
        print("Sector map: skipped (今日已產生過，保留既有檔案)。")

    print("AI Analysis completed.")


if __name__ == "__main__":
    main()
