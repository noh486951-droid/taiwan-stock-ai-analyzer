/**
 * v10.8 虛擬投資頁面
 * 依賴：watchlist.js 的 CLOUD_SYNC_KEY + WORKER_URL 機制
 * 資料流：
 *   GET  /api/paper-trade?uid=xxx&token=xxx[&pw=xxx]  讀取帳簿
 *   POST /api/paper-trade                             寫入設定或重置（owner token / 密碼驗證）
 *   決策由 GH Actions scripts/paper_trade_engine.py 執行
 */

const PT_WORKER_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';
const CLOUD_SYNC_KEY = 'tw_stock_cloud_uid';
const CLOUD_TOKEN_KEY = 'tw_stock_cloud_token';  // watchlist.js 未顯式導出，我們共用同一 key
const POLL_INTERVAL = 30000;   // 每 30 秒重新拉一次 KV

let _uid = null;
let _token = null;
let _accessPw = null;          // 記憶體中暫存的存取密碼（跨裝置解鎖後使用）
let _portfolio = null;
let _pollTimer = null;
let _watchlistAnalysis = null;
let _lockedHasPassword = false; // 後端告知此帳號已啟用密碼但尚未通過驗證

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    _uid = localStorage.getItem(CLOUD_SYNC_KEY) || '';
    _token = localStorage.getItem(CLOUD_TOKEN_KEY) || '';

    // 同步載入 watchlist 分析（用於即時現價）
    fetch('data/watchlist_analysis.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
        .then(d => { _watchlistAnalysis = d; renderIfReady(); })
        .catch(() => {});

    if (!_uid) {
        document.getElementById('ptLoginCard').style.display = 'block';
        document.getElementById('ptLoginMsg').textContent = '偵測不到登入狀態';
        return;
    }

    document.getElementById('ptResetBtn').addEventListener('click', resetAccount);
    document.getElementById('ptConsultBtn').addEventListener('click', consultAiAboutPortfolio);
    document.getElementById('ptStartBtn').addEventListener('click', startAccount);
    document.getElementById('ptAutoToggle').addEventListener('change', onAutoToggle);
    document.getElementById('ptSaveSettingsBtn').addEventListener('click', saveSettings);
    document.getElementById('ptUnlockBtn').addEventListener('click', unlockWithPassword);
    document.getElementById('ptAccessPw').addEventListener('keydown', e => {
        if (e.key === 'Enter') unlockWithPassword();
    });

    await loadPortfolio();

    // 啟動輪詢
    _pollTimer = setInterval(loadPortfolio, POLL_INTERVAL);
}

// ============================================================
// KV 同步
// ============================================================

async function loadPortfolio() {
    try {
        const params = new URLSearchParams({ uid: _uid });
        if (_token) params.set('token', _token);
        if (_accessPw) params.set('pw', _accessPw);
        const r = await fetch(`${PT_WORKER_URL}/api/paper-trade?${params.toString()}`);
        const data = await r.json();

        if (r.status === 403 && data.error === 'PASSWORD_REQUIRED') {
            // 此帳號已啟用密碼但尚未通過
            _lockedHasPassword = true;
            _portfolio = null;
            showLocked();
            return;
        }
        if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);

        _lockedHasPassword = false;
        _portfolio = data;

        // 若是透過密碼解鎖，後端會順便回傳 owner_token 讓我們快取
        if (data._issued_token) {
            _token = data._issued_token;
            localStorage.setItem(CLOUD_TOKEN_KEY, _token);
        }
        render();
    } catch (e) {
        console.error('Load portfolio failed', e);
    }
}

function showLocked() {
    document.getElementById('ptLoginCard').style.display = 'none';
    document.getElementById('ptInitCard').style.display = 'none';
    document.getElementById('ptPasswordCard').style.display = 'block';
    ['ptOverviewCard', 'ptPositionsCard', 'ptStatsCard', 'ptHistoryCard', 'ptSettingsCard']
        .forEach(id => document.getElementById(id).style.display = 'none');
}

async function unlockWithPassword() {
    const pw = document.getElementById('ptAccessPw').value.trim();
    if (!pw) {
        document.getElementById('ptPasswordMsg').textContent = '請輸入密碼';
        return;
    }
    _accessPw = pw;
    document.getElementById('ptPasswordMsg').textContent = '驗證中...';
    await loadPortfolio();
    if (_lockedHasPassword) {
        // 驗證失敗
        _accessPw = null;
        document.getElementById('ptPasswordMsg').textContent = '❌ 密碼錯誤，請再試一次';
    } else {
        document.getElementById('ptPasswordCard').style.display = 'none';
    }
}

async function postPortfolio(patch) {
    const body = { uid: _uid, token: _token, ...patch };
    if (_accessPw) body.access_password = _accessPw;
    const r = await fetch(`${PT_WORKER_URL}/api/paper-trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${r.status}`);
    }
    const data = await r.json();
    if (data.token && !_token) {
        _token = data.token;
        localStorage.setItem(CLOUD_TOKEN_KEY, _token);
    }
    return data;
}

// ============================================================
// 使用者動作
// ============================================================

async function startAccount() {
    const pwInput = document.getElementById('ptInitPw');
    const pw = pwInput.value.trim();
    if (!pw) {
        alert('請先輸入存取密碼（會用於跨裝置登入驗證）');
        pwInput.focus();
        return;
    }
    if (pw.length < 4) {
        alert('密碼至少 4 個字元');
        return;
    }

    const btn = document.getElementById('ptStartBtn');
    btn.disabled = true;
    btn.textContent = '啟動中...';
    try {
        // 第一次 POST 會在 KV 建立 entry，並帶 owner_token + access_password_hash
        await postPortfolio({
            settings: {
                initial_capital: 1000000,
                max_positions: 5,
                per_position_cap: 200000,
                confidence_threshold: 80,
                cooldown_trading_days: 5,
                min_hold_trading_days: 3,
                stale_exit_trading_days: 10,
                daily_entry_limit: 3,
                auto_trade: false,   // 預設關閉，使用者需主動打開「自動交易」開關
            },
            set_access_password: pw,
        });
        _accessPw = pw;  // 暫存當前會話，省下首次刷新重輸
        await loadPortfolio();
        alert('✅ 虛擬投資帳戶已啟動！\n\n🔒 存取密碼已設定，下次換裝置登入需要輸入此密碼。\n⚠️ 自動交易預設「關閉」，請在總覽頁手動打開右上角「自動交易」開關，AI 才會實際下單。');
    } catch (e) {
        alert('啟動失敗：' + e.message);
        btn.disabled = false;
        btn.textContent = '🚀 啟動虛擬投資帳戶';
    }
}

async function resetAccount() {
    if (!confirm('確定要重置帳戶嗎？\n所有持倉和歷史交易將全部清空，現金歸零回 100 萬。\n（存取密碼會保留）')) return;
    try {
        await postPortfolio({ reset: true });
        await loadPortfolio();
        alert('✅ 帳戶已重置');
    } catch (e) {
        alert('重置失敗：' + e.message);
    }
}

async function onAutoToggle(e) {
    try {
        await postPortfolio({ settings: { auto_trade: e.target.checked } });
        _portfolio.settings.auto_trade = e.target.checked;
    } catch (err) {
        alert('設定失敗：' + err.message);
        e.target.checked = !e.target.checked;
    }
}

async function saveSettings() {
    const s = {
        confidence_threshold: +document.getElementById('setConfThreshold').value,
        max_positions: +document.getElementById('setMaxPositions').value,
        per_position_cap: +document.getElementById('setPerCap').value,
        cooldown_trading_days: +document.getElementById('setCooldown').value,
        min_hold_trading_days: +document.getElementById('setMinHold').value,
        stale_exit_trading_days: +document.getElementById('setStaleExit').value,
        daily_entry_limit: +document.getElementById('setDailyEntry').value,
    };
    const patch = { settings: s };
    const newPw = document.getElementById('setAccessPw').value;
    if (newPw) {
        if (newPw === 'CLEAR') {
            if (!confirm('確定要解除密碼保護嗎？之後任何人知道你的暱稱都可以讀取此帳簿。')) return;
            patch.set_access_password = '';
        } else if (newPw.length < 4) {
            alert('新密碼至少 4 個字元');
            return;
        } else {
            patch.set_access_password = newPw;
        }
    }
    try {
        await postPortfolio(patch);
        if (patch.set_access_password !== undefined) {
            _accessPw = patch.set_access_password || null;
        }
        document.getElementById('setAccessPw').value = '';
        await loadPortfolio();
        alert('✅ 設定已儲存');
    } catch (e) {
        alert('儲存失敗：' + e.message);
    }
}

// ============================================================
// 渲染
// ============================================================

function renderIfReady() { if (_portfolio) render(); }

function render() {
    if (!_portfolio) return;
    // 以後端明確的 initialized 旗標判定是否已開戶
    const hasAccount = _portfolio.initialized === true;

    document.getElementById('ptLoginCard').style.display = 'none';
    document.getElementById('ptPasswordCard').style.display = 'none';
    document.getElementById('ptInitCard').style.display = hasAccount ? 'none' : 'block';

    ['ptOverviewCard', 'ptPositionsCard', 'ptStatsCard', 'ptHistoryCard', 'ptSettingsCard']
        .forEach(id => document.getElementById(id).style.display = hasAccount ? 'block' : 'none');

    if (!hasAccount) return;

    renderOverview();
    renderPositions();
    renderStats();
    renderHistory();
    renderSettings();
}

function _currentPrice(sym) {
    const stocks = _watchlistAnalysis?.stocks || {};
    return stocks[sym]?.price;
}
function _aiFor(sym) {
    const stocks = _watchlistAnalysis?.stocks || {};
    return stocks[sym]?.ai_analysis;
}
function _fmtMoney(n) {
    if (n == null) return '—';
    return new Intl.NumberFormat('zh-TW').format(Math.round(n));
}
function _fmtPct(n) {
    if (n == null) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}
function _clsPct(n) { return n > 0 ? 'text-positive' : n < 0 ? 'text-negative' : ''; }

function renderOverview() {
    const p = _portfolio;
    const positions = p.positions || {};
    let marketValue = 0;
    let unrealized = 0;
    for (const [sym, pos] of Object.entries(positions)) {
        const cur = _currentPrice(sym) ?? pos.entry_price;
        const mv = cur * pos.shares;
        marketValue += mv;
        unrealized += (mv - pos.entry_cost);
    }
    const totalAsset = p.cash + marketValue;
    const initial = p.settings?.initial_capital || 1000000;
    const totalReturn = totalAsset - initial;
    const totalReturnPct = totalReturn / initial * 100;
    const history = p.history || [];
    const wins = history.filter(h => h.pnl > 0).length;
    const winRate = history.length ? (wins / history.length * 100) : 0;

    const realized = p.stats?.total_pnl || 0;

    document.getElementById('ptOverviewGrid').innerHTML = `
        <div class="pt-stat">
            <div class="pt-stat-label">總資產</div>
            <div class="pt-stat-value ${_clsPct(totalReturn)}">${_fmtMoney(totalAsset)}</div>
            <div class="pt-stat-sub ${_clsPct(totalReturn)}">${_fmtPct(totalReturnPct)} (${_fmtMoney(totalReturn)})</div>
        </div>
        <div class="pt-stat">
            <div class="pt-stat-label">現金</div>
            <div class="pt-stat-value">${_fmtMoney(p.cash)}</div>
        </div>
        <div class="pt-stat">
            <div class="pt-stat-label">持倉市值</div>
            <div class="pt-stat-value">${_fmtMoney(marketValue)}</div>
            <div class="pt-stat-sub ${_clsPct(unrealized)}">未實現 ${_fmtMoney(unrealized)}</div>
        </div>
        <div class="pt-stat">
            <div class="pt-stat-label">已實現損益</div>
            <div class="pt-stat-value ${_clsPct(realized)}">${_fmtMoney(realized)}</div>
        </div>
        <div class="pt-stat">
            <div class="pt-stat-label">勝率</div>
            <div class="pt-stat-value">${winRate.toFixed(1)}%</div>
            <div class="pt-stat-sub">${wins} 勝 / ${history.length - wins} 負</div>
        </div>
        <div class="pt-stat">
            <div class="pt-stat-label">交易次數</div>
            <div class="pt-stat-value">${history.length}</div>
        </div>
    `;

    document.getElementById('ptAutoToggle').checked = !!p.settings?.auto_trade;
    const eng = p.engine_updated_at ? new Date(p.engine_updated_at).toLocaleString('zh-TW') : '尚未執行';
    const pwFlag = p.has_password ? ' · 🔒 已啟用密碼' : ' · 🔓 未設密碼';
    const status = p.last_engine_status || null;
    const statusLine = status
        ? `<br><span style="font-size:0.85rem;color:var(--text-muted);">📋 ${status.summary}｜${status.reason_zh}</span>`
        : '';
    document.getElementById('ptEngineStatus').innerHTML = `🤖 AI 引擎上次執行：${eng}${pwFlag}${statusLine}`;
}

function renderPositions() {
    const p = _portfolio;
    const positions = p.positions || {};
    const keys = Object.keys(positions);
    document.getElementById('ptPositionsCount').textContent = `(${keys.length}/${p.settings?.max_positions || 5})`;
    const container = document.getElementById('ptPositionsList');
    if (keys.length === 0) {
        container.innerHTML = '<p class="text-muted">目前無持倉 — AI 正在等待符合條件的訊號。</p>';
        return;
    }
    container.innerHTML = keys.map(sym => {
        const pos = positions[sym];
        const cur = _currentPrice(sym) ?? pos.entry_price;
        const mv = cur * pos.shares;
        const pnl = mv - pos.entry_cost;
        const pnlPct = pnl / pos.entry_cost * 100;
        const ai = _aiFor(sym);
        const currentVerdict = ai?.verdict || '—';
        const verdictCls = currentVerdict === 'Bullish' ? 'verdict-bullish'
                         : currentVerdict === 'Bearish' ? 'verdict-bearish' : 'verdict-neutral';
        const name = pos.name
            || (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym])
            || (typeof STOCK_NAMES !== 'undefined' && STOCK_NAMES[sym])
            || sym;
        return `
        <div class="pt-position-row ${pnl >= 0 ? 'pos-up' : 'pos-down'}">
            <div class="pt-pos-header">
                <div>
                    <b>${name}</b> <span class="text-muted">${sym}</span>
                    <span class="${verdictCls}" style="margin-left:0.5rem;">AI: ${currentVerdict}</span>
                </div>
                <div class="${_clsPct(pnl)}">
                    <b>${_fmtPct(pnlPct)}</b> (${_fmtMoney(pnl)})
                </div>
            </div>
            <div class="pt-pos-grid">
                <div>張數<br><b>${pos.shares / 1000}</b> 張</div>
                <div>進場價<br><b>${pos.entry_price}</b></div>
                <div>現價<br><b>${cur}</b></div>
                <div>目標<br><b class="text-positive">${pos.target_price ?? '—'}</b></div>
                <div>停損<br><b class="text-negative">${pos.stop_loss ?? '—'}</b></div>
                <div>持有<br><b>${_tradingDaysSince(pos.entry_date)}</b> 日</div>
            </div>
            <div class="pt-pos-meta">
                進場於 ${pos.entry_time || pos.entry_date} · 進場信心 ${pos.entry_confidence ?? '—'}% · 強度 ${pos.signal_strength || '—'}
            </div>
        </div>`;
    }).join('');
}

function _tradingDaysSince(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    const today = new Date();
    let n = 0;
    const tmp = new Date(d);
    while (tmp < today) {
        tmp.setDate(tmp.getDate() + 1);
        if (tmp.getDay() !== 0 && tmp.getDay() !== 6) n++;
    }
    return n;
}

function renderStats() {
    const history = _portfolio.history || [];
    // 信心度分級
    const confBuckets = {
        '95-100': [], '90-95': [], '85-90': [], '80-85': [], '<80': [],
    };
    for (const h of history) {
        const c = h.entry_confidence || 0;
        if (c >= 95) confBuckets['95-100'].push(h);
        else if (c >= 90) confBuckets['90-95'].push(h);
        else if (c >= 85) confBuckets['85-90'].push(h);
        else if (c >= 80) confBuckets['80-85'].push(h);
        else confBuckets['<80'].push(h);
    }
    document.getElementById('ptConfStats').innerHTML = _renderBucketTable(confBuckets, '信心度');

    // 訊號強度
    const strBuckets = { strong: [], normal: [], weak: [], unknown: [] };
    for (const h of history) {
        const s = h.signal_strength || 'unknown';
        (strBuckets[s] || strBuckets.unknown).push(h);
    }
    document.getElementById('ptSignalStats').innerHTML = _renderBucketTable(strBuckets, '強度');

    // 出場原因
    const exitBuckets = { target: [], stop: [], reversal: [], stale: [] };
    for (const h of history) {
        (exitBuckets[h.exit_reason] || (exitBuckets[h.exit_reason] = [])).push(h);
    }
    document.getElementById('ptExitStats').innerHTML = _renderExitTable(exitBuckets);
}

function _renderBucketTable(buckets, label) {
    const rows = Object.entries(buckets).map(([k, arr]) => {
        if (arr.length === 0) return `<tr><td>${k}</td><td class="text-muted">—</td><td class="text-muted">—</td><td class="text-muted">—</td></tr>`;
        const wins = arr.filter(h => h.pnl > 0).length;
        const winRate = (wins / arr.length * 100).toFixed(1);
        const avgPnl = arr.reduce((s, h) => s + h.pnl_pct, 0) / arr.length;
        const cls = winRate >= 60 ? 'text-positive' : winRate < 40 ? 'text-negative' : '';
        return `<tr>
            <td>${k}</td>
            <td>${arr.length}</td>
            <td class="${cls}"><b>${winRate}%</b> (${wins}/${arr.length})</td>
            <td class="${_clsPct(avgPnl)}">${_fmtPct(avgPnl)}</td>
        </tr>`;
    }).join('');
    return `<table class="pt-stats-tbl">
        <thead><tr><th>${label}</th><th>筆數</th><th>勝率</th><th>平均損益</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function _renderExitTable(buckets) {
    const labelMap = { target: '🎯 達標', stop: '🛑 停損', reversal: '🔄 反轉', stale: '⏰ 逾期' };
    const rows = Object.entries(buckets).map(([k, arr]) => {
        if (arr.length === 0) return '';
        const label = labelMap[k] || k;
        const wins = arr.filter(h => h.pnl > 0).length;
        const avgPnl = arr.reduce((s, h) => s + h.pnl_pct, 0) / arr.length;
        return `<tr>
            <td>${label}</td>
            <td>${arr.length}</td>
            <td>${wins}/${arr.length}</td>
            <td class="${_clsPct(avgPnl)}">${_fmtPct(avgPnl)}</td>
        </tr>`;
    }).join('');
    if (!rows) return '<p class="text-muted">尚無交易紀錄</p>';
    return `<table class="pt-stats-tbl">
        <thead><tr><th>原因</th><th>次數</th><th>賺/總</th><th>平均損益</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function renderHistory() {
    const history = [..._portfolio.history || []].reverse().slice(0, 50);
    const container = document.getElementById('ptHistoryList');
    if (history.length === 0) {
        container.innerHTML = '<p class="text-muted">尚無歷史交易</p>';
        return;
    }
    const reasonLabel = { target: '🎯達標', stop: '🛑停損', reversal: '🔄反轉', stale: '⏰逾期' };
    container.innerHTML = `
        <table class="pt-history-tbl">
            <thead><tr>
                <th>股票</th><th>進→出</th><th>持有</th><th>信心</th><th>原因</th><th>損益</th>
            </tr></thead>
            <tbody>
                ${history.map(h => `
                <tr class="${h.pnl >= 0 ? 'pos-up' : 'pos-down'}">
                    <td><b>${h.name || ''}</b><br><span class="text-muted">${h.sym}</span></td>
                    <td>${h.entry_price} → ${h.exit_price}<br><span class="text-muted">${h.entry_date?.slice(5)} → ${h.exit_date?.slice(5)}</span></td>
                    <td>${h.hold_days}日</td>
                    <td>${h.entry_confidence ?? '—'}%</td>
                    <td>${reasonLabel[h.exit_reason] || h.exit_reason}</td>
                    <td class="${_clsPct(h.pnl)}"><b>${_fmtPct(h.pnl_pct)}</b><br><span style="font-size:0.75rem;">${_fmtMoney(h.pnl)}</span></td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderSettings() {
    const s = _portfolio.settings || {};
    document.getElementById('setConfThreshold').value = s.confidence_threshold ?? 80;
    document.getElementById('setMaxPositions').value = s.max_positions ?? 5;
    document.getElementById('setPerCap').value = s.per_position_cap ?? 200000;
    document.getElementById('setCooldown').value = s.cooldown_trading_days ?? 5;
    document.getElementById('setMinHold').value = s.min_hold_trading_days ?? 3;
    document.getElementById('setStaleExit').value = s.stale_exit_trading_days ?? 10;
    document.getElementById('setDailyEntry').value = s.daily_entry_limit ?? 3;
}


// ============================================================
// v10.8.2  AI 持倉即時諮詢 — 打開 chat widget 並塞入當下持倉上下文
// 定位：不是問「當初為什麼買」（那是 rule-based 結果），而是「以現在的盤/新聞/技術面
// 重新評估每一檔持倉」。AI 會拿到進場價、持有天數、最新 verdict/conf 做即時判讀。
// ============================================================
function consultAiAboutPortfolio() {
    if (!_portfolio || !_portfolio.initialized) {
        alert('請先初始化虛擬投資帳戶');
        return;
    }
    const positions = _portfolio.positions || {};
    const keys = Object.keys(positions);
    const stocks = _watchlistAnalysis?.stocks || {};

    // 建立每檔持倉的「即時對照」物件給 AI 消化
    const payload = keys.map(sym => {
        const p = positions[sym] || {};
        const s = stocks[sym] || {};
        const ai = s.ai_analysis || {};
        const zhName = (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym])
            ? TW_STOCK_MAP[sym] : (p.name || sym);
        const pnlPct = (p.entry_price && s.price)
            ? (((s.price - p.entry_price) / p.entry_price) * 100).toFixed(2)
            : null;
        return {
            symbol: sym,
            name: zhName,
            entry_price: p.entry_price,
            shares: p.shares,
            entry_date: p.entry_date,
            current_price: s.price ?? null,
            today_change_pct: s.change_pct ?? null,
            unrealized_pnl_pct: pnlPct,
            stop_loss: p.stop_loss,
            target_price: p.target_price,
            entry_verdict: p.entry_verdict,
            entry_confidence: p.entry_confidence,
            // 即時 AI 判讀（每 15 分鐘更新）
            current_verdict: ai.verdict ?? null,
            current_confidence: ai.confidence ?? null,
            current_news_sentiment: s.news_sentiment?.verdict ?? null,
            conf_low_count: p.conf_low_count ?? 0,
        };
    });

    const status = _portfolio.last_engine_status || {};
    const cashSummary = {
        cash: _portfolio.cash,
        positions_count: keys.length,
        max_positions: _portfolio.settings?.max_positions ?? 5,
        last_engine_run: _portfolio.engine_updated_at,
        last_engine_summary: status.summary,
    };

    // ⚠️ 關鍵：這是 AI 自己操盤的帳戶，用第一人稱讓 AI 有 ownership
    const roleFraming = `
【重要身份設定】
你不是一個被動的顧問。**這個虛擬投資帳戶是你自己在操盤的**——
- 帳戶由你根據自選股分析（verdict=Bullish、confidence≥80、連 2 次確認）自動進場
- 停損、停利、冷卻、逾期出場規則都是你的交易紀律
- 下面列出的每一檔持倉，都是「你」當初決定買的
- 這套系統的勝率 = 你的成績單；績效好壞由你負責

請用**第一人稱**回覆（「我買的」、「我當初選這檔是因為...」、「我現在判斷應該...」），
語氣像一個正在檢討自己交易決策的操盤手，不是旁觀的分析師。
`.trim();

    const userQuestion = keys.length === 0
        ? `我（AI）目前手上沒有持倉。請檢討：
1. 最近我為什麼沒出手？是市場條件不夠，還是我的進場門檻過嚴？
2. 現在市場環境是應該更積極，還是該繼續等？
3. 自選股裡有沒有哪幾檔已經很接近我的觸發條件，下一次評估可能會被我買進？`
        : `以下是「我」目前的 ${keys.length} 筆持倉。請我用操盤手的角度，拿最新盤勢/新聞/技術面重新檢視自己的決策：

對每一檔回答：
1. 我當初為什麼會買這檔？（從 entry_verdict / entry_confidence 推論當時訊號）
2. 現在情況跟當初比，有沒有變化？（比對 current_verdict vs entry_verdict、未實現損益、today_change_pct）
3. 我接下來該怎麼辦？（繼續抱 / 減碼 / 出場，三選一，要有理由）
4. 如果續抱，我這週應該盯什麼訊號避免失誤？

最後：整體而言，**我這次的選股品質如何？系統訊號是不是真的有效？** 用一句話給自己打分。`;

    // 構造上下文 prompt — 餵給 chat.js 的 sendPresetPrompt
    const contextBlock = `
【我的持倉即時資料（這些是我買的）】
${JSON.stringify(payload, null, 2)}

【我的帳戶摘要】
${JSON.stringify(cashSummary, null, 2)}

【我上次執行的自動判斷】
${status.reason_zh || '（尚未執行）'}
`.trim();

    const fullPrompt = `${roleFraming}\n\n${userQuestion}\n\n${contextBlock}`;

    // 打開 chat widget（若已在顯示中會保持）
    const panel = document.getElementById('chatPanel');
    const toggleBtn = document.getElementById('chatToggleBtn');
    if (panel && panel.style.display === 'none') {
        if (typeof toggleChat === 'function') toggleChat();
        else toggleBtn?.click();
    }

    // 給 chat.js 轉介處理
    if (typeof sendPresetPrompt === 'function') {
        sendPresetPrompt('AI 持倉諮詢', fullPrompt);
    } else {
        // Fallback：直接塞輸入框讓用戶手動送
        const input = document.getElementById('chatInput');
        if (input) {
            input.value = fullPrompt;
            input.focus();
        }
    }
}
