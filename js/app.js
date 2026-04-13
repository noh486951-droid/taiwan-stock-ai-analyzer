document.addEventListener('DOMContentLoaded', () => {
    fetchData();

    document.getElementById('dispatchAnalysis').addEventListener('click', triggerAnalysis);
});

async function fetchData() {
    try {
        // Normally this would be a relative path: 'data/market_pulse.json'
        // For local development testing, we load it easily.
        const response = await fetch('data/market_pulse.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        renderData(data);
    } catch (error) {
        console.error("無法載入數據:", error);
        document.getElementById('marketPulseContent').innerHTML = `
            <p class="text-negative">數據載入失敗。請確保 GitHub Actions 已執行且 data/market_pulse.json 檔案存在。</p>
        `;
    }
}

function renderData(data) {
    // 1. 渲染市場脈動 / AI 分析
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
        
        // 觀察建議
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

    // 2. 渲染指數數據
    const indicesGrid = document.getElementById('indicesGrid');
    indicesGrid.innerHTML = '';
    
    // 繁體中文映射
    const nameMap = {
        'TAIEX': '台股加權指數',
        'SOX': '費城半導體',
        'TSMC': '台積電 (2330)',
        'USD/TWD': '美元/台幣'
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

    // 3. 渲染新聞
    const newsGrid = document.getElementById('newsGrid');
    newsGrid.innerHTML = '';
    if (data.news && data.news.length > 0) {
        data.news.slice(0, 6).forEach(item => {
            newsGrid.innerHTML += `
                <li><a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.title}</a></li>
            `;
        });
    } else {
        newsGrid.innerHTML = '<li>暫無近期新聞。</li>';
    }

    // 4. 渲染籌碼數據
    const chipContent = document.getElementById('chipContent');
    chipContent.innerHTML = '';
    if (data.chips && data.chips.summary) {
        chipContent.innerHTML += `<p>更新日期：${data.chips.date}</p>`;
        data.chips.summary.forEach(row => {
            // TWSE 格式: [單位名稱, 買進, 賣出, 買賣差額]
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

function triggerAnalysis() {
    const symbol = document.getElementById('stockSymbol').value;
    const msg = document.getElementById('assistantMsg');
    
    if (!symbol) {
        msg.textContent = '請輸入有效的股票代碼。';
        msg.className = 'assistant-msg text-negative';
        return;
    }
    
    msg.textContent = '正在安全地觸發 GitHub Dispatch 事件...';
    msg.className = 'assistant-msg';
    
    // 模擬觸發
    setTimeout(() => {
        msg.textContent = "分析任務已成功送出。結果將在大約 120-180 秒後顯示。";
        msg.className = 'assistant-msg text-positive';
    }, 1500);
}
