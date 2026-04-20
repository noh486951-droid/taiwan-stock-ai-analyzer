document.addEventListener('DOMContentLoaded', () => {
    loadSectorMap();
    loadEventCalendar();
});

async function loadSectorMap() {
    try {
        const res = await fetch('data/sector_map.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('sector_map.json not found');
        const data = await res.json();
        if (data.status === 'success') {
            renderSectorMap(data);
        } else {
            document.getElementById('marketTheme').innerHTML = '<p class="text-muted">族群地圖尚未產生，請等待下次排程分析。</p>';
        }
    } catch (error) {
        console.error('Error loading sector map:', error);
        document.getElementById('marketTheme').innerHTML = '<p class="text-muted">族群地圖載入失敗。</p>';
    }
}

function renderSectorMap(data) {
    // 1. 市場主題
    const themeEl = document.getElementById('marketTheme');
    themeEl.innerHTML = `
        <p style="font-size:1.2rem;font-weight:600;margin-bottom:0.5rem;">${data.market_theme || ''}</p>
        ${data.rotation_signal ? `<p class="text-muted" style="font-size:0.9rem;">💫 ${data.rotation_signal}</p>` : ''}
        <p class="text-muted" style="font-size:0.75rem;margin-top:0.5rem;">更新時間：${data.timestamp || ''}</p>
    `;

    // 2. 族群熱度
    const heatEl = document.getElementById('sectorHeatmap');
    if (data.sectors && data.sectors.length > 0) {
        const sorted = [...data.sectors].sort((a, b) => (b.heat || 0) - (a.heat || 0));
        heatEl.innerHTML = `
            <div class="sector-grid">
                ${sorted.map(s => {
                    const trendClass = s.trend === '強勢' ? 'sector-hot' : s.trend === '弱勢' ? 'sector-cold' : 'sector-neutral';
                    const heatBars = '🔥'.repeat(Math.min(s.heat || 0, 5));
                    return `
                    <div class="sector-card ${trendClass}">
                        <div class="sector-card-header">
                            <span class="sector-name">${s.name}</span>
                            <span class="sector-heat">${heatBars}</span>
                        </div>
                        <div class="sector-trend-badge sector-trend-${s.trend === '強勢' ? 'bull' : s.trend === '弱勢' ? 'bear' : 'neutral'}">${s.trend}</div>
                        ${s.key_stocks && s.key_stocks.length > 0 ? `
                        <div class="sector-stocks">
                            ${s.key_stocks.map(st => `<span class="tag">${st}</span>`).join('')}
                        </div>` : ''}
                        <p class="sector-catalyst">${s.catalyst || ''}</p>
                        <p class="sector-outlook">${s.outlook || ''}</p>
                    </div>`;
                }).join('')}
            </div>
        `;
    } else {
        heatEl.innerHTML = '<p class="text-muted">暫無族群資料</p>';
    }

    // 3. 產業鏈
    const chainEl = document.getElementById('supplyChain');
    if (data.supply_chain && data.supply_chain.length > 0) {
        chainEl.innerHTML = data.supply_chain.map(chain => {
            const statusClass = chain.status === '受惠' ? 'text-positive' : chain.status === '受壓' ? 'text-negative' : 'text-muted';
            return `
            <div class="chain-card">
                <div class="chain-header">
                    <span class="chain-name">${chain.chain_name}</span>
                    <span class="chain-status ${statusClass}">${chain.status}</span>
                </div>
                <div class="chain-flow">
                    <div class="chain-stage">
                        <span class="chain-stage-label">上游</span>
                        <div class="chain-stage-items">${(chain.upstream || []).map(u => `<span class="tag">${u}</span>`).join('')}</div>
                    </div>
                    <span class="chain-arrow">→</span>
                    <div class="chain-stage">
                        <span class="chain-stage-label">中游</span>
                        <div class="chain-stage-items">${(chain.midstream || []).map(m => `<span class="tag">${m}</span>`).join('')}</div>
                    </div>
                    <span class="chain-arrow">→</span>
                    <div class="chain-stage">
                        <span class="chain-stage-label">下游</span>
                        <div class="chain-stage-items">${(chain.downstream || []).map(d => `<span class="tag">${d}</span>`).join('')}</div>
                    </div>
                </div>
                <p class="chain-reason">${chain.reason || ''}</p>
            </div>`;
        }).join('');
    } else {
        chainEl.innerHTML = '<p class="text-muted">暫無產業鏈資料</p>';
    }

    // 4. 資金輪動
    const rotEl = document.getElementById('rotationSignal');
    rotEl.innerHTML = `<p style="font-size:1rem;line-height:1.6;">${data.rotation_signal || '暫無資金輪動訊號'}</p>`;

    // 5. 近期催化劑
    if (data.upcoming_catalysts && data.upcoming_catalysts.length > 0) {
        const calEl = document.getElementById('eventCalendar');
        const existingContent = calEl.innerHTML;
        const catalystHtml = `
            <div class="catalyst-section" style="margin-top:1rem;">
                <h3 style="font-size:0.95rem;color:var(--accent-blue);margin-bottom:0.5rem;">AI 預測催化劑</h3>
                ${data.upcoming_catalysts.map(c => `
                <div class="event-item">
                    <span class="event-date">${c.date || ''}</span>
                    <div class="event-info">
                        <span class="event-title">${c.event}</span>
                        <span class="event-sectors">${(c.affected_sectors || []).join('、')}</span>
                        <span class="event-impact-text">${c.expected_impact || ''}</span>
                    </div>
                </div>`).join('')}
            </div>
        `;
        calEl.innerHTML += catalystHtml;
    }
}

async function loadEventCalendar() {
    try {
        const res = await fetch('data/events_calendar.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        renderEventCalendar(data);
    } catch {
        // No calendar data
    }
}

function renderEventCalendar(data) {
    const container = document.getElementById('eventCalendar');
    if (!data.events || data.events.length === 0) {
        container.innerHTML = '<p class="text-muted">暫無行事曆事件</p>';
        return;
    }

    // Sort by date
    const sorted = [...data.events].sort((a, b) => a.date.localeCompare(b.date));

    // Filter future events
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = sorted.filter(e => e.date >= today);
    const past = sorted.filter(e => e.date < today).slice(-3); // Last 3 past events

    const typeIcons = {
        earnings: '📊',
        dividend: '💰',
        economic: '🏛️',
        holiday: '🏖️',
        ipo: '🚀',
        other: '📌',
    };

    const impactColors = {
        high: 'var(--negative)',
        medium: '#f59e0b',
        low: 'var(--text-muted)',
    };

    const renderEvents = (events) => events.map(e => `
        <div class="event-item">
            <span class="event-date">${e.date}</span>
            <span class="event-type-icon">${typeIcons[e.type] || typeIcons.other}</span>
            <div class="event-info">
                <span class="event-title">${e.title}</span>
                ${e.symbol ? `<span class="tag" style="font-size:0.7rem;">${e.symbol}</span>` : ''}
                <span class="event-desc">${e.description || ''}</span>
            </div>
            <span class="event-impact" style="color:${impactColors[e.impact] || impactColors.low}">
                ${e.impact === 'high' ? '高影響' : e.impact === 'medium' ? '中影響' : '低影響'}
            </span>
        </div>
    `).join('');

    container.innerHTML = `
        ${upcoming.length > 0 ? `
        <div class="events-section">
            <h3 style="font-size:0.9rem;color:var(--accent-blue);margin-bottom:0.5rem;">即將到來</h3>
            ${renderEvents(upcoming)}
        </div>` : '<p class="text-muted">近期無重大事件</p>'}
        ${past.length > 0 ? `
        <div class="events-section" style="margin-top:1rem;opacity:0.6;">
            <h3 style="font-size:0.9rem;color:var(--text-muted);margin-bottom:0.5rem;">近期已過</h3>
            ${renderEvents(past)}
        </div>` : ''}
        <p class="text-muted" style="font-size:0.7rem;margin-top:0.8rem;">最後更新：${data.last_updated || '-'}</p>
    `;
}
