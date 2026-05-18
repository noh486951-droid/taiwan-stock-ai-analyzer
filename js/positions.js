// positions.js — 自選股持倉成本 + AI 建議下一步 (v11.14.9)
//
// 設計目標：
//   1. 完全獨立於 paper_trade（虛擬投資）— 這裡只是「自選股多了買入價」
//   2. localStorage 為主，登入後跟 watchlist 同一個 KV payload 同步（多 1 個欄位）
//   3. AI 建議按需呼叫（點按鈕才打 /api/chat），用既有的 Gemini→Groq→Mistral 鏈

const POSITIONS_KEY = 'tw_watchlist_positions';

// 全域狀態（讓 watchlist.js pushToCloud 拿來夾帶送 KV）
window._positions = window._positions || null;
window._remotePositions = window._remotePositions || null;

// ========== Storage ==========

function getPositions() {
    if (window._positions !== null) return window._positions;
    try {
        const raw = localStorage.getItem(POSITIONS_KEY);
        window._positions = raw ? JSON.parse(raw) : {};
    } catch {
        window._positions = {};
    }
    return window._positions;
}

function savePositions(positions) {
    window._positions = positions || {};
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(window._positions));
    // 觸發雲端同步（如果 watchlist.js 有定義 pushToCloud）
    try { if (typeof pushToCloud === 'function') pushToCloud(); } catch {}
}

function getPosition(symbol) {
    return getPositions()[symbol] || null;
}

function setPosition(symbol, data) {
    const positions = getPositions();
    if (!data) {
        delete positions[symbol];
    } else {
        positions[symbol] = data;
    }
    savePositions(positions);
}

// 給 watchlist.js 的雲端同步用
window.getPositionsForCloud = function () {
    return getPositions();
};
window.applyPositionsFromCloud = function (positions) {
    if (positions && typeof positions === 'object') {
        window._positions = positions;
        localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    }
};

// ========== 浮動損益計算 ==========

function calcPL(position, currentPrice) {
    if (!position || !currentPrice) return null;
    const cost = parseFloat(position.cost) || 0;
    const shares = parseFloat(position.shares) || 0;
    if (cost <= 0 || shares <= 0) return null;

    const currentValue = currentPrice * shares;
    const costValue = cost * shares;
    const pnlAbs = currentValue - costValue;
    const pnlPct = ((currentPrice - cost) / cost) * 100;
    return {
        pnl_abs: pnlAbs,
        pnl_pct: pnlPct,
        cost_value: costValue,
        current_value: currentValue,
    };
}

function formatMoney(n) {
    if (n == null || isNaN(n)) return '-';
    const abs = Math.abs(n);
    if (abs >= 10000) return (n / 10000).toFixed(1) + '萬';
    return Math.round(n).toLocaleString();
}

// ========== 卡片內持倉區塊 ==========

window.renderPositionSection = function (symbol, stockData) {
    const pos = getPosition(symbol);
    const currentPrice = parseFloat(stockData?.price) || 0;

    if (!pos) {
        return `
            <div class="position-section position-empty">
                <button class="position-add-btn" onclick="window.openPositionEditor(event, '${symbol}')" title="新增買入成本">
                    💼 + 設定持倉成本
                </button>
            </div>
        `;
    }

    const pl = calcPL(pos, currentPrice);
    const pnlCls = pl && pl.pnl_pct >= 0 ? 'text-positive' : 'text-negative';
    const sign = pl && pl.pnl_pct >= 0 ? '+' : '';
    const lots = (pos.shares / 1000).toFixed(pos.shares % 1000 === 0 ? 0 : 1);
    const totalCost = pos.total_cost != null ? pos.total_cost : (pos.cost * pos.shares);
    const costPerShare = (typeof pos.cost === 'number') ? pos.cost.toFixed(2) : '-';

    return `
        <div class="position-section">
            <div class="position-row">
                <span class="position-label">💼 持倉</span>
                <span class="position-cost">投入 $${formatMoney(totalCost)} / ${lots} 張 (均價 ${costPerShare})</span>
                ${pl ? `
                    <span class="${pnlCls} position-pnl">
                        ${sign}${pl.pnl_pct.toFixed(2)}%
                        <span class="position-pnl-abs">(${sign}${formatMoney(pl.pnl_abs)})</span>
                    </span>
                ` : ''}
            </div>
            <div class="position-actions">
                <button class="position-btn position-edit-btn" onclick="window.openPositionEditor(event, '${symbol}')" title="編輯">✏️</button>
                <button class="position-btn position-advise-btn" onclick="window.analyzePosition(event, '${symbol}')" title="AI 建議下一步">🤖 AI 建議</button>
                <button class="position-btn position-clear-btn" onclick="window.clearPosition(event, '${symbol}')" title="清除持倉資料">🗑</button>
            </div>
            <div class="position-advice" id="position-advice-${symbol.replace('.', '-')}" style="display:none;"></div>
        </div>
    `;
};

// ========== 編輯彈窗 ==========

window.openPositionEditor = function (e, symbol) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const pos = getPosition(symbol) || {};
    const cnName = (typeof getChineseName === 'function') ? getChineseName(symbol) : symbol;
    // 既有資料：以前是存 cost(每股)，換算回 total
    const initTotal = (pos.total_cost != null)
        ? pos.total_cost
        : (pos.cost && pos.shares ? Math.round(pos.cost * pos.shares) : '');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay position-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content glass" style="max-width:480px;">
            <button class="modal-close" onclick="this.closest('.position-modal').remove()">&times;</button>
            <h2 style="margin-bottom:1rem;">💼 持倉成本 — ${cnName} <span class="text-muted" style="font-size:0.8rem;">${symbol}</span></h2>
            <div class="position-form">
                <label>
                    投資總額（元）
                    <input type="number" id="posTotal" step="1" min="0" value="${initTotal}" placeholder="如 27629（含手續費實際扣款金額）" />
                    <small class="text-muted" id="posCostPerShareHint">&nbsp;</small>
                </label>
                <label>
                    持股股數
                    <input type="number" id="posShares" step="1000" min="0" value="${pos.shares ?? ''}" placeholder="如 1000（= 1 張）" />
                    <small class="text-muted">台股 1 張 = 1000 股，零股請填實際股數</small>
                </label>
                <label>
                    入場日（選填）
                    <input type="date" id="posDate" value="${pos.entry_date ?? ''}" />
                </label>
                <label>
                    備註（選填）
                    <textarea id="posNotes" rows="2" placeholder="如：AI 諮詢後加碼、長線存股..." style="resize:vertical;">${pos.notes ?? ''}</textarea>
                </label>
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:1rem;justify-content:flex-end;">
                ${pos.cost || pos.total_cost ? `<button class="btn-secondary" onclick="window._deletePosition('${symbol}', this)">🗑 移除</button>` : ''}
                <button class="btn-secondary" onclick="this.closest('.position-modal').remove()">取消</button>
                <button class="btn-primary" onclick="window._savePosition('${symbol}', this)">儲存</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', ev => { if (ev.target === modal) modal.remove(); });

    // 即時顯示「= 平均 X 元/股」
    const updateHint = () => {
        const t = parseFloat(modal.querySelector('#posTotal').value);
        const s = parseFloat(modal.querySelector('#posShares').value);
        const hint = modal.querySelector('#posCostPerShareHint');
        if (t > 0 && s > 0) {
            hint.textContent = `= 平均 ${(t / s).toFixed(2)} 元/股`;
            hint.style.color = '#b794ff';
        } else {
            hint.innerHTML = '&nbsp;';
        }
    };
    modal.querySelector('#posTotal').addEventListener('input', updateHint);
    modal.querySelector('#posShares').addEventListener('input', updateHint);
    updateHint();
    setTimeout(() => modal.querySelector('#posTotal')?.focus(), 50);
};

window._savePosition = function (symbol, btn) {
    const modal = btn.closest('.position-modal');
    const totalCost = parseFloat(modal.querySelector('#posTotal').value);
    const shares = parseInt(modal.querySelector('#posShares').value, 10);
    const entry_date = modal.querySelector('#posDate').value || '';
    const notes = modal.querySelector('#posNotes').value.trim();
    if (!(totalCost > 0) || !(shares > 0)) {
        alert('請輸入有效的投資總額與股數');
        return;
    }
    // 內部仍存每股成本（讓 calcPL 不用改），同時存 total_cost 給編輯時還原
    const cost = totalCost / shares;
    setPosition(symbol, {
        cost,
        total_cost: totalCost,
        shares,
        entry_date,
        notes,
        updated_at: new Date().toISOString(),
    });
    modal.remove();
    if (typeof loadWatchlist === 'function') loadWatchlist();
};

window._deletePosition = function (symbol, btn) {
    if (!confirm(`確定移除 ${symbol} 的持倉資料？（不會影響虛擬投資）`)) return;
    setPosition(symbol, null);
    btn.closest('.position-modal').remove();
    if (typeof loadWatchlist === 'function') loadWatchlist();
};

window.clearPosition = function (e, symbol) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (!confirm(`確定移除 ${symbol} 的持倉資料？`)) return;
    setPosition(symbol, null);
    if (typeof loadWatchlist === 'function') loadWatchlist();
};

// ========== AI 建議 ==========

const POSITION_WORKER_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';

window.analyzePosition = async function (e, symbol) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const pos = getPosition(symbol);
    if (!pos) { alert('請先設定持倉成本'); return; }

    const adviceId = 'position-advice-' + symbol.replace('.', '-');
    const adviceEl = document.getElementById(adviceId);
    if (!adviceEl) return;

    // 從 _analysisCache 拿該股最新資料
    const stockData = (window._analysisCache || {})[symbol] || {};
    const currentPrice = parseFloat(stockData.price) || 0;
    if (!currentPrice) {
        adviceEl.style.display = 'block';
        adviceEl.innerHTML = `<p class="text-negative">⚠️ 沒有當日報價資料，請等下次盤後排程更新後再試。</p>`;
        return;
    }

    const pl = calcPL(pos, currentPrice);
    adviceEl.style.display = 'block';
    adviceEl.innerHTML = `<p class="text-muted">⏳ AI 分析中（最多 30 秒）…</p>`;

    // 組 prompt — 把該股的所有有用資料丟進去
    const prompt = _buildPositionPrompt(symbol, pos, stockData, pl);

    try {
        const body = {
            model: 'gemini-2.5-flash',
            system_instruction: { parts: [{ text: '你是一位專精台股的資深操盤手與風險管理顧問。請依用戶提供的「個股當前資料 + 持倉成本」給出明確的下一步建議。回覆請使用繁體中文、條列清晰、避免空話。' }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
        };
        const resp = await fetch(POSITION_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        }
        // 讀取 SSE 串流
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
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
                        adviceEl.innerHTML = _formatAdvice(fullText);
                    } catch {}
                }
            }
        }
        if (!fullText) {
            adviceEl.innerHTML = `<p class="text-negative">⚠️ AI 沒有回傳內容，請稍後再試。</p>`;
        } else {
            // 加個收合按鈕
            adviceEl.innerHTML = _formatAdvice(fullText) + `
                <div style="margin-top:0.5rem;text-align:right;">
                    <button class="position-btn" onclick="document.getElementById('${adviceId}').style.display='none'">收合</button>
                </div>`;
        }
    } catch (err) {
        adviceEl.innerHTML = `<p class="text-negative">❌ 分析失敗：${err.message.slice(0, 200)}</p>`;
    }
};

function _buildPositionPrompt(symbol, pos, stockData, pl) {
    const cnName = (typeof getChineseName === 'function') ? getChineseName(symbol, stockData.name) : (stockData.name || symbol);
    const tech = stockData.technical || {};
    const fund = stockData.fundamental || {};
    const chip = stockData.chip_concentration || {};
    const inst = stockData.institutional || {};
    const ai = stockData.ai_analysis || {};
    const rs = stockData.rs || {};
    const mr = stockData.monthly_revenue || {};

    const techStr = [
        tech.MA5 != null ? `MA5 ${tech.MA5}` : null,
        tech.MA20 != null ? `MA20 ${tech.MA20}` : null,
        tech.MA60 != null ? `MA60 ${tech.MA60}` : null,
        tech.RSI != null ? `RSI ${tech.RSI}` : null,
        tech.K != null ? `K ${tech.K} / D ${tech.D}` : null,
        tech.MACD != null ? `MACD ${tech.MACD}` : null,
    ].filter(Boolean).join('、');

    const instStr = inst.total_today != null
        ? `今日法人 ${Math.round(inst.total_today / 1000)} 張（外資 ${Math.round((inst.foreign?.today||0)/1000)} / 投信 ${Math.round((inst.trust?.today||0)/1000)} / 自營 ${Math.round((inst.dealer?.today||0)/1000)}）；5 日累計 ${Math.round((inst.total_5d||0)/1000)} 張`
        : '無';

    const chipStr = chip.trend_10d
        ? `10 日 ${chip.trend_10d}(score ${chip.score_10d})、20 日 ${chip.trend_20d}(score ${chip.score_20d})`
        : '無';

    const rsStr = rs.label
        ? `${rs.label}（vs 大盤 ${rs.vs_taiex_pct != null ? rs.vs_taiex_pct + '%' : '-'}）`
        : '未提供';

    const mrStr = mr.yoy_pct != null
        ? `月營收 YoY ${mr.yoy_pct}% / MoM ${mr.mom_pct ?? '-'}% / 累計 YoY ${mr.cumulative_yoy_pct ?? '-'}%`
        : '無';

    const aiStr = ai.analysis
        ? `近期 AI 評語（${ai.verdict || '中性'}, 信心 ${ai.confidence ?? '-'}％）：${String(ai.analysis).slice(0, 400)}`
        : '無';

    const heldDays = pos.entry_date
        ? Math.max(0, Math.floor((new Date() - new Date(pos.entry_date)) / 86400000))
        : null;

    return `
請依以下個股當前資料 + 我的持倉成本，給出**明確的下一步操作建議**（必須選一個動作，不要含糊）。

# 個股資料
代號：${symbol}（${cnName}）
產業：${mr.industry || '-'}
當前股價：${stockData.price}（今日 ${stockData.change_pct >= 0 ? '+' : ''}${stockData.change_pct}%）
技術面：${techStr || '無'}
基本面：PE ${fund.PE ?? '-'}、殖利率 ${fund.dividend_yield ?? '-'}%、EPS ${fund.EPS ?? '-'}
籌碼集中：${chipStr}
法人動向：${instStr}
RS 相對強度：${rsStr}
月營收成長：${mrStr}
${aiStr}

# 我的持倉
投資總額：${(pos.total_cost ?? (pos.cost * pos.shares)).toLocaleString()} 元
平均成本：${pos.cost.toFixed(2)} 元/股
持股：${pos.shares} 股（${(pos.shares/1000).toFixed(pos.shares % 1000 === 0 ? 0 : 1)} 張）
入場日：${pos.entry_date || '未填'}${heldDays !== null ? `（已持 ${heldDays} 天）` : ''}
目前市值：${Math.round(pl.current_value).toLocaleString()} 元
浮動損益：${pl.pnl_pct >= 0 ? '+' : ''}${pl.pnl_pct.toFixed(2)}%（${pl.pnl_abs >= 0 ? '+' : ''}${Math.round(pl.pnl_abs).toLocaleString()} 元）
備註：${pos.notes || '無'}

# 請回覆以下結構（用 Markdown 標題）

## 🎯 建議動作
從以下「擇一」並標粗體：**強烈加碼 / 加碼 / 續抱 / 減碼 / 停利出場 / 停損出場**

## 📋 理由（3-5 點 bullet）
- 每點 1-2 句，引用上面提供的具體數字（如「跌破 MA60 = ${tech.MA60 ?? '?'}」）

## 👁 下一個觀察點
- 價位：建議的關鍵壓力/支撐
- 技術指標：要盯哪一個（如「等 K 值翻過 50」）
- 籌碼：要看哪個變化

## ⚠️ 風險警示
1-2 句說最值得擔心的事

請務必基於上述真實數字判讀，**不要編造資料**，不要說空話如「請審慎評估」。如果某些欄位是「無」，就基於有的資料推論並標明假設。
    `.trim();
}

function _formatAdvice(text) {
    // 簡易 Markdown → HTML（標題、粗體、bullet）
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>(?:\n<li>.*?<\/li>)*)/gs, '<ul>$1</ul>');
    html = html.replace(/\n\n/g, '</p><p>');
    return `<div class="position-advice-content"><p>${html}</p></div>`;
}
