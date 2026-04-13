/**
 * Cloudflare Worker — Gemini API 代理與個股動態分析引擎
 */

const rateLimitMap = new Map();
const analysisCache = new Map();

const RATE_LIMIT_CHAT = 10;
const RATE_LIMIT_ANALYZE = 5;
const RATE_WINDOW = 60000;
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours
const MISTRAL_ANALYZE_MODEL = 'mistral-small-latest';

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

function extractJsonFromText(text) {
    if (!text) return '';
    const trimmed = String(text).trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    return fenced ? fenced[1].trim() : trimmed;
}

function getMistralAnalyzeKeys(env) {
    return [env.MISTRAL_API_KEY, env.MISTRAL_API_KEY_1, env.MISTRAL_API_KEY_2].filter(Boolean);
}

async function callMistralForAnalyze(prompt, apiKeys, model) {
    let lastError = null;

    for (const apiKey of apiKeys) {
        try {
            const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.4,
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content: '你是台股分析助手。你只能輸出合法 JSON，不能有 markdown 或額外文字。',
                        },
                        { role: 'user', content: prompt },
                    ],
                }),
            });

            if (!mistralRes.ok) {
                const errText = await mistralRes.text();
                lastError = new Error(`Mistral API Error: ${mistralRes.status} ${errText}`);
                if ([401, 403, 429].includes(mistralRes.status)) continue;
                throw lastError;
            }

            const mistralData = await mistralRes.json();
            const content = mistralData?.choices?.[0]?.message?.content;
            const jsonText = extractJsonFromText(content);
            return JSON.parse(jsonText);
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('Mistral analyze failed with all keys.');
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
    
    // 基本面資料從 meta 裡拿，如果沒有再去算
    const meta = result.meta;
    
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
    
    // 計算 MA
    const ma5 = calcMA(c, 5);
    const ma10 = calcMA(c, 10);
    const ma20 = calcMA(c, 20);
    const ma60 = calcMA(c, 60);
    const ma120 = calcMA(c, 120);
    
    // 計算布林通道 (20MA, 2 std dev)
    const std20 = c.map((val, i, arr) => {
        if (i < 19) return null;
        const mean = ma20[i];
        let sumSq = 0;
        for (let j=0; j<20; j++) sumSq += Math.pow(arr[i-j] - mean, 2);
        return Math.sqrt(sumSq / 20);
    });
    const boll_up = ma20.map((m, i) => m !== null && std20[i] !== null ? m + 2 * std20[i] : null);
    const boll_dn = ma20.map((m, i) => m !== null && std20[i] !== null ? m - 2 * std20[i] : null);
    
    const rsi = calcRSI(c, 14);
    const macdData = calcMACD(c);
    const kdData = calcKD(h, l, c, 9);
    
    const last = cleanData.length - 1;
    const currentPrice = c[last];
    const prevPrice = c[last-1] || currentPrice;
    const changePct = ((currentPrice - prevPrice)/prevPrice*100).toFixed(2);
    
    // 簡易抓取 52周新高新低 (大概 250 天)
    const period250 = cleanData.slice(Math.max(0, cleanData.length - 250));
    const high52 = period250.length ? Math.max(...period250.map(d=>d.h)) : currentPrice;
    const low52 = period250.length ? Math.min(...period250.map(d=>d.l)) : currentPrice;
    
    // 計算支撐壓力與停損 (找出近 20/60 天高低點，和均線組成清單)
    const period20 = cleanData.slice(Math.max(0, cleanData.length - 20));
    const recentHigh20 = Math.max(...period20.map(d=>d.h));
    const recentLow20 = Math.min(...period20.map(d=>d.l));
    
    let support_candidates = [recentLow20, ma20[last], ma60[last], boll_dn[last]].filter(v => v !== null && v < currentPrice);
    let resist_candidates = [recentHigh20, high52, boll_up[last], currentPrice * 1.05].filter(v => v !== null && v > currentPrice);
    
    // 排序與取前 3 名
    support_candidates.sort((a,b) => b - a); // 離現在價位最近的排前面 (降遞)
    resist_candidates.sort((a,b) => a - b); // 離現價最近的排前面 (升遞)
    
    const sup1 = support_candidates[0] || (currentPrice * 0.95);
    const sup2 = support_candidates[1] || (currentPrice * 0.90);
    const sup3 = support_candidates[2] || (currentPrice * 0.85);
    const res1 = resist_candidates[0] || (currentPrice * 1.05);
    const res2 = resist_candidates[1] || (currentPrice * 1.10);
    const res3 = resist_candidates[2] || (currentPrice * 1.15);
    
    // 計算支撐/壓力建議
    const stop_cons = sup1 * 0.98;
    const stop_agg = sup1 * 0.99;
    const target = res2;
    const risk = currentPrice - stop_cons;
    const reward = target - currentPrice;
    const rr_ratio = risk > 0 ? (reward / risk).toFixed(1) : 0;
    
    // 虛擬一個基本面 (由於 worker fetch 只能抓圖表，若有需要可以用 yahoo quote api 加強，我們這裡傳遞已知資訊)
    // 我們可以從 Meta 或發第二個 request 到 quote，但為節省時間這裡用 mock 基本面+圖表資訊
    
    return {
        price: currentPrice.toFixed(2),
        change_pct: parseFloat(changePct),
        volume: cleanData[last].v,
        fundamental: {
          "52w_high": high52.toFixed(2),
          "52w_low": low52.toFixed(2),
          "PE": "-",  // 即時抓取財報這支 API 沒有給 PE
          "PB": "-",
          "EPS": "-",
          "dividend_yield": "-"
        },
        support_resistance: {
            supports: [sup1.toFixed(2), sup2.toFixed(2), sup3.toFixed(2)],
            resistances: [res1.toFixed(2), res2.toFixed(2), res3.toFixed(2)],
            stop_loss: {
                conservative: stop_cons.toFixed(2),
                conservative_pct: ((currentPrice - stop_cons) / currentPrice * 100).toFixed(1),
                aggressive: stop_agg.toFixed(2),
                aggressive_pct: ((currentPrice - stop_agg) / currentPrice * 100).toFixed(1)
            },
            target: { price: target.toFixed(2), upside_pct: ((target - currentPrice) / currentPrice * 100).toFixed(1) },
            risk_reward_ratio: rr_ratio
        },
        technical: {
            "MA5": ma5[last] ? parseFloat(ma5[last].toFixed(2)) : null,
            "MA10": ma10[last] ? parseFloat(ma10[last].toFixed(2)) : null,
            "MA20": ma20[last] ? parseFloat(ma20[last].toFixed(2)) : null,
            "MA60": ma60[last] ? parseFloat(ma60[last].toFixed(2)) : null,
            "MA120": ma120[last] ? parseFloat(ma120[last].toFixed(2)) : null,
            "MA240": null,
            "BOLL_upper": boll_up[last] ? parseFloat(boll_up[last].toFixed(2)) : null,
            "BOLL_mid": ma20[last] ? parseFloat(ma20[last].toFixed(2)) : null,
            "BOLL_lower": boll_dn[last] ? parseFloat(boll_dn[last].toFixed(2)) : null,
            "RSI": rsi[last] ? parseFloat(rsi[last].toFixed(2)) : null,
            "MACD": macdData.macd[last] ? parseFloat(macdData.macd[last].toFixed(3)) : null,
            "MACD_signal": macdData.signal[last] ? parseFloat(macdData.signal[last].toFixed(3)) : null,
            "MACD_hist": macdData.hist[last] ? parseFloat(macdData.hist[last].toFixed(3)) : null,
            "K": kdData.k[last] ? parseFloat(kdData.k[last].toFixed(2)) : null,
            "D": kdData.d[last] ? parseFloat(kdData.d[last].toFixed(2)) : null
        }
    };
}

async function getYahooQuote(symbol) {
    if(!symbol.includes('.')) symbol = symbol + '.TW';
    let url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
    let res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok && symbol.endsWith('.TW')) {
        url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbol.replace('.TW', '.TWO')}`;
        res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }
    if (res.ok) {
        let json = await res.json();
        let resArr = json.quoteResponse.result;
        if (resArr && resArr.length > 0) return resArr[0];
    }
    return null;
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
        const [stockInfo, quoteInfo] = await Promise.all([
            fetchYahooData(cacheKey),
            getYahooQuote(cacheKey)
        ]);
        
        // 合併 基本面資訊
        if (quoteInfo) {
            stockInfo.fundamental["PE"] = quoteInfo.trailingPE ? quoteInfo.trailingPE.toFixed(2) : "-";
            stockInfo.fundamental["forward_PE"] = quoteInfo.forwardPE ? quoteInfo.forwardPE.toFixed(2) : "-";
            stockInfo.fundamental["PB"] = quoteInfo.priceToBook ? quoteInfo.priceToBook.toFixed(2) : "-";
            stockInfo.fundamental["EPS"] = quoteInfo.epsTrailingTwelveMonths ? quoteInfo.epsTrailingTwelveMonths.toFixed(2) : "-";
            stockInfo.fundamental["dividend_yield"] = quoteInfo.trailingAnnualDividendYield ? (quoteInfo.trailingAnnualDividendYield * 100).toFixed(2) : "-";
            stockInfo.fundamental["market_cap"] = quoteInfo.marketCap || null;
        }

        const mistralKeys = getMistralAnalyzeKeys(env);
        if (mistralKeys.length === 0) {
            throw new Error('Mistral API Key not configured for analyze route');
        }
        const prompt = `你是一位專業的台灣股市資深專職投資人。請根據以下個股最新技術與基本面數據，提供與標準格式一致的結構化診斷，並以嚴格的 JSON 格式回傳。
        
【分析標的】: ${cacheKey}
【即時行情】: ${stockInfo.price} (漲跌幅 ${stockInfo.change_pct}%)
【基本面】: PE=${stockInfo.fundamental.PE}, PB=${stockInfo.fundamental.PB}, EPS=${stockInfo.fundamental.EPS}, 殖利率=${stockInfo.fundamental.dividend_yield}%
【技術指標】:
- MA(5/20/60): ${stockInfo.technical.MA5} / ${stockInfo.technical.MA20} / ${stockInfo.technical.MA60}
- 日 RSI(14): ${stockInfo.technical.RSI}
- 布林通道: 上軌 ${stockInfo.technical.BOLL_upper}, 中軌 ${stockInfo.technical.BOLL_mid}, 下軌 ${stockInfo.technical.BOLL_lower}
- MACD 柱狀體: ${stockInfo.technical.MACD_hist}
- K/D: ${stockInfo.technical.K} / ${stockInfo.technical.D}

請回傳精準的 JSON 結構（必須是合法的 JSON，不要加 markdown block 或其他字眼）：
{
  "change_pct": ${stockInfo.change_pct},
  "price": "${stockInfo.price}",
  "volume": ${stockInfo.volume},
  "fundamental": ${JSON.stringify(stockInfo.fundamental)},
  "technical": ${JSON.stringify(stockInfo.technical)},
  "support_resistance": ${JSON.stringify(stockInfo.support_resistance)},
  "ai_analysis": {
    "trend": "偏多|偏空|盤整",
    "risk_level": "高|中|低",
    "confidence": 1到100的整數 (判定你的分析有幾分把握),
    "verdict": "強烈買進|波段操作|觀望|逢高調節|強烈賣出",
    "highlights": [
      "重點亮點一 (如技術面突破)",
      "重點亮點二 (如基本面或位階點評)",
      "重點亮點三"
    ],
    "reasons": [
      {"category": "Technical", "factor": "技術面描述", "weight": -3到3},
      {"category": "Fundamental", "factor": "基本面描述", "weight": -3到3}
    ],
    "radar": {
      "chip": 0 (目前因籌碼無資料請給0),
      "tech": -3到3,
      "fundamental": -3到3,
      "news": 0
    },
    "analysis": "綜合技術與基本面深度分析 (約80字)",
    "suggestion": "包含進出場與停損的具體操作建議 (約50字)",
    "industry_pe_avg": "如果知道其產業平均就填，不知道填 '-'"
  }
}`;

        let finalJson;
        try {
            finalJson = await callMistralForAnalyze(prompt, mistralKeys, env.MISTRAL_ANALYZE_MODEL || MISTRAL_ANALYZE_MODEL);
        } catch (analyzeErr) {
            const fallbackResponse = {
                change_pct: stockInfo.change_pct, price: stockInfo.price, volume: stockInfo.volume,
                fundamental: stockInfo.fundamental, technical: stockInfo.technical, support_resistance: stockInfo.support_resistance,
                ai_analysis: {
                    trend: "-", risk_level: "-", confidence: 0, verdict: "暫停服務",
                    highlights: ["🚫 AI 分析額度暫時不可用", "✅ 系統已載入完整技術指標與支撐壓力位", "請稍後再試，或檢查 Mistral 金鑰配額與權限。"],
                    reasons: [],
                    radar: { chip: 0, tech: 0, fundamental: 0, news: 0 },
                    analysis: "這檔股票的行情、技術與基本面數據皆已成功載入，但 AI 文字分析服務暫時不可用。",
                    suggestion: "建議先參考支撐壓力與技術指標，並搭配風險控管。",
                    industry_pe_avg: "-"
                }
            };
            analysisCache.set(cacheKey, { data: fallbackResponse, timestamp: Date.now() });
            console.error('Analyze fallback triggered:', analyzeErr?.message || analyzeErr);
            return new Response(JSON.stringify(fallbackResponse), { headers: corsHeaders });
        }
        
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
            const model = body.model || 'gemini-3-flash';
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
