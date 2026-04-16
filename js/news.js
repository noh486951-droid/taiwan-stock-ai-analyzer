document.addEventListener('DOMContentLoaded', () => {
    fetchDigest();
    fetchNews();
});

// ============================================================
// 晨間 AI 快報
// ============================================================

async function fetchDigest() {
    const container = document.getElementById('digestContent');
    try {
        const res = await fetch('data/morning_digest.json');
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        renderDigest(data);
    } catch {
        container.innerHTML = `<p class="text-muted">晨間快報尚未產生，請等待每日 08:00 排程更新。</p>`;
    }
}

function renderDigest(data) {
    const container = document.getElementById('digestContent');

    // 動態標題依時段切換
    const sessionMap = {
        morning:   { icon: '☀', badge: '盤前 08:00' },
        midday:    { icon: '📊', badge: '盤中 10:00' },
        afternoon: { icon: '🌤', badge: '收盤 14:30' },
        evening:   { icon: '🌙', badge: '盤後 18:00' },
    };
    const s = sessionMap[data.session] || sessionMap.morning;
    const titleEl = document.getElementById('digestTitle');
    const badgeEl = document.getElementById('digestBadge');
    if (titleEl) titleEl.textContent = `${s.icon} ${data.show_name || '台股早安'}`;
    if (badgeEl) badgeEl.textContent = s.badge;

    if (data.status !== 'success') {
        container.innerHTML = `<p class="text-muted">${data.content || '快報產生失敗。'}</p>`;
        return;
    }

    let html = '';

    // 標題
    if (data.title) {
        html += `<h2 class="digest-title">${data.title}</h2>`;
    }

    // 開場白
    if (data.greeting) {
        html += `<p class="digest-greeting">${data.greeting}</p>`;
    }

    // 各段落
    if (data.sections && data.sections.length > 0) {
        data.sections.forEach(section => {
            html += `
                <div class="digest-section">
                    <h3>${section.heading}</h3>
                    <p>${section.body}</p>
                </div>
            `;
        });
    }

    // 風險警示
    if (data.risk_alerts && data.risk_alerts.length > 0) {
        html += `<div class="digest-alerts">`;
        html += `<h3>⚠ 風險警示</h3><ul>`;
        data.risk_alerts.forEach(alert => {
            html += `<li>${alert}</li>`;
        });
        html += `</ul></div>`;
    }

    // 結語
    if (data.closing) {
        html += `<p class="digest-closing">${data.closing}</p>`;
    }

    // 時間戳
    html += `<p class="digest-timestamp">更新時間：${data.timestamp}</p>`;

    container.innerHTML = html;
}

// ============================================================
// 新聞列表
// ============================================================

async function fetchNews() {
    try {
        const response = await fetch('data/market_pulse.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        renderNews(data);
    } catch (error) {
        console.error("無法載入新聞:", error);
        document.getElementById('newsGrid').innerHTML = `
            <div class="glass news-card">
                <p class="text-negative">新聞載入失敗。</p>
            </div>
        `;
    }
}

function renderNews(data) {
    const newsGrid = document.getElementById('newsGrid');
    newsGrid.innerHTML = '';

    if (data.news && data.news.length > 0) {
        data.news.forEach(item => {
            const publishDate = item.published ? formatDate(item.published) : '';
            newsGrid.innerHTML += `
                <div class="glass news-card">
                    <a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.title}</a>
                    ${publishDate ? `<div class="news-meta">${publishDate}</div>` : ''}
                </div>
            `;
        });
    } else {
        newsGrid.innerHTML = `
            <div class="glass news-card">
                <p>暫無近期新聞。</p>
            </div>
        `;
    }
}

function formatDate(dateStr) {
    try {
        const date = new Date(dateStr);
        return date.toLocaleString('zh-TW', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
}
