document.addEventListener('DOMContentLoaded', () => {
    loadSectorMap();
    loadRotationHeatmap();   // v11.9
});

// ============================================================
// v11.9：10 日資金輪動熱力圖
// ============================================================
async function loadRotationHeatmap() {
    const card = document.getElementById('rotationHeatmapCard');
    const container = document.getElementById('rotationHeatmapContent');
    if (!card || !container) return;
    let data;
    try {
        const r = await fetch('data/sector_history.json', { cache: 'no-store' });
        if (!r.ok) return;
        data = await r.json();
    } catch { return; }
    const summary = data.summary_10d || [];
    const days = data.days || [];
    if (!summary.length) return;
    card.style.display = 'block';

    const trendColor = {
        '波段上漲': '#5fbf83',
        '煙火股':   '#ffa502',
        '波段下跌': '#ff7070',
        '盤整':     '#888',
        '中性':     '#aaa',
    };
    const trendIcon = {
        '波段上漲': '🚀', '煙火股': '🎆', '波段下跌': '📉', '盤整': '↔️', '中性': '➖',
    };

    // 1. 摘要表（按 cum_change_pct 排序）
    const summaryRows = summary.map(s => {
        const cls = s.cum_change_pct > 0 ? 'text-positive' : s.cum_change_pct < 0 ? 'text-negative' : '';
        const sign = s.cum_change_pct >= 0 ? '+' : '';
        return `<tr>
            <td>${s.name}</td>
            <td class="${cls}"><b>${sign}${s.cum_change_pct.toFixed(2)}%</b></td>
            <td>${s.win_days} / ${s.present_days} 天</td>
            <td><span style="background:${trendColor[s.trend]}33;color:${trendColor[s.trend]};padding:1px 8px;border-radius:6px;font-size:0.78rem;font-weight:700;">${trendIcon[s.trend]} ${s.trend}</span></td>
        </tr>`;
    }).join('');

    // 2. Heatmap：每個產業一行，每一天一格
    const lastNDays = days.slice(-10);
    const allSectorNames = [...new Set(summary.map(s => s.name))];
    // 用 summary 排序順序
    const sectorOrder = summary.map(s => s.name);

    const headerCols = lastNDays.map(d => `<th style="font-size:0.7rem;writing-mode:vertical-rl;padding:4px;">${d.date.slice(5)}</th>`).join('');

    const heatRows = sectorOrder.map(name => {
        const cells = lastNDays.map(d => {
            const sec = (d.sectors || []).find(s => s.name === name);
            const cp = sec?.change_pct;
            if (cp === undefined || cp === null) {
                return '<td style="background:rgba(255,255,255,0.02);text-align:center;">—</td>';
            }
            // v12.1.7：台灣慣例 紅漲綠跌 — 對調顏色
            // 顏色強度：abs(cp) > 3 → 飽滿；< 0.5 → 淡色
            const intensity = Math.min(Math.abs(cp) / 3, 1);
            // cp > 0（漲）= 紅；cp < 0（跌）= 綠
            const r = cp > 0 ? Math.round(220 + (255 - 220) * intensity) : Math.round(95 + (50 - 95) * intensity);
            const g = cp > 0 ? Math.round(80 + (60 - 80) * intensity)   : Math.round(191 + (70 - 191) * intensity);
            const b = cp > 0 ? Math.round(80 + (60 - 80) * intensity)   : Math.round(131 + (45 - 131) * intensity);
            const bg = `rgba(${r},${g},${b},${0.3 + intensity * 0.4})`;
            return `<td style="background:${bg};text-align:center;font-size:0.74rem;font-weight:600;color:${cp > 0 ? '#ff7070' : cp < 0 ? '#5fbf83' : '#aaa'};" title="${d.date}: ${cp > 0 ? '+' : ''}${cp.toFixed(2)}%">${cp > 0 ? '+' : ''}${cp.toFixed(1)}</td>`;
        }).join('');
        return `<tr><th style="text-align:left;padding:4px 8px;font-size:0.82rem;font-weight:600;">${name}</th>${cells}</tr>`;
    }).join('');

    container.innerHTML = `
        <h4 style="margin-top:0.8rem;font-size:0.95rem;">📊 摘要排行（${data.days_count} 天累積）</h4>
        <table class="pt-stats-tbl" style="font-size:0.88rem;margin-bottom:1rem;">
            <thead><tr><th>產業</th><th>累積漲跌</th><th>紅棒 / 全</th><th>判定</th></tr></thead>
            <tbody>${summaryRows}</tbody>
        </table>

        <h4 style="font-size:0.95rem;">🌡️ 日線熱力圖</h4>
        <div style="overflow-x:auto;margin-top:0.5rem;">
            <table style="border-collapse:collapse;width:100%;min-width:600px;">
                <thead><tr><th style="text-align:left;padding:4px 8px;font-size:0.78rem;color:var(--text-muted);">產業 ＼ 日期</th>${headerCols}</tr></thead>
                <tbody>${heatRows}</tbody>
            </table>
        </div>
        <p class="text-muted" style="font-size:0.72rem;margin-top:0.6rem;">
            ⚠️ 資料 ${data.days_count} 天 · 至少 5 天才有意義 · 「煙火股」表示累積漲幅高但紅棒天數少（一日行情居多，避開）
        </p>
    `;
}

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

    // v12.8.2：舊「近期催化劑 → eventCalendar」注入移除（行事曆卡已下線，改用 calendar.html）
}

