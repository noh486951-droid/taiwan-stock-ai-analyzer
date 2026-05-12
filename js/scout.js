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

    renderSuspicious(d.suspicious_buy_top || []);
    renderRecurring(d.recurring_3d || {});

    renderInstTable('foreignBuyTable',  d.foreign_buy_top,  'foreign', 'buy');
    renderInstTable('foreignSellTable', d.foreign_sell_top, 'foreign', 'sell');
    renderInstTable('trustBuyTable',    d.trust_buy_top,    'trust',   'buy');
    renderInstTable('totalBuyTable',    d.total_buy_top,    'total',   'buy');

    renderPriceTable('priceUpTable',   d.price_up_top,   'up');
    renderPriceTable('priceDownTable', d.price_down_top, 'down');

    renderVolSurge('volSurgeTable', d.volume_surge_top);
    renderChipJump('chipJumpTable', d.chip_concentration_jump);
    // v11.13：年增率 + 大戶布局
    renderRevenueYoyTop(d.revenue_yoy_top || []);
    renderBigHolderTop(d.big_holder_top || []);
}

// v11.13：年增率 Top 10（含產業篩選）
let _revenueYoyData = [];
function renderRevenueYoyTop(list) {
    _revenueYoyData = list || [];
    const el = document.getElementById('revenueYoyTable');
    if (!el) return;
    if (!_revenueYoyData.length) {
        el.innerHTML = '<p class="text-muted">無資料</p>';
        return;
    }
    // 建立產業選單
    _renderSectorFilter('revenueYoyFilter', _revenueYoyData, 'yoy');
    _drawRevenueYoyTable('all');
}

function _drawRevenueYoyTable(filterIndustry) {
    const el = document.getElementById('revenueYoyTable');
    let list = _revenueYoyData;
    if (filterIndustry && filterIndustry !== 'all') {
        list = list.filter(s => s.industry === filterIndustry);
    }
    list = list.slice(0, 15);   // 篩選後最多 15 筆
    if (!list.length) {
        el.innerHTML = '<p class="text-muted">該產業無符合條件的個股</p>';
        return;
    }
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr>
                <th>個股</th><th>產業</th><th>YoY %</th><th>MoM %</th><th>累積 YoY</th><th>當月營收</th><th>品質分</th>
            </tr></thead>
            <tbody>${list.map((s, i) => {
                const cls = (s.yoy_pct || 0) > 0 ? 'text-positive' : 'text-negative';
                const sign = (s.yoy_pct || 0) >= 0 ? '+' : '';
                const momCls = (s.mom_pct || 0) >= 0 ? 'text-positive' : 'text-negative';
                const momSign = (s.mom_pct || 0) >= 0 ? '+' : '';
                const cumCls = (s.cumulative_yoy_pct || 0) >= 0 ? 'text-positive' : 'text-negative';
                const cumSign = (s.cumulative_yoy_pct || 0) >= 0 ? '+' : '';
                const rev = s.revenue ? `${(s.revenue / 1000000).toFixed(0)} 億` : '—';
                const qs = s.quality_score || 0;
                const qsColor = qs > 100 ? '#ef4444' : qs > 50 ? '#fbbf24' : '#60a5fa';
                return `<tr>
                    <td>${i+1}. <b>${s.name || s.code}</b> <span class="text-muted">${s.code}</span></td>
                    <td style="font-size:0.8rem;">${s.industry || '—'}</td>
                    <td class="${cls}"><b>${sign}${s.yoy_pct}%</b></td>
                    <td class="${momCls}">${momSign}${(s.mom_pct || 0).toFixed(1)}%</td>
                    <td class="${cumCls}">${cumSign}${(s.cumulative_yoy_pct || 0).toFixed(1)}%</td>
                    <td>${rev}</td>
                    <td style="color:${qsColor};font-weight:700;">${qs}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>
        <p class="text-muted" style="font-size:0.75rem;margin-top:0.5rem;">
            💡 品質分數 = 累計 YoY × 1.5 + 單月 YoY × 1.0 + MoM × 0.5（&gt;100 為強）<br>
            🔒 已排除：YoY > 200% 一次性爆衝 / 累計 YoY 為負 / MoM 大跌的個股
        </p>
    `;
}

// 產業篩選下拉選單
function _renderSectorFilter(containerId, data, type) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const industries = [...new Set(data.map(s => s.industry).filter(Boolean))].sort();
    if (industries.length === 0) {
        el.innerHTML = '';
        return;
    }
    const options = ['<option value="all">🌐 全部產業</option>']
        .concat(industries.map(ind => `<option value="${ind}">${ind} (${data.filter(s => s.industry === ind).length})</option>`));
    el.innerHTML = `
        <label style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.8rem;flex-wrap:wrap;">
            <span style="font-size:0.85rem;color:var(--text-muted);">🔍 產業篩選：</span>
            <select style="background:rgba(0,0,0,0.4);color:#fff;border:1px solid rgba(255,255,255,0.15);padding:0.3rem 0.6rem;border-radius:6px;font-size:0.85rem;min-width:180px;">
                ${options.join('')}
            </select>
        </label>
    `;
    const select = el.querySelector('select');
    select.addEventListener('change', (e) => {
        const val = e.target.value;
        if (type === 'yoy') _drawRevenueYoyTable(val);
        else if (type === 'whale') _drawBigHolderTable(val);
    });
}

// v11.13：大戶布局 Top 10（含產業篩選）
let _bigHolderData = [];
function renderBigHolderTop(list) {
    _bigHolderData = list || [];
    const el = document.getElementById('bigHolderTable');
    if (!el) return;
    if (!_bigHolderData.length) {
        el.innerHTML = '<p class="text-muted">無資料（TDCC 每週五更新）</p>';
        return;
    }
    _renderSectorFilter('bigHolderFilter', _bigHolderData, 'whale');
    _drawBigHolderTable('all');
}

function _drawBigHolderTable(filterIndustry) {
    const el = document.getElementById('bigHolderTable');
    let list = _bigHolderData;
    if (filterIndustry && filterIndustry !== 'all') {
        list = list.filter(s => s.industry === filterIndustry);
    }
    list = list.slice(0, 15);
    if (!list.length) {
        el.innerHTML = '<p class="text-muted">該產業無符合條件的個股</p>';
        return;
    }
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr>
                <th>個股</th><th>產業</th><th>千張以上 %</th><th>散戶 %</th><th>大戶 Δ</th><th>流動性</th><th>訊號</th><th>分數</th><th>今日</th>
            </tr></thead>
            <tbody>${list.map((s, i) => {
                const signalColor = {
                    'strong_accumulation': '#ef4444',
                    'accumulation':        '#fbbf24',
                    'distribution':        '#22c55e',
                    'retail_pileup':       '#9ca3af',
                }[s.signal] || '#71717a';
                const signalLabel = {
                    'strong_accumulation': '🐳 強吸',
                    'accumulation':        '🐟 加碼',
                    'distribution':        '📤 派發',
                    'retail_pileup':       '⚠️ 散戶堆積',
                    'neutral':             '中性',
                }[s.signal] || (s.signal || '—');
                const wd = (s.whale_delta || 0);
                const wdColor = wd > 0 ? 'text-positive' : wd < 0 ? 'text-negative' : '';
                const cpCls = (s.change_pct || 0) >= 0 ? 'text-positive' : 'text-negative';
                const cpSign = (s.change_pct || 0) >= 0 ? '+' : '';
                // 流動性：當日成交量（張）
                const vol = s.volume || 0;
                const lots = Math.round(vol / 1000);
                let volLabel, volColor;
                if (lots >= 5000)      { volLabel = (lots/1000).toFixed(1) + '萬張'; volColor = '#22c55e'; }
                else if (lots >= 1000) { volLabel = lots.toLocaleString() + '張'; volColor = '#fbbf24'; }
                else if (lots >= 100)  { volLabel = lots + '張'; volColor = '#f59e0b'; }
                else                   { volLabel = lots + '張 ⚠️'; volColor = '#ef4444'; }
                return `<tr>
                    <td>${i+1}. <b>${s.name || s.code}</b> <span class="text-muted">${s.code}</span></td>
                    <td style="font-size:0.8rem;">${s.industry || '—'}</td>
                    <td><b>${s.mega_whale_pct}%</b></td>
                    <td>${s.retail_pct}%</td>
                    <td class="${wdColor}">${wd >= 0 ? '+' : ''}${wd}%</td>
                    <td style="color:${volColor};font-size:0.85rem;">${volLabel}</td>
                    <td><span style="color:${signalColor};font-weight:700;">${signalLabel}</span></td>
                    <td>${s.score}</td>
                    <td class="${cpCls}">${cpSign}${(s.change_pct || 0).toFixed(2)}%</td>
                </tr>`;
            }).join('')}</tbody>
        </table>
        <p class="text-muted" style="font-size:0.75rem;margin-top:0.5rem;">
            💡 真正的「殭屍股」= 大戶 % 高 <b>且</b> 流動性差，不是只看大戶 %<br>
            🔒 流動性分級閘：&lt; 500 張 ❌ / 70%+ 需 1000 張 / 85%+ 需 3000 張<br>
            ✨ 流動性好的高大戶 %（如台積電 80%+ 但日成交幾十萬張）會上榜
        </p>
    `;
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
    const fmtDelta = (v) => {
        if (v === null || v === undefined) return '-';
        const n = Number(v);
        return (n >= 0 ? '+' : '') + n.toFixed(2) + ' pp';
    };
    const sigBadge = (sig) => {
        if (sig === 'strong_accumulation') return '<span class="badge-hot">🔥強集</span>';
        if (sig === 'accumulation') return '<span class="badge-streak">📈集中</span>';
        return '';
    };
    const rows = list.map((x, i) => `
        <tr>
            <td>${i+1}</td>
            <td><b>${x.code}</b> ${sigBadge(x.signal)}<br><span class="text-muted" style="font-size:0.75rem;">${x.name||'-'}${x.industry?' · '+x.industry:''}</span></td>
            <td class="num ${changeClass(x.mega_whale_delta)}">${fmtDelta(x.mega_whale_delta)}</td>
            <td class="num ${changeClass(x.whale_delta)}">${fmtDelta(x.whale_delta)}</td>
            <td class="num">${x.mega_whale_pct ? x.mega_whale_pct.toFixed(1)+'%' : '-'}</td>
            <td><button class="add-btn" onclick="addToWatchlist('${x.symbol}')">＋</button></td>
        </tr>
    `).join('');
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr>
                <th>#</th><th>代號 / 名稱</th>
                <th class="num" title="千張大戶一週變化（更具代表性）">千張 Δ</th>
                <th class="num" title="100 張以上大戶一週變化">大戶 Δ</th>
                <th class="num">千張占比</th>
                <th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// ========== 異常買盤警示 ==========

function renderSuspicious(list) {
    const card = document.getElementById('suspiciousCard');
    const el = document.getElementById('suspiciousContent');
    if (!card || !el) return;
    if (!list || list.length === 0) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    const rows = list.map((x, i) => {
        const netBuy = x.foreign || x.total || 0;
        return `
            <tr>
                <td>${i+1}</td>
                <td><b>${x.code}</b><br><span class="text-muted" style="font-size:0.75rem;">${x.name||'-'}</span></td>
                <td class="num text-positive">+${fmtShares(netBuy)}</td>
                <td class="num text-negative"><b>${fmtPct(x.change_pct)}</b></td>
                <td><span class="badge-fake">${x.anomaly_type||'異常'}</span></td>
                <td><button class="add-btn" onclick="addToWatchlist('${x.symbol||x.code+'.TW'}')" style="opacity:0.5;" title="不建議加入">＋</button></td>
            </tr>`;
    }).join('');
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr><th>#</th><th>代號 / 名稱</th><th class="num">法人買超</th><th class="num">當日漲跌</th><th>類型</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <p class="scout-meta" style="margin-top:0.6rem;">💡 判讀：跌越多 + 買越大 = 越可疑。建議搭配融券餘額 / 期貨未平倉量交叉驗證。</p>`;
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
        html += items.map(x => {
            const sym = x.code + '.TW';
            const nm = (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym]) || '';
            return `<span style="margin-right:0.7rem;">${x.code}${nm?' '+nm:''}<span class="badge-streak">${x.streak} 天</span></span>`;
        }).join('');
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

    const items = (data.picks || []).map(p => {
        const sym = p.symbol || '';
        // 名稱優先順序：AI 回的 name > stock_names.js 對照 > 純代號
        const name = p.name
            || (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym])
            || sym.replace(/\.(TW|TWO)$/, '');
        return `
        <div class="ai-pick-item">
            <div class="sym">${sym} <b style="color:#fff;">${name}</b> <span class="cat">${p.category||''}</span></div>
            <div class="reason">${p.reason||''}</div>
            <button class="add-btn" style="margin-top:0.4rem;" onclick="addToWatchlist('${sym}')">加入自選股</button>
        </div>`;
    }).join('');

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
