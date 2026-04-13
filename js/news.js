document.addEventListener('DOMContentLoaded', () => {
    fetchNews();
});

async function fetchNews() {
    try {
        const response = await fetch('data/market_pulse.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        renderNews(data);
    } catch (error) {
        console.error("無法載入新聞:", error);
        document.getElementById('newsGrid').innerHTML = `
            <div class="glass news-card">
                <p class="text-negative">新聞載入失敗。請確保資料檔案存在。</p>
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
            minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
}
