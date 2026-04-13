/**
 * Cloudflare Worker — Gemini API 代理
 *
 * 功能：
 * 1. 隱藏 Gemini API Key（存在環境變數）
 * 2. IP 速率限制（每分鐘 10 次）
 * 3. CORS 處理（允許你的 GitHub Pages 網域）
 *
 * 環境變數（在 Cloudflare Dashboard 設定）：
 *   GOOGLE_API_KEY — 你的 Gemini API Key
 *   ALLOWED_ORIGIN — 你的網站網域，例如 https://username.github.io
 */

// 簡易速率限制（使用 Map，Worker 重啟會清空，但足夠防止短時間濫用）
const rateLimitMap = new Map();
const RATE_LIMIT = 10;       // 每分鐘最多 10 次請求
const RATE_WINDOW = 60000;   // 1 分鐘

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now - record.start > RATE_WINDOW) {
        rateLimitMap.set(ip, { start: now, count: 1 });
        return true;
    }

    record.count++;
    if (record.count > RATE_LIMIT) {
        return false;
    }
    return true;
}

// 定期清理過期記錄
function cleanupRateLimit() {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap) {
        if (now - record.start > RATE_WINDOW * 2) {
            rateLimitMap.delete(ip);
        }
    }
}

export default {
    async fetch(request, env) {
        // 定期清理
        cleanupRateLimit();

        // CORS 設定
        const allowedOrigin = env.ALLOWED_ORIGIN || '*';
        const corsHeaders = {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // 處理 preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // 只允許 POST
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // 速率限制
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!checkRateLimit(clientIP)) {
            return new Response(JSON.stringify({ error: '請求過於頻繁，請稍後再試。' }), {
                status: 429,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // 檢查 API Key
        const apiKey = env.GOOGLE_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'API Key not configured' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        try {
            const body = await request.json();

            // 轉發給 Gemini API（串流模式）
            const model = body.model || 'gemini-2.5-flash-lite';
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

            // 移除 model 欄位再轉發
            delete body.model;

            const geminiResponse = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!geminiResponse.ok) {
                const errText = await geminiResponse.text();
                return new Response(JSON.stringify({ error: `Gemini API error: ${geminiResponse.status}` }), {
                    status: geminiResponse.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            // 串流轉發
            return new Response(geminiResponse.body, {
                status: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    },
};
