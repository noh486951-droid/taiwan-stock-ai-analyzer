/**
 * AI 聊天助手 — 透過 Cloudflare Worker 代理連接 Gemini API
 *
 * 設定方式：
 * 1. 在 WORKER_URL 填入你部署的 Cloudflare Worker 網址
 * 2. 使用者不需要提供 API Key，Key 安全存在 Worker 端
 */

// ============================================================
// 設定 — 部署 Worker 後把這個 URL 改成你的
// ============================================================
const WORKER_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';
const CHAT_MODEL = 'gemini-2.5-flash-lite';

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
                        例如：<br>
                        • 今天台股大盤怎麼樣？<br>
                        • 台積電現在可以買嗎？<br>
                        • 幫我分析三大法人動向<br>
                        • VIX 恐慌指數目前多少？
                    </div>
                </div>
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
        fetch('data/market_pulse.json').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/watchlist_analysis.json').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/morning_digest.json').then(r => r.ok ? r.json() : null).catch(() => null),
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

        const response = await fetch(WORKER_URL, {
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
