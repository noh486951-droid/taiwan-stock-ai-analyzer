let watchlistAnalysis = {};

document.addEventListener('DOMContentLoaded', () => {
    fetchData();
    loadWatchlistAnalysis();
    document.getElementById('dispatchAnalysis').addEventListener('click', queryStock);
    document.getElementById('stockSymbol').addEventListener('keydown', e => {
        if (e.key === 'Enter') queryStock();
    });
    document.getElementById('stockSymbol').addEventListener('input', onMainSearchInput);
    document.addEventListener('click', e => {
        if (!e.target.closest('.diagnostic-assistant')) closeMainSuggestions();
    });
});

async function fetchData() {
    try {
        const response = await fetch('data/market_pulse.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        renderData(data);
    } catch (error) {
        console.error("無法載入數據:", error);
        document.getElementById('marketPulseContent').innerHTML = `
            <p class="text-negative">數據載入失敗。請確保 GitHub Actions 已執行且 data/market_pulse.json 檔案存在。</p>
        `;
    }
}

async function loadWatchlistAnalysis() {
    try {
        const res = await fetch('data/watchlist_analysis.json');
        if (res.ok) {
            const json = await res.json();
            watchlistAnalysis = json.stocks || {};
        }
    } catch {
        // No watchlist data yet
    }
}

function renderData(data) {
    // 1. AI 市場脈動
    const pulseContainer = document.getElementById('marketPulseContent');
    const ai = data.ai_analysis || {};
    if (ai.status === 'success') {
        const verdictLower = (ai.verdict || ai.sentiment || 'neutral').toLowerCase();
        let verdictLabel = '中立';
        if (verdictLower === 'bullish') verdictLabel = '看多';
        else if (verdictLower === 'bearish') verdictLabel = '看空';

        pulseContainer.innerHTML = `
            <p>${ai.summary}</p>
            <div class="sentiment-badge sentiment-${verdictLower}">
                市場觀點：${verdictLabel}
            </div>
            <p style="margin-top: 1rem; font-size: 0.8rem; color: var(--text-muted);">
                更新時間：${ai.timestamp}
            </p>
        `;

        // AI 信心度與四維評分面板
        renderVerdictPanel(ai);

        // AI Reasons (展開式)
        renderReasons(ai.reasons || []);

        // AI 觀察與建議
        const obsList = document.getElementById('aiObservations');
        obsList.innerHTML = '';
        if (ai.observations && ai.observations.length > 0) {
            ai.observations.forEach(obs => {
                const li = document.createElement('li');
                li.textContent = obs;
                obsList.appendChild(li);
            });
        } else {
            obsList.innerHTML = '<li>目前無 AI 建議產生。</li>';
        }
    } else {
        pulseContainer.innerHTML = `<p>${ai.summary || 'AI 分析暫時不可用。'}</p>`;
    }

    // 1b. 融資融券
    renderMarginData(data.margin);

    // 1c. 漲跌家數
    renderBreadthData(data.breadth);

    // 2. 指數數據
    const indicesGrid = document.getElementById('indicesGrid');
    indicesGrid.innerHTML = '';

    const nameMap = {
        'TAIEX': '加權指數',
        'SOX': '費半',
        'TSMC': '台積電',
        'USD/TWD': '美元/台幣',
        'S&P500': 'S&P 500',
        'NASDAQ': 'NASDAQ',
        'DOW': '道瓊',
        'VIX': 'VIX 恐慌',
    };

    if (data.market) {
        for (const [key, info] of Object.entries(data.market)) {
            if (info.error) continue;
            const displayName = nameMap[key] || key;
            const changeClass = info.change_pct >= 0 ? 'text-positive' : 'text-negative';
            const sign = info.change_pct >= 0 ? '+' : '';
            indicesGrid.innerHTML += `
                <div class="index-box">
                    <h3>${displayName}</h3>
                    <div class="price">${info.price}</div>
                    <div class="change ${changeClass}">${sign}${info.change_pct}%</div>
                </div>
            `;
        }
    }

    // 3. 籌碼
    const chipContent = document.getElementById('chipContent');
    chipContent.innerHTML = '';
    if (data.chips && data.chips.summary) {
        chipContent.innerHTML += `<p>更新日期：${data.chips.date}</p>`;
        data.chips.summary.forEach(row => {
            const name = row[0];
            const diffStr = row[3];
            const isPositive = !diffStr.startsWith('-');
            const colorClass = isPositive ? 'text-positive' : 'text-negative';
            chipContent.innerHTML += `
                <p><strong>${name}:</strong> <span class="${colorClass}">${diffStr}</span> 元</p>
            `;
        });
    } else {
        chipContent.innerHTML = '<p>籌碼數據暫時不可用或抓取失敗。</p>';
    }
}

// ============================================================
// 個股快速查詢（支援中文搜尋）
// ============================================================

function onMainSearchInput(e) {
    const query = e.target.value.trim();
    if (typeof getSearchSuggestions !== 'function') return;

    const suggestions = getSearchSuggestions(query);
    if (suggestions.length === 0) {
        closeMainSuggestions();
        return;
    }

    let dropdown = document.getElementById('mainSearchDropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'mainSearchDropdown';
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
            document.getElementById('stockSymbol').value = item.dataset.code;
            closeMainSuggestions();
            queryStock();
        });
    });
}

function closeMainSuggestions() {
    const d = document.getElementById('mainSearchDropdown');
    if (d) d.style.display = 'none';
}

function queryStock() {
    const input = document.getElementById('stockSymbol');
    const msg = document.getElementById('assistantMsg');
    const resultDiv = document.getElementById('quickStockResult');
    const raw = input.value.trim();

    if (!raw) {
        msg.textContent = '請輸入股票代碼或中文名稱。';
        msg.className = 'assistant-msg text-negative';
        resultDiv.innerHTML = '';
        return;
    }

    closeMainSuggestions();

    // 支援中文搜尋
    const symbol = typeof searchStock === 'function' ? searchStock(raw) : raw.toUpperCase();

    const stockData = watchlistAnalysis[symbol];

    if (!stockData || stockData.error) {
        const cnName = typeof getChineseName === 'function' ? getChineseName(symbol) : symbol;
        msg.textContent = `找不到 ${cnName} (${symbol}) 的分析資料。請先至「自選股」頁面新增，等待下次排程分析。`;
        msg.className = 'assistant-msg text-negative';
        resultDiv.innerHTML = '';
        return;
    }

    msg.textContent = '';
    msg.className = 'assistant-msg';
    renderQuickResult(resultDiv, symbol, stockData);
}

function renderQuickResult(container, symbol, data) {
    const tech = data.technical || {};
    const fund = data.fundamental || {};
    const ai = data.ai_analysis || {};
    const cnName = typeof getChineseName === 'function' ? getChineseName(symbol, data.name) : (data.name || symbol);
    const changeClass = data.change_pct >= 0 ? 'text-positive' : 'text-negative';
    const sign = data.change_pct >= 0 ? '+' : '';

    container.innerHTML = `
        <div class="quick-result-card">
            <h3>${cnName} <span class="text-muted">(${symbol})</span></h3>
            <div class="stock-price-row" style="margin-bottom:1rem;">
                <span class="stock-price">${data.price}</span>
                <span class="${changeClass}">${sign}${data.change_pct}%</span>
                ${data.volume ? `<span class="text-muted vol">量 ${formatVolume(data.volume)}</span>` : ''}
            </div>

            <div class="indicator-grid">
                ${indRow('MA5', tech.MA5)}
                ${indRow('MA20', tech.MA20)}
                ${indRow('MA60', tech.MA60)}
                ${indRow('RSI', tech.RSI)}
                ${indRow('K', tech.K)}
                ${indRow('D', tech.D)}
                ${indRow('MACD', tech.MACD)}
                ${indRow('Signal', tech.MACD_signal)}
                ${indRow('PE', fund.PE)}
                ${indRow('PB', fund.PB)}
                ${indRow('EPS', fund.EPS)}
                ${indRow('殖利率', fund.dividend_yield != null ? fund.dividend_yield + '%' : null)}
            </div>

            ${ai.confidence != null ? `
            <div class="modal-verdict-row" style="margin-bottom:0.8rem;">
                <div class="verdict-badge verdict-${(ai.verdict||'neutral').toLowerCase()}" style="font-size:0.9rem;padding:0.3rem 0.8rem;">
                    ${ai.verdict === 'Bullish' ? '看多' : ai.verdict === 'Bearish' ? '看空' : '中立'}
                </div>
                <span class="text-muted" style="font-size:0.85rem;">信心 ${ai.confidence}%</span>
            </div>` : ''}

            ${ai.analysis ? `
            <div class="ai-detail">
                ${ai.trend ? `<p><strong>趨勢：</strong><span class="${ai.trend === '偏多' ? 'text-positive' : ai.trend === '偏空' ? 'text-negative' : ''}">${ai.trend}</span></p>` : ''}
                ${ai.support ? `<p><strong>支撐：</strong>${ai.support}</p>` : ''}
                ${ai.resistance ? `<p><strong>壓力：</strong>${ai.resistance}</p>` : ''}
                <p><strong>分析：</strong>${ai.analysis}</p>
                ${ai.suggestion ? `<p><strong>建議：</strong>${ai.suggestion}</p>` : ''}
            </div>` : ''}
        </div>
    `;
}

function indRow(label, value) {
    if (value == null) return '';
    return `<div class="ind-item"><span class="ind-label">${label}</span><span class="ind-value">${value}</span></div>`;
}

function formatVolume(vol) {
    if (vol >= 100000000) return (vol / 100000000).toFixed(1) + ' 億';
    if (vol >= 10000) return (vol / 10000).toFixed(0) + ' 萬';
    return vol.toLocaleString();
}

// ============================================================
// AI 信心度與四維評分
// ============================================================

function renderVerdictPanel(ai) {
    const panel = document.getElementById('aiVerdictPanel');
    if (!panel) return;

    const confidence = ai.confidence || 0;
    const scores = ai.scores || {};
    const verdictLower = (ai.verdict || 'neutral').toLowerCase();
    let verdictLabel = '中立';
    let verdictClass = 'neutral';
    if (verdictLower === 'bullish') { verdictLabel = '看多'; verdictClass = 'bullish'; }
    else if (verdictLower === 'bearish') { verdictLabel = '看空'; verdictClass = 'bearish'; }

    const dims = [
        { key: 'chip', label: '籌碼面', icon: '🏦' },
        { key: 'technical', label: '技術面', icon: '📈' },
        { key: 'sentiment', label: '消息面', icon: '📰' },
        { key: 'macro', label: '總經面', icon: '🌍' },
    ];

    panel.innerHTML = `
        <div class="verdict-header">
            <div class="verdict-badge verdict-${verdictClass}">${verdictLabel}</div>
            <div class="confidence-section">
                <span class="confidence-label">AI 信心度</span>
                <div class="confidence-bar-bg">
                    <div class="confidence-bar-fill confidence-${verdictClass}" style="width: ${confidence}%"></div>
                </div>
                <span class="confidence-value">${confidence}%</span>
            </div>
        </div>
        <div class="scores-grid">
            ${dims.map(d => {
                const val = scores[d.key] || 0;
                const pct = ((val + 3) / 6) * 100;
                const scoreClass = val > 0 ? 'score-pos' : val < 0 ? 'score-neg' : 'score-zero';
                return `
                <div class="score-item">
                    <span class="score-icon">${d.icon}</span>
                    <span class="score-label">${d.label}</span>
                    <div class="score-bar-bg">
                        <div class="score-bar-center"></div>
                        <div class="score-bar-fill ${scoreClass}" style="left: ${val >= 0 ? '50%' : pct + '%'}; width: ${Math.abs(val) / 6 * 100}%"></div>
                    </div>
                    <span class="score-value ${scoreClass}">${val > 0 ? '+' : ''}${val}</span>
                </div>`;
            }).join('')}
        </div>
    `;
}

function renderReasons(reasons) {
    const container = document.getElementById('aiReasons');
    if (!container || !reasons.length) {
        if (container) container.innerHTML = '';
        return;
    }

    const typeMap = { chip: '🏦 籌碼', technical: '📈 技術', sentiment: '📰 消息', macro: '🌍 總經' };

    container.innerHTML = `
        <div class="reasons-list">
            ${reasons.map(r => {
                const typeLabel = typeMap[r.type] || r.type;
                const weightPct = Math.round((r.weight || 0) * 100);
                return `
                <div class="reason-item">
                    <span class="reason-type">${typeLabel}</span>
                    <span class="reason-text">${r.text}</span>
                    <div class="reason-weight">
                        <div class="reason-weight-bar" style="width: ${weightPct}%"></div>
                    </div>
                </div>`;
            }).join('')}
        </div>
    `;
}

// ============================================================
// 融資融券
// ============================================================

function renderMarginData(margin) {
    const container = document.getElementById('marginContent');
    if (!container) return;

    if (!margin || margin.error || !margin.summary) {
        container.innerHTML = '<p class="text-muted">融資融券資料暫無（非交易日或尚未更新）</p>';
        return;
    }

    const s = margin.summary;
    const marginChangeClass = s.margin_change >= 0 ? 'text-positive' : 'text-negative';
    const shortChangeClass = s.short_change >= 0 ? 'text-negative' : 'text-positive';
    const marginSign = s.margin_change >= 0 ? '+' : '';
    const shortSign = s.short_change >= 0 ? '+' : '';

    container.innerHTML = `
        <div class="margin-grid">
            <div class="margin-item">
                <span class="margin-label">融資餘額</span>
                <span class="margin-value">${formatCount(s.margin_balance)} 張</span>
            </div>
            <div class="margin-item">
                <span class="margin-label">融資增減</span>
                <span class="margin-value ${marginChangeClass}">${marginSign}${formatCount(s.margin_change)} 張</span>
            </div>
            <div class="margin-item">
                <span class="margin-label">融券餘額</span>
                <span class="margin-value">${formatCount(s.short_balance)} 張</span>
            </div>
            <div class="margin-item">
                <span class="margin-label">融券增減</span>
                <span class="margin-value ${shortChangeClass}">${shortSign}${formatCount(s.short_change)} 張</span>
            </div>
            <div class="margin-item">
                <span class="margin-label">券資比</span>
                <span class="margin-value">${s.short_margin_ratio || '-'}%</span>
            </div>
        </div>
        <p class="text-muted" style="font-size:0.75rem; margin-top:0.5rem;">更新日期：${margin.date || '-'}</p>
    `;
}

// ============================================================
// 漲跌家數
// ============================================================

function renderBreadthData(breadth) {
    const container = document.getElementById('breadthContent');
    if (!container) return;

    if (!breadth || breadth.error || !breadth.summary) {
        container.innerHTML = '<p class="text-muted">漲跌家數資料暫無（非交易日或尚未更新）</p>';
        return;
    }

    const s = breadth.summary;
    const total = s.up + s.down + s.unchanged;
    const upPct = total > 0 ? (s.up / total * 100).toFixed(1) : 0;
    const downPct = total > 0 ? (s.down / total * 100).toFixed(1) : 0;
    const unchangedPct = total > 0 ? (s.unchanged / total * 100).toFixed(1) : 0;

    container.innerHTML = `
        <div class="breadth-bar">
            <div class="breadth-up" style="width: ${upPct}%"></div>
            <div class="breadth-unchanged" style="width: ${unchangedPct}%"></div>
            <div class="breadth-down" style="width: ${downPct}%"></div>
        </div>
        <div class="breadth-stats">
            <div class="breadth-stat">
                <span class="text-positive">▲ ${s.up}</span>
                <span class="text-muted">${upPct}%</span>
                ${s.up_limit > 0 ? `<span class="breadth-limit up">漲停 ${s.up_limit}</span>` : ''}
            </div>
            <div class="breadth-stat">
                <span class="text-muted">— ${s.unchanged}</span>
                <span class="text-muted">${unchangedPct}%</span>
            </div>
            <div class="breadth-stat">
                <span class="text-negative">▼ ${s.down}</span>
                <span class="text-muted">${downPct}%</span>
                ${s.down_limit > 0 ? `<span class="breadth-limit down">跌停 ${s.down_limit}</span>` : ''}
            </div>
        </div>
        <div class="breadth-ratio">
            漲跌比：<strong>${s.advance_decline_ratio}</strong>
        </div>
        <p class="text-muted" style="font-size:0.75rem; margin-top:0.5rem;">更新日期：${breadth.date || '-'}</p>
    `;
}

function formatCount(num) {
    if (num == null) return '-';
    return num.toLocaleString();
}
