// scout.js — 市場雷達前端
// 讀 data/scout_radar.json + data/ai_picked_watchlist.json

let _radar = null;

document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([loadRadar(), loadAiPick()]);
});

async function loadRadar() {
    try {
        const r = await fetch('data/scout_radar.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('no scout_radar.json yet');
        _radar = await r.json();
        renderAll(_radar);
    } catch (e) {
        document.getElementById('scoutMeta').innerHTML =
            '<span class="text-negative">⚠️ 雷達資料尚未產生 — 請等下一次盤後（14:30 UTC+8）跑完 main.yml 再回來看</span>';
    }
}

async function loadAiPick() {
    try {
        const r = await fetch('data/ai_picked_watchlist.json', { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (data.error || !data.picks) return;
        renderAiPick(data);
    } catch { /* no AI pick yet */ }
}

function renderAll(d) {
    document.getElementById('scoutMeta').innerHTML =
        `📅 資料日期：<b>${formatDate(d.date)}</b> &nbsp;·&nbsp; 掃描時間：${d.fetched_at || '-'}`;

    renderRecurring(d.recurring_3d || {});

    renderInstTable('foreignBuyTable',  d.foreign_buy_top,  'foreign', 'buy');
    renderInstTable('foreignSellTable', d.foreign_sell_top, 'foreign', 'sell');
    renderInstTable('trustBuyTable',    d.trust_buy_top,    'trust',   'buy');
    renderInstTable('totalBuyTable',    d.total_buy_top,    'total',   'buy');

    renderPriceTable('priceUpTable',   d.price_up_top,   'up');
    renderPriceTable('priceDownTable', d.price_down_top, 'down');

    renderVolSurge('volSurgeTable', d.volume_surge_top);
    renderChipJump('chipJumpTable', d.chip_concentration_jump);
}

function formatDate(s) {
    if (!s) return '-';
    return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : s;
}

function fmtShares(s) {
    // 股 → 張
    if (s == null) return '-';
    const lots = Math.round(s / 1000);
    if (Math.abs(lots) >= 10000) return (lots/10000).toFixed(1) + '萬張';
    return lots.toLocaleString() + '張';
}

function changeClass(pct) {
    if (pct == null) return '';
    if (pct > 0) return 'text-positive';
    if (pct < 0) return 'text-negative';
    return 'text-muted';
}

function fmtPct(pct) {
    if (pct == null) return '-';
    const sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(2) + '%';
}

// ========== 表格渲染 ==========

function renderInstTable(elId, list, instType, side) {
    const el = document.getElementById(elId);
    if (!list || list.length === 0) {
        el.innerHTML = '<p class="text-muted">無資料</p>';
        return;
    }
    const valKey = instType; // 'foreign' | 'trust' | 'total'
    const rows = list.map((x, i) => {
        const v = x[valKey];
        const rowCls = side === 'buy' ? 'scout-row-pos' : 'scout-row-neg';
        return `
            <tr class="${rowCls}">
                <td>${i+1}</td>
                <td><b>${x.code}</b><br><span class="text-muted" style="font-size:0.75rem;">${x.name||'-'}</span></td>
                <td class="num ${changeClass(v)}">${v >= 0 ? '+' : ''}${fmtShares(v)}</td>
                <td class="num ${changeClass(x.change_pct)}">${fmtPct(x.change_pct)}</td>
                <td><button class="add-btn" onclick="addToWatchlist('${x.symbol||x.code+'.TW'}')">＋</button></td>
            </tr>`;
    }).join('');
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr><th>#</th><th>代號 / 名稱</th><th class="num">${side==='buy'?'買超':'賣超'}</th><th class="num">漲跌</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function renderPriceTable(elId, list, dir) {
    const el = document.getElementById(elId);
    if (!list || list.length === 0) {
        el.innerHTML = '<p class="text-muted">無資料</p>';
        return;
    }
    const rows = list.map((x, i) => {
        const rowCls = dir === 'up' ? 'scout-row-pos' : 'scout-row-neg';
        return `
            <tr class="${rowCls}">
                <td>${i+1}</td>
                <td><b>${x.code}</b><br><span class="text-muted" style="font-size:0.75rem;">${x.name||'-'}</span></td>
                <td class="num">${x.close}</td>
                <td class="num ${changeClass(x.change_pct)}"><b>${fmtPct(x.change_pct)}</b></td>
                <td class="num text-muted" style="font-size:0.75rem;">${fmtShares(x.volume)}</td>
                <td><button class="add-btn" onclick="addToWatchlist('${x.symbol||x.code+'.TW'}')">＋</button></td>
            </tr>`;
    }).join('');
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr><th>#</th><th>代號 / 名稱</th><th class="num">收盤</th><th class="num">漲跌</th><th class="num">成交</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function renderVolSurge(elId, list) {
    const el = document.getElementById(elId);
    if (!list || list.length === 0) {
        el.innerHTML = '<p class="text-muted">今日無爆量股（需要 daily_base_data 提供 MA5）</p>';
        return;
    }
    const rows = list.map((x, i) => `
        <tr>
            <td>${i+1}</td>
            <td><b>${x.code}</b><br><span class="text-muted" style="font-size:0.75rem;">${x.name||'-'}</span></td>
            <td class="num"><b style="color:#ffa502;">${x.vol_ratio}x</b></td>
            <td class="num ${changeClass(x.change_pct)}">${fmtPct(x.change_pct)}</td>
            <td><button class="add-btn" onclick="addToWatchlist('${x.symbol||x.code+'.TW'}')">＋</button></td>
        </tr>
    `).join('');
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr><th>#</th><th>代號 / 名稱</th><th class="num">量比</th><th class="num">漲跌</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function renderChipJump(elId, list) {
    const el = document.getElementById(elId);
    if (!list || list.length === 0) {
        el.innerHTML = '<p class="text-muted">本週無顯著籌碼異動（需要 TDCC 兩週快照）</p>';
        return;
    }
    const rows = list.map((x, i) => `
        <tr>
            <td>${i+1}</td>
            <td><b>${x.code}</b><br><span class="text-muted" style="font-size:0.75rem;">${x.name||'-'}</span></td>
            <td class="num ${changeClass(x.whale_delta)}">${x.whale_delta >= 0 ? '+' : ''}${x.whale_delta.toFixed(2)} pp</td>
            <td class="num">${x.whale_pct ? x.whale_pct.toFixed(1)+'%' : '-'}</td>
            <td><button class="add-btn" onclick="addToWatchlist('${x.symbol}')">＋</button></td>
        </tr>
    `).join('');
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr><th>#</th><th>代號 / 名稱</th><th class="num">大戶 Δ</th><th class="num">大戶占比</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// ========== 連 3 日上榜 ==========

function renderRecurring(rec) {
    const card = document.getElementById('recurringCard');
    const el = document.getElementById('recurringContent');
    const boardLabels = {
        foreign_buy_top: '外資買超',
        foreign_sell_top: '外資賣超',
        total_buy_top: '法人合計買超',
        price_up_top: '漲幅榜',
        volume_surge_top: '量增榜',
    };
    let total = 0;
    let html = '';
    for (const [board, items] of Object.entries(rec)) {
        if (!items || !items.length) continue;
        total += items.length;
        html += `<div style="margin-bottom:0.6rem;"><b style="color:var(--accent-blue);">${boardLabels[board]||board}</b>: `;
        html += items.map(x =>
            `<span style="margin-right:0.5rem;">${x.code}<span class="badge-streak">${x.streak} 天</span></span>`
        ).join('');
        html += '</div>';
    }
    if (total === 0) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    el.innerHTML = html + `<p class="scout-meta" style="margin-top:0.5rem;">⚠️ 同一檔在多個榜上連 3 日 = 法人共識成形，值得加入觀察</p>`;
}

// ========== AI 自選股推薦 ==========

function renderAiPick(data) {
    const card = document.getElementById('aiPickCard');
    const el = document.getElementById('aiPickContent');
    card.style.display = 'block';

    const items = (data.picks || []).map(p => `
        <div class="ai-pick-item">
            <div class="sym">${p.symbol||''} <span class="cat">${p.category||''}</span></div>
            <div class="reason">${p.reason||''}</div>
            <button class="add-btn" style="margin-top:0.4rem;" onclick="addToWatchlist('${p.symbol}')">加入自選股</button>
        </div>
    `).join('');

    el.innerHTML = `
        <p style="font-size:0.85rem; color:var(--text-muted);">
            這是 AI 從上面雷達榜單按「中長線、產業多元、避開噴出股」原則挑出的觀察名單（${data.radar_date||'-'} 雷達）
        </p>
        <p style="margin:0.6rem 0; line-height:1.5;">${data.rationale||''}</p>
        ${data.sectors_covered ? `<p class="scout-meta">涵蓋產業：${data.sectors_covered.join(' · ')}</p>` : ''}
        <div class="ai-pick-grid">${items}</div>
        <p class="scout-meta" style="margin-top:0.8rem;">🕐 產生時間：${data.generated_at||'-'}</p>
    `;
}

// ========== 加入自選股 — 複製代號到剪貼簿，引導使用者貼進自選股頁 ==========

async function addToWatchlist(symbol) {
    if (!symbol) return;
    try {
        await navigator.clipboard.writeText(symbol);
        alert(`✅ 已複製 ${symbol} 到剪貼簿\n\n請打開「⭐ 自選股」頁，在新增欄位貼上後加入。`);
    } catch {
        prompt('複製這個代號到自選股頁：', symbol);
    }
}
