const STORAGE_KEY = 'tw_stock_watchlist';
let _analysisCache = {};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addStockBtn').addEventListener('click', addStock);
    const input = document.getElementById('addSymbolInput');
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') addStock();
    });
    input.addEventListener('input', onSearchInput);
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('stockModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('.watchlist-add')) closeSuggestions();
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
    const raw = input.value.trim();

    if (!raw) {
        showMsg(msg, '請輸入股票代碼或中文名稱', 'text-negative');
        return;
    }

    // 用 searchStock 支援中文搜尋
    const symbol = searchStock(raw);

    const list = getWatchlist();
    if (list.includes(symbol)) {
        const name = getChineseName(symbol);
        showMsg(msg, `${name} (${symbol}) 已在自選股清單中`, 'text-negative');
        return;
    }

    list.push(symbol);
    saveWatchlist(list);
    input.value = '';
    closeSuggestions();

    const name = getChineseName(symbol);
    showMsg(msg, `已新增 ${name} (${symbol})，將於下次排程更新時由 AI 分析`, 'text-positive');
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
// 搜尋建議下拉
// ============================================================

function onSearchInput(e) {
    const query = e.target.value.trim();
    const suggestions = getSearchSuggestions(query);

    if (suggestions.length === 0) {
        closeSuggestions();
        return;
    }

    let dropdown = document.getElementById('searchDropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'searchDropdown';
        dropdown.className = 'search-dropdown';
        e.target.parentElement.appendChild(dropdown);
    }

    dropdown.innerHTML = suggestions.map(s => `
        <div class="search-item" data-code="${s.code}">
            <span class="search-code">${s.code.replace('.TW', '').replace('.TWO', '')}</span>
            <span class="search-name">${s.name}</span>
        </div>
    `).join('');

    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.search-item').forEach(item => {
        item.addEventListener('click', () => {
            document.getElementById('addSymbolInput').value = item.dataset.code;
            closeSuggestions();
            addStock();
        });
    });
}

function closeSuggestions() {
    const dropdown = document.getElementById('searchDropdown');
    if (dropdown) dropdown.style.display = 'none';
}

// ============================================================
// 載入與渲染
// ============================================================

async function loadWatchlist() {
    const localList = getWatchlist();

    // 載入 AI 分析資料（僅用於顯示，不影響清單）
    try {
        const res = await fetch('data/watchlist_analysis.json');
        if (res.ok) {
            const json = await res.json();
            _analysisCache = json.stocks || {};
        }
    } catch {
        _analysisCache = {};
    }

    // 只顯示 localStorage 中的股票
    renderCards(localList, _analysisCache);
}

function renderCards(symbols, analysisData) {
    const container = document.getElementById('watchlistCards');

    if (symbols.length === 0) {
        container.innerHTML = `
            <div class="glass stock-card empty-state">
                <p>尚未新增任何自選股</p>
                <p class="text-muted">在上方輸入股票代碼或中文名稱開始追蹤</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    symbols.forEach(symbol => {
        const data = analysisData[symbol];
        container.innerHTML += renderStockCard(symbol, data);
    });

    // 綁定刪除事件
    container.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            const sym = btn.dataset.symbol;
            removeStock(sym);
        });
    });

    // 綁定卡片點擊
    container.querySelectorAll('.stock-card[data-symbol]').forEach(card => {
        card.addEventListener('click', () => {
            openModal(card.dataset.symbol, analysisData[card.dataset.symbol]);
        });
    });
}

function renderStockCard(symbol, data) {
    const cnName = getChineseName(symbol, data?.name);

    if (!data || data.error) {
        return `
            <div class="glass stock-card" data-symbol="${symbol}">
                <div class="stock-card-header">
                    <div>
                        <span class="stock-symbol">${cnName}</span>
                        <span class="stock-name">${symbol}</span>
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
                    <span class="stock-symbol">${cnName}</span>
                    <span class="stock-name">${symbol}</span>
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

            ${data.chip_concentration ? `
            <div class="stock-indicators" style="margin-top:0.3rem;">
                <span class="tag ${data.chip_concentration.trend_10d === '集中' ? 'text-positive' : data.chip_concentration.trend_10d === '發散' ? 'text-negative' : ''}">10日: ${data.chip_concentration.trend_10d} (${data.chip_concentration.score_10d > 0 ? '+' : ''}${data.chip_concentration.score_10d})</span>
                <span class="tag ${data.chip_concentration.trend_20d === '集中' ? 'text-positive' : data.chip_concentration.trend_20d === '發散' ? 'text-negative' : ''}">20日: ${data.chip_concentration.trend_20d} (${data.chip_concentration.score_20d > 0 ? '+' : ''}${data.chip_concentration.score_20d})</span>
            </div>` : ''}

            ${ai.trend ? `
            <div class="stock-ai-brief">
                <span class="${trendClass}">趨勢：${ai.trend}</span>
                <span class="${riskColor}">風險：${ai.risk_level || '-'}</span>
                ${ai.confidence != null ? `<span class="text-muted">信心 ${ai.confidence}%</span>` : ''}
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
    const cnName = getChineseName(symbol, data?.name);

    if (!data || data.error) {
        body.innerHTML = `
            <h2>${cnName} <span class="text-muted">(${symbol})</span></h2>
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
            <h2>${cnName} <span class="text-muted">(${symbol})</span></h2>
            <div class="modal-price">
                <span class="big-price">${data.price}</span>
                <span class="${changeClass}">${sign}${data.change_pct}%</span>
                ${data.volume ? `<span class="text-muted">成交量 ${formatVolume(data.volume)}</span>` : ''}
            </div>
        </div>

        <div class="modal-section">
            <h3>技術指標</h3>
            <div class="indicator-grid">
                ${indRow('MA5', tech.MA5)}
                ${indRow('MA10', tech.MA10)}
                ${indRow('MA20', tech.MA20)}
                ${indRow('MA60', tech.MA60)}
                ${indRow('MA120', tech.MA120)}
                ${indRow('MA240', tech.MA240)}
                ${indRow('RSI(14)', tech.RSI)}
                ${indRow('K 值', tech.K)}
                ${indRow('D 值', tech.D)}
                ${indRow('MACD', tech.MACD)}
                ${indRow('Signal', tech.MACD_signal)}
                ${indRow('柱狀體', tech.MACD_hist)}
                ${indRow('布林上軌', tech.BOLL_upper)}
                ${indRow('布林中軌', tech.BOLL_mid)}
                ${indRow('布林下軌', tech.BOLL_lower)}
            </div>
        </div>

        <div class="modal-section">
            <h3>基本面</h3>
            <div class="indicator-grid">
                ${indRow('本益比 PE', fund.PE)}
                ${indRow('預估 PE', fund.forward_PE)}
                ${indRow('股價淨值比', fund.PB)}
                ${indRow('EPS', fund.EPS)}
                ${indRow('殖利率', fund.dividend_yield != null ? fund.dividend_yield + '%' : null)}
                ${indRow('市值', fund.market_cap ? formatMarketCap(fund.market_cap) : null)}
                ${indRow('52 週高', fund['52w_high'])}
                ${indRow('52 週低', fund['52w_low'])}
                ${ai.industry_pe_avg ? indRow('產業平均 PE', ai.industry_pe_avg) : ''}
            </div>
        </div>

        ${ai.highlights && ai.highlights.length > 0 ? `
        <div class="modal-section">
            <h3>投資重點提示</h3>
            <ul class="highlights-list">
                ${ai.highlights.map(h => `<li>${h}</li>`).join('')}
            </ul>
        </div>` : ''}

        ${data.chip_concentration ? `
        <div class="modal-section">
            <h3>籌碼集中度</h3>
            <div class="concentration-grid">
                <div class="conc-item">
                    <span class="conc-label">10日集中度</span>
                    <span class="conc-score ${data.chip_concentration.score_10d > 0 ? 'text-positive' : data.chip_concentration.score_10d < 0 ? 'text-negative' : 'text-muted'}">${data.chip_concentration.score_10d > 0 ? '+' : ''}${data.chip_concentration.score_10d}</span>
                    <span class="conc-trend ${data.chip_concentration.trend_10d === '集中' ? 'text-positive' : data.chip_concentration.trend_10d === '發散' ? 'text-negative' : 'text-muted'}">${data.chip_concentration.trend_10d}</span>
                    <div class="conc-bar-bg">
                        <div class="conc-bar-center"></div>
                        <div class="conc-bar-fill ${data.chip_concentration.score_10d > 0 ? 'score-pos' : 'score-neg'}" style="left:${data.chip_concentration.score_10d >= 0 ? '50%' : (50 + data.chip_concentration.score_10d / 2) + '%'};width:${Math.min(50, Math.abs(data.chip_concentration.score_10d) / 2)}%"></div>
                    </div>
                </div>
                <div class="conc-item">
                    <span class="conc-label">20日集中度</span>
                    <span class="conc-score ${data.chip_concentration.score_20d > 0 ? 'text-positive' : data.chip_concentration.score_20d < 0 ? 'text-negative' : 'text-muted'}">${data.chip_concentration.score_20d > 0 ? '+' : ''}${data.chip_concentration.score_20d}</span>
                    <span class="conc-trend ${data.chip_concentration.trend_20d === '集中' ? 'text-positive' : data.chip_concentration.trend_20d === '發散' ? 'text-negative' : 'text-muted'}">${data.chip_concentration.trend_20d}</span>
                    <div class="conc-bar-bg">
                        <div class="conc-bar-center"></div>
                        <div class="conc-bar-fill ${data.chip_concentration.score_20d > 0 ? 'score-pos' : 'score-neg'}" style="left:${data.chip_concentration.score_20d >= 0 ? '50%' : (50 + data.chip_concentration.score_20d / 2) + '%'};width:${Math.min(50, Math.abs(data.chip_concentration.score_20d) / 2)}%"></div>
                    </div>
                </div>
            </div>
            <div class="margin-grid" style="margin-top:0.5rem;">
                <div class="margin-item"><span class="margin-label">10日量比</span><span class="margin-value">${data.chip_concentration.vol_ratio_10d}x</span></div>
                <div class="margin-item"><span class="margin-label">20日量比</span><span class="margin-value">${data.chip_concentration.vol_ratio_20d}x</span></div>
                <div class="margin-item"><span class="margin-label">10日漲跌</span><span class="margin-value ${data.chip_concentration.price_change_10d >= 0 ? 'text-positive' : 'text-negative'}">${data.chip_concentration.price_change_10d >= 0 ? '+' : ''}${data.chip_concentration.price_change_10d}%</span></div>
                <div class="margin-item"><span class="margin-label">20日漲跌</span><span class="margin-value ${data.chip_concentration.price_change_20d >= 0 ? 'text-positive' : 'text-negative'}">${data.chip_concentration.price_change_20d >= 0 ? '+' : ''}${data.chip_concentration.price_change_20d}%</span></div>
            </div>
        </div>` : ''}

        ${ai.confidence != null ? `
        <div class="modal-section">
            <h3>AI 信心度與評分</h3>
            <div class="modal-verdict-row">
                <div class="verdict-badge verdict-${(ai.verdict || 'neutral').toLowerCase()}">${ai.verdict === 'Bullish' ? '看多' : ai.verdict === 'Bearish' ? '看空' : '中立'}</div>
                <div class="confidence-section" style="flex:1;">
                    <span class="confidence-label">信心度</span>
                    <div class="confidence-bar-bg">
                        <div class="confidence-bar-fill confidence-${(ai.verdict || 'neutral').toLowerCase()}" style="width: ${ai.confidence}%"></div>
                    </div>
                    <span class="confidence-value">${ai.confidence}%</span>
                </div>
            </div>
            ${ai.scores ? `
            <div class="scores-grid" style="margin-top:0.8rem;">
                ${['chip','technical','sentiment','macro'].map(k => {
                    const labels = {chip:'🏦 籌碼',technical:'📈 技術',sentiment:'📰 消息',macro:'🌍 總經'};
                    const v = ai.scores[k] || 0;
                    const cls = v > 0 ? 'score-pos' : v < 0 ? 'score-neg' : 'score-zero';
                    const pct = ((v + 3) / 6) * 100;
                    return `<div class="score-item">
                        <span class="score-icon">${labels[k].split(' ')[0]}</span>
                        <span class="score-label">${labels[k].split(' ')[1]}</span>
                        <div class="score-bar-bg">
                            <div class="score-bar-center"></div>
                            <div class="score-bar-fill ${cls}" style="left:${v>=0?'50%':pct+'%'};width:${Math.abs(v)/6*100}%"></div>
                        </div>
                        <span class="score-value ${cls}">${v>0?'+':''}${v}</span>
                    </div>`;
                }).join('')}
            </div>` : ''}
        </div>` : ''}

        ${ai.reasons && ai.reasons.length > 0 ? `
        <div class="modal-section">
            <h3>分析理由</h3>
            <div class="reasons-list">
                ${ai.reasons.map(r => {
                    const typeMap = {chip:'🏦 籌碼',technical:'📈 技術',sentiment:'📰 消息',macro:'🌍 總經'};
                    return `<div class="reason-item">
                        <span class="reason-type">${typeMap[r.type] || r.type}</span>
                        <span class="reason-text">${r.text}</span>
                        <div class="reason-weight"><div class="reason-weight-bar" style="width:${Math.round((r.weight||0)*100)}%"></div></div>
                    </div>`;
                }).join('')}
            </div>
        </div>` : ''}

        ${ai.analysis ? `
        <div class="modal-section">
            <h3>AI 深度分析</h3>
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

function indRow(label, value) {
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
