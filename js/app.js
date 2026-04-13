let watchlistAnalysis = {};

document.addEventListener('DOMContentLoaded', () => {
    fetchData();
    loadWatchlistAnalysis();
    document.getElementById('dispatchAnalysis').addEventListener('click', queryStock);
    document.getElementById('stockSymbol').addEventListener('keydown', e => {
        if (e.key === 'Enter') queryStock();
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
    if (data.ai_analysis && data.ai_analysis.status === 'success') {
        let sentimentLabel = '中立';
        const sentimentLower = data.ai_analysis.sentiment?.toLowerCase() || 'neutral';
        if (sentimentLower === 'bullish') sentimentLabel = '看多';
        else if (sentimentLower === 'bearish') sentimentLabel = '看空';

        pulseContainer.innerHTML = `
            <p>${data.ai_analysis.summary}</p>
            <div class="sentiment-badge sentiment-${sentimentLower}">
                市場觀點：${sentimentLabel}
            </div>
            <p style="margin-top: 1rem; font-size: 0.8rem; color: var(--text-muted);">
                更新時間：${data.ai_analysis.timestamp}
            </p>
        `;

        const obsList = document.getElementById('aiObservations');
        obsList.innerHTML = '';
        if (data.ai_analysis.observations && data.ai_analysis.observations.length > 0) {
            data.ai_analysis.observations.forEach(obs => {
                const li = document.createElement('li');
                li.textContent = obs;
                obsList.appendChild(li);
            });
        } else {
            obsList.innerHTML = '<li>目前無 AI 建議產生。</li>';
        }
    } else {
        pulseContainer.innerHTML = `<p>${data.ai_analysis?.summary || 'AI 分析暫時不可用。'}</p>`;
    }

    // 2. 指數數據 (含國際指數)
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

    // 3. 籌碼數據
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
// 個股快速查詢
// ============================================================

function queryStock() {
    const input = document.getElementById('stockSymbol');
    const msg = document.getElementById('assistantMsg');
    const resultDiv = document.getElementById('quickStockResult');
    let symbol = input.value.trim().toUpperCase();

    if (!symbol) {
        msg.textContent = '請輸入有效的股票代碼。';
        msg.className = 'assistant-msg text-negative';
        resultDiv.innerHTML = '';
        return;
    }

    if (/^\d{4}$/.test(symbol)) {
        symbol += '.TW';
    }

    const stockData = watchlistAnalysis[symbol];

    if (!stockData || stockData.error) {
        msg.textContent = `找不到 ${symbol} 的分析資料。請先至「自選股」頁面新增此股票，等待下次排程分析。`;
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
    const changeClass = data.change_pct >= 0 ? 'text-positive' : 'text-negative';
    const sign = data.change_pct >= 0 ? '+' : '';

    container.innerHTML = `
        <div class="quick-result-card">
            <h3>${data.name || symbol} <span class="text-muted">(${symbol})</span></h3>
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
