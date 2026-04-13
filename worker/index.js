/**
 * Cloudflare Worker — Gemini API 代理與個股動態分析引擎
 */

const rateLimitMap = new Map();
const analysisCache = new Map();

const RATE_LIMIT_CHAT = 10;
const RATE_LIMIT_ANALYZE = 5;
const RATE_WINDOW = 60000;
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

function checkRateLimit(ip, limit) {
    const now = Date.now();
    const record = rateLimitMap.get(ip);
    if (!record || now - record.start > RATE_WINDOW) {
        rateLimitMap.set(ip, { start: now, count: 1 });
        return true;
    }
    record.count++;
    return record.count <= limit;
}

function cleanupMaps() {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap) {
        if (now - record.start > RATE_WINDOW * 2) rateLimitMap.delete(ip);
    }
    for (const [key, cache] of analysisCache) {
        if (now - cache.timestamp > CACHE_TTL) analysisCache.delete(key);
    }
}

// === 技術指標運算 ===
function calcMA(data, period) {
    return data.map((val, i, arr) => {
        if (i < period - 1) return null;
        let sum = 0;
        for (let j = 0; j < period; j++) sum += arr[i - j];
        return sum / period;
    });
}
function calcRSI(closes, period = 14) {
    let rsi = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return rsi;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    
    for (let i = period + 1; i < closes.length; i++) {
        let diff = closes[i] - closes[i - 1];
        let gain = diff > 0 ? diff : 0;
        let loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    return rsi;
}
function calcMACD(closes) {
    let ema12 = calcEMA(closes, 12);
    let ema26 = calcEMA(closes, 26);
    let macd = closes.map((_, i) => ema12[i] !== null && ema26[i] !== null ? ema12[i] - ema26[i] : null);
    let signal = calcEMA(macd.map(v => v !== null ? v : 0), 9, macd.findIndex(v => v !== null));
    let hist = macd.map((m, i) => m !== null && signal[i] !== null ? m - signal[i] : null);
    return { macd, signal, hist };
}
function calcEMA(data, period, startIndex = 0) {
    let ema = new Array(data.length).fill(null);
    let k = 2 / (period + 1);
    let sum = 0;
    let count = 0;
    for (let i = startIndex; i < startIndex + period && i < data.length; i++) {
        sum += data[i];
        count++;
    }
    if (count < period) return ema;
    ema[startIndex + period - 1] = sum / period;
    for (let i = startIndex + period; i < data.length; i++) {
        ema[i] = data[i] * k + ema[i - 1] * (1 - k);
    }
    return ema;
}
function calcKD(highs, lows, closes, period = 9) {
    let kLine = new Array(closes.length).fill(null);
    let dLine = new Array(closes.length).fill(null);
    if (closes.length < period) return { k: kLine, d: dLine };
    let prevK = 50, prevD = 50;
    for (let i = period - 1; i < closes.length; i++) {
        let maxH = Math.max(...highs.slice(i - period + 1, i + 1));
        let minL = Math.min(...lows.slice(i - period + 1, i + 1));
        let rsv = maxH === minL ? 50 : ((closes[i] - minL) / (maxH - minL)) * 100;
        let k = (2/3) * prevK + (1/3) * rsv;
        let d = (2/3) * prevD + (1/3) * k;
        kLine[i] = k;
        dLine[i] = d;
        prevK = k;
        prevD = d;
    }
    return { k: kLine, d: dLine };
}

// === Yahoo Finance 抓取 ===
async function fetchYahooData(symbol) {
    // 確保有後綴
    if(!symbol.includes('.')) symbol = symbol + '.TW';
    
    // Yahoo Finance 不支援上櫃 .TWO 的某些舊代碼，但多數支援。保險起見我們直接查。
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' } });
    if (!res.ok) {
        // 如果 .TW 找不到，試試 .TWO
        if(symbol.endsWith('.TW')) {
            const url2 = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.replace('.TW', '.TWO')}?range=1y&interval=1d`;
            const res2 = await fetch(url2, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!res2.ok) throw new Error("無效的股票代碼或無法取得歷史資料");
            return await parseYahooJSON(await res2.json());
        }
        throw new Error("無效的股票代碼或無法取得歷史資料");
    }
    return await parseYahooJSON(await res.json());
}

async function parseYahooJSON(json) {
    const result = json.chart.result[0];
    if (!result.timestamp || !result.indicators.quote[0].close) throw new Error("無交易資料");
    
    const quote = result.indicators.quote[0];
    const closes = quote.close;
    const highs = quote.high;
    const lows = quote.low;
    const volumes = quote.volume;
    
    // 過濾 null
    let cleanData = [];
    for(let i=0; i<closes.length; i++){
        if(closes[i] !== null && highs[i] !== null && lows[i] !== null && volumes[i] !== null) {
            cleanData.push({
                c: closes[i], h: highs[i], l: lows[i], v: volumes[i]
            });
        }
    }
    
    if (cleanData.length < 30) throw new Error("上市櫃時間過短，無法計算技術指標");
    
    const c = cleanData.map(d => d.c);
    const h = cleanData.map(d => d.h);
    const l = cleanData.map(d => d.l);
    const ma5 = calcMA(c, 5);
    const ma20 = calcMA(c, 20);
    const ma60 = calcMA(c, 60);
    const rsi = calcRSI(c, 14);
    const macdData = calcMACD(c);
    const kdData = calcKD(h, l, c, 9);
    
    const last = cleanData.length - 1;
    const currentPrice = c[last];
    const prevPrice = c[last-1] || currentPrice;
    const changePct = ((currentPrice - prevPrice)/prevPrice*100).toFixed(2);
    
    return {
        price: currentPrice.toFixed(2),
        change_pct: parseFloat(changePct),
        volume: cleanData[last].v,
        technical: {
            "MA5": ma5[last] ? ma5[last].toFixed(2) : null,
            "MA20": ma20[last] ? ma20[last].toFixed(2) : null,
            "MA60": ma60[last] ? ma60[last].toFixed(2) : null,
            "RSI": rsi[last] ? parseFloat(rsi[last].toFixed(2)) : null,
            "MACD": macdData.macd[last] ? parseFloat(macdData.macd[last].toFixed(3)) : null,
            "MACD_hist": macdData.hist[last] ? parseFloat(macdData.hist[last].toFixed(3)) : null,
            "K": kdData.k[last] ? parseFloat(kdData.k[last].toFixed(2)) : null,
            "D": kdData.d[last] ? parseFloat(kdData.d[last].toFixed(2)) : null
        }
    };
}

async function handleAnalyze(request, env, corsHeaders, clientIP) {
    if (!checkRateLimit(clientIP, RATE_LIMIT_ANALYZE)) {
        return new Response(JSON.stringify({ error: '請求過於頻繁，請稍後再試。' }), { status: 429, headers: corsHeaders });
    }
    
    const { symbol } = await request.json().catch(() => ({}));
    if (!symbol) return new Response(JSON.stringify({ error: 'Missing symbol' }), { status: 400, headers: corsHeaders });
    
    const cacheKey = symbol.toUpperCase();
    if (analysisCache.has(cacheKey)) {
        return new Response(JSON.stringify(analysisCache.get(cacheKey).data), { headers: corsHeaders });
    }

    try {
        const stockInfo = await fetchYahooData(cacheKey);
        
        const apiKey = env.GOOGLE_API_KEY;
        const prompt = `你是一位台灣股市資深專職投資人。請根據以下個股技術面數據，提供深度但精準的判斷，並以嚴格的 JSON 格式回傳。
        
分析目標股票: ${cacheKey}
股價: ${stockInfo.price} (漲跌 ${stockInfo.change_pct}%)
成交量: ${stockInfo.volume}
技術指標:
- MA5: ${stockInfo.technical.MA5}
- MA20: ${stockInfo.technical.MA20}
- MA60: ${stockInfo.technical.MA60}
- RSI(14): ${stockInfo.technical.RSI}
- MACD柱狀體: ${stockInfo.technical.MACD_hist}
- K: ${stockInfo.technical.K}, D: ${stockInfo.technical.D}

請回傳這段 JSON 結構（必須是合法的 JSON，不要加 markdown block 或其他字眼）：
{
  "change_pct": ${stockInfo.change_pct},
  "price": "${stockInfo.price}",
  "volume": ${stockInfo.volume},
  "fundamental": {},
  "technical": {
    "MA5": "${stockInfo.technical.MA5}", "MA20": "${stockInfo.technical.MA20}", "MA60": "${stockInfo.technical.MA60}",
    "RSI": "${stockInfo.technical.RSI}", "K": "${stockInfo.technical.K}", "D": "${stockInfo.technical.D}",
    "MACD_hist": "${stockInfo.technical.MACD_hist}"
  },
  "ai_analysis": {
    "trend": "偏多|偏空|盤整",
    "risk_level": "高|中|低",
    "confidence": 1到100的整數,
    "verdict": "Bullish|Bearish|Neutral",
    "support": "估計支撐價位",
    "resistance": "估計壓力價位",
    "analysis": "綜合技術面分析 (約30字)",
    "suggestion": "操作建議 (約20字)"
  }
}`;

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });

        if (!geminiRes.ok) throw new Error("Gemini API Error: " + geminiRes.status);
        const geminiData = await geminiRes.json();
        let aiJsonStr = geminiData.candidates[0].content.parts[0].text;
        let finalJson = JSON.parse(aiJsonStr);
        
        analysisCache.set(cacheKey, { timestamp: Date.now(), data: finalJson });
        return new Response(JSON.stringify(finalJson), { headers: corsHeaders });
    } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}

export default {
    async fetch(request, env) {
        cleanupMaps();
        const allowedOrigin = env.ALLOWED_ORIGIN || '*';
        const corsHeaders = {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

        const url = new URL(request.url);
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

        if (url.pathname === '/api/analyze') {
            const corsHeadersJson = { ...corsHeaders, 'Content-Type': 'application/json' };
            return handleAnalyze(request, env, corsHeadersJson, clientIP);
        }

        // Original Chat Proxy route
        if (!checkRateLimit(clientIP, RATE_LIMIT_CHAT)) {
            return new Response(JSON.stringify({ error: '請求過於頻繁，請稍後再試。' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const apiKey = env.GOOGLE_API_KEY;
        if (!apiKey) return new Response(JSON.stringify({ error: 'API Key not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        try {
            const body = await request.json();
            const model = body.model || 'gemini-2.5-flash-lite';
            delete body.model;
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

            const geminiResponse = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!geminiResponse.ok) {
                const errText = await geminiResponse.text();
                return new Response(JSON.stringify({ error: `Gemini API error: ${geminiResponse.status}` }), { status: geminiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            return new Response(geminiResponse.body, {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
    },
};
