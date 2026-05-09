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
const INTERACTION_TYPE_MESSAGE_COMPONENT = 3;   // v11.12 D: 按鈕互動
const RESPONSE_TYPE_PONG = 1;
const RESPONSE_TYPE_CHANNEL_MESSAGE = 4;
const RESPONSE_TYPE_DEFERRED_CHANNEL_MESSAGE = 5;
const RESPONSE_TYPE_DEFERRED_UPDATE_MESSAGE = 6;
const RESPONSE_TYPE_UPDATE_MESSAGE = 7;

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

    // v11.12 D：按鈕點擊
    if (body.type === INTERACTION_TYPE_MESSAGE_COMPONENT) {
        ctx.waitUntil(_handleButtonAsync(env, body));
        return _json({ type: RESPONSE_TYPE_DEFERRED_UPDATE_MESSAGE });
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


// v11.12 D：按鈕點擊處理
// custom_id 格式：{action}:{params}（例：'consult:2330.TW' / 'mute:duck:2330.TW' / 'goweb:'）
async function _handleButtonAsync(env, body) {
    const customId = body.data?.custom_id || '';
    const [action, ...params] = customId.split(':');
    const appId = env.DISCORD_BOT_APPLICATION_ID;
    const token = body.token;
    const orig = body.message || {};

    let updated;
    try {
        switch (action) {
            case 'consult': {
                // 觸發 AI 諮詢提示 — 引導去網頁（因為完整諮詢要 30s+）
                updated = {
                    embeds: orig.embeds || [],
                    components: [],   // 移除按鈕（已點過）
                    content: '💬 請到網頁按「💬 AI 持倉諮詢」，結果會推到 #🤖-AI 諮詢 頻道',
                };
                break;
            }
            case 'quote': {
                // 即時查股
                const sym = params[0] || '';
                if (!sym) { updated = { content: '❌ 缺股票代碼' }; break; }
                const result = await _cmdQuote(env, sym);
                updated = {
                    ...result,
                    embeds: [...(orig.embeds || []), ...(result.embeds || [])],
                    components: [],
                };
                break;
            }
            case 'mute': {
                // 24h 靜音標記（純前端視覺，後端先不擋；展示用）
                updated = {
                    embeds: orig.embeds || [],
                    components: [],
                    content: '🔇 已靜音此類警示 24 小時（注意：目前是視覺確認，後端尚未實作真正靜音）',
                };
                break;
            }
            case 'history': {
                const result = await _cmdHistory(env);
                updated = {
                    ...result,
                    embeds: [...(orig.embeds || []), ...(result.embeds || [])],
                    components: [],
                };
                break;
            }
            case 'risk': {
                const result = await _cmdRisk(env);
                updated = {
                    ...result,
                    embeds: [...(orig.embeds || []), ...(result.embeds || [])],
                    components: [],
                };
                break;
            }
            default:
                updated = { content: `❌ 未知按鈕: ${action}`, components: [] };
        }
    } catch (e) {
        updated = { content: `❌ 按鈕處理失敗: ${e.message}`, components: [] };
    }
    await _patchOriginal(appId, token, updated);
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
            case 'chat':   // v11.12 #C：DM 友善別名
                result = await _cmdAsk(env, opts.question || opts.message);
                break;
            // v11.12 #B 新增 6 個指令
            case 'history':
                result = await _cmdHistory(env);
                break;
            case 'winners':
                result = await _cmdWinners(env);
                break;
            case 'losers':
                result = await _cmdLosers(env);
                break;
            case 'risk':
                result = await _cmdRisk(env);
                break;
            case 'streak':
                result = await _cmdStreak(env);
                break;
            case 'refresh':
                result = await _cmdRefresh(env, opts.workflow);
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
// v11.12 #B：新增 6 個指令
// ──────────────────────────────────────────

async function _readPortfolioKV(env) {
    if (!env.WATCHLIST_KV) return null;
    const uid = env.NOTIFY_UID || '明芳';
    return await env.WATCHLIST_KV.get(`paper_trade:${uid}`, 'json');
}


async function _cmdHistory(env) {
    const p = await _readPortfolioKV(env);
    if (!p) return { content: '❌ 帳戶找不到' };
    const history = (p.history || []).slice(-10).reverse();
    if (!history.length) return { content: '_(尚無已平倉交易)_' };
    const lines = (await Promise.all(history.map(async (t, i) => {
        const sym = t.sym || t.symbol || '';
        const zh = await _zhName(sym, t.name);
        const pnl = t.pnl || 0;
        const pct = t.pnl_pct || 0;
        const emoji = pnl > 0 ? '🔴' : pnl < 0 ? '🟢' : '⚪';
        const sign = pnl >= 0 ? '+' : '';
        return `${i + 1}. ${emoji} **${zh}** \`${sym.replace(/\.(TW|TWO)$/, '')}\` ${sign}${pct.toFixed(2)}% (${sign}${pnl.toLocaleString()}) · ${t.exit_reason || '—'}`;
    }))).join('\n');
    return {
        embeds: [{
            title: '📜 最近 10 筆已平倉',
            description: lines,
            color: 0x3B82F6,
        }],
    };
}


async function _cmdWinners(env) {
    const p = await _readPortfolioKV(env);
    if (!p) return { content: '❌ 帳戶找不到' };
    const wins = (p.history || []).filter(t => (t.pnl || 0) > 0).sort((a, b) => (b.pnl || 0) - (a.pnl || 0)).slice(0, 5);
    if (!wins.length) return { content: '_(尚無贏家)_' };
    const lines = (await Promise.all(wins.map(async (t, i) => {
        const sym = t.sym || t.symbol || '';
        const zh = await _zhName(sym, t.name);
        return `${i + 1}. 🏆 **${zh}** \`${sym.replace(/\.(TW|TWO)$/, '')}\` +${(t.pnl_pct || 0).toFixed(2)}% (+${(t.pnl || 0).toLocaleString()}) · 持 ${t.hold_days || 0} 日 · ${t.exit_reason || '—'}`;
    }))).join('\n');
    return {
        embeds: [{
            title: '🏆 歷來贏家 Top 5',
            description: lines,
            color: 0xEF4444,
        }],
    };
}


async function _cmdLosers(env) {
    const p = await _readPortfolioKV(env);
    if (!p) return { content: '❌ 帳戶找不到' };
    const losses = (p.history || []).filter(t => (t.pnl || 0) < 0).sort((a, b) => (a.pnl || 0) - (b.pnl || 0)).slice(0, 5);
    if (!losses.length) return { content: '_(尚無輸家)_' };
    const lines = (await Promise.all(losses.map(async (t, i) => {
        const sym = t.sym || t.symbol || '';
        const zh = await _zhName(sym, t.name);
        return `${i + 1}. 💀 **${zh}** \`${sym.replace(/\.(TW|TWO)$/, '')}\` ${(t.pnl_pct || 0).toFixed(2)}% (${(t.pnl || 0).toLocaleString()}) · 持 ${t.hold_days || 0} 日 · ${t.exit_reason || '—'}`;
    }))).join('\n');
    return {
        embeds: [{
            title: '💀 歷來輸家 Top 5（檢討用）',
            description: lines,
            color: 0x22C55E,
        }],
    };
}


async function _cmdRisk(env) {
    const p = await _readPortfolioKV(env);
    if (!p) return { content: '❌ 帳戶找不到' };
    const positions = p.positions || {};
    const keys = Object.keys(positions);
    if (keys.length < 2) return { content: '⚠️ 持倉 < 2 檔，無集中風險' };

    // 抓 ETF 穿透資料 + 即時價
    const [etfPagesData, wa] = await Promise.all([
        _fetchPagesData('data/etf_holdings.json'),
        _fetchPagesData('data/watchlist_analysis.json'),
    ]);
    const etfData = etfPagesData?.etfs || {};
    const stocks = wa?.stocks || {};

    const positionValues = {};
    let totalValue = 0;
    for (const sym of keys) {
        const sd = stocks[sym] || {};
        const cur = sd.price || positions[sym].entry_price || 0;
        const mv = cur * (positions[sym].shares || 0);
        positionValues[sym] = mv;
        totalValue += mv;
    }
    if (totalValue === 0) return { content: '⚠️ 無法計算市值' };

    const sectorExposure = {};
    const stockExposure = {};
    const etfsHeld = [];
    for (const sym of keys) {
        const w = positionValues[sym] / totalValue;
        const etf = etfData[sym];
        if (etf) {
            etfsHeld.push({ sym, name: etf.name, weight: w });
            for (const [sec, pct] of Object.entries(etf.sectors || {})) {
                sectorExposure[sec] = (sectorExposure[sec] || 0) + w * pct / 100;
            }
            for (const h of (etf.top_holdings || [])) {
                stockExposure[h.symbol] = (stockExposure[h.symbol] || 0) + w * h.weight / 100;
            }
        } else {
            sectorExposure['個股直持'] = (sectorExposure['個股直持'] || 0) + w;
            stockExposure[sym] = (stockExposure[sym] || 0) + w;
        }
    }
    const sortedSectors = Object.entries(sectorExposure).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const dupe = Object.entries(stockExposure).sort((a, b) => b[1] - a[1]).filter(([_, w]) => w > 0.05).slice(0, 5);

    const sectorLines = sortedSectors.map(([s, w]) => {
        const pct = (w * 100).toFixed(1);
        const warn = w > 0.5 ? ' 🚨' : w > 0.3 ? ' ⚠️' : '';
        return `• ${s}: **${pct}%**${warn}`;
    }).join('\n');

    const dupLines = (await Promise.all(dupe.map(async ([sym, w]) => {
        const zh = await _zhName(sym);
        return `• ${zh} \`${sym.replace(/\.(TW|TWO)$/, '')}\`: ${(w * 100).toFixed(1)}%`;
    }))).join('\n') || '_(無重複下注)_';

    let topWarning = '';
    if (sortedSectors[0]) {
        const [s, w] = sortedSectors[0];
        if (w > 0.5) topWarning = `🚨 **${s}** 實質佔比 ${(w * 100).toFixed(1)}%（>50%），過度單壓`;
        else if (w > 0.4) topWarning = `🟡 **${s}** 實質佔比 ${(w * 100).toFixed(1)}%（40-50%），略偏單壓`;
    }

    return {
        embeds: [{
            title: '🔬 投資組合風險穿透',
            description: topWarning || '✅ 產業分布合理',
            color: topWarning.startsWith('🚨') ? 0xEF4444 : topWarning.startsWith('🟡') ? 0xF59E0B : 0x22C55E,
            fields: [
                { name: '📊 穿透後產業曝險', value: sectorLines, inline: false },
                { name: '🎯 重複下注 Top 5', value: dupLines, inline: false },
                { name: '🎫 持有 ETF', value: etfsHeld.length ? etfsHeld.map(e => `${e.name} (${(e.weight * 100).toFixed(1)}%)`).join('、') : '_(無)_', inline: false },
            ],
            footer: { text: '穿透資料：data/etf_holdings.json' },
        }],
    };
}


async function _cmdStreak(env) {
    const p = await _readPortfolioKV(env);
    if (!p) return { content: '❌ 帳戶找不到' };
    const history = p.history || [];
    if (!history.length) return { content: '_(尚無交易紀錄)_' };

    // 計算當前 streak（從最後一筆往前數）
    let curStreak = 0;
    let curType = null;   // 'win' or 'lose'
    for (let i = history.length - 1; i >= 0; i--) {
        const pnl = history[i].pnl || 0;
        const t = pnl > 0 ? 'win' : pnl < 0 ? 'lose' : null;
        if (!t) break;
        if (curType === null) curType = t;
        if (t !== curType) break;
        curStreak++;
    }

    // 史上最長
    let maxWin = 0, maxLose = 0, w = 0, l = 0;
    for (const t of history) {
        const pnl = t.pnl || 0;
        if (pnl > 0) { w++; l = 0; if (w > maxWin) maxWin = w; }
        else if (pnl < 0) { l++; w = 0; if (l > maxLose) maxLose = l; }
        else { w = 0; l = 0; }
    }

    const total = history.length;
    const wins = history.filter(t => (t.pnl || 0) > 0).length;
    const winRate = (wins / total * 100).toFixed(1);

    const curStr = curType === 'win'
        ? `🔥 **連勝 ${curStreak} 筆**（注意過度自信）`
        : curType === 'lose'
        ? `❄️ **連敗 ${curStreak} 筆**（建議減倉冷靜）`
        : '中性';

    return {
        embeds: [{
            title: '📊 連勝 / 連敗 統計',
            color: curType === 'win' ? 0xEF4444 : curType === 'lose' ? 0x22C55E : 0x9CA3AF,
            fields: [
                { name: '🎯 當前狀態', value: curStr, inline: false },
                { name: '🏆 史上最長連勝', value: `${maxWin} 筆`, inline: true },
                { name: '💀 史上最長連敗', value: `${maxLose} 筆`, inline: true },
                { name: '📈 整體勝率', value: `${winRate}% (${wins}/${total})`, inline: true },
            ],
        }],
    };
}


async function _cmdRefresh(env, workflow) {
    // workflow 參數可選：watchlist / main / all（預設 all）
    const which = (workflow || 'all').toLowerCase();
    const repo = env.GITHUB_DISPATCH_REPO;
    const token = env.GITHUB_DISPATCH_TOKEN;
    if (!repo || !token) return { content: '❌ GH dispatch 未設定' };

    const eventTypes = which === 'main' ? ['trigger-main']
                     : which === 'watchlist' ? ['trigger-watchlist-quick']
                     : ['trigger-main', 'trigger-watchlist-quick'];

    const results = [];
    for (const eventType of eventTypes) {
        try {
            const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'tw-stock-bot',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    event_type: eventType,
                    client_payload: { source: 'discord-bot', ts: new Date().toISOString() },
                }),
            });
            results.push(r.ok ? `✅ ${eventType}` : `❌ ${eventType} (${r.status})`);
        } catch (e) {
            results.push(`❌ ${eventType}: ${e.message}`);
        }
    }
    return {
        embeds: [{
            title: '🔄 手動觸發 GitHub Workflow',
            description: results.join('\n') + '\n\n⏳ 觸發後 1-3 分鐘內會看到結果',
            color: 0x10B981,
        }],
    };
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
