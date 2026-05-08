/**
 * Discord Bot Interactions Handler (v11.11 G)
 *
 * 處理 Discord slash commands：
 *   /portfolio    顯示你的虛擬投資帳戶
 *   /quote 2330   個股報價 + AI 判讀
 *   /scout        今日 AI 雷達精選
 *   /macro        未來 7 天總經事件
 *   /sector       強弱族群排行
 *   /consult      觸發 AI 持倉諮詢（提示用網頁）
 *   /ask <問題>   自由對話（呼叫 Gemini）
 *
 * Discord 互動式回覆 3 秒限制：
 *   1. 收到 interaction → 立即回 type 5 (deferred)
 *   2. 用 ctx.waitUntil() 跑實際邏輯
 *   3. 完成後用 PATCH /webhooks/{app_id}/{token}/messages/@original 回填
 *
 * 必要 env vars:
 *   DISCORD_BOT_PUBLIC_KEY     (Application 公鑰，用於 Ed25519 簽章驗證)
 *   DISCORD_BOT_APPLICATION_ID (Application ID，用於回填訊息)
 *   DISCORD_BOT_TOKEN          (Bot Token，註冊指令時用)
 *   GOOGLE_API_KEY (已有)
 *   PAPER_TRADE_ENGINE_SECRET  (已有，讀 portfolio)
 *   NOTIFY_UID                 (已有，限制誰能用 /portfolio /consult)
 */

// Discord interaction types
const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const RESPONSE_TYPE_PONG = 1;
const RESPONSE_TYPE_DEFERRED_CHANNEL_MESSAGE = 5;

// ──────────────────────────────────────────
// Ed25519 簽章驗證
// Cloudflare Workers 對 Ed25519 算法名稱依 compatibility_date 不同有差異：
//   - 老版本：'NODE-ED25519' + namedCurve
//   - 新版本（>= 2023-09）：'Ed25519'
// 兩種都試一次比較保險
// ──────────────────────────────────────────
function _hexToBytes(hex) {
    if (!hex || hex.length % 2 !== 0) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        const byte = parseInt(hex.substr(i, 2), 16);
        if (Number.isNaN(byte)) return null;
        bytes[i / 2] = byte;
    }
    return bytes;
}

async function _tryVerify(algoSpec, verifyAlgo, pubKeyBytes, sig, msg) {
    try {
        const key = await crypto.subtle.importKey('raw', pubKeyBytes, algoSpec, false, ['verify']);
        return await crypto.subtle.verify(verifyAlgo, key, sig, msg);
    } catch (e) {
        return { error: e.message || 'crypto_error' };
    }
}

async function verifySignature(request, publicKey) {
    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    if (!signature || !timestamp) {
        return { ok: false, reason: 'missing_headers' };
    }
    const body = await request.clone().text();
    const pubKeyBytes = _hexToBytes(publicKey);
    const sig = _hexToBytes(signature);
    if (!pubKeyBytes || !sig) {
        return { ok: false, reason: 'bad_hex', body };
    }
    const msg = new TextEncoder().encode(timestamp + body);

    let reasons = [];

    // Path 1：NODE-ED25519（部分 Workers 環境）
    let r1 = await _tryVerify(
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
        { name: 'NODE-ED25519' },
        pubKeyBytes, sig, msg,
    );
    if (r1 === true) return { ok: true, body };
    if (r1 && r1.error) reasons.push(`NODE-ED25519: ${r1.error}`);
    else if (r1 === false) reasons.push('NODE-ED25519: signature_invalid');

    // Path 2：Ed25519（新版 Workers 推薦）
    let r2 = await _tryVerify('Ed25519', 'Ed25519', pubKeyBytes, sig, msg);
    if (r2 === true) return { ok: true, body };
    if (r2 && r2.error) reasons.push(`Ed25519: ${r2.error}`);
    else if (r2 === false) reasons.push('Ed25519: signature_invalid');

    // Path 3：另一種 Ed25519 宣告方式
    let r3 = await _tryVerify(
        { name: 'Ed25519', namedCurve: 'Ed25519' },
        { name: 'Ed25519' },
        pubKeyBytes, sig, msg,
    );
    if (r3 === true) return { ok: true, body };
    if (r3 && r3.error) reasons.push(`Ed25519(curve): ${r3.error}`);
    else if (r3 === false) reasons.push('Ed25519(curve): signature_invalid');

    // 都失敗：把錯誤原因吐回去 debug
    return { ok: false, reason: reasons.join(' | '), body };
}


// ──────────────────────────────────────────
// 回覆指令邏輯
// ──────────────────────────────────────────

export async function handleDiscordInteraction(request, env, ctx) {
    const publicKey = (env.DISCORD_BOT_PUBLIC_KEY || '').trim();
    if (!publicKey) {
        return new Response('Bot not configured (DISCORD_BOT_PUBLIC_KEY missing)', { status: 503 });
    }

    const verified = await verifySignature(request, publicKey);
    if (!verified.ok) {
        // 401 + 原因 → console.log 輔助 debug（Cloudflare logs 會看到）
        console.log(`[discord-bot] verify failed: ${verified.reason}`);
        return new Response(`Invalid signature: ${verified.reason}`, { status: 401 });
    }

    const body = JSON.parse(verified.body);

    // PING（Discord 註冊 endpoint 時驗證用）
    if (body.type === INTERACTION_TYPE_PING) {
        return _json({ type: RESPONSE_TYPE_PONG });
    }

    if (body.type !== INTERACTION_TYPE_APPLICATION_COMMAND) {
        return _json({ type: 4, data: { content: '不支援的互動類型' } });
    }

    const cmd = body.data?.name || '';
    const opts = (body.data?.options || []).reduce((acc, o) => {
        acc[o.name] = o.value;
        return acc;
    }, {});
    const userId = body.member?.user?.id || body.user?.id || '';
    const appId = env.DISCORD_BOT_APPLICATION_ID;
    const token = body.token;

    // 立即回「思考中…」（type 5），實際處理用 waitUntil 背景跑
    ctx.waitUntil(_handleCommandAsync(env, cmd, opts, userId, appId, token));
    return _json({ type: RESPONSE_TYPE_DEFERRED_CHANNEL_MESSAGE });
}


async function _handleCommandAsync(env, cmd, opts, userId, appId, token) {
    let result;
    try {
        switch (cmd) {
            case 'portfolio':
                result = await _cmdPortfolio(env);
                break;
            case 'quote':
                result = await _cmdQuote(env, opts.symbol);
                break;
            case 'scout':
                result = await _cmdScout(env);
                break;
            case 'macro':
                result = await _cmdMacro(env);
                break;
            case 'sector':
                result = await _cmdSector(env);
                break;
            case 'consult':
                result = {
                    embeds: [{
                        title: '💬 AI 持倉諮詢',
                        description: '完整諮詢請到網頁按「💬 AI 持倉諮詢」按鈕（要 30-60 秒）— 結果會自動推送到 #🤖-AI 諮詢 頻道',
                        color: 0x6366F1,
                    }],
                };
                break;
            case 'ask':
                result = await _cmdAsk(env, opts.question);
                break;
            default:
                result = { content: `❌ 未知指令：${cmd}` };
        }
    } catch (e) {
        result = { content: `❌ 執行失敗：${e.message}` };
    }
    await _patchOriginal(appId, token, result);
}


// ──────────────────────────────────────────
// 個別指令實作
// ──────────────────────────────────────────

async function _cmdPortfolio(env) {
    const uid = env.NOTIFY_UID || '明芳';
    if (!env.WATCHLIST_KV) {
        return { content: '❌ KV 尚未綁定到 Worker（看 wrangler.toml）' };
    }
    try {
        // v11.11.1：直接讀 KV，不打自己的 HTTP API（避免 self-fetch 的繞路 + 鑒權問題）
        const p = await env.WATCHLIST_KV.get(`paper_trade:${uid}`, 'json');
        if (!p) {
            return { content: `❌ 帳戶 \`${uid}\` 在 KV 找不到（請先到網頁啟動）` };
        }
        const cash = p.cash || 0;
        const positions = p.positions || {};
        const stats = p.stats || {};
        const totalTrades = stats.total_trades || 0;
        const wins = stats.win_trades || 0;
        const winRate = totalTrades ? (wins / totalTrades * 100).toFixed(1) : 0;

        const positionEntries = Object.entries(positions).slice(0, 8);
        const positionLines = positionEntries.length === 0
            ? '_(無持倉)_'
            : (await Promise.all(positionEntries.map(async ([sym, pos]) => {
                const code = sym.replace(/\.(TW|TWO)$/, '');
                const zh = await _zhName(sym, pos.name);
                return `• **${zh}** \`${code}\`  ${pos.shares} 股 @ $${pos.entry_price}`;
            }))).join('\n');

        return {
            embeds: [{
                title: `💼 ${uid} 的虛擬投資帳戶`,
                color: 0x3B82F6,
                fields: [
                    { name: '💵 現金', value: `$${cash.toLocaleString()}`, inline: true },
                    { name: '📈 持倉檔數', value: `${Object.keys(positions).length}`, inline: true },
                    { name: '🎯 勝率', value: `${winRate}% (${wins}/${totalTrades})`, inline: true },
                    { name: '持倉一覽', value: positionLines, inline: false },
                ],
                footer: { text: `更新於 ${p.engine_updated_at || '—'}` },
            }],
        };
    } catch (e) {
        return { content: `❌ 錯誤：${e.message}` };
    }
}

async function _cmdQuote(env, symbol) {
    if (!symbol) return { content: '請輸入股票代碼，例如 `/quote 2330`' };
    let sym = String(symbol).toUpperCase().replace(/\.TW$/i, '').replace(/\.TWO$/i, '');
    sym = sym + '.TW';   // 預設 .TW
    try {
        const wa = await _fetchPagesData('data/watchlist_analysis.json');
        const stocks = wa?.stocks || {};
        const sd = stocks[sym] || stocks[sym.replace('.TW', '.TWO')];
        if (!sd) return { content: `❌ ${symbol} 不在自選股庫，無法即時查詢（先去自選股加入）` };
        const ai = sd.ai_analysis || {};
        const tech = sd.technical || {};
        const cp = sd.change_pct ?? 0;
        const sign = cp >= 0 ? '+' : '';
        const cls = cp > 0 ? '🔴' : cp < 0 ? '🟢' : '⚪';
        const zhName = await _zhName(sym, sd.name);
        return {
            embeds: [{
                title: `📊 ${zhName} (${sym})`,
                color: cp > 0 ? 0xEF4444 : cp < 0 ? 0x22C55E : 0x9CA3AF,
                fields: [
                    { name: '現價', value: `$${sd.price ?? '—'}`, inline: true },
                    { name: '漲跌', value: `${cls} ${sign}${cp.toFixed(2)}%`, inline: true },
                    { name: 'AI 判讀', value: `${ai.verdict || '—'} (${ai.confidence ?? '—'}%)`, inline: true },
                    { name: 'RSI / K / D', value: `${tech.RSI ?? '—'} / ${tech.K ?? '—'} / ${tech.D ?? '—'}`, inline: true },
                    { name: 'MA20 / MA60', value: `$${tech.MA20 ?? '—'} / $${tech.MA60 ?? '—'}`, inline: true },
                    { name: '建議', value: ((ai.suggestion_structured?.action || '') + ' ' + (ai.suggestion || '')).slice(0, 200) || '—', inline: false },
                ],
            }],
        };
    } catch (e) {
        return { content: `❌ 錯誤：${e.message}` };
    }
}

async function _cmdScout(env) {
    try {
        const ai = await _fetchPagesData('data/ai_picked_watchlist.json');
        const picks = ai?.picks || [];
        if (!picks.length) return { content: '⚠️ scout 自選資料尚未產生' };
        const lines = (await Promise.all(picks.slice(0, 10).map(async (p, i) => {
            const code = (p.symbol || '').replace(/\.(TW|TWO)$/, '');
            const zh = await _zhName(p.symbol, p.name);
            return `${i + 1}. **${zh}** \`${code}\`\n   ${(p.reason || '').slice(0, 80)}`;
        }))).join('\n\n');
        return {
            embeds: [{
                title: `🎯 今日 AI 自選股 Top ${picks.length}`,
                description: lines,
                color: 0xF59E0B,
                footer: { text: `產生於 ${ai.generated_at || '—'}` },
            }],
        };
    } catch (e) {
        return { content: `❌ ${e.message}` };
    }
}

async function _cmdMacro(env) {
    try {
        const mc = await _fetchPagesData('data/macro_calendar.json');
        const next7 = mc?.next_7_days || [];
        if (!next7.length) return { content: '✅ 未來 7 天無重大總經事件' };
        const today = mc.today || new Date().toISOString().slice(0, 10);
        const lines = next7.slice(0, 8).map(e => {
            const days = Math.max(0, Math.round((new Date(e.date) - new Date(today)) / 86400000));
            const dayLabel = days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天後`;
            const imp = e.importance === 'high' ? '🔴' : '🟡';
            return `${imp} **${dayLabel}** ${e.date} ${e.time || ''}  ${e.title}`;
        }).join('\n');
        return {
            embeds: [{
                title: '🌍 未來 7 天總經事件',
                description: lines,
                color: 0xEAB308,
            }],
        };
    } catch (e) {
        return { content: `❌ ${e.message}` };
    }
}

async function _cmdSector(env) {
    try {
        const wa = await _fetchPagesData('data/watchlist_analysis.json');
        const sf = wa?.sector_flow;
        if (!sf || !sf.sectors?.length) return { content: '⚠️ 族群資料尚未產生' };
        const top3 = sf.sectors.slice(0, 5);
        const bottom3 = sf.sectors.slice(-5).reverse();
        const fmtRow = s => {
            const sign = s.change_pct >= 0 ? '+' : '';
            const emoji = s.change_pct > 0 ? '🔴' : s.change_pct < 0 ? '🟢' : '⚪';
            return `${emoji} **${s.name}** ${sign}${s.change_pct}%`;
        };
        return {
            embeds: [{
                title: '🗺️ 今日族群強弱',
                color: 0xA855F7,
                fields: [
                    { name: `📊 加權指數 ${(sf.taiex?.change_pct ?? 0) >= 0 ? '+' : ''}${sf.taiex?.change_pct ?? 0}%`, value: '—', inline: false },
                    { name: '🔥 強勢 Top 5', value: top3.map(fmtRow).join('\n'), inline: false },
                    { name: '❄️ 弱勢 Top 5', value: bottom3.map(fmtRow).join('\n'), inline: false },
                ],
            }],
        };
    } catch (e) {
        return { content: `❌ ${e.message}` };
    }
}

async function _cmdAsk(env, question) {
    if (!question) return { content: '請輸入問題，例如 `/ask 台積電未來怎麼走？`' };
    const keys = [env.GOOGLE_API_KEY, env.GOOGLE_API_KEY2, env.GOOGLE_API_KEY3].filter(Boolean);
    if (!keys.length) return { content: '❌ AI 未設定' };

    // 帶上市場 context（只精簡必要欄位）
    let contextSummary = '';
    try {
        const wa = await _fetchPagesData('data/watchlist_analysis.json');
        const sf = wa?.sector_flow;
        const taiex = sf?.taiex || {};
        contextSummary = `今日加權 ${(taiex.change_pct ?? 0) >= 0 ? '+' : ''}${taiex.change_pct ?? '-'}%。`;
        if (sf?.sectors?.length) {
            contextSummary += ` 強勢族群：${sf.sectors.slice(0, 3).map(s => s.name).join('、')}。`;
        }
    } catch { }

    // v11.11.3：請 AI 控制長度 + bump tokens，避免回到一半被截斷
    const promptText = `${question}

【市場現況】${contextSummary}

【回答規則】
- 用繁體中文，簡潔有力（1500 字內）
- 重點分點，數字優先於形容詞
- 結尾若還有想補充的，寫「（如需更多細節再問）」`;
    const body = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 4096 },
    };
    for (const key of keys) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
            const ac = new AbortController();
            const tid = setTimeout(() => ac.abort(), 22000);
            const r = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body), signal: ac.signal,
            });
            clearTimeout(tid);
            if (!r.ok) continue;
            const data = await r.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const finishReason = data?.candidates?.[0]?.finishReason || '';
            if (text) {
                // 若 > 3800 字切成 2 個 embed
                if (text.length > 3800) {
                    let cut = text.lastIndexOf('\n\n', 3800);
                    if (cut < 2500) cut = text.lastIndexOf('。', 3800);
                    if (cut < 2000) cut = 3800;
                    const head = text.slice(0, cut);
                    const tail = text.slice(cut).trimStart().slice(0, 3800);
                    return {
                        embeds: [
                            {
                                title: '💬 AI 回答（1/2）',
                                description: head,
                                color: 0x6366F1,
                            },
                            {
                                title: '💬 接續（2/2）',
                                description: tail,
                                color: 0x6366F1,
                                footer: { text: 'Gemini Flash · 市場 context · ' + (finishReason || '完成') },
                            },
                        ],
                    };
                }
                return {
                    embeds: [{
                        title: '💬 AI 回答',
                        description: text,
                        color: 0x6366F1,
                        footer: { text: 'Gemini Flash · 市場 context · ' + (finishReason || '完成') },
                    }],
                };
            }
        } catch { }
    }
    return { content: '❌ 所有 Gemini key 都失敗' };
}


// ──────────────────────────────────────────
// 中文股名查詢（v11.11.2）
// 從 GitHub Pages 抓 stock_names.js 文字，regex 解析建表，cache 在 Worker isolate
// ──────────────────────────────────────────
let _STOCK_NAMES_CACHE = null;
let _STOCK_NAMES_FETCHED_AT = 0;

async function _loadStockNames() {
    // Worker isolate 之間 memory 不共享，每次冷啟會重抓；24h Cloudflare cache 加速
    if (_STOCK_NAMES_CACHE && Date.now() - _STOCK_NAMES_FETCHED_AT < 6 * 60 * 60 * 1000) {
        return _STOCK_NAMES_CACHE;
    }
    try {
        const baseUrl = 'https://noh486951-droid.github.io/taiwan-stock-ai-analyzer';
        const ac = new AbortController();
        const tid = setTimeout(() => ac.abort(), 5000);
        const r = await fetch(`${baseUrl}/js/stock_names.js`, {
            cf: { cacheTtl: 86400 },
            signal: ac.signal,
        });
        clearTimeout(tid);
        if (!r.ok) {
            console.log(`[bot] stock_names HTTP ${r.status}`);
            _STOCK_NAMES_CACHE = {};
            return {};
        }
        const text = await r.text();
        // regex 抓所有 'XXXX.TW(O)?': '中文名',
        const re = /'(\d{4,6}\.TWO?)'\s*:\s*'([^']+)'/g;
        const map = {};
        let m;
        while ((m = re.exec(text)) !== null) {
            map[m[1]] = m[2];
        }
        _STOCK_NAMES_CACHE = map;
        _STOCK_NAMES_FETCHED_AT = Date.now();
        console.log(`[bot] stock_names loaded: ${Object.keys(map).length} entries`);
        return map;
    } catch (e) {
        console.log(`[bot] _loadStockNames err: ${e.message}`);
        _STOCK_NAMES_CACHE = {};
        return {};
    }
}

async function _zhName(sym, fallback) {
    if (!sym) return fallback || '-';
    const map = await _loadStockNames();
    const zh = map[sym];
    if (zh) return zh;
    return fallback || sym.replace(/\.(TW|TWO)$/, '');
}


// ──────────────────────────────────────────
// 工具函數
// ──────────────────────────────────────────
async function _fetchPagesData(path) {
    // 從 GitHub Pages 拉資料；加 8s timeout + 錯誤處理避免卡死 bot
    const baseUrl = 'https://noh486951-droid.github.io/taiwan-stock-ai-analyzer';
    const url = `${baseUrl}/${path}`;
    try {
        const ac = new AbortController();
        const tid = setTimeout(() => ac.abort(), 8000);
        const r = await fetch(url, { cf: { cacheTtl: 30 }, signal: ac.signal });
        clearTimeout(tid);
        if (!r.ok) {
            console.log(`[bot] _fetchPagesData ${path} HTTP ${r.status}`);
            return null;
        }
        return await r.json();
    } catch (e) {
        console.log(`[bot] _fetchPagesData ${path} ERR: ${e.message}`);
        return null;
    }
}

async function _patchOriginal(appId, token, payload) {
    if (!appId || !token) return;
    try {
        await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (e) {
        console.error('PATCH original failed:', e.message);
    }
}

function _json(obj) {
    return new Response(JSON.stringify(obj), {
        status: 200, headers: { 'Content-Type': 'application/json' },
    });
}
