const STORAGE_KEY = 'tw_stock_watchlist';

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addStockBtn').addEventListener('click', addStock);
    document.getElementById('addSymbolInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') addStock();
    });
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('stockModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
    loadWatchlist();
});

// ============================================================
// LocalStorage 管理
// ============================================================

function getWatchlist() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
        return [];
    }
}

function saveWatchlist(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function addStock() {
    const input = document.getElementById('addSymbolInput');
    const msg = document.getElementById('addMsg');
    let symbol = input.value.trim().toUpperCase();

    if (!symbol) {
        showMsg(msg, '請輸入股票代碼', 'text-negative');
        return;
    }

    // 自動補上 .TW 如果是純數字 (台股上市)
    if (/^\d{4}$/.test(symbol)) {
        symbol += '.TW';
    }

    const list = getWatchlist();
    if (list.includes(symbol)) {
        showMsg(msg, `${symbol} 已在自選股清單中`, 'text-negative');
        return;
    }

    list.push(symbol);
    saveWatchlist(list);
    input.value = '';
    showMsg(msg, `已新增 ${symbol}，將於下次排程更新時由 AI 分析`, 'text-positive');
    loadWatchlist();
}

function removeStock(symbol) {
    const list = getWatchlist().filter(s => s !== symbol);
    saveWatchlist(list);
    loadWatchlist();
}

function showMsg(el, text, cls) {
    el.textContent = text;
    el.className = 'assistant-msg ' + (cls || '');
}

// ============================================================
// 載入與渲染
// ============================================================

async function loadWatchlist() {
    const localList = getWatchlist();
    let analysisData = {};

    // 嘗試載入 AI 分析資料
    try {
        const res = await fetch('data/watchlist_analysis.json');
        if (res.ok) {
            const json = await res.json();
            analysisData = json.stocks || {};
        }
    } catch {
        // 分析資料不存在，正常情況
    }

    // 同步：把分析資料中有但 localStorage 沒有的也加入顯示
    const allSymbols = [...new Set([...localList, ...Object.keys(analysisData)])];

    // 確保 localStorage 也同步
    if (allSymbols.length !== localList.length) {
        saveWatchlist(allSymbols);
    }

    renderCards(allSymbols, analysisData);
}

function renderCards(symbols, analysisData) {
    const container = document.getElementById('watchlistCards');

    if (symbols.length === 0) {
        container.innerHTML = `
            <div class="glass stock-card empty-state">
                <p>尚未新增任何自選股</p>
                <p class="text-muted">在上方輸入股票代碼開始追蹤</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    symbols.forEach(symbol => {
        const data = analysisData[symbol];
        container.innerHTML += renderStockCard(symbol, data);
    });

    // 綁定事件
    container.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            removeStock(btn.dataset.symbol);
        });
    });
    container.querySelectorAll('.stock-card[data-symbol]').forEach(card => {
        card.addEventListener('click', () => {
            const sym = card.dataset.symbol;
            openModal(sym, analysisData[sym]);
        });
    });
}

function renderStockCard(symbol, data) {
    if (!data || data.error) {
        return `
            <div class="glass stock-card" data-symbol="${symbol}">
                <div class="stock-card-header">
                    <div>
                        <span class="stock-symbol">${symbol}</span>
                    </div>
                    <button class="btn-remove" data-symbol="${symbol}" title="移除">&times;</button>
                </div>
                <p class="text-muted" style="margin-top:0.5rem;">等待下次排程更新分析...</p>
            </div>
        `;
    }

    const changeClass = data.change_pct >= 0 ? 'text-positive' : 'text-negative';
    const sign = data.change_pct >= 0 ? '+' : '';
    const tech = data.technical || {};
    const fund = data.fundamental || {};
    const ai = data.ai_analysis || {};

    const trendClass = ai.trend === '偏多' ? 'text-positive' : ai.trend === '偏空' ? 'text-negative' : 'text-muted';
    const riskColor = ai.risk_level === '高' ? 'text-negative' : ai.risk_level === '低' ? 'text-positive' : 'text-muted';

    return `
        <div class="glass stock-card" data-symbol="${symbol}">
            <div class="stock-card-header">
                <div>
                    <span class="stock-symbol">${symbol}</span>
                    <span class="stock-name">${data.name || ''}</span>
                </div>
                <button class="btn-remove" data-symbol="${symbol}" title="移除">&times;</button>
            </div>

            <div class="stock-price-row">
                <span class="stock-price">${data.price}</span>
                <span class="${changeClass}">${sign}${data.change_pct}%</span>
                ${data.volume ? `<span class="text-muted vol">量 ${formatVolume(data.volume)}</span>` : ''}
            </div>

            <div class="stock-indicators">
                ${tech.RSI != null ? `<span class="tag">RSI ${tech.RSI}</span>` : ''}
                ${tech.K != null ? `<span class="tag">K${tech.K} D${tech.D}</span>` : ''}
                ${fund.PE != null ? `<span class="tag">PE ${fund.PE}</span>` : ''}
                ${fund.dividend_yield != null ? `<span class="tag">殖利率 ${fund.dividend_yield}%</span>` : ''}
            </div>

            ${ai.trend ? `
            <div class="stock-ai-brief">
                <span class="${trendClass}">趨勢：${ai.trend}</span>
                <span class="${riskColor}">風險：${ai.risk_level || '-'}</span>
            </div>` : ''}

            <div class="stock-card-hint">點擊查看完整分析</div>
        </div>
    `;
}

// ============================================================
// 個股詳細彈窗
// ============================================================

function openModal(symbol, data) {
    const modal = document.getElementById('stockModal');
    const body = document.getElementById('modalBody');

    if (!data || data.error) {
        body.innerHTML = `
            <h2>${symbol}</h2>
            <p class="text-muted">尚無分析資料，請等待下次排程更新。</p>
        `;
        modal.style.display = 'flex';
        return;
    }

    const tech = data.technical || {};
    const fund = data.fundamental || {};
    const ai = data.ai_analysis || {};
    const changeClass = data.change_pct >= 0 ? 'text-positive' : 'text-negative';
    const sign = data.change_pct >= 0 ? '+' : '';

    body.innerHTML = `
        <div class="modal-header-info">
            <h2>${data.name || symbol} <span class="text-muted">(${symbol})</span></h2>
            <div class="modal-price">
                <span class="big-price">${data.price}</span>
                <span class="${changeClass}">${sign}${data.change_pct}%</span>
                ${data.volume ? `<span class="text-muted">成交量 ${formatVolume(data.volume)}</span>` : ''}
            </div>
        </div>

        <div class="modal-section">
            <h3>技術指標</h3>
            <div class="indicator-grid">
                ${renderIndicatorRow('MA5', tech.MA5)}
                ${renderIndicatorRow('MA10', tech.MA10)}
                ${renderIndicatorRow('MA20', tech.MA20)}
                ${renderIndicatorRow('MA60', tech.MA60)}
                ${renderIndicatorRow('MA120', tech.MA120)}
                ${renderIndicatorRow('MA240', tech.MA240)}
                ${renderIndicatorRow('RSI(14)', tech.RSI)}
                ${renderIndicatorRow('K 值', tech.K)}
                ${renderIndicatorRow('D 值', tech.D)}
                ${renderIndicatorRow('MACD', tech.MACD)}
                ${renderIndicatorRow('Signal', tech.MACD_signal)}
                ${renderIndicatorRow('柱狀體', tech.MACD_hist)}
                ${renderIndicatorRow('布林上軌', tech.BOLL_upper)}
                ${renderIndicatorRow('布林中軌', tech.BOLL_mid)}
                ${renderIndicatorRow('布林下軌', tech.BOLL_lower)}
            </div>
        </div>

        <div class="modal-section">
            <h3>基本面</h3>
            <div class="indicator-grid">
                ${renderIndicatorRow('本益比 PE', fund.PE)}
                ${renderIndicatorRow('預估 PE', fund.forward_PE)}
                ${renderIndicatorRow('股價淨值比', fund.PB)}
                ${renderIndicatorRow('EPS', fund.EPS)}
                ${renderIndicatorRow('殖利率', fund.dividend_yield != null ? fund.dividend_yield + '%' : null)}
                ${renderIndicatorRow('市值', fund.market_cap ? formatMarketCap(fund.market_cap) : null)}
                ${renderIndicatorRow('52 週高', fund['52w_high'])}
                ${renderIndicatorRow('52 週低', fund['52w_low'])}
            </div>
        </div>

        ${ai.analysis ? `
        <div class="modal-section">
            <h3>AI 分析觀點</h3>
            <div class="ai-detail">
                ${ai.trend ? `<p><strong>趨勢判斷：</strong><span class="${ai.trend === '偏多' ? 'text-positive' : ai.trend === '偏空' ? 'text-negative' : ''}">${ai.trend}</span></p>` : ''}
                ${ai.support ? `<p><strong>支撐區間：</strong>${ai.support}</p>` : ''}
                ${ai.resistance ? `<p><strong>壓力區間：</strong>${ai.resistance}</p>` : ''}
                ${ai.risk_level ? `<p><strong>風險等級：</strong>${ai.risk_level}</p>` : ''}
                <p><strong>綜合分析：</strong>${ai.analysis}</p>
                ${ai.suggestion ? `<p><strong>操作建議：</strong>${ai.suggestion}</p>` : ''}
            </div>
        </div>` : ''}

        <div class="modal-footer-info">
            <p class="text-muted">資料日期：${data.date || '-'}</p>
        </div>
    `;
    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('stockModal').style.display = 'none';
}

function renderIndicatorRow(label, value) {
    if (value == null) return '';
    return `<div class="ind-item"><span class="ind-label">${label}</span><span class="ind-value">${value}</span></div>`;
}

// ============================================================
// 工具
// ============================================================

function formatVolume(vol) {
    if (vol >= 100000000) return (vol / 100000000).toFixed(1) + ' 億';
    if (vol >= 10000) return (vol / 10000).toFixed(0) + ' 萬';
    return vol.toLocaleString();
}

function formatMarketCap(cap) {
    if (cap >= 1e12) return (cap / 1e12).toFixed(1) + ' 兆';
    if (cap >= 1e8) return (cap / 1e8).toFixed(0) + ' 億';
    return cap.toLocaleString();
}
