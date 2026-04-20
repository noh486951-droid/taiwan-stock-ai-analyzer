/**
 * Cloudflare Worker — Gemini API 代理與個股動態分析引擎
 */

const rateLimitMap = new Map();
const analysisCache = new Map();

const RATE_LIMIT_CHAT = 10;
const RATE_LIMIT_ANALYZE = 5;
const RATE_WINDOW = 60000;
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours (memory)
const KV_CACHE_TTL = 2 * 60 * 60;     // 2 hours (KV, in seconds for expirationTtl)
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

    const body = await request.json().catch(() => ({}));
    const symbol = body.symbol;
    const forceRefresh = body.force === true; // 前端可傳 force:true 強制重新分析
    if (!symbol) return new Response(JSON.stringify({ error: 'Missing symbol' }), { status: 400, headers: corsHeaders });

    const cacheKey = symbol.toUpperCase();
    const kvCacheKey = `analysis:${cacheKey}`;

    // === 第一層：記憶體快取 ===
    if (!forceRefresh && analysisCache.has(cacheKey)) {
        const cached = analysisCache.get(cacheKey);
        return new Response(JSON.stringify({ ...cached.data, _cache: 'memory' }), { headers: corsHeaders });
    }

    // === 第二層：KV 持久化快取 (2 小時 TTL，由 KV expirationTtl 自動過期) ===
    if (!forceRefresh && env.WATCHLIST_KV) {
        try {
            const kvCached = await env.WATCHLIST_KV.get(kvCacheKey, 'json');
            if (kvCached) {
                // 回填記憶體快取
                analysisCache.set(cacheKey, { data: kvCached, timestamp: Date.now() });
                return new Response(JSON.stringify({ ...kvCached, _cache: 'kv' }), { headers: corsHeaders });
            }
        } catch (e) {
            console.warn('KV cache read failed:', e.message);
        }
    }

    // === 快取未命中：呼叫 Yahoo Finance + Mistral AI ===
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
            // fallback 不寫入 KV（下次可能成功）
            analysisCache.set(cacheKey, { data: fallbackResponse, timestamp: Date.now() });
            console.error('Analyze fallback triggered:', analyzeErr?.message || analyzeErr);
            return new Response(JSON.stringify(fallbackResponse), { headers: corsHeaders });
        }

        // 加上快取時間戳
        finalJson._cached_at = new Date().toISOString();

        // === 同時寫入記憶體快取 + KV 持久化快取 ===
        analysisCache.set(cacheKey, { timestamp: Date.now(), data: finalJson });
        if (env.WATCHLIST_KV) {
            // expirationTtl: KV 自動在 2 小時後刪除此 key，無需手動清理
            env.WATCHLIST_KV.put(kvCacheKey, JSON.stringify(finalJson), { expirationTtl: KV_CACHE_TTL })
                .catch(e => console.warn('KV cache write failed:', e.message));
        }

        return new Response(JSON.stringify(finalJson), { headers: corsHeaders });
    } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}

// ============================================================
// 自選股雲端同步 (KV)
// ============================================================

async function handleWatchlistGet(request, env, corsHeaders) {
    if (!env.WATCHLIST_KV) {
        return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
    }
    const url = new URL(request.url);
    const userId = url.searchParams.get('uid') || 'default';

    const data = await env.WATCHLIST_KV.get(`watchlist:${userId}`, 'json');
    if (!data) return new Response(JSON.stringify({ groups: [], watchlists: {} }), { headers: corsHeaders });
    // 不暴露 owner_token 和 edit_password_hash 給 GET 請求
    const { owner_token, edit_password_hash, ...safeData } = data;
    safeData.has_edit_password = !!edit_password_hash;
    return new Response(JSON.stringify(safeData), { headers: corsHeaders });
}

async function handleNewsTracking(request, env, corsHeaders) {
    if (!env.WATCHLIST_KV) {
        return new Response(JSON.stringify({ stocks: [] }), { headers: corsHeaders });
    }
    // 掃描所有使用者的 news_tracking，合併成唯一清單
    try {
        const list = await env.WATCHLIST_KV.list({ prefix: 'watchlist:' });
        const allTracked = new Set();
        for (const key of list.keys) {
            const data = await env.WATCHLIST_KV.get(key.name, 'json');
            if (data?.news_tracking) {
                data.news_tracking.forEach(s => allTracked.add(s));
            }
        }
        return new Response(JSON.stringify({ stocks: [...allTracked] }), { headers: corsHeaders });
    } catch (e) {
        return new Response(JSON.stringify({ stocks: [], error: e.message }), { headers: corsHeaders });
    }
}

async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleWatchlistSave(request, env, corsHeaders) {
    if (!env.WATCHLIST_KV) {
        return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
    }
    try {
        const body = await request.json();
        const userId = body.uid || 'default';
        const token = body.token || '';

        const existing = await env.WATCHLIST_KV.get(`watchlist:${userId}`, 'json');

        // === 身份判定 ===
        const isOwner = !existing || !existing.owner_token || existing.owner_token === token;

        if (!isOwner) {
            // 非 Owner — 需要共享編輯密碼
            if (!existing.edit_password_hash) {
                return new Response(JSON.stringify({ error: 'NICKNAME_TAKEN', message: `暱稱「${userId}」已被其他人使用，請換一個暱稱。` }), { status: 409, headers: corsHeaders });
            }
            const inputPw = body.shared_password || '';
            if (!inputPw) {
                return new Response(JSON.stringify({ error: 'EDIT_PASSWORD_REQUIRED', message: '需要共享編輯密碼才能修改此帳號' }), { status: 403, headers: corsHeaders });
            }
            const inputHash = await sha256(inputPw);
            if (inputHash !== existing.edit_password_hash) {
                return new Response(JSON.stringify({ error: 'EDIT_PASSWORD_WRONG', message: '共享編輯密碼錯誤' }), { status: 403, headers: corsHeaders });
            }
            // 密碼正確 — 允許編輯（保留原 owner_token 和密碼 hash）
            const payload = {
                groups: body.groups || existing.groups || [],
                watchlists: body.watchlists || existing.watchlists || {},
                news_tracking: body.news_tracking || existing.news_tracking || [],
                owner_token: existing.owner_token,
                edit_password_hash: existing.edit_password_hash,
                updated_at: new Date().toISOString(),
            };
            await env.WATCHLIST_KV.put(`watchlist:${userId}`, JSON.stringify(payload));
            return new Response(JSON.stringify({ ok: true, shared_edit: true }), { headers: corsHeaders });
        }

        // === Owner 正常儲存 ===
        const payload = {
            groups: body.groups || [],
            watchlists: body.watchlists || {},
            news_tracking: body.news_tracking || [],
            owner_token: existing?.owner_token || token || crypto.randomUUID(),
            updated_at: new Date().toISOString(),
        };

        // Owner 設定/更新共享編輯密碼
        if (body.set_edit_password !== undefined) {
            if (body.set_edit_password === '') {
                // 清除密碼
                delete payload.edit_password_hash;
            } else {
                payload.edit_password_hash = await sha256(body.set_edit_password);
            }
        } else if (existing?.edit_password_hash) {
            // 保留原有密碼
            payload.edit_password_hash = existing.edit_password_hash;
        }

        await env.WATCHLIST_KV.put(`watchlist:${userId}`, JSON.stringify(payload));
        return new Response(JSON.stringify({ ok: true, token: payload.owner_token }), { headers: corsHeaders });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: corsHeaders });
    }
}

// ============================================================
// v10.8 虛擬投資（Paper Trade）
//   KV key: paper_trade:{userId}
//   結構: { cash, positions: {sym: {...}}, history: [...], stats: {...},
//           owner_token, updated_at, engine_updated_at }
// ============================================================

function _defaultPaperPortfolio(token) {
    return {
        cash: 1000000,
        positions: {},
        history: [],
        stats: { total_trades: 0, win_trades: 0, total_pnl: 0 },
        settings: {
            initial_capital: 1000000,
            max_positions: 5,
            per_position_cap: 200000,
            confidence_threshold: 80,
            cooldown_trading_days: 5,
            min_hold_trading_days: 3,
            stale_exit_trading_days: 10,
            daily_entry_limit: 3,
            auto_trade: false,   // v10.8: 預設關閉，使用者需主動開啟以避免資源爭用
        },
        cooldowns: {},            // {sym: "YYYY-MM-DD"} 進場冷卻截止日
        pending_confirms: {},     // {sym: {verdict, count, last_seen}} 連續確認計數
        owner_token: token || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        engine_updated_at: null,
    };
}

async function _verifyPaperTradeAuth(request, body, existing, env) {
    // 回傳 { ok: bool, reason: string, isEngine: bool }
    const url = new URL(request.url);
    // === Engine 模式：支援 body / query / header 三種來源（GET 走 query/header）===
    const engineSecret =
        (body && body.engine_secret) ||
        url.searchParams.get('engine_secret') ||
        request.headers.get('X-Engine-Secret') ||
        '';
    const engineFlag =
        (body && body.engine === true) ||
        url.searchParams.get('engine') === '1' ||
        request.headers.get('X-Engine') === '1';
    if (engineFlag && env.PAPER_TRADE_ENGINE_SECRET && engineSecret === env.PAPER_TRADE_ENGINE_SECRET) {
        return { ok: true, isEngine: true };
    }
    if (!existing) return { ok: true, isEngine: false };  // 未建立，允許初始化
    // Token 比對
    const token = (body && body.token) || url.searchParams.get('token') || '';
    if (existing.owner_token && token && existing.owner_token === token) {
        return { ok: true, isEngine: false };
    }
    // 密碼比對
    const pw = (body && body.access_password) || url.searchParams.get('pw') || '';
    if (existing.access_password_hash && pw) {
        const h = await sha256(pw);
        if (h === existing.access_password_hash) return { ok: true, isEngine: false, byPassword: true };
    }
    return { ok: false, reason: existing.access_password_hash ? 'PASSWORD_REQUIRED' : 'FORBIDDEN' };
}

async function handlePaperTradeGet(request, env, corsHeaders) {
    if (!env.WATCHLIST_KV) {
        return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
    }
    const url = new URL(request.url);
    const userId = url.searchParams.get('uid') || 'default';
    const data = await env.WATCHLIST_KV.get(`paper_trade:${userId}`, 'json');
    if (!data) {
        const def = _defaultPaperPortfolio('');
        def.initialized = false;
        return new Response(JSON.stringify(def), { headers: corsHeaders });
    }
    // 驗證身份
    const auth = await _verifyPaperTradeAuth(request, null, data, env);
    if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.reason, initialized: true, has_password: !!data.access_password_hash }), { status: 403, headers: corsHeaders });
    }
    const { owner_token, access_password_hash, ...safe } = data;
    safe.initialized = true;
    safe.has_password = !!access_password_hash;
    // 若靠密碼驗證通過，順便回傳 token 讓前端存起來（免得每次打 API 都要密碼）
    if (auth.byPassword) safe._issued_token = owner_token;
    return new Response(JSON.stringify(safe), { headers: corsHeaders });
}

async function handlePaperTradeSave(request, env, corsHeaders) {
    if (!env.WATCHLIST_KV) {
        return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
    }
    try {
        const body = await request.json();
        const userId = body.uid || 'default';
        const token = body.token || '';

        const existing = await env.WATCHLIST_KV.get(`paper_trade:${userId}`, 'json');

        // 身份驗證（Engine / Owner-token / Password / 初始化）
        const auth = await _verifyPaperTradeAuth(request, body, existing, env);
        if (!auth.ok) {
            return new Response(JSON.stringify({ error: auth.reason, message: auth.reason === 'PASSWORD_REQUIRED' ? '需要密碼才能存取' : '不是這個帳號的擁有者' }), { status: 403, headers: corsHeaders });
        }
        const isEngine = auth.isEngine;

        // Engine 模式：允許更新 positions/cash/history/stats/cooldowns/pending_confirms/engine_updated_at
        // Owner 模式：允許更新 settings / 全量覆蓋（restore）
        const base = existing || _defaultPaperPortfolio(token);
        const payload = { ...base };

        if (isEngine) {
            if (body.cash != null) payload.cash = body.cash;
            if (body.positions != null) payload.positions = body.positions;
            if (body.history != null) payload.history = body.history;
            if (body.stats != null) payload.stats = body.stats;
            if (body.cooldowns != null) payload.cooldowns = body.cooldowns;
            if (body.pending_confirms != null) payload.pending_confirms = body.pending_confirms;
            payload.engine_updated_at = new Date().toISOString();
        } else {
            // Owner 更新
            if (body.settings != null) payload.settings = { ...payload.settings, ...body.settings };
            if (body.reset === true) {
                const keepPwHash = existing?.access_password_hash;
                Object.assign(payload, _defaultPaperPortfolio(base.owner_token || token));
                payload.settings = body.settings || base.settings;
                if (keepPwHash) payload.access_password_hash = keepPwHash;
            }
            if (!payload.owner_token) payload.owner_token = token || crypto.randomUUID();

            // 設定 / 更新 / 清除存取密碼
            if (body.set_access_password !== undefined) {
                if (body.set_access_password === '') {
                    delete payload.access_password_hash;
                } else {
                    payload.access_password_hash = await sha256(body.set_access_password);
                }
            } else if (existing?.access_password_hash) {
                // 保留既有密碼
                payload.access_password_hash = existing.access_password_hash;
            }
        }
        payload.updated_at = new Date().toISOString();

        await env.WATCHLIST_KV.put(`paper_trade:${userId}`, JSON.stringify(payload));
        return new Response(JSON.stringify({ ok: true, token: payload.owner_token }), { headers: corsHeaders });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: corsHeaders });
    }
}

// ============================================================
// v10.8 Admin — 總控管儀表板（密碼 = env.ADMIN_PASSWORD）
// ============================================================

function _verifyAdminPw(request, body, env) {
    const url = new URL(request.url);
    const pw = (body && body.admin_pw) || url.searchParams.get('admin_pw') || request.headers.get('X-Admin-Pw') || '';
    return !!env.ADMIN_PASSWORD && pw === env.ADMIN_PASSWORD;
}

async function handlePaperTradeAdminGet(request, env, corsHeaders) {
    if (!env.WATCHLIST_KV) return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
    if (!_verifyAdminPw(request, null, env)) {
        return new Response(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403, headers: corsHeaders });
    }
    try {
        const list = await env.WATCHLIST_KV.list({ prefix: 'paper_trade:' });
        const users = [];
        for (const key of list.keys) {
            const data = await env.WATCHLIST_KV.get(key.name, 'json');
            if (!data) continue;
            const uid = key.name.replace(/^paper_trade:/, '');
            const positions = data.positions || {};
            const history = data.history || [];
            const marketValue = Object.entries(positions).reduce((sum, [, pos]) => sum + (pos.entry_price * pos.shares), 0);
            users.push({
                uid,
                auto_trade: !!data.settings?.auto_trade,
                has_password: !!data.access_password_hash,
                cash: data.cash || 0,
                positions_count: Object.keys(positions).length,
                positions_mv_estimate: marketValue,
                total_trades: history.length,
                realized_pnl: data.stats?.total_pnl || 0,
                confidence_threshold: data.settings?.confidence_threshold ?? 80,
                created_at: data.created_at || null,
                updated_at: data.updated_at || null,
                engine_updated_at: data.engine_updated_at || null,
            });
        }
        users.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
        return new Response(JSON.stringify({ users, count: users.length }), { headers: corsHeaders });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
}

async function handlePaperTradeAdminAction(request, env, corsHeaders) {
    if (!env.WATCHLIST_KV) return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: corsHeaders });
    try {
        const body = await request.json();
        if (!_verifyAdminPw(request, body, env)) {
            return new Response(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403, headers: corsHeaders });
        }
        const action = body.action || '';
        const uid = body.uid || '';
        if (!uid) return new Response(JSON.stringify({ error: 'Missing uid' }), { status: 400, headers: corsHeaders });

        const key = `paper_trade:${uid}`;
        const data = await env.WATCHLIST_KV.get(key, 'json');
        if (!data) return new Response(JSON.stringify({ error: 'USER_NOT_FOUND' }), { status: 404, headers: corsHeaders });

        let summary = '';
        switch (action) {
            case 'force_disable_auto_trade':
                data.settings = { ...(data.settings || {}), auto_trade: false };
                summary = `已強制關閉 ${uid} 的自動交易`;
                break;
            case 'force_enable_auto_trade':
                data.settings = { ...(data.settings || {}), auto_trade: true };
                summary = `已開啟 ${uid} 的自動交易`;
                break;
            case 'clear_access_password':
                delete data.access_password_hash;
                summary = `已解除 ${uid} 的存取密碼`;
                break;
            case 'reset_account':
                {
                    const keepToken = data.owner_token;
                    const keepPw = data.access_password_hash;
                    const fresh = _defaultPaperPortfolio(keepToken);
                    Object.assign(data, fresh);
                    data.owner_token = keepToken;
                    if (keepPw) data.access_password_hash = keepPw;
                    summary = `已重置 ${uid} 的帳戶（密碼保留）`;
                }
                break;
            case 'delete_user':
                await env.WATCHLIST_KV.delete(key);
                return new Response(JSON.stringify({ ok: true, summary: `已刪除 ${uid}` }), { headers: corsHeaders });
            default:
                return new Response(JSON.stringify({ error: 'UNKNOWN_ACTION' }), { status: 400, headers: corsHeaders });
        }

        data.updated_at = new Date().toISOString();
        data._last_admin_action = { action, at: data.updated_at };
        await env.WATCHLIST_KV.put(key, JSON.stringify(data));
        return new Response(JSON.stringify({ ok: true, summary }), { headers: corsHeaders });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
    }
}

async function handlePaperTradeAllUsers(request, env, corsHeaders) {
    if (!env.WATCHLIST_KV) return new Response(JSON.stringify({ users: [] }), { headers: corsHeaders });
    // 需要 engine_secret 才能列出
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret') || request.headers.get('X-Engine-Secret') || '';
    if (!env.PAPER_TRADE_ENGINE_SECRET || secret !== env.PAPER_TRADE_ENGINE_SECRET) {
        return new Response(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403, headers: corsHeaders });
    }
    try {
        const list = await env.WATCHLIST_KV.list({ prefix: 'paper_trade:' });
        const users = list.keys.map(k => k.name.replace(/^paper_trade:/, ''));
        return new Response(JSON.stringify({ users }), { headers: corsHeaders });
    } catch (e) {
        return new Response(JSON.stringify({ users: [], error: e.message }), { headers: corsHeaders });
    }
}

// ============================================================
// TWSE / TAIFEX 代理（從 Cloudflare 台灣邊緣節點呼叫，避免 GitHub Actions IP 被封）
// ============================================================

const TWSE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Referer': 'https://www.twse.com.tw/zh/',
};

async function handleTwseProxy(request, env, corsHeaders) {
    const url = new URL(request.url);
    const target = url.searchParams.get('target'); // chip | margin | breadth | futures | pcr
    const date = url.searchParams.get('date') || '';

    try {
        let result = {};

        switch (target) {
            case 'chip': {
                // 三大法人買賣超
                const res = await fetch('https://www.twse.com.tw/fund/BFI82U?response=json', {
                    headers: { ...TWSE_HEADERS, Referer: 'https://www.twse.com.tw/zh/trading/fund/BFI82U.html' },
                });
                if (!res.ok) throw new Error(`TWSE returned ${res.status}`);
                const data = await res.json();
                if (data.stat === 'OK') {
                    result = { stat: 'OK', date: data.date || '', data: data.data || [] };
                } else {
                    result = { stat: data.stat || 'FAIL', error: '非交易日或尚未更新' };
                }
                break;
            }

            case 'margin': {
                // 融資融券
                const mUrl = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${date}&selectType=ALL`;
                const res = await fetch(mUrl, {
                    headers: { ...TWSE_HEADERS, Referer: 'https://www.twse.com.tw/zh/trading/exchange/MI_MARGN.html' },
                });
                if (!res.ok) throw new Error(`TWSE returned ${res.status}`);
                const data = await res.json();
                if (data.stat === 'OK') {
                    result = { stat: 'OK', date: data.date || '', data: data.data || [], fields: data.fields || [] };
                } else {
                    result = { stat: data.stat || 'FAIL', error: '非交易日或尚未更新' };
                }
                break;
            }

            case 'breadth': {
                // 漲跌家數
                const bUrl = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${date}`;
                const res = await fetch(bUrl, {
                    headers: { ...TWSE_HEADERS, Referer: 'https://www.twse.com.tw/zh/trading/exchange/MI_INDEX.html' },
                });
                if (!res.ok) throw new Error(`TWSE returned ${res.status}`);
                const data = await res.json();
                // 直接回傳完整 JSON，讓 Python 那邊解析
                result = { stat: data.stat || 'FAIL', date: data.date || '' };
                // 把所有 data* key 都帶過去
                for (const key of Object.keys(data)) {
                    if (key.startsWith('data')) {
                        result[key] = data[key];
                    }
                }
                break;
            }

            case 'futures': {
                // 外資期貨未平倉 (TAIFEX CSV)
                const fUrl = 'https://www.taifex.com.tw/cht/3/futContractsDateDown';
                const formBody = `queryType=1&commodity_id=TX&queryDate=${encodeURIComponent(date)}`;
                const res = await fetch(fUrl, {
                    method: 'POST',
                    headers: {
                        ...TWSE_HEADERS,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Referer: 'https://www.taifex.com.tw/cht/3/futContractsDate',
                    },
                    body: formBody,
                });
                if (!res.ok) throw new Error(`TAIFEX returned ${res.status}`);
                const text = await res.text();
                result = { stat: 'OK', csv: text, date };
                break;
            }

            case 'pcr': {
                // Put/Call Ratio (TAIFEX)
                const pUrl = 'https://www.taifex.com.tw/cht/3/dlOptDailyMarketReport';
                const formBody = `queryType=1&commodity_id=TXO&queryDate=${encodeURIComponent(date)}`;
                const res = await fetch(pUrl, {
                    method: 'POST',
                    headers: {
                        ...TWSE_HEADERS,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Referer: 'https://www.taifex.com.tw/cht/3/optDailyMarketReport',
                    },
                    body: formBody,
                });
                if (!res.ok) throw new Error(`TAIFEX returned ${res.status}`);
                const text = await res.text();
                result = { stat: 'OK', csv: text, date };
                break;
            }

            case 'futures-html': {
                // 外資期貨未平倉 — HTML 表格解析（比 CSV 下載更穩定）
                const fhUrl = 'https://www.taifex.com.tw/cht/3/futContractsDate';
                const fhBody = `queryType=1&commodity_id=TX&queryDate=${encodeURIComponent(date)}`;
                const fhRes = await fetch(fhUrl, {
                    method: 'POST',
                    headers: {
                        ...TWSE_HEADERS,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'text/html,application/xhtml+xml,*/*',
                        Referer: 'https://www.taifex.com.tw/cht/3/futContractsDate',
                    },
                    body: fhBody,
                });
                if (!fhRes.ok) throw new Error(`TAIFEX returned ${fhRes.status}`);
                const fhHtml = await fhRes.text();

                // 解析 HTML 表格中的外資/自營商資料
                result = { stat: 'OK', date };

                // 擷取所有 <tr> 內容
                const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
                const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
                let trMatch;
                let foundForeign = false;
                let foundDealer = false;

                while ((trMatch = trPattern.exec(fhHtml)) !== null) {
                    const rowHtml = trMatch[1];
                    // 取出所有 td 的文字內容
                    const cells = [];
                    let tdMatch;
                    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
                    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
                        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
                    }

                    if (cells.length < 10) continue;

                    const identity = cells[1] || '';
                    const product = cells[0] || '';

                    // 只看臺股期貨的未平倉
                    if (!product.includes('臺股期貨') && !product.includes('台股期貨')) continue;

                    const parseNum = (s) => {
                        const n = parseInt(String(s).replace(/,/g, ''), 10);
                        return isNaN(n) ? 0 : n;
                    };

                    if ((identity.includes('外資') || identity.includes('外資及陸資')) && !foundForeign) {
                        // 未平倉：多方口數[6], 空方口數[7], 多空淨額口數[8]
                        // 表格結構：交易(多方口數[2],多方金額[3],空方口數[4],空方金額[5],淨額口數[6],淨額金額[7]) + 未平倉(多方口數[8],多方金額[9],空方口數[10],空方金額[11],淨額口數[12],淨額金額[13])
                        // 根據表格實際欄位順序取未平倉資料
                        const longOi = parseNum(cells[cells.length >= 14 ? 8 : 6]);
                        const shortOi = parseNum(cells[cells.length >= 14 ? 10 : 7]);
                        const netOi = parseNum(cells[cells.length >= 14 ? 12 : 8]);
                        result.foreign_investor = {
                            long_oi: longOi, short_oi: shortOi, net_oi: netOi,
                            bias: netOi > 0 ? '偏多' : netOi < 0 ? '偏空' : '中性',
                        };
                        foundForeign = true;
                    }

                    if (identity.includes('自營商') && !foundDealer) {
                        const longOi = parseNum(cells[cells.length >= 14 ? 8 : 6]);
                        const shortOi = parseNum(cells[cells.length >= 14 ? 10 : 7]);
                        const netOi = parseNum(cells[cells.length >= 14 ? 12 : 8]);
                        result.dealer = { long_oi: longOi, short_oi: shortOi, net_oi: netOi };
                        foundDealer = true;
                    }
                }

                if (!result.foreign_investor) {
                    result.error = '無法從 HTML 解析外資期貨資料';
                }
                break;
            }

            case 'pcr-html': {
                // Put/Call Ratio — HTML 表格解析
                const pcrUrl = 'https://www.taifex.com.tw/cht/3/pcRatio';
                const today = date.replace(/\//g, '/');
                const pcrBody = `queryStartDate=${encodeURIComponent(today)}&queryEndDate=${encodeURIComponent(today)}`;
                const pcrRes = await fetch(pcrUrl, {
                    method: 'POST',
                    headers: {
                        ...TWSE_HEADERS,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'text/html,application/xhtml+xml,*/*',
                        Referer: 'https://www.taifex.com.tw/cht/3/pcRatio',
                    },
                    body: pcrBody,
                });
                if (!pcrRes.ok) throw new Error(`TAIFEX PCR returned ${pcrRes.status}`);
                const pcrHtml = await pcrRes.text();

                result = { stat: 'OK', date };

                // PCR 表格：日期 | 賣權成交量 | 買權成交量 | 成交量P/C% | 賣權未平倉 | 買權未平倉 | 未平倉P/C%
                const pcrTrPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
                let pcrTrMatch;
                let pcrFound = false;

                while ((pcrTrMatch = pcrTrPattern.exec(pcrHtml)) !== null) {
                    const rowHtml = pcrTrMatch[1];
                    const cells = [];
                    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
                    let tdM;
                    while ((tdM = tdRe.exec(rowHtml)) !== null) {
                        cells.push(tdM[1].replace(/<[^>]+>/g, '').trim());
                    }

                    // 找到包含日期的資料行（例如 "2026/04/14"）
                    if (cells.length >= 7 && /\d{4}\/\d{2}\/\d{2}/.test(cells[0])) {
                        const pN = (s) => {
                            const n = parseFloat(String(s).replace(/,/g, '').replace('%', ''));
                            return isNaN(n) ? 0 : n;
                        };

                        result.put_volume = Math.round(pN(cells[1]));
                        result.call_volume = Math.round(pN(cells[2]));
                        result.volume_pcr = Math.round(pN(cells[3])) / 100;  // 百分比→小數
                        result.put_oi = Math.round(pN(cells[4]));
                        result.call_oi = Math.round(pN(cells[5]));
                        result.oi_pcr = Math.round(pN(cells[6])) / 100;
                        // 修正：取更精確的值
                        if (result.call_volume > 0) {
                            result.volume_pcr = Math.round(result.put_volume / result.call_volume * 1000) / 1000;
                        }
                        if (result.call_oi > 0) {
                            result.oi_pcr = Math.round(result.put_oi / result.call_oi * 1000) / 1000;
                        }
                        pcrFound = true;
                        break;  // 只取第一行（最新日期）
                    }
                }

                if (!pcrFound) {
                    result.error = '無法從 HTML 解析 PCR 資料';
                }
                break;
            }

            default:
                return new Response(JSON.stringify({ error: 'Invalid target. Use: chip|margin|breadth|futures|pcr|futures-html|pcr-html' }), { status: 400, headers: corsHeaders });
        }

        return new Response(JSON.stringify(result), { headers: corsHeaders });
    } catch (e) {
        return new Response(JSON.stringify({ stat: 'ERROR', error: e.message }), { status: 502, headers: corsHeaders });
    }
}

async function handleAllWatchlistSymbols(request, env, corsHeaders) {
    if (!env.WATCHLIST_KV) {
        return new Response(JSON.stringify({ symbols: [] }), { headers: corsHeaders });
    }
    try {
        const list = await env.WATCHLIST_KV.list({ prefix: 'watchlist:' });
        const allSymbols = new Set();
        for (const key of list.keys) {
            const data = await env.WATCHLIST_KV.get(key.name, 'json');
            if (data?.watchlists) {
                // watchlists 是 { groupId: [symbol1, symbol2, ...] }
                Object.values(data.watchlists).forEach(stocks => {
                    if (Array.isArray(stocks)) {
                        stocks.forEach(s => allSymbols.add(s));
                    }
                });
            }
        }
        return new Response(JSON.stringify({ symbols: [...allSymbols], count: allSymbols.size }), { headers: corsHeaders });
    } catch (e) {
        return new Response(JSON.stringify({ symbols: [], error: e.message }), { headers: corsHeaders });
    }
}

// ============================================================
// v10.8 Cron Trigger — 用 Worker 排程當 GH Actions */15 的 failsafe
// 每 15 分鐘打 GitHub repository_dispatch 強制觸發 watchlist_quick
// ============================================================

async function triggerGithubDispatch(env, eventType) {
    const repo = env.GITHUB_DISPATCH_REPO;     // "owner/repo"
    const token = env.GITHUB_DISPATCH_TOKEN;   // PAT，scope: repo 或 actions:write
    if (!repo || !token) {
        console.warn('[cron] GITHUB_DISPATCH_REPO / _TOKEN 未設定，略過 dispatch');
        return { ok: false, reason: 'not_configured' };
    }
    try {
        const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'tw-stock-ai-proxy-cron',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                event_type: eventType,
                client_payload: { source: 'cloudflare-worker-cron', ts: new Date().toISOString() },
            }),
        });
        if (!res.ok) {
            const txt = await res.text();
            console.error(`[cron] dispatch ${eventType} failed: ${res.status} ${txt}`);
            return { ok: false, status: res.status, body: txt };
        }
        console.log(`[cron] dispatch ${eventType} ok`);
        return { ok: true };
    } catch (e) {
        console.error('[cron] dispatch error:', e.message);
        return { ok: false, error: e.message };
    }
}

export default {
    async scheduled(event, env, ctx) {
        // 只打 watchlist_quick — 每 15 分鐘一次，盤中交易時段
        // Python 腳本內部會自動判斷「現在不是交易時段」並 exit(0)，所以不用在這邊再判斷
        ctx.waitUntil(triggerGithubDispatch(env, 'trigger-watchlist-quick'));
    },

    async fetch(request, env) {
        cleanupMaps();
        const allowedOrigin = env.ALLOWED_ORIGIN || '*';
        const corsHeaders = {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

        const url = new URL(request.url);
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        const corsHeadersJson = { ...corsHeaders, 'Content-Type': 'application/json' };

        // 自選股雲端同步 — GET / POST 均支援
        if (url.pathname === '/api/watchlist') {
            if (request.method === 'GET') return handleWatchlistGet(request, env, corsHeadersJson);
            if (request.method === 'POST') return handleWatchlistSave(request, env, corsHeadersJson);
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        // 新聞追蹤清單（供 GitHub Actions 排程讀取）
        if (url.pathname === '/api/news-tracking') {
            if (request.method === 'GET') return handleNewsTracking(request, env, corsHeadersJson);
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        // TWSE / TAIFEX 代理（供 GitHub Actions 從 Cloudflare 邊緣節點抓取台灣交易所資料）
        if (url.pathname === '/api/twse-proxy') {
            if (request.method === 'GET') return handleTwseProxy(request, env, corsHeadersJson);
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        // 所有使用者自選股合併清單（供 GitHub Actions 排程抓資料 + AI 分析）
        if (url.pathname === '/api/watchlist/all-symbols') {
            if (request.method === 'GET') return handleAllWatchlistSymbols(request, env, corsHeadersJson);
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        // v10.8 虛擬投資（paper trade）雲端同步
        if (url.pathname === '/api/paper-trade') {
            if (request.method === 'GET') return handlePaperTradeGet(request, env, corsHeadersJson);
            if (request.method === 'POST') return handlePaperTradeSave(request, env, corsHeadersJson);
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }
        // 供 GitHub Actions 列出所有虛擬投資使用者
        if (url.pathname === '/api/paper-trade/all-users') {
            if (request.method === 'GET') return handlePaperTradeAllUsers(request, env, corsHeadersJson);
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        // v10.8 手動觸發 GH Actions dispatch（debug 用，憑 ADMIN_PASSWORD）
        if (url.pathname === '/api/dispatch/watchlist-quick') {
            const pw = url.searchParams.get('admin_pw') || '';
            if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) {
                return new Response(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403, headers: corsHeadersJson });
            }
            const result = await triggerGithubDispatch(env, 'trigger-watchlist-quick');
            return new Response(JSON.stringify(result), { headers: corsHeadersJson });
        }

        // v10.8 Admin 總控管（憑 env.ADMIN_PASSWORD）
        if (url.pathname === '/api/paper-trade/admin') {
            if (request.method === 'GET') return handlePaperTradeAdminGet(request, env, corsHeadersJson);
            if (request.method === 'POST') return handlePaperTradeAdminAction(request, env, corsHeadersJson);
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        // 以下路由只接受 POST
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

        if (url.pathname === '/api/analyze') {
            return handleAnalyze(request, env, corsHeadersJson, clientIP);
        }

        // Original Chat Proxy route
        if (!checkRateLimit(clientIP, RATE_LIMIT_CHAT)) {
            return new Response(JSON.stringify({ error: '請求過於頻繁，請稍後再試。' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // v10.8.2: 三把 Gemini key 輪替，遇 429/5xx 自動切換；
        //          都失敗時最後再試一次較輕量的備援模型（gemini-2.5-flash）再放棄
        const keyPool = [env.GOOGLE_API_KEY, env.GOOGLE_API_KEY2, env.GOOGLE_API_KEY3].filter(Boolean);
        if (keyPool.length === 0) {
            return new Response(JSON.stringify({ error: 'API Key not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        try {
            const body = await request.json();
            const primaryModel = body.model || 'gemini-3-flash-preview';
            delete body.model;
            const bodyStr = JSON.stringify(body);

            // 嘗試序列：每把 key × (primary model, fallback model)
            const FALLBACK_MODEL = 'gemini-2.5-flash';
            const attempts = [];
            for (const k of keyPool) attempts.push({ key: k, model: primaryModel });
            if (primaryModel !== FALLBACK_MODEL) {
                for (const k of keyPool) attempts.push({ key: k, model: FALLBACK_MODEL });
            }

            let lastStatus = 0;
            let lastErrText = '';
            for (let i = 0; i < attempts.length; i++) {
                const { key, model } = attempts[i];
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`;
                let resp;
                try {
                    resp = await fetch(geminiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: bodyStr,
                    });
                } catch (e) {
                    lastErrText = e.message;
                    continue;
                }
                if (resp.ok) {
                    // 成功：直接 pipe SSE（加上 header 讓前端知道用了哪條）
                    return new Response(resp.body, {
                        status: 200,
                        headers: {
                            ...corsHeaders,
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive',
                            'X-Gemini-Model': model,
                            'X-Gemini-Attempt': String(i + 1),
                        },
                    });
                }
                lastStatus = resp.status;
                lastErrText = await resp.text().catch(() => '');
                // 400/401/403 是客戶端錯誤（prompt 本身不合法 / key 被停用），再換 key 也沒意義
                if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
                    break;
                }
                // 429 / 5xx → 換下一個 attempt
            }
            return new Response(JSON.stringify({
                error: `Gemini API 暫時無法服務（已輪替 ${attempts.length} 次）`,
                last_status: lastStatus,
                hint: lastStatus === 503 ? '模型目前負載過高，請稍後再試。' : undefined,
            }), {
                status: lastStatus || 502,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
    },
};
