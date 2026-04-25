let watchlistAnalysis = {};

/**
 * 金額人性化格式（台幣）
 * >= 1億 → XX.X 億
 * >= 1萬 → XX.X 萬
 * 其他 → 原數字
 */
function formatTWCurrency(value) {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '+';
    if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)} 億`;
    if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)} 萬`;
    return `${sign}${abs.toLocaleString()}`;
}

/**
 * 股數 → 張數，人性化
 */
function formatShares(shares) {
    const lots = Math.round(shares / 1000);
    const abs = Math.abs(lots);
    const sign = lots >= 0 ? '+' : '-';
    if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)} 萬張`;
    if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)} 千張`;
    return `${sign}${abs.toLocaleString()} 張`;
}

/**
 * 5 日法人進出趨勢 CSS 長條圖
 */
function renderChipChart(history) {
    if (!history || history.length === 0) return '';
    const recent = history.slice(-5);
    const investors = ['外資', '投信', '自營商'];

    // 找全域最大值用於計算比例
    let maxVal = 0;
    recent.forEach(day => {
        investors.forEach(inv => {
            const v = Math.abs(day[inv] || 0);
            if (v > maxVal) maxVal = v;
        });
    });
    if (maxVal === 0) return '';

    let html = '<div class="chip-chart-section"><h4>📊 近 5 日法人進出趨勢</h4>';

    investors.forEach(inv => {
        html += `<div class="chip-chart-group"><span class="chip-chart-label">${inv}</span><div class="chip-chart-bars">`;
        recent.forEach(day => {
            const val = day[inv] || 0;
            const pct = Math.min(Math.abs(val) / maxVal * 100, 100);
            const cls = val >= 0 ? 'bar-positive' : 'bar-negative';
            const dateStr = day.date ? `${day.date.substring(4, 6)}/${day.date.substring(6, 8)}` : '';
            html += `
                <div class="chip-chart-row">
                    <span class="chip-chart-date">${dateStr}</span>
                    <div class="chip-chart-bar-wrap">
                        <div class="chip-chart-bar ${cls}" style="width:${Math.max(pct, 2)}%"></div>
                    </div>
                    <span class="chip-chart-val ${cls}">${formatTWCurrency(val)}</span>
                </div>`;
        });
        html += '</div></div>';
    });

    html += '</div>';
    return html;
}

/**
 * 將各種 verdict 格式統一映射為 CSS class (bullish/bearish/neutral)
 */
function normalizeVerdict(verdict) {
    if (!verdict) return { cls: 'neutral', label: '中性' };
    const v = verdict.toLowerCase();
    // 英文 verdict → 中文
    if (v === 'bullish' || v === 'positive' || v === 'strong') return { cls: 'bullish', label: '偏多' };
    if (v === 'bearish' || v === 'negative' || v === 'weak') return { cls: 'bearish', label: '偏空' };
    if (v === 'neutral' || v === 'mixed' || v === 'flat') return { cls: 'neutral', label: '中性' };
    // 中文 verdict
    if (['強烈買進', '買進', '偏多', '看多', '積極買進'].some(k => verdict.includes(k))) return { cls: 'bullish', label: verdict };
    if (['強烈賣出', '賣出', '偏空', '看空', '逢高調節', '減碼'].some(k => verdict.includes(k))) return { cls: 'bearish', label: verdict };
    if (['觀望', '中性', '中立', '盤整', '分歧'].some(k => verdict.includes(k))) return { cls: 'neutral', label: verdict };
    return { cls: 'neutral', label: verdict || '中性' };
}

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
        const response = await fetch('data/market_pulse.json', { cache: 'no-store' });
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
        const res = await fetch('data/watchlist_analysis.json', { cache: 'no-store' });
        if (res.ok) {
            const json = await res.json();
            watchlistAnalysis = json.stocks || {};
        }
    } catch {
        // No watchlist data yet
    }
}

function renderData(data) {
    // v11.4: 各卡片獨立 try/catch — 一張壞掉不影響其他
    const _safe = (fn, label) => { try { fn(); } catch(e) { console.error('[render]', label, e); } };

    // 1. AI 市場脈動
    _safe(() => {
        const pulseContainer = document.getElementById('marketPulseContent');
        const ai = data.ai_analysis || {};
        if (ai.status === 'success') {
            const vd = normalizeVerdict(ai.verdict || ai.sentiment);

            pulseContainer.innerHTML = `
                <p>${ai.summary}</p>
                <div class="sentiment-badge sentiment-${vd.cls}">
                    市場觀點：${vd.label}
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
    }, 'market-pulse');

    // 1a. 異常波動預警
    _safe(() => renderAlerts(data.alerts), 'alerts');

    // v10.7 功能 2: 美債 10 年期殖利率 (US10Y) 警示橫幅
    _safe(() => renderMacroSignals(data.macro_signals), 'macro');

    // 1b. 融資融券
    _safe(() => renderMarginData(data.margin), 'margin');

    // 1c. 漲跌家數
    _safe(() => renderBreadthData(data.breadth), 'breadth');

    // 1d. 期貨未平倉
    _safe(() => renderFuturesData(data.futures), 'futures');

    // 1e. Put/Call Ratio
    _safe(() => renderPcrData(data.pcr), 'pcr');

    // 1f. SOX + TSMC ADR 連動
    _safe(() => renderSoxAdrLinkage(data.market), 'sox-adr');

    // 2. 指數數據
    _safe(() => {
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
    }, 'indices');

    // 3. 籌碼
    _safe(() => {
        const chipContent = document.getElementById('chipContent');
        chipContent.innerHTML = '';
        if (data.chips && data.chips.summary) {
            const staleTag = data.chips.is_stale
                ? ` <span class="tag text-muted" title="本次 TWSE 抓取失敗，顯示的是上次成功的資料">⚠️ 延遲資料</span>`
                : '';
            chipContent.innerHTML += `<p>更新日期：${data.chips.date}${staleTag}</p>`;
            data.chips.summary.forEach(row => {
                const name = row[0];
                const rawVal = parseInt(String(row[3]).replace(/,/g, ''), 10) || 0;
                const formatted = formatTWCurrency(rawVal);
                const isPositive = rawVal >= 0;
                const colorClass = isPositive ? 'text-positive' : 'text-negative';
                chipContent.innerHTML += `
                    <p><strong>${name}:</strong> <span class="${colorClass}">${formatted}</span></p>
                `;
            });

            // 5 日法人進出趨勢圖
            if (data.chip_history && data.chip_history.length > 0) {
                chipContent.innerHTML += renderChipChart(data.chip_history);
            }
        } else {
            chipContent.innerHTML = '<p>籌碼數據暫時不可用或抓取失敗。</p>';
        }
    }, 'chips');
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

async function queryStock() {
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

    let stockData = watchlistAnalysis[symbol];

    if (!stockData || stockData.error) {
        // 沒有快取，動態呼叫 Cloudflare Worker 進行分析
        msg.textContent = '🚀 AI 正在即時抓取最新資料與深度診斷中，請稍候（約需 10~15 秒）...';
        msg.className = 'assistant-msg text-positive';
        resultDiv.innerHTML = '<div class="loading" style="text-align:center; padding: 2rem;">正在進行動態分析...</div>';

        try {
            const WORKER_ANALYZE_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev/api/analyze';
            const res = await fetch(WORKER_ANALYZE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: symbol })
            });

            if (!res.ok) {
                let errText = "無法取得即時分析";
                try { const e = await res.json(); errText = e.error || errText; } catch (e) { }
                throw new Error(errText);
            }

            stockData = await res.json();

            // 寫入快取，避免重複請求
            watchlistAnalysis[symbol] = stockData;
        } catch (err) {
            msg.textContent = `❌ 動態分析失敗：${err.message}`;
            msg.className = 'assistant-msg text-negative';
            resultDiv.innerHTML = '';

            // Revert original static fail-safe message if dynamic failed heavily
            if (!err.message.includes('429')) {
                const cnName = typeof getChineseName === 'function' ? getChineseName(symbol) : symbol;
                setTimeout(() => {
                    msg.textContent = `找不到 ${cnName} (${symbol})。也可以至「自選股」新增並等待排程分析。`;
                }, 3000);
            }
            return;
        }
    }

    msg.textContent = '✅ 已取得最新分析結果';
    msg.className = 'assistant-msg text-positive';
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
                <div class="verdict-badge verdict-${(ai.verdict || 'neutral').toLowerCase()}" style="font-size:0.9rem;padding:0.3rem 0.8rem;">
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
    const vd = normalizeVerdict(ai.verdict);
    const verdictLabel = vd.label;
    const verdictClass = vd.cls;

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

// ============================================================
// 期貨未平倉
// ============================================================

function renderFuturesData(futures) {
    const container = document.getElementById('futuresContent');
    if (!container) return;

    if (!futures || futures.error || !futures.foreign_investor) {
        container.innerHTML = '<p class="text-muted">期貨未平倉資料暫無（非交易日或尚未更新）</p>';
        return;
    }

    const fi = futures.foreign_investor;
    const dealer = futures.dealer || {};
    const biasClass = fi.net_oi > 0 ? 'text-positive' : fi.net_oi < 0 ? 'text-negative' : 'text-muted';
    const biasSign = fi.net_oi > 0 ? '+' : '';

    container.innerHTML = `
        <div class="futures-grid">
            <div class="futures-section">
                <h4>外資</h4>
                <div class="margin-grid">
                    <div class="margin-item">
                        <span class="margin-label">多單</span>
                        <span class="margin-value">${formatCount(fi.long_oi)} 口</span>
                    </div>
                    <div class="margin-item">
                        <span class="margin-label">空單</span>
                        <span class="margin-value">${formatCount(fi.short_oi)} 口</span>
                    </div>
                    <div class="margin-item">
                        <span class="margin-label">淨部位</span>
                        <span class="margin-value ${biasClass}">${biasSign}${formatCount(fi.net_oi)} 口</span>
                    </div>
                    <div class="margin-item">
                        <span class="margin-label">偏向</span>
                        <span class="margin-value ${biasClass}">${fi.bias}</span>
                    </div>
                </div>
            </div>
            ${dealer.net_oi != null ? `
            <div class="futures-section" style="margin-top:0.8rem;">
                <h4 style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.4rem;">自營商淨部位：
                    <span class="${dealer.net_oi > 0 ? 'text-positive' : 'text-negative'}">${dealer.net_oi > 0 ? '+' : ''}${formatCount(dealer.net_oi)} 口</span>
                </h4>
            </div>` : ''}
        </div>
        <p class="text-muted" style="font-size:0.75rem; margin-top:0.5rem;">更新日期：${futures.date || '-'}</p>
    `;
}

// ============================================================
// Put/Call Ratio
// ============================================================

function renderPcrData(pcr) {
    const container = document.getElementById('pcrContent');
    if (!container) return;

    if (!pcr || pcr.error || (!pcr.volume_pcr && !pcr.oi_pcr)) {
        container.innerHTML = '<p class="text-muted">PCR 資料暫無（非交易日或尚未更新）</p>';
        return;
    }

    const volPcr = pcr.volume_pcr || 0;
    const oiPcr = pcr.oi_pcr || 0;

    // PCR gauge color
    let pcrColor = 'var(--text-muted)';
    if (volPcr > 1.0) pcrColor = 'var(--negative)';
    else if (volPcr > 0.7) pcrColor = '#f59e0b';
    else pcrColor = 'var(--positive)';

    container.innerHTML = `
        <div class="pcr-display">
            <div class="pcr-main">
                <div class="pcr-number" style="color:${pcrColor}">${volPcr.toFixed(3)}</div>
                <div class="pcr-label">成交量 PCR</div>
            </div>
            <div class="pcr-main">
                <div class="pcr-number">${oiPcr.toFixed(3)}</div>
                <div class="pcr-label">未平倉 PCR</div>
            </div>
        </div>
        <div class="pcr-sentiment">
            <span class="margin-label">情緒判讀</span>
            <span class="margin-value">${pcr.sentiment || '-'}</span>
        </div>
        <div class="margin-grid" style="margin-top:0.6rem;">
            <div class="margin-item">
                <span class="margin-label">Call 量</span>
                <span class="margin-value">${formatCount(pcr.call_volume)}</span>
            </div>
            <div class="margin-item">
                <span class="margin-label">Put 量</span>
                <span class="margin-value">${formatCount(pcr.put_volume)}</span>
            </div>
        </div>
        <p class="text-muted" style="font-size:0.75rem; margin-top:0.5rem;">更新日期：${pcr.date || '-'}</p>
    `;
}

// ============================================================
// SOX + TSMC ADR 連動
// ============================================================

function renderSoxAdrLinkage(market) {
    const container = document.getElementById('soxAdrContent');
    if (!container) return;

    const sox = market?.SOX || {};
    const tsmcTw = market?.TSMC || {};
    const tsmcAdr = market?.TSMC_ADR || {};
    const usdtwd = market?.['USD/TWD']?.price || 32;

    if (!sox.price || !tsmcTw.price) {
        container.innerHTML = '<p class="text-muted">連動資料暫無</p>';
        return;
    }

    // 計算 ADR 溢折價
    let adrPremium = 0;
    let adrInTwd = '-';
    if (tsmcAdr.price) {
        adrInTwd = (tsmcAdr.price * usdtwd / 5).toFixed(2);
        adrPremium = ((parseFloat(adrInTwd) - tsmcTw.price) / tsmcTw.price * 100).toFixed(2);
    }

    // 背離檢測
    let divergence = '';
    let divClass = '';
    const soxChg = sox.change_pct || 0;
    const twChg = tsmcTw.change_pct || 0;
    if (soxChg > 1.0 && twChg < -0.5) {
        divergence = '⚠️ 費半漲但台積電跌 — 背離警告，注意補漲或持續弱勢';
        divClass = 'text-negative';
    } else if (soxChg < -1.0 && twChg > 0.5) {
        divergence = '⚠️ 費半跌但台積電抗跌 — 留意後續是否補跌';
        divClass = 'text-negative';
    } else if (Math.abs(soxChg) > 2.0) {
        divergence = `⚡ 費半大幅波動 ${soxChg > 0 ? '+' : ''}${soxChg}%，半導體族群留意連動`;
        divClass = soxChg > 0 ? 'text-positive' : 'text-negative';
    } else {
        divergence = '✅ 費半與台積電走勢一致，無明顯背離';
        divClass = 'text-muted';
    }

    const premiumClass = adrPremium > 0 ? 'text-positive' : adrPremium < 0 ? 'text-negative' : 'text-muted';

    container.innerHTML = `
        <div class="linkage-grid">
            <div class="linkage-item">
                <span class="linkage-label">費半指數</span>
                <span class="linkage-price">${sox.price}</span>
                <span class="${sox.change_pct >= 0 ? 'text-positive' : 'text-negative'}">${sox.change_pct >= 0 ? '+' : ''}${sox.change_pct}%</span>
            </div>
            <div class="linkage-item">
                <span class="linkage-label">台積電 (TW)</span>
                <span class="linkage-price">${tsmcTw.price}</span>
                <span class="${tsmcTw.change_pct >= 0 ? 'text-positive' : 'text-negative'}">${tsmcTw.change_pct >= 0 ? '+' : ''}${tsmcTw.change_pct}%</span>
            </div>
            <div class="linkage-item">
                <span class="linkage-label">台積電 ADR</span>
                <span class="linkage-price">${tsmcAdr.price || '-'}</span>
                <span class="${(tsmcAdr.change_pct || 0) >= 0 ? 'text-positive' : 'text-negative'}">${tsmcAdr.change_pct != null ? ((tsmcAdr.change_pct >= 0 ? '+' : '') + tsmcAdr.change_pct + '%') : '-'}</span>
            </div>
            <div class="linkage-item">
                <span class="linkage-label">ADR 折算台幣</span>
                <span class="linkage-price">${adrInTwd}</span>
                <span class="${premiumClass}">${adrPremium > 0 ? '+' : ''}${adrPremium}% ${adrPremium > 0 ? '溢價' : adrPremium < 0 ? '折價' : ''}</span>
            </div>
        </div>
        <div class="linkage-divergence ${divClass}" style="margin-top:0.8rem;padding:0.7rem 1rem;background:rgba(0,0,0,0.3);border-radius:8px;font-size:0.9rem;">
            ${divergence}
        </div>
    `;
}

// ============================================================
// 異常波動預警
// ============================================================

// v10.7 功能 2: 美債 10 年期殖利率 (US10Y) 總經信號
function renderMacroSignals(macro) {
    const container = document.getElementById('macroSignalsContainer');
    if (!container) return;
    if (!macro || macro.us10y_yield == null) {
        container.innerHTML = '';
        return;
    }
    const yld = macro.us10y_yield;
    const lvl = macro.us10y_warning_level || 'normal';
    const msg = macro.us10y_message || '';
    const styleMap = {
        high: { icon: '🚨', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.35)', color: 'var(--negative)', label: '高警戒' },
        medium: { icon: '⚠️', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.35)', color: '#f59e0b', label: '中警戒' },
        low: { icon: '🟡', bg: 'rgba(234,179,8,0.06)', border: 'rgba(234,179,8,0.25)', color: '#eab308', label: '低警戒' },
        dovish: { icon: '🕊️', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.3)', color: 'var(--positive)', label: '偏鴿' },
        normal: { icon: '🌐', bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.2)', color: 'var(--accent-blue)', label: '中性' },
    };
    const cfg = styleMap[lvl] || styleMap.normal;
    const flags = (macro.risk_flags || []).map(f => `<span class="macro-flag">${f}</span>`).join('');
    container.innerHTML = `
        <div class="card glass" style="margin-bottom:1.5rem;background:${cfg.bg};border:1px solid ${cfg.border};">
            <h2 style="color:${cfg.color};">${cfg.icon} 總經信號 · 美債 10Y 殖利率</h2>
            <div class="macro-row" style="display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap;">
                <span style="font-size:2rem;font-weight:700;color:${cfg.color};">${yld}%</span>
                <span class="sentiment-badge" style="background:${cfg.border};color:${cfg.color};">${cfg.label}</span>
            </div>
            ${msg ? `<p style="margin-top:0.6rem;color:var(--text-main);">${msg}</p>` : ''}
            ${flags ? `<div class="macro-flags" style="margin-top:0.5rem;display:flex;gap:0.4rem;flex-wrap:wrap;">${flags}</div>` : ''}
        </div>
    `;
}

function renderAlerts(alerts) {
    const container = document.getElementById('alertsContainer');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
        container.innerHTML = '';
        return;
    }

    const levelConfig = {
        critical: { icon: '🚨', bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.3)', color: 'var(--negative)' },
        warning: { icon: '⚠️', bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.3)', color: '#f59e0b' },
        info: { icon: 'ℹ️', bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent-blue)' },
    };

    container.innerHTML = `
        <div class="card glass alerts-card" style="margin-bottom:1.5rem;">
            <h2>🚨 異常波動預警</h2>
            <div class="alerts-list">
                ${alerts.map(a => {
        const cfg = levelConfig[a.level] || levelConfig.info;
        return `
                    <div class="alert-item" style="background:${cfg.bg};border:1px solid ${cfg.border};border-radius:10px;padding:0.8rem 1rem;margin-bottom:0.5rem;">
                        <div class="alert-header">
                            <span class="alert-icon">${cfg.icon}</span>
                            <span class="alert-title" style="color:${cfg.color};font-weight:600;">${a.title}</span>
                        </div>
                        <p class="alert-desc" style="font-size:0.88rem;margin:0.3rem 0;color:var(--text-main);">${a.description}</p>
                        <p class="alert-action" style="font-size:0.82rem;color:var(--text-muted);">💡 ${a.action}</p>
                    </div>`;
    }).join('')}
            </div>
        </div>
    `;
}
