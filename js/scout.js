// scout.js — 市場雷達前端
// 讀 data/scout_radar.json + data/ai_picked_watchlist.json

let _radar = null;

document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([loadRadar(), loadAiPick(), loadMomentum()]);
});

// v11.14.14：日/週/月 強勢股
let _momentumData = null;
let _momentumMarket = 'tw';
let _momentumPeriod = 'week';

async function loadMomentum() {
    try {
        const r = await fetch('data/momentum_rankings.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('no momentum_rankings.json');
        _momentumData = await r.json();
        renderMomentumTabs();
        renderMomentumTable();
    } catch (e) {
        const el = document.getElementById('momentumTable');
        if (el) el.innerHTML = '<p class="text-muted">強勢股資料尚未產生（盤後 14:40 / 18:10 才會跑）</p>';
    }
}

function renderMomentumTabs() {
    const mkTab = (label, val, active, currentVal) => `
        <button class="mom-tab ${val === currentVal ? 'active' : ''}" data-val="${val}"
                style="padding:0.4rem 0.9rem;background:${val === currentVal ? 'linear-gradient(135deg,#ef4444,#fbbf24)' : 'rgba(255,255,255,0.05)'};
                       border:1px solid ${val === currentVal ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.12)'};
                       color:${val === currentVal ? '#fff' : '#aaa'};
                       border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:${val === currentVal ? '700' : '500'};">
            ${label}
        </button>`;
    const mEl = document.getElementById('momentumMarketTabs');
    if (mEl) {
        mEl.innerHTML = [
            mkTab('🇹🇼 台股', 'tw', true, _momentumMarket),
            mkTab('🇺🇸 美股', 'us', true, _momentumMarket),
        ].join('');
        mEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
            _momentumMarket = b.dataset.val;
            renderMomentumTabs();
            renderMomentumTable();
        }));
    }
    const pEl = document.getElementById('momentumPeriodTabs');
    if (pEl) {
        pEl.innerHTML = [
            mkTab('日', 'day', true, _momentumPeriod),
            mkTab('週', 'week', true, _momentumPeriod),
            mkTab('月', 'month', true, _momentumPeriod),
        ].join('');
        pEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
            _momentumPeriod = b.dataset.val;
            renderMomentumTabs();
            renderMomentumTable();
        }));
    }
}

function renderMomentumTable() {
    const el = document.getElementById('momentumTable');
    if (!el || !_momentumData) return;
    const sec = _momentumData[_momentumMarket] || {};
    const list = sec[_momentumPeriod] || [];
    if (!list.length) {
        el.innerHTML = '<p class="text-muted">無資料</p>';
        return;
    }
    const periodLabel = { day: '日漲幅', week: '週漲幅(5d)', month: '月漲幅(20d)' }[_momentumPeriod];
    const rows = list.slice(0, 20).map((s, i) => {
        const pctCls = s.pct >= 0 ? 'text-positive' : 'text-negative';
        const sign = s.pct >= 0 ? '+' : '';
        const isUS = _momentumMarket === 'us';
        // v11.14.15：用前端 getChineseName 查中文，後端只給 code 就好
        let displayName = s.name || '';
        if (!isUS && typeof getChineseName === 'function') {
            const cn = getChineseName(s.symbol, s.name);
            if (cn && cn !== s.code) displayName = cn;
        }
        if (displayName === s.code) displayName = '';   // 避免重複顯示 code
        return `<tr>
            <td>${i+1}</td>
            <td><b>${s.code}</b>${displayName ? `<br><span class="text-muted" style="font-size:0.75rem;">${displayName}</span>` : ''}</td>
            <td class="num">${s.close ?? '-'}</td>
            <td class="num ${pctCls}"><b>${sign}${(s.pct || 0).toFixed(2)}%</b></td>
            <td>${!isUS ? `<button class="add-btn" onclick="addToWatchlist('${s.symbol}')">＋</button>` : ''}</td>
        </tr>`;
    }).join('');
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr><th>#</th><th>代號 / 名稱</th><th class="num">收盤</th><th class="num">${periodLabel}</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <p class="text-muted" style="font-size:0.75rem;margin-top:0.5rem;">
            📅 資料：${_momentumData.fetched_at || '-'}　·　Top 20　·　台股盤後 14:40 / 18:10 更新
        </p>
    `;
}

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
    // v11.14.4：偵測資料過期（>= 1 個交易日未更新），顯眼警示避免用戶誤把舊資料當今天
    const staleHtml = (() => {
        try {
            const ds = String(d.date || '');
            if (ds.length !== 8) return '';
            const dataDate = new Date(`${ds.slice(0,4)}-${ds.slice(4,6)}-${ds.slice(6,8)}T13:30:00+08:00`);
            const now = new Date();
            const hoursOld = (now - dataDate) / 3600000;
            // 超過 26 小時（容許跨日 + 收盤後 workflow 延遲）
            if (hoursOld > 26) {
                const days = Math.floor(hoursOld / 24);
                return `<div style="background:rgba(255,165,2,0.15);border:1px solid rgba(255,165,2,0.4);padding:0.6rem 0.9rem;border-radius:8px;margin:0.6rem 0;color:#ffa502;font-size:0.85rem;">
                    ⚠️ <b>資料已 ${days} 天未更新</b> — 你看到的數字是 ${formatDate(d.date)} 收盤資料，不是今天。建議等 workflow 跑完再回來看。
                </div>`;
            }
        } catch {}
        return '';
    })();
    document.getElementById('scoutMeta').innerHTML =
        `📅 資料日期：<b>${formatDate(d.date)}</b> &nbsp;·&nbsp; 掃描時間：${d.fetched_at || '-'}${staleHtml}`;

    renderSuspicious(d.suspicious_buy_top || []);
    renderRecurring(d.recurring_3d || {});
    renderGoldenCross(d.golden_cross_top || []);   // v12.1：黃金交叉雙料股

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
let _bigHolderCutoff = 1000;   // v11.14.14：預設 1000 張
let _bigHolderIndustry = 'all';

// v11.14.14：張數 → bucket index 對照
//   200 張+ = bucket 11~15 ; 400 張+ = 12~15 ; 600 張+ = 13~15
//   800 張+ = 14~15        ; 1000 張+ = 15
const CUTOFF_BUCKETS = {
    200:  ['11', '12', '13', '14', '15'],
    400:  ['12', '13', '14', '15'],
    600:  ['13', '14', '15'],
    800:  ['14', '15'],
    1000: ['15'],
};

function _sumBuckets(buckets, keys) {
    if (!buckets) return 0;
    let s = 0;
    for (const k of keys) {
        const v = Number(buckets[k] || 0);
        if (!isNaN(v)) s += v;
    }
    return s;
}

function renderBigHolderTop(list) {
    _bigHolderData = list || [];
    const el = document.getElementById('bigHolderTable');
    if (!el) return;
    if (!_bigHolderData.length) {
        el.innerHTML = '<p class="text-muted">無資料（TDCC 每週五更新）</p>';
        return;
    }
    _renderSectorFilter('bigHolderFilter', _bigHolderData, 'whale');
    _renderBigHolderCutoffTabs();
    _drawBigHolderTable(_bigHolderIndustry);
}

// v11.14.14：張數切換 tabs
function _renderBigHolderCutoffTabs() {
    let tabEl = document.getElementById('bigHolderCutoffTabs');
    if (!tabEl) {
        const filterEl = document.getElementById('bigHolderFilter');
        if (!filterEl) return;
        tabEl = document.createElement('div');
        tabEl.id = 'bigHolderCutoffTabs';
        tabEl.style.cssText = 'display:flex;gap:0.4rem;margin:0.5rem 0;flex-wrap:wrap;';
        filterEl.parentNode.insertBefore(tabEl, filterEl.nextSibling);
    }
    const tabs = [200, 400, 600, 800, 1000];
    tabEl.innerHTML = tabs.map(t => `
        <button class="big-holder-cutoff-tab ${t === _bigHolderCutoff ? 'active' : ''}"
                data-cutoff="${t}"
                style="padding:0.4rem 0.9rem;background:${t === _bigHolderCutoff ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : 'rgba(255,255,255,0.05)'};
                       border:1px solid ${t === _bigHolderCutoff ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.12)'};
                       color:${t === _bigHolderCutoff ? '#000' : '#aaa'};
                       border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:${t === _bigHolderCutoff ? '700' : '500'};">
            ${t} 張+
        </button>
    `).join('');
    tabEl.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            _bigHolderCutoff = parseInt(b.dataset.cutoff, 10);
            _renderBigHolderCutoffTabs();
            _drawBigHolderTable(_bigHolderIndustry);
        });
    });
}

function _drawBigHolderTable(filterIndustry) {
    _bigHolderIndustry = filterIndustry || 'all';
    const el = document.getElementById('bigHolderTable');
    let list = _bigHolderData.slice();
    if (filterIndustry && filterIndustry !== 'all') {
        list = list.filter(s => s.industry === filterIndustry);
    }

    // v11.14.14：依當前 cutoff 重算 pct 與 delta，並重新排序
    const keys = CUTOFF_BUCKETS[_bigHolderCutoff] || CUTOFF_BUCKETS[1000];
    list = list.map(s => {
        const curPct = s.buckets ? _sumBuckets(s.buckets, keys) : (s.mega_whale_pct || 0);
        const prevPct = s.prev_buckets ? _sumBuckets(s.prev_buckets, keys) : null;
        const delta = (prevPct != null) ? (curPct - prevPct) : null;
        return { ...s, _cur_pct: curPct, _prev_pct: prevPct, _delta: delta };
    });

    // 排序：以「該 cutoff 下大戶 % + delta 加分」綜合
    list.sort((a, b) => {
        const sa = (a._cur_pct || 0) + (a._delta || 0) * 5;
        const sb = (b._cur_pct || 0) + (b._delta || 0) * 5;
        return sb - sa;
    });

    list = list.slice(0, 15);
    if (!list.length) {
        el.innerHTML = '<p class="text-muted">該產業無符合條件的個股</p>';
        return;
    }
    const cutoffLabel = `${_bigHolderCutoff} 張+`;

    el.innerHTML = `
        <table class="scout-table">
            <thead><tr>
                <th>個股</th><th>產業</th><th>${cutoffLabel} %</th><th>變化</th><th>散戶 %</th><th>流動性</th><th>訊號</th><th>今日</th>
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
                const cur = s._cur_pct.toFixed(2);
                const delta = s._delta;
                let deltaHtml = '<span class="text-muted">—</span>';
                if (delta != null) {
                    const dCls = delta > 0 ? 'text-positive' : delta < 0 ? 'text-negative' : '';
                    const dSign = delta >= 0 ? '+' : '';
                    deltaHtml = `<span class="${dCls}"><b>${dSign}${delta.toFixed(2)}pp</b></span>`;
                    if (s._prev_pct != null) {
                        deltaHtml = `<span style="font-size:0.72rem;color:#888;">${s._prev_pct.toFixed(1)} → ${cur}</span><br>${deltaHtml}`;
                    }
                }
                const cpCls = (s.change_pct || 0) >= 0 ? 'text-positive' : 'text-negative';
                const cpSign = (s.change_pct || 0) >= 0 ? '+' : '';
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
                    <td><b>${cur}%</b></td>
                    <td>${deltaHtml}</td>
                    <td>${s.retail_pct}%</td>
                    <td style="color:${volColor};font-size:0.85rem;">${volLabel}</td>
                    <td><span style="color:${signalColor};font-weight:700;">${signalLabel}</span></td>
                    <td class="${cpCls}">${cpSign}${(s.change_pct || 0).toFixed(2)}%</td>
                </tr>`;
            }).join('')}</tbody>
        </table>
        <p class="text-muted" style="font-size:0.75rem;margin-top:0.5rem;">
            💡 切換上方按鈕看「不同等級大戶」的籌碼分布。<br>
            🔒 流動性分級閘：&lt; 500 張 ❌ / 70%+ 需 1000 張 / 85%+ 需 3000 張<br>
            ✨ pp = 百分點（percentage points），與上週 TDCC 快照的差。
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

// ========== v12.1：黃金交叉雙料股（大戶布局 ∩ 月營收 YoY） ==========
function renderGoldenCross(list) {
    const card = document.getElementById('goldenCrossCard');
    const el = document.getElementById('goldenCrossContent');
    if (!card || !el) return;
    if (!list || list.length === 0) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    const rows = list.slice(0, 10).map((s, i) => {
        const cpCls = (s.change_pct || 0) >= 0 ? 'text-positive' : 'text-negative';
        const cpSign = (s.change_pct || 0) >= 0 ? '+' : '';
        const yoy = s.yoy_pct;
        const yoyCls = yoy >= 50 ? 'text-positive' : '';
        const mwDelta = s.mega_whale_delta;
        const mwDeltaStr = mwDelta != null ? `${mwDelta >= 0 ? '+' : ''}${mwDelta.toFixed(2)}pp` : '-';
        return `<tr>
            <td>${i+1}</td>
            <td><b>${s.code}</b><br><span class="text-muted" style="font-size:0.75rem;">${s.name||''}${s.industry?' · '+s.industry:''}</span></td>
            <td class="num">${s.close ?? '-'}</td>
            <td class="num ${cpCls}"><b>${cpSign}${(s.change_pct || 0).toFixed(2)}%</b></td>
            <td class="num"><b>${s.mega_whale_pct ?? '-'}%</b><br><span style="font-size:0.7rem;color:#fbbf24;">${mwDeltaStr}</span></td>
            <td class="num ${yoyCls}"><b>${yoy ?? '-'}%</b></td>
            <td class="num text-muted" style="font-size:0.75rem;">${s.cumulative_yoy_pct ?? '-'}%</td>
            <td><button class="add-btn" onclick="addToWatchlist('${s.code}.TW')">＋ 自選</button></td>
        </tr>`;
    }).join('');
    el.innerHTML = `
        <table class="scout-table">
            <thead><tr>
                <th>#</th><th>代號 / 產業</th><th class="num">收盤</th><th class="num">當日</th>
                <th class="num">千張+%<br><span style="font-weight:normal;font-size:0.7rem;">(週Δ)</span></th>
                <th class="num">月YoY</th>
                <th class="num">累計YoY</th>
                <th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <p class="text-muted" style="font-size:0.75rem;margin-top:0.5rem;">
            💡 這些是<b>同時</b>滿足「大戶布局加碼」+「月營收年增正成長」的稀有標的（通常不到 5 檔）。<br>
            🎯 可以在 AI 助手問：「黃金交叉雙料股有哪些值得追？」AI 會優先從這份清單推薦。
        </p>
    `;
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
            <button class="add-btn" style="margin-top:0.4rem;cursor:pointer;" onclick="addToWatchlist('${sym}', this)">加入自選股</button>
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

// v12.2.8：加 console.log + 按鈕視覺反饋（用戶回報「沒反應」可能是 toast 沒看到）
window.addToWatchlist = async function (symbol, btnEl) {
    console.log('[scout] addToWatchlist 觸發:', symbol);
    if (!symbol) {
        alert('⚠️ symbol 是空的，請通知開發者');
        return;
    }
    let full = symbol;
    if (!/\.(TW|TWO)$/i.test(full)) full = full + '.TW';

    const group = localStorage.getItem('tw_stock_current_group') || 'default';
    const key = 'tw_stock_watchlist_' + group;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key)) || []; } catch {}

    // 按鈕視覺反饋（不管後續結果先閃一下）
    if (btnEl) {
        const orig = btnEl.textContent;
        btnEl.style.background = '#22c55e';
        btnEl.style.color = '#000';
        btnEl.textContent = '✓ 已加入';
        setTimeout(() => {
            btnEl.style.background = '';
            btnEl.style.color = '';
            btnEl.textContent = orig;
        }, 1500);
    }

    if (list.includes(full)) {
        _scoutToast(`「${full}」已在自選股清單裡`, 'info');
        console.log('[scout] 重複加入:', full);
        return;
    }
    // 1. 寫進當前 group
    list.push(full);
    localStorage.setItem(key, JSON.stringify(list));
    console.log('[scout] 已寫入 localStorage', key, '→', list.length, '檔');

    // 2. 寫進待新增佇列（給雲端同步用戶當 inbox）
    const QKEY = 'tw_stock_pending_adds';
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem(QKEY)) || []; } catch {}
    if (!queue.find(it => it.symbol === full && it.group === group)) {
        queue.push({ symbol: full, group, added_at: new Date().toISOString() });
        localStorage.setItem(QKEY, JSON.stringify(queue));
        console.log('[scout] 已加入佇列', QKEY, '→', queue.length, '項');
    }
    _scoutToast(`✅ 已加入「${full}」到自選股`, 'success');
};

function _scoutToast(txt, type) {
    const bg = type === 'success' ? 'rgba(34,197,94,0.95)'
             : type === 'info' ? 'rgba(120,80,255,0.95)'
             : 'rgba(239,68,68,0.95)';
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%) translateY(-20px);
        background:${bg};color:#fff;padding:0.7rem 1.3rem;border-radius:10px;
        box-shadow:0 8px 30px rgba(0,0,0,0.4);z-index:99999;font-weight:600;font-size:0.9rem;
        opacity:0;transition:all 0.25s;`;
    t.textContent = txt;
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(-20px)'; }, 2200);
    setTimeout(() => t.remove(), 2600);
}
