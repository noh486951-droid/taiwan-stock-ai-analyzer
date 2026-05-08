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
// ──────────────────────────────────────────
function _hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    return bytes;
}

async function verifySignature(request, publicKey) {
    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    if (!signature || !timestamp) return { ok: false, reason: 'missing_headers' };
    const body = await request.clone().text();
    try {
        const key = await crypto.subtle.importKey(
            'raw',
            _hexToBytes(publicKey),
            { name: 'Ed25519', namedCurve: 'Ed25519' },
            false,
            ['verify']
        );
        const sig = _hexToBytes(signature);
        const msg = new TextEncoder().encode(timestamp + body);
        const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, msg);
        return { ok, body };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}


// ──────────────────────────────────────────
// 回覆指令邏輯
// ──────────────────────────────────────────

export async function handleDiscordInteraction(request, env, ctx) {
    const publicKey = env.DISCORD_BOT_PUBLIC_KEY;
    if (!publicKey) {
        return new Response('Bot not configured', { status: 503 });
    }

    const verified = await verifySignature(request, publicKey);
    if (!verified.ok) {
        return new Response('Invalid signature', { status: 401 });
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
    const secret = env.PAPER_TRADE_ENGINE_SECRET || '';
    const workerOrigin = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';
    try {
        const r = await fetch(`${workerOrigin}/api/paper-trade?uid=${encodeURIComponent(uid)}&engine=1`, {
            headers: { 'X-Engine-Secret': secret, 'X-Engine': '1' },
        });
        if (!r.ok) return { content: `❌ 無法讀取帳戶（HTTP ${r.status}）` };
        const p = await r.json();
        const cash = p.cash || 0;
        const positions = p.positions || {};
        const stats = p.stats || {};
        const totalTrades = stats.total_trades || 0;
        const wins = stats.win_trades || 0;
        const winRate = totalTrades ? (wins / totalTrades * 100).toFixed(1) : 0;

        const positionLines = Object.entries(positions).slice(0, 8).map(([sym, pos]) => {
            const code = sym.replace(/\.(TW|TWO)$/, '');
            return `• ${pos.name || code} \`${code}\`  ${pos.shares} 股  ${pos.entry_price}`;
        }).join('\n') || '_(無持倉)_';

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
        return {
            embeds: [{
                title: `📊 ${sd.name || sym} (${sym})`,
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
        const lines = picks.slice(0, 10).map((p, i) =>
            `${i + 1}. **${p.name || p.symbol}** \`${(p.symbol || '').replace(/\.(TW|TWO)$/, '')}\`\n   ${(p.reason || '').slice(0, 80)}`
        ).join('\n\n');
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
    } catch {}

    const body = {
        contents: [{ parts: [{ text: `${question}\n\n（市場現況：${contextSummary}）` }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 1500 },
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
            if (text) {
                return {
                    embeds: [{
                        title: '💬 AI 回答',
                        description: text.slice(0, 4000),
                        color: 0x6366F1,
                        footer: { text: '透過 Gemini Flash · 即時市場 context' },
                    }],
                };
            }
        } catch {}
    }
    return { content: '❌ 所有 Gemini key 都失敗' };
}


// ──────────────────────────────────────────
// 工具函數
// ──────────────────────────────────────────
async function _fetchPagesData(path) {
    // 從 GitHub Pages 拉資料（你的 frontend host）
    const baseUrl = 'https://noh486951-droid.github.io/taiwan-stock-ai-analyzer';
    const r = await fetch(`${baseUrl}/${path}`, { cf: { cacheTtl: 30 } });
    if (!r.ok) return null;
    return r.json();
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
