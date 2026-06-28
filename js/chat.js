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
// v11.10.2：諮詢類大 prompt 改用穩定版 2.5 flash（preview 版偶爾 503/timeout）
const CHAT_MODEL = 'gemini-2.5-flash';

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
                <button class="chat-chip" data-action="golden_cross">🌟 黃金交叉股</button>
                <button class="chat-chip" data-action="find_whales">🐳 尋找大鯨魚</button>
                <button class="chat-chip" data-action="tech_breakout">⚡ 技術面噴發</button>
                <button class="chat-chip" data-action="watchlist_checkup">⭐ 自選股體檢</button>
            </div>
            <div class="chat-input-area">
                <input type="text" id="chatInput" placeholder="輸入問題..." />
                <button id="chatSendBtn" class="btn-primary btn-sm">送出</button>
                <button id="chatClearBtn" class="btn-clear-history" title="清除聊天歷史">🧹</button>
            </div>
        </div>
    `;
    document.body.appendChild(widget);

    document.getElementById('chatToggleBtn').addEventListener('click', toggleChat);
    document.getElementById('chatSendBtn').addEventListener('click', sendMessage);
    document.getElementById('chatClearBtn').addEventListener('click', () => {
        if (confirm('確定要清除聊天歷史嗎？這會讓 AI 忘記之前的對話。')) {
            chatHistory = [];
            appendMsg('ai', '已清除聊天歷史 ✨');
        }
    });
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
    // v12.1：黃金交叉股 — 走 AI 推薦（資料已在 system prompt）
    if (action === 'golden_cross') {
        const prompt = `請從【🌟 黃金交叉雙料股】清單裡挑 3-5 檔最值得追蹤的個股，逐一說明：
1. 為什麼是「黃金交叉」（大戶在累積什麼程度 + 月營收成長多少）
2. 目前技術面看法（如果有資料）
3. 風險警示（如有 — 例如已漲多、產業逆風）

如果清單為空，請說明「今天還沒有符合雙重條件的標的」並引導用戶過幾天再看。
回覆繁體中文，每檔約 80-150 字。`;
        await sendPresetPrompt('黃金交叉股', prompt);
        return;
    }

    // 方案 B: 純本地 JSON 篩選，不叫 AI
    // v12.4.8：find_whales 改成 async（要 fetch 全市場 whale_candidates.json）
    let html;
    try {
        if (action === 'find_whales')          html = await quickFindWhales();
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

// ── 🐳 尋找大鯨魚 v2：全市場掃描，挑 3 隻最強鯨魚 + 顯示回測勝率 ──
async function quickFindWhales() {
    let whaleData;
    try {
        const r = await fetch('data/whale_candidates.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('檔案不存在');
        whaleData = await r.json();
    } catch (e) {
        return '🐳 <b>尋找大鯨魚</b><br><br>全市場掃描資料尚未生成（每週六凌晨 TDCC 更新後自動產生）。<br><br>' +
            '<i class="text-muted">如果這是新功能首次使用，請等今晚 18:07 EOD workflow 跑完。</i>';
    }
    const top = (whaleData.top || []).slice(0, 4);  // v12.5.7：3 → 4 隻
    if (top.length === 0) {
        return `🐳 <b>尋找大鯨魚</b><br><br>本週全市場沒有明顯鯨魚吸籌訊號（截至 ${whaleData.as_of_date || '?'}）。<br><br>` +
            '<i class="text-muted">這通常表示市場處於整理或恐慌期，鯨魚還沒進場。</i>';
    }

    // v12.5.8：讀過去回測 + 本週進行中的 picks
    let backtestHtml = '';
    let currentWeekHtml = '';
    try {
        const br = await fetch('data/whale_picks_history.json', { cache: 'no-store' });
        if (br.ok) {
            const bj = await br.json();
            const weeks = bj.weeks || [];
            // 已 evaluated 的過去週 → 勝率統計
            const past = weeks.filter(w => w.evaluated).slice(-4);
            if (past.length > 0) {
                const allPicks = past.flatMap(w => w.picks || []);
                const evaluated = allPicks.filter(p => p.return_pct != null);
                if (evaluated.length > 0) {
                    const wins = evaluated.filter(p => p.return_pct > 0).length;
                    const avgRet = evaluated.reduce((s, p) => s + p.return_pct, 0) / evaluated.length;
                    const winRate = (wins / evaluated.length * 100);
                    const retColor = avgRet >= 0 ? 'text-positive' : 'text-negative';
                    backtestHtml = `<div style="background:rgba(120,80,255,0.08);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:0.8rem;">
                        📊 <b>過去 ${past.length} 週鯨魚追蹤</b>：共 ${evaluated.length} 筆，勝率 <b>${winRate.toFixed(0)}%</b>，平均週報酬 <b class="${retColor}">${avgRet >= 0 ? '+' : ''}${avgRet.toFixed(2)}%</b>
                    </div>`;
                }
            }
            // 本週執行中（尚未 evaluated）→ 顯示鎖定 picks + 即時 running %
            const currentWeek = [...weeks].reverse().find(w => !w.evaluated);
            if (currentWeek && (currentWeek.picks || []).length > 0) {
                const picks = currentWeek.picks;
                const rows = picks.map(p => {
                    const ret = p.running_return_pct;
                    const cls = ret == null ? 'text-muted' : (ret > 0 ? 'text-positive' : (ret < 0 ? 'text-negative' : 'text-muted'));
                    const sign = ret == null ? '' : (ret > 0 ? '+' : '');
                    const retLabel = ret == null ? '—' : `${sign}${ret.toFixed(2)}%`;
                    return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:0.78rem;">
                        <span><b>${_nameOf(p.sym)}</b> <span class="text-muted">${p.sym}</span></span>
                        <span class="${cls}"><b>${retLabel}</b></span>
                    </div>`;
                }).join('');
                currentWeekHtml = `<div style="background:rgba(34,197,94,0.08);border-radius:6px;padding:8px 10px;margin-bottom:10px;border-left:3px solid #22c55e;">
                    <div style="font-size:0.8rem;color:#86efac;font-weight:600;margin-bottom:6px;">
                        📅 本週鎖定 (週一 ${currentWeek.snapshot_date}) · 進行中
                    </div>
                    ${rows}
                </div>`;
            }
        }
    } catch {}

    // v12.5.6：支援兩種 source schema
    const isPseudo = (whaleData.source || '').includes('pseudo');
    const sourceTag = isPseudo
        ? `<span class="text-muted" style="font-size:0.7rem;">📊 主力資金法 (T86)</span>`
        : `<span class="text-muted" style="font-size:0.7rem;">🏛️ 集保千張法 (TDCC)</span>`;

    let html = `🐳 <b>尋找大鯨魚</b> <span class="text-muted">(截至 ${whaleData.as_of_date || '?'})</span> ${sourceTag}<br>`;
    html += currentWeekHtml;
    html += backtestHtml;
    html += `<div style="font-size:0.78rem;color:#aaa;font-weight:600;margin-bottom:6px;margin-top:8px;">🔄 今日 Top ${top.length}（每日浮動，已自動加入 AI 虛擬交易候選池）</div>`;
    html += '<div class="quick-result-list">';
    for (const w of top) {
        let detailLine;
        if (isPseudo) {
            // T86 主力資金 schema
            const smartLots = w.smart_money_5d_lots ?? 0;
            const smartSign = smartLots >= 0 ? '+' : '';
            const retailLots = w.retail_estimate_5d_lots ?? 0;
            const retailSign = retailLots >= 0 ? '+' : '';
            const fSt = w.foreign_streak ?? 0;
            const tSt = w.trust_streak ?? 0;
            const fSgn = fSt >= 0 ? '+' : '';
            const tSgn = tSt >= 0 ? '+' : '';
            const fStLabel = fSt >= 3 ? `<span class="text-positive">外資連${fSt}日</span>` : (fSt <= -3 ? `<span class="text-negative">外資連賣${Math.abs(fSt)}日</span>` : `外資${fSgn}${fSt}日`);
            detailLine = `<span class="text-muted">主力 5 日：<span class="text-positive">${smartSign}${smartLots.toLocaleString()} 張</span> ｜
                散戶推估 <span class="${retailLots < 0 ? 'text-positive' : 'text-negative'}">${retailSign}${retailLots.toLocaleString()} 張</span><br>
                ${fStLabel} · 投信 ${tSgn}${tSt} 日</span>`;
        } else {
            // TDCC 千張 schema
            const bd = (w.mega_delta >= 0 ? '+' : '') + w.mega_delta + 'pp';
            const rd = (w.retail_delta >= 0 ? '+' : '') + w.retail_delta + 'pp';
            const dCls = w.mega_delta > 0 ? 'text-positive' : 'text-muted';
            const rCls = w.retail_delta < 0 ? 'text-positive' : (w.retail_delta > 0 ? 'text-negative' : 'text-muted');
            detailLine = `<span class="text-muted">千張 ${w.mega_pct.toFixed(2)}% (<span class="${dCls}">${bd}</span>) ｜
                大戶 ${w.big_pct.toFixed(2)}% ｜ 散戶 ${w.retail_pct.toFixed(2)}% (<span class="${rCls}">${rd}</span>)</span>`;
        }
        html += `<div class="quick-row">
            <b>${_nameOf(w.sym)}</b> <span class="text-muted">${w.sym}</span>
            <span class="tag-hot">${w.label}</span> <span class="text-muted" style="font-size:0.7rem;">分數 ${w.whale_score}</span><br>
            ${detailLine}
        </div>`;
    }
    html += '</div>';
    const explainer = isPseudo
        ? '💡 主力資金法：外資+投信 5 日合計買超 × 連續日數因子 − 散戶推估阻力。每日 EOD 更新。TDCC 服務恢復後自動切換成集保千張法。'
        : '💡 集保千張法：千張Δ×2 + 大戶Δ×0.7 − 散戶Δ×0.5。每週五 TDCC 公佈後自動更新。';
    html += `<div class="text-muted" style="font-size:0.7rem;margin-top:6px;">${explainer}</div>`;
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
    const isConsult = (label === 'AI 持倉諮詢');
    // v11.10.2：諮詢類「單次請求」— 不放 chatHistory（避免重試膨脹 + 老 context 干擾）
    // 老式聊天才用 chatHistory；諮詢每次都用乾淨的 contents
    const oneShotContents = [{ role: 'user', parts: [{ text: prompt }] }];
    const useHistory = !isConsult;
    if (useHistory) {
        chatHistory.push({ role: 'user', parts: [{ text: prompt }] });
    }
    const typingId = appendMsg('ai', '思考中…（諮詢首字可能要 30 秒以上）', true);
    let fullText = '';
    let aborted = false;
    const ctrl = new AbortController();
    // v11.10.2：兩段式 timeout — 首字較寬（諮詢 prompt 大、Gemini warmup 慢）；首字後嚴
    let stallTimer = null;
    let firstChunkReceived = false;
    const FIRST_CHUNK_MS = 60000;
    const STALL_MS = 25000;
    const resetStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        const ms = firstChunkReceived ? STALL_MS : FIRST_CHUNK_MS;
        stallTimer = setTimeout(() => {
            aborted = true;
            try { ctrl.abort(); } catch {}
        }, ms);
    };
    try {
        const systemPrompt = buildSystemPrompt();
        const body = {
            model: CHAT_MODEL,
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: useHistory ? chatHistory : oneShotContents,
            generationConfig: { temperature: 0.5, maxOutputTokens: isConsult ? 8192 : 4096 },
        };
        resetStall();
        const response = await fetch(CHAT_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`伺服器錯誤 ${response.status}：${errText.slice(0, 400)}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!firstChunkReceived) {
                firstChunkReceived = true;
                updateMsg(typingId, '⏳ AI 正在生成…');
            }
            resetStall();
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
        if (stallTimer) clearTimeout(stallTimer);
        if (!fullText) updateMsg(typingId, '抱歉，無法產生回覆');
        if (useHistory) {
            chatHistory.push({ role: 'model', parts: [{ text: fullText }] });
            if (chatHistory.length > 20) chatHistory = chatHistory.slice(-16);
        }
        if (isConsult && fullText && fullText.length > 100) {
            try { await _pushConsultToDiscord(fullText); } catch (e) { console.warn('discord consult push failed', e); }
        }
    } catch (e) {
        if (stallTimer) clearTimeout(stallTimer);
        // 失敗時把這輪加進去的 user prompt 拿掉（避免下次重試疊加）
        if (useHistory && chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') {
            chatHistory.pop();
        }
        const phase = firstChunkReceived ? '生成中斷' : 'AI 還沒開始回覆';
        const got = fullText ? formatMarkdown(fullText) + '\n\n---\n' : '';
        const msg = aborted
            ? `⚠️ ${phase}（${firstChunkReceived ? STALL_MS / 1000 : FIRST_CHUNK_MS / 1000} 秒）\n${got}**👉 點下方紅色「重試」可重發**`
            : `❌ ${e.message || '錯誤'}`;
        updateMsg(typingId, msg);
        try { _addRetryButton(typingId, label, prompt); } catch {}
    }
}

// v11.10.1：在 typing message 下方加重試按鈕
function _addRetryButton(msgId, label, prompt) {
    const msgEl = document.getElementById(msgId);
    if (!msgEl) return;
    // 避免重複加按鈕
    if (msgEl.querySelector('.chat-retry-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'chat-retry-btn';
    btn.textContent = '🔄 重試';
    btn.style.cssText = 'margin-top:0.5rem;margin-right:0.4rem;padding:4px 12px;background:#ef4444;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:0.85rem;';
    btn.addEventListener('click', () => {
        // 把這個失敗 typing 訊息整個移除（不要堆積）
        try { msgEl.remove(); } catch {}
        sendPresetPrompt(label, prompt);
    });
    msgEl.appendChild(btn);
    // 同時加「清除歷史」按鈕（避免老聊天記錄累積拖慢新對話）
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🧹 清除聊天歷史';
    clearBtn.style.cssText = 'margin-top:0.5rem;padding:4px 12px;background:#6b7280;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:0.85rem;';
    clearBtn.addEventListener('click', () => {
        try { chatHistory = []; } catch {}
        clearBtn.textContent = '✅ 已清除';
        clearBtn.disabled = true;
    });
    msgEl.appendChild(clearBtn);
}

// v11.10：把 AI 諮詢結果摘要推到 Discord（透過 Worker 代理，URL 不暴露）
async function _pushConsultToDiscord(fullText) {
    const summary = _summarizeConsult(fullText);
    const uid = localStorage.getItem('tw_stock_cloud_uid') || '';
    if (!uid) return;
    // 從 chat URL 推導出 origin，組出 /api/discord-notify
    let notifyUrl;
    try {
        const u = new URL(CHAT_WORKER_URL);
        notifyUrl = `${u.origin}/api/discord-notify`;
    } catch {
        notifyUrl = CHAT_WORKER_URL.replace(/\/$/, '') + '/api/discord-notify';
    }
    try {
        const r = await fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'consult',
                uid,
                summary: summary,
                positions_count: (typeof _portfolio !== 'undefined' && _portfolio?.positions)
                    ? Object.keys(_portfolio.positions).length : 0,
            }),
        });
        const j = await r.json().catch(() => ({}));
        if (j.ok) console.log('✅ AI 諮詢結果已推送到 Discord');
        else console.warn('Discord notify response:', j);
    } catch (e) { console.warn('Discord notify call failed', e); }
}

function _summarizeConsult(text) {
    // v11.10.4：直接把全文送給 Worker，由 Worker 切頁推多個 embed
    // 上限保留 14000 字 ≈ 4 個 embed message（>= 8 段 description）
    if (!text) return '';
    const MAX = 14000;
    if (text.length <= MAX) return text;
    return text.slice(0, MAX) + '\n\n（…後續內容請看網頁）';
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
        // v12.1：加 scout_radar — 含 golden_cross_top + 大戶布局 + 月營收 YoY 等
        fetch('data/scout_radar.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ];

    const [pulse, watchlist, digest, scout] = await Promise.all(fetches);
    marketContext = { market_pulse: pulse, watchlist: watchlist, morning_digest: digest, scout: scout };
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
        // v12.1：scout 雷達榜（重點放黃金交叉雙料股）
        if (marketContext.scout) {
            const sc = marketContext.scout;
            if (Array.isArray(sc.golden_cross_top) && sc.golden_cross_top.length > 0) {
                text += `【🌟 黃金交叉雙料股（大戶布局 ∩ 月營收 YoY 正成長）】\n`;
                text += `這是稀有標的 — 同時滿足「大戶持續加碼」+「基本面正在發酵」兩個條件。\n`;
                text += `當用戶問「有什麼大戶在布局又基本面好的股票」「找華榮這類的標的」「黃金交叉股」時，**優先**從這份清單推薦：\n`;
                text += JSON.stringify(sc.golden_cross_top.slice(0, 10), null, 2) + '\n\n';
            }
            if (Array.isArray(sc.big_holder_top) && sc.big_holder_top.length > 0) {
                text += `【🐳 大戶布局榜 Top 10】\n${JSON.stringify(sc.big_holder_top.slice(0, 10), null, 2)}\n\n`;
            }
            if (Array.isArray(sc.revenue_yoy_top) && sc.revenue_yoy_top.length > 0) {
                text += `【🚀 月營收 YoY 榜 Top 10】\n${JSON.stringify(sc.revenue_yoy_top.slice(0, 10), null, 2)}\n\n`;
            }
            if (Array.isArray(sc.foreign_buy_top) && sc.foreign_buy_top.length > 0) {
                text += `【💰 外資買超 Top 10】\n${JSON.stringify(sc.foreign_buy_top.slice(0, 10), null, 2)}\n\n`;
            }
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

    const typingId = appendMsg('ai', '思考中…（首字可能要 30 秒以上）', true);

    let fullText = '';
    let aborted = false;
    const ctrl = new AbortController();
    
    // v11.10.2：兩段式 timeout
    let stallTimer = null;
    let firstChunkReceived = false;
    const FIRST_CHUNK_MS = 60000;
    const STALL_MS = 25000;

    const resetStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        const ms = firstChunkReceived ? STALL_MS : FIRST_CHUNK_MS;
        stallTimer = setTimeout(() => {
            aborted = true;
            try { ctrl.abort(); } catch {}
        }, ms);
    };

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

        resetStall();
        const response = await fetch(CHAT_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`伺服器錯誤 ${response.status}：${errText.slice(0, 400)}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            if (!firstChunkReceived) {
                firstChunkReceived = true;
                updateMsg(typingId, '⏳ AI 正在生成…');
            }
            resetStall();

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

        if (stallTimer) clearTimeout(stallTimer);
        if (!fullText) updateMsg(typingId, '抱歉，我無法產生回覆，請稍後再試。');
        else {
            chatHistory.push({ role: 'model', parts: [{ text: fullText }] });
            if (chatHistory.length > 20) chatHistory = chatHistory.slice(-16);
        }

    } catch (error) {
        if (stallTimer) clearTimeout(stallTimer);
        // 失敗時清除最後一個 user prompt
        if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') {
            chatHistory.pop();
        }

        const phase = firstChunkReceived ? '生成中斷' : 'AI 還沒開始回覆';
        const got = fullText ? formatMarkdown(fullText) + '\n\n---\n' : '';
        const msg = aborted
            ? `⚠️ ${phase}（超過 ${firstChunkReceived ? STALL_MS / 1000 : FIRST_CHUNK_MS / 1000} 秒）\n${got}**👉 點下方按鈕重試**`
            : `❌ ${error.message || '發生未知錯誤'}`;
        
        updateMsg(typingId, msg);
        _addRetryButton(typingId, '一般對話', text);
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
