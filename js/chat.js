/**
 * AI 聊天助手 — 透過 Cloudflare Worker 代理連接 Gemini API
 *
 * 設定方式：
 * 1. 在 CHAT_WORKER_URL 填入你部署的 Cloudflare Worker 網址
 * 2. 使用者不需要提供 API Key，Key 安全存在 Worker 端
 */

// ============================================================
// 設定 — 部署 Worker 後把這個 URL 改成你的
// ============================================================
const CHAT_WORKER_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';
const CHAT_MODEL = 'gemini-3-flash-preview';

let chatHistory = [];
let marketContext = null;

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    injectChatWidget();
    loadMarketContext();
});

function injectChatWidget() {
    const widget = document.createElement('div');
    widget.id = 'aiChatWidget';
    widget.innerHTML = `
        <button id="chatToggleBtn" class="chat-toggle" title="AI 聊天助手">
            <span class="chat-icon">💬</span>
            <span class="chat-icon-close" style="display:none;">✕</span>
        </button>
        <div id="chatPanel" class="chat-panel" style="display:none;">
            <div class="chat-header">
                <span>🤖 AI 股市助手</span>
            </div>
            <div id="chatMessages" class="chat-messages">
                <div class="chat-msg ai">
                    <div class="chat-msg-content">
                        你好！我是你的 AI 股市助手 🤖<br><br>
                        我已載入最新的市場數據、自選股分析和財經新聞，有什麼問題儘管問我！<br><br>
                        點下方按鈕快速查詢，或直接輸入問題。
                    </div>
                </div>
            </div>
            <div id="chatQuickChips" class="chat-quick-chips">
                <button class="chat-chip" data-action="market_review">📈 盤勢大檢閱</button>
                <button class="chat-chip" data-action="find_whales">🐳 尋找大鯨魚</button>
                <button class="chat-chip" data-action="tech_breakout">⚡ 技術面噴發</button>
                <button class="chat-chip" data-action="watchlist_checkup">⭐ 自選股體檢</button>
            </div>
            <div class="chat-input-area">
                <input type="text" id="chatInput" placeholder="輸入問題..." />
                <button id="chatSendBtn" class="btn-primary btn-sm">送出</button>
            </div>
        </div>
    `;
    document.body.appendChild(widget);

    document.getElementById('chatToggleBtn').addEventListener('click', toggleChat);
    document.getElementById('chatSendBtn').addEventListener('click', sendMessage);
    document.getElementById('chatInput').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    // v10.8: 快速指令 chip
    document.querySelectorAll('#chatQuickChips .chat-chip').forEach(btn => {
        btn.addEventListener('click', () => handleQuickAction(btn.dataset.action, btn.textContent.trim()));
    });
}

// ============================================================
// v10.8: 快速指令 — 方案 B (本地 JSON 篩選) + 方案 C (盤勢大檢閱走 AI)
// ============================================================

async function handleQuickAction(action, label) {
    if (!marketContext) {
        appendMsg('ai', '資料尚未載入完成，請稍候再試');
        return;
    }
    // 在對話中顯示使用者按的指令
    appendMsg('user', label);

    if (action === 'market_review') {
        // 方案 C: 叫 AI 做總結解讀（需要敘述性）
        const prompt = buildMarketReviewPrompt();
        if (!prompt) return appendMsg('ai', '市場資料不足，無法檢閱');
        await sendPresetPrompt('盤勢大檢閱', prompt);
        return;
    }

    // 方案 B: 純本地 JSON 篩選，不叫 AI
    let html;
    try {
        if (action === 'find_whales')          html = quickFindWhales();
        else if (action === 'tech_breakout')   html = quickTechBreakout();
        else if (action === 'watchlist_checkup') html = quickWatchlistCheckup();
        else html = '未知指令';
    } catch (e) {
        html = `查詢失敗：${e.message}`;
    }
    appendMsg('ai', html);
}

function _getWatchlistStocks() {
    return (marketContext?.watchlist?.stocks) || {};
}

function _nameOf(sym) {
    // 統一使用 stock_names.js 暴露的 TW_STOCK_MAP（鍵為 2330.TW / 6547.TWO 這類）
    if (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym]) return TW_STOCK_MAP[sym];
    // 舊版保留向後相容
    if (typeof STOCK_NAMES !== 'undefined' && STOCK_NAMES[sym]) return STOCK_NAMES[sym];
    return sym.replace(/\.(TW|TWO)$/, '');
}

// ── 🐳 尋找大鯨魚：TDCC signal = strong_accumulation / accumulation ──
function quickFindWhales() {
    const stocks = _getWatchlistStocks();
    const whales = [];
    for (const [sym, data] of Object.entries(stocks)) {
        const td = data.tdcc;
        if (!td || !td.signal) continue;
        if (td.signal === 'strong_accumulation' || td.signal === 'accumulation') {
            whales.push({ sym, ...td });
        }
    }
    if (whales.length === 0) {
        return '🐳 <b>尋找大鯨魚</b><br><br>目前自選股裡沒有大戶加碼訊號（TDCC 每週五更新）。<br><br>' +
            '<i class="text-muted">週末或資料未到時，此功能可能為空。</i>';
    }
    whales.sort((a, b) => (b.big_delta || 0) - (a.big_delta || 0));
    let html = `🐳 <b>尋找大鯨魚</b> — 發現 ${whales.length} 檔大戶動作<br><br>`;
    html += '<div class="quick-result-list">';
    for (const w of whales) {
        const label = w.signal === 'strong_accumulation' ? '🐳 強吸' : '🐟 加碼';
        const bd = w.big_delta != null ? (w.big_delta >= 0 ? '+' : '') + w.big_delta + '%' : '—';
        const rd = w.retail_delta != null ? (w.retail_delta >= 0 ? '+' : '') + w.retail_delta + '%' : '—';
        html += `<div class="quick-row">
            <b>${_nameOf(w.sym)}</b> <span class="text-muted">${w.sym}</span>
            <span class="tag-hot">${label}</span><br>
            <span class="text-muted">大戶 ${w.big_pct}% (Δ${bd}) / 散戶 ${w.retail_pct}% (Δ${rd})</span><br>
            <span class="text-muted">${w.signal_reason || ''}</span>
        </div>`;
    }
    html += '</div>';
    return html;
}

// ── ⚡ 技術面噴發：MACD hist > 0 且 RSI > 55 且 MA5 > MA20 ──
function quickTechBreakout() {
    const stocks = _getWatchlistStocks();
    const hot = [];
    for (const [sym, data] of Object.entries(stocks)) {
        const t = data.technical || {};
        const score = _techBreakoutScore(t, data.price);
        if (score.qualifies) hot.push({ sym, data, ...score });
    }
    if (hot.length === 0) {
        return '⚡ <b>技術面噴發</b><br><br>目前自選股沒有符合「強勢突破」條件（MACD 紅柱 + RSI>55 + 多頭排列）。';
    }
    hot.sort((a, b) => b.strength - a.strength);
    let html = `⚡ <b>技術面噴發</b> — 發現 ${hot.length} 檔強勢股<br><br><div class="quick-result-list">`;
    for (const h of hot) {
        const t = h.data.technical || {};
        html += `<div class="quick-row">
            <b>${_nameOf(h.sym)}</b> <span class="text-muted">${h.sym}</span>
            <span class="tag-hot">強度 ${h.strength}</span><br>
            <span class="text-muted">RSI ${t.RSI} · MACD hist ${t.MACD_hist ?? t.MACD?.hist ?? '—'} · K${t.K} D${t.D}</span><br>
            <span class="text-muted">${h.reasons.join(' · ')}</span>
        </div>`;
    }
    html += '</div>';
    return html;
}

function _techBreakoutScore(t, price) {
    const reasons = [];
    let strength = 0;
    const macdHist = t.MACD_hist ?? t.MACD?.hist;
    if (macdHist != null && macdHist > 0) { strength += 2; reasons.push('MACD 紅柱'); }
    if (t.RSI != null && t.RSI > 55 && t.RSI < 80) { strength += 1; reasons.push(`RSI ${t.RSI}`); }
    if (t.MA5 != null && t.MA20 != null && t.MA5 > t.MA20) { strength += 1; reasons.push('MA5>MA20'); }
    if (t.K != null && t.D != null && t.K > t.D && t.K > 50) { strength += 1; reasons.push('KD 黃金交叉'); }
    const bollUp = t.BOLL_upper ?? t.BBands_upper;
    if (bollUp != null && price != null && price > bollUp) { strength += 2; reasons.push('站上布林上緣'); }
    return { qualifies: strength >= 4, strength, reasons };
}

// ── ⭐ 自選股體檢：依 AI verdict 分三欄 ──
function quickWatchlistCheckup() {
    const stocks = _getWatchlistStocks();
    const buckets = { Bullish: [], Neutral: [], Bearish: [] };
    for (const [sym, data] of Object.entries(stocks)) {
        const ai = data.ai_analysis || {};
        const v = ai.verdict || 'Neutral';
        const bucket = buckets[v] ? v : 'Neutral';
        buckets[bucket].push({ sym, ai, data });
    }
    const total = Object.values(buckets).reduce((n, arr) => n + arr.length, 0);
    if (total === 0) return '⭐ <b>自選股體檢</b><br><br>尚無分析結果。';

    const pct = n => total > 0 ? Math.round(n / total * 100) : 0;
    let html = `⭐ <b>自選股體檢</b> — ${total} 檔已分析<br>
        <div class="checkup-summary">
            <span class="verdict-bullish">偏多 ${buckets.Bullish.length} (${pct(buckets.Bullish.length)}%)</span>
            <span class="verdict-neutral">中性 ${buckets.Neutral.length} (${pct(buckets.Neutral.length)}%)</span>
            <span class="verdict-bearish">偏空 ${buckets.Bearish.length} (${pct(buckets.Bearish.length)}%)</span>
        </div>`;
    const order = [['Bullish', '🔴 偏多'], ['Neutral', '⚪ 中性'], ['Bearish', '🟢 偏空']];
    for (const [key, title] of order) {
        const arr = buckets[key];
        if (arr.length === 0) continue;
        arr.sort((a, b) => (b.ai.confidence || 0) - (a.ai.confidence || 0));
        html += `<div class="checkup-group"><b>${title}</b><ul>`;
        for (const item of arr) {
            const conf = item.ai.confidence != null ? `${item.ai.confidence}%` : '—';
            const pctStr = item.data.change_pct != null
                ? `<span class="${item.data.change_pct >= 0 ? 'text-positive' : 'text-negative'}">${item.data.change_pct >= 0 ? '+' : ''}${item.data.change_pct}%</span>`
                : '';
            html += `<li><b>${_nameOf(item.sym)}</b> ${pctStr} · 信心 ${conf}`;
            if (item.ai.volume_verdict && item.ai.volume_verdict !== '無基準') html += ` · ${item.ai.volume_verdict}`;
            html += '</li>';
        }
        html += '</ul></div>';
    }
    return html;
}

// ── 📈 盤勢大檢閱：方案 C — 把結構化資料注入 prompt 給 AI 解讀 ──
function buildMarketReviewPrompt() {
    const mp = marketContext?.market_pulse;
    if (!mp) return null;
    const ctx = {
        taiex: mp.market?.TAIEX,
        chips: mp.chips,
        breadth: mp.breadth,
        futures: mp.futures,
        pcr: mp.pcr,
        margin: mp.margin,
        macro: mp.macro_signals,
        ai_verdict: mp.ai_analysis?.verdict,
        ai_confidence: mp.ai_analysis?.confidence,
    };
    return `請根據以下即時市場資料做「盤勢大檢閱」，用繁體中文，口語化但專業，200 字內：

${JSON.stringify(ctx, null, 2)}

必須涵蓋：
1. 加權指數當下表現與 AI verdict
2. 三大法人買賣超方向
3. 外資期貨淨空單變化（若有 risk signal）
4. 漲跌家數反映的市場寬度
5. 美債 10Y 殖利率風險（若 macro.us10y_warning_level 非 normal 需特別提醒）
6. 一句話結論：現在該加碼、觀望、還是減碼？

禁止瞎編資料，所有數字都要來自上述 JSON。`;
}

async function sendPresetPrompt(label, prompt) {
    // 直接把 prompt 當作 user message 送 API（不顯示原 prompt，只顯示 label）
    chatHistory.push({ role: 'user', parts: [{ text: prompt }] });
    const typingId = appendMsg('ai', '思考中...', true);
    try {
        const systemPrompt = buildSystemPrompt();
        const body = {
            model: CHAT_MODEL,
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: chatHistory,
            generationConfig: { temperature: 0.5, maxOutputTokens: 4096 },
        };
        const response = await fetch(CHAT_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`伺服器錯誤 (${response.status})`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '', buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        fullText += chunk;
                        updateMsg(typingId, formatMarkdown(fullText));
                    } catch {}
                }
            }
        }
        if (!fullText) updateMsg(typingId, '抱歉，無法產生回覆');
        chatHistory.push({ role: 'model', parts: [{ text: fullText }] });
        if (chatHistory.length > 20) chatHistory = chatHistory.slice(-16);
    } catch (e) {
        updateMsg(typingId, e.message || '錯誤');
    }
}

// ============================================================
// UI 控制
// ============================================================

function toggleChat() {
    const panel = document.getElementById('chatPanel');
    const iconOpen = document.querySelector('.chat-icon');
    const iconClose = document.querySelector('.chat-icon-close');
    const isOpen = panel.style.display !== 'none';

    panel.style.display = isOpen ? 'none' : 'flex';
    iconOpen.style.display = isOpen ? 'inline' : 'none';
    iconClose.style.display = isOpen ? 'none' : 'inline';

    if (!isOpen) {
        document.getElementById('chatInput').focus();
    }
}

// ============================================================
// 載入市場資料作為 AI 上下文
// ============================================================

async function loadMarketContext() {
    const fetches = [
        fetch('data/market_pulse.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/watchlist_analysis.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/morning_digest.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ];

    const [pulse, watchlist, digest] = await Promise.all(fetches);
    marketContext = { market_pulse: pulse, watchlist: watchlist, morning_digest: digest };
}

function buildSystemPrompt() {
    let text = `你是一位專業的台灣股市 AI 分析助手。你可以存取以下即時資料來回答使用者的問題。
回答請使用繁體中文，口語化但專業。如果使用者問的問題超出你的資料範圍，請誠實告知。
回答盡量簡潔有力，不要過度冗長。如果涉及投資建議，請附上風險提醒。\n\n`;

    if (marketContext) {
        if (marketContext.market_pulse) {
            const mp = marketContext.market_pulse;
            text += `【市場數據】\n${JSON.stringify(mp.market || {}, null, 2)}\n\n`;
            text += `【三大法人】\n${JSON.stringify(mp.chips || {}, null, 2)}\n\n`;
            if (mp.margin) text += `【融資融券】\n${JSON.stringify(mp.margin, null, 2)}\n\n`;
            if (mp.breadth) text += `【漲跌家數】\n${JSON.stringify(mp.breadth, null, 2)}\n\n`;
            if (mp.futures) text += `【外資期貨未平倉】\n${JSON.stringify(mp.futures, null, 2)}\n\n`;
            if (mp.pcr) text += `【Put/Call Ratio】\n${JSON.stringify(mp.pcr, null, 2)}\n\n`;
            text += `【AI 盤勢分析】\n${JSON.stringify(mp.ai_analysis || {}, null, 2)}\n\n`;
            if (mp.news && mp.news.length > 0) {
                text += `【今日新聞標題】\n`;
                mp.news.forEach(n => { text += `- ${n.title}\n`; });
                text += '\n';
            }
        }
        if (marketContext.watchlist && marketContext.watchlist.stocks) {
            text += `【自選股分析資料】\n${JSON.stringify(marketContext.watchlist.stocks, null, 2)}\n\n`;
        }
        if (marketContext.morning_digest && marketContext.morning_digest.status === 'success') {
            text += `【晨間快報摘要】\n${JSON.stringify(marketContext.morning_digest, null, 2)}\n\n`;
        }
    }

    return text;
}

// ============================================================
// 聊天邏輯 — 透過 Cloudflare Worker 代理
// ============================================================

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    appendMsg('user', text);
    input.value = '';
    input.disabled = true;

    chatHistory.push({ role: 'user', parts: [{ text }] });

    const typingId = appendMsg('ai', '思考中...', true);

    try {
        const systemPrompt = buildSystemPrompt();

        const body = {
            model: CHAT_MODEL,
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: chatHistory,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048,
            },
        };

        const response = await fetch(CHAT_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (response.status === 429) {
                throw new Error('請求太頻繁了，請稍等一下再試 😅');
            }
            throw new Error(errData.error || `伺服器錯誤 (${response.status})`);
        }

        // 串流讀取
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        fullText += chunk;
                        updateMsg(typingId, formatMarkdown(fullText));
                    } catch {
                        // 跳過無法解析的 chunk
                    }
                }
            }
        }

        if (!fullText) {
            fullText = '抱歉，我無法產生回覆，請稍後再試。';
            updateMsg(typingId, fullText);
        }

        chatHistory.push({ role: 'model', parts: [{ text: fullText }] });

        // 限制歷史長度
        if (chatHistory.length > 20) {
            chatHistory = chatHistory.slice(-16);
        }

    } catch (error) {
        console.error('Chat error:', error);
        updateMsg(typingId, error.message || '發生未知錯誤，請稍後再試。');
    } finally {
        input.disabled = false;
        input.focus();
    }
}

// ============================================================
// 訊息渲染
// ============================================================

let msgCounter = 0;

function appendMsg(role, content, isTyping = false) {
    const container = document.getElementById('chatMessages');
    const id = `msg-${++msgCounter}`;
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.id = id;
    div.innerHTML = `<div class="chat-msg-content ${isTyping ? 'typing' : ''}">${content}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}

function updateMsg(id, content) {
    const el = document.getElementById(id);
    if (el) {
        const inner = el.querySelector('.chat-msg-content');
        inner.classList.remove('typing');
        inner.innerHTML = content;
        document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
    }
}

function formatMarkdown(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}
