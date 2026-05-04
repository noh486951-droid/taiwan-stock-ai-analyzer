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
// v11.8：帳戶模式 — 'mine' 走 KV，'bot' 直接讀 data/ai_bot_portfolio.json
const PT_MODE_KEY = 'tw_stock_pt_mode';
let _mode = localStorage.getItem(PT_MODE_KEY) || 'mine';

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

    // v11.8：即使未登入也要綁帳戶切換按鈕
    const btnMine0 = document.getElementById('ptModeMine');
    const btnBot0 = document.getElementById('ptModeBot');
    if (btnMine0 && btnBot0 && !btnMine0.dataset.bound) {
        btnMine0.dataset.bound = '1';
        btnMine0.addEventListener('click', () => switchMode('mine'));
        btnBot0.addEventListener('click', () => switchMode('bot'));
    }
    // v11.8：依 localStorage 還原 active 樣式
    if (btnMine0 && btnBot0) {
        btnMine0.classList.toggle('active', _mode === 'mine');
        btnBot0.classList.toggle('active', _mode === 'bot');
    }
    // 如果一進來就是 bot 模式，先把個人帳戶卡片藏起來
    if (_mode === 'bot') {
        ['ptLoginCard', 'ptInitCard', 'ptPasswordCard'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    if (!_uid) {
        document.getElementById('ptLoginCard').style.display = 'block';
        document.getElementById('ptLoginMsg').textContent = '偵測不到登入狀態（仍可點上方「🤖 AI 機器人帳戶」觀戰）';
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
    // v11.8：帳戶模式切換
    const btnMine = document.getElementById('ptModeMine');
    const btnBot = document.getElementById('ptModeBot');
    if (btnMine && btnBot) {
        btnMine.addEventListener('click', () => switchMode('mine'));
        btnBot.addEventListener('click', () => switchMode('bot'));
    }

    await loadPortfolio();

    // 啟動輪詢
    _pollTimer = setInterval(loadPortfolio, POLL_INTERVAL);
}

// ============================================================
// KV 同步
// ============================================================

async function loadPortfolio() {
    // v11.8：AI 機器人帳戶 — 直接讀 repo 的 JSON，不走 KV
    if (_mode === 'bot') {
        try {
            const r = await fetch(`data/ai_bot_portfolio.json?_=${Date.now()}`);
            if (!r.ok) {
                _portfolio = null;
                document.getElementById('ptOverviewCard').style.display = 'none';
                document.getElementById('ptPositionsCard').style.display = 'none';
                showBotEmpty();
                return;
            }
            _portfolio = await r.json();
            _lockedHasPassword = false;
            renderBot();
        } catch (e) {
            console.error('Load AI bot portfolio failed', e);
        }
        return;
    }
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

// v11.8：帳戶模式切換
function switchMode(mode) {
    if (_mode === mode) return;
    _mode = mode;
    localStorage.setItem(PT_MODE_KEY, mode);   // v11.8：刷新後維持選擇
    const btnMine = document.getElementById('ptModeMine');
    const btnBot = document.getElementById('ptModeBot');
    if (btnMine && btnBot) {
        btnMine.classList.toggle('active', mode === 'mine');
        btnBot.classList.toggle('active', mode === 'bot');
    }
    // 切到 bot 模式：隱藏會員專屬卡片（登入/密碼/啟動），鎖定互動
    if (mode === 'bot') {
        ['ptLoginCard', 'ptInitCard', 'ptPasswordCard'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    } else {
        // 切回 mine：隱藏 bot 提示卡，解鎖按鈕
        const empty = document.getElementById('ptBotEmpty');
        if (empty) empty.style.display = 'none';
        const autoTog = document.getElementById('ptAutoToggle');
        const resetBtn = document.getElementById('ptResetBtn');
        const consultBtn = document.getElementById('ptConsultBtn');
        if (autoTog) autoTog.disabled = false;
        if (resetBtn) resetBtn.style.display = '';
        if (consultBtn) consultBtn.style.display = '';
    }
    loadPortfolio();
}

function renderBot() {
    if (!_portfolio) {
        showBotEmpty();
        return;
    }
    // 顯示總覽 + 持倉 + 統計 + 歷史；隱藏設定卡（bot 不能改設定）
    ['ptOverviewCard', 'ptPositionsCard', 'ptStatsCard', 'ptHistoryCard']
        .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; });
    ['ptSettingsCard', 'ptLoginCard', 'ptInitCard', 'ptPasswordCard']
        .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    // 鎖住互動按鈕
    const autoTog = document.getElementById('ptAutoToggle');
    const resetBtn = document.getElementById('ptResetBtn');
    const consultBtn = document.getElementById('ptConsultBtn');
    if (autoTog) { autoTog.disabled = true; }
    if (resetBtn) { resetBtn.style.display = 'none'; }
    if (consultBtn) { consultBtn.style.display = 'none'; }
    render();   // 重用既有的 render（會吃 _portfolio）
}

function showBotEmpty() {
    ['ptOverviewCard', 'ptPositionsCard', 'ptStatsCard', 'ptHistoryCard', 'ptSettingsCard',
     'ptLoginCard', 'ptInitCard', 'ptPasswordCard']
        .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    let el = document.getElementById('ptBotEmpty');
    if (!el) {
        el = document.createElement('div');
        el.id = 'ptBotEmpty';
        el.className = 'glass';
        el.style.cssText = 'padding:1.5rem;margin-bottom:1.5rem;text-align:center;';
        el.innerHTML = `
            <h3>🤖 AI 機器人帳戶尚未啟動</h3>
            <p class="text-muted">需等到下一輪 GitHub Actions 跑完 paper_trade_engine 後，會自動建立 <code>data/ai_bot_portfolio.json</code>。</p>
            <p class="text-muted" style="font-size:0.8rem;">資料來源：每日 scout 雷達的 AI 自選 10 檔，自動進出場（觀戰模式，不可操作）</p>
        `;
        const container = document.querySelector('.container');
        container.appendChild(el);
    }
    el.style.display = 'block';
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
                profit_lock_arm_pct: 7,
                profit_lock_floor_pct: 3,
                ma5_extension_limit_pct: 3,
                sector_filter_mode: 'weak_only',
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
        enable_ai_review: document.getElementById('setEnableAiReview').checked,
        profit_lock_arm_pct: +document.getElementById('setProfitLockArm').value,
        profit_lock_floor_pct: +document.getElementById('setProfitLockFloor').value,
        ma5_extension_limit_pct: +document.getElementById('setMa5ExtLimit').value,
        sector_filter_mode: document.getElementById('setSectorFilterMode').value,
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

    // v11.2: 族群資金流向摘要（讀 watchlist_analysis.json 頂層 sector_flow）
    let sectorLine = '';
    const sf = _watchlistAnalysis?.sector_flow;
    if (sf && sf.sectors && sf.sectors.length) {
        const taiex = sf.taiex || {};
        const top3 = sf.sectors.slice(0, 3);
        const bot3 = sf.sectors.slice(-3).reverse();
        const fmt = arr => arr.map(s => {
            const sign = s.change_pct >= 0 ? '+' : '';
            const cls = s.change_pct >= 0 ? 'verdict-bullish' : 'verdict-bearish';
            return `<span class="${cls}">${s.name} ${sign}${s.change_pct}%</span>`;
        }).join('、');
        const topHeavy = sf.concentration?.is_top_heavy
            ? ' <span class="verdict-bearish" title="資金過度集中頭部族群，中小型股易被抽血">⚠️ 資金集中</span>'
            : '';
        const taiexSign = (taiex.change_pct ?? 0) >= 0 ? '+' : '';
        sectorLine = `<br><span style="font-size:0.8rem;color:var(--text-muted);">
            📊 大盤 ${taiexSign}${taiex.change_pct ?? '-'}%｜🔥 強勢：${fmt(top3)}｜❄️ 弱勢：${fmt(bot3)}${topHeavy}
        </span>`;
    }

    // v11.5：盤勢回測 — 顯示當前盤勢、動態門檻、該盤勢歷史勝率
    let regimeLine = '';
    if (status && status.market_regime && status.market_regime !== 'unknown') {
        const regimeBadge = {
            bull:  '<span style="background:rgba(80,180,120,0.18);color:#5fbf83;padding:1px 8px;border-radius:6px;">🐂 多頭</span>',
            bear:  '<span style="background:rgba(220,80,80,0.18);color:#ff7070;padding:1px 8px;border-radius:6px;">🐻 空頭</span>',
            range: '<span style="background:rgba(255,165,2,0.18);color:#ffa502;padding:1px 8px;border-radius:6px;">↔️ 盤整</span>',
        }[status.market_regime] || status.market_regime_zh;
        const dyn = status.dynamic_threshold;
        const base = status.base_threshold;
        const wr = status.regime_winrate;
        const n = status.regime_sample_count;
        let thresholdNote = '';
        if (dyn != null && base != null) {
            if (dyn !== base) {
                const sign = dyn > base ? '+' : '';
                const color = dyn > base ? '#ff7070' : '#5fbf83';
                thresholdNote = ` 進場門檻 <b style="color:${color};">${dyn}</b>（基準 ${base}, ${sign}${dyn - base}）`;
            } else {
                thresholdNote = ` 進場門檻 <b>${dyn}</b>`;
            }
        }
        let wrNote = '';
        if (wr != null) {
            wrNote = ` · 此盤勢歷史勝率 <b>${(wr * 100).toFixed(0)}%</b>(${n} 筆)`;
        } else if (n > 0) {
            wrNote = ` · 此盤勢樣本 ${n} 筆（<10 暫不調整）`;
        }
        regimeLine = `<br><span style="font-size:0.8rem;color:var(--text-muted);">
            🎯 當前盤勢：${regimeBadge}${thresholdNote}${wrNote}
        </span>`;
    }

    // v11.6：宏觀風險防禦模式
    let macroLine = '';
    if (status && status.macro_risk && status.macro_risk.level && status.macro_risk.level !== 'normal') {
        const mr = status.macro_risk;
        const macroBadge = mr.level === 'defensive'
            ? '<span style="background:rgba(220,80,80,0.22);color:#ff5050;padding:1px 8px;border-radius:6px;">🛡️ 防禦模式（縮減部位）</span>'
            : '<span style="background:rgba(255,165,2,0.22);color:#ffa502;padding:1px 8px;border-radius:6px;">⚠️ 警戒（門檻加嚴）</span>';
        const triggers = (mr.triggers || []).slice(0, 3).map(t => `<li>${t}</li>`).join('');
        macroLine = `<br><span style="font-size:0.8rem;color:var(--text-muted);">
            ${macroBadge} 風險分數 <b>${mr.score}</b>／10
            ${triggers ? `<ul style="margin:4px 0 0 18px;padding:0;font-size:0.78rem;">${triggers}</ul>` : ''}
        </span>`;
    }

    document.getElementById('ptEngineStatus').innerHTML = `🤖 AI 引擎上次執行：${eng}${pwFlag}${statusLine}${sectorLine}${regimeLine}${macroLine}`;
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
        // v11.2: RS + 族群資金流向 tag
        const sd = _watchlistAnalysis?.stocks?.[sym] || {};
        const rs = sd.rs;
        const sf = sd.sector_flow;
        let rsTag = '';
        if (rs && rs.vs_taiex_pct != null) {
            const strong = ['強勢', '跟漲'].includes(rs.label);
            const weak = ['弱勢', '極弱'].includes(rs.label);
            const cls = strong ? 'verdict-bullish' : weak ? 'verdict-bearish' : 'verdict-neutral';
            const sign = rs.vs_taiex_pct >= 0 ? '+' : '';
            rsTag = `<span class="${cls}" style="margin-left:0.4rem;font-size:0.75rem;" title="個股漲跌 vs 大盤">RS ${rs.label} ${sign}${rs.vs_taiex_pct}%</span>`;
        }
        let sfTag = '';
        if (sf && sf.sector_name) {
            const strongSec = ['強勢', '領漲'].includes(sf.strength);
            const weakSec = ['弱勢', '落後'].includes(sf.strength);
            const cls = strongSec ? 'verdict-bullish' : weakSec ? 'verdict-bearish' : 'verdict-neutral';
            const sign = sf.sector_change_pct >= 0 ? '+' : '';
            sfTag = `<span class="${cls}" style="margin-left:0.4rem;font-size:0.75rem;" title="族群資金流向">${sf.sector_name} ${sf.strength} ${sign}${sf.sector_change_pct}%</span>`;
        }
        // 中文優先：TW_STOCK_MAP > STOCK_NAMES > pos.name（yfinance 英文）> sym
        const name = (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym])
            || (typeof STOCK_NAMES !== 'undefined' && STOCK_NAMES[sym])
            || pos.name
            || sym.replace(/\.(TW|TWO)$/, '');
        return `
        <div class="pt-position-row ${pnl >= 0 ? 'pos-up' : 'pos-down'}">
            <div class="pt-pos-header">
                <div>
                    <b>${name}</b> <span class="text-muted">${sym}</span>
                    <span class="${verdictCls}" style="margin-left:0.5rem;">AI: ${currentVerdict}</span>
                    ${rsTag}${sfTag}
                </div>
                <div class="${_clsPct(pnl)}">
                    <b>${_fmtPct(pnlPct)}</b> (${_fmtMoney(pnl)})
                </div>
            </div>
            <div class="pt-pos-grid">
                <div>張數<br><b>${pos.shares >= 1000 && pos.shares % 1000 === 0 ? (pos.shares / 1000) + ' 張' : pos.shares + ' 股'}</b></div>
                <div>進場價<br><b>${pos.entry_price}</b></div>
                <div>現價<br><b>${cur}</b></div>
                <div>目標<br><b class="text-positive">${pos.target_price ?? '—'}</b></div>
                <div>停損<br><b class="text-negative">${pos.stop_loss ?? '—'}</b></div>
                <div>持有<br><b>${_tradingDaysSince(pos.entry_date)}</b> 日</div>
                <div title="ATR 移動停利：浮盈 ≥5% 啟動 / 獲利鎖定：曾達 +7% 後跌破 +3% 出場">移動停利<br>${(() => {
                    const stop = pos.trailing_stop;
                    const locked = pos.profit_locked;
                    const armedTrail = pos.trailing_activated;
                    const maxP = pos.max_profit_pct;
                    if (locked) {
                        return `<b class="text-positive">${stop ?? '—'}</b>
                            <span class="verdict-bullish" style="font-size:0.7rem;margin-left:4px;" title="獲利鎖定中：曾達 +${maxP}% 浮盈，跌破出場線會強制出場">🔒 鎖利</span>
                            <br><span style="font-size:0.7rem;color:var(--text-muted);">高 ${pos.highest_price ?? '—'} · 峰值 +${maxP}%</span>`;
                    }
                    if (armedTrail) {
                        return `<b class="text-positive">${stop ?? '—'}</b>
                            <span style="font-size:0.7rem;color:var(--text-muted);">(高 ${pos.highest_price ?? '—'})</span>`;
                    }
                    return `<span class="text-muted">未啟動</span>${maxP ? `<br><span style="font-size:0.7rem;color:var(--text-muted);">峰值 +${maxP}%</span>` : ''}`;
                })()}</div>
            </div>
            <div class="pt-pos-meta">
                進場於 ${pos.entry_time || pos.entry_date} · 進場信心 ${pos.entry_confidence ?? '—'}% · 強度 ${pos.signal_strength || '—'}
                ${(pos.adjustments && pos.adjustments.length)
                    ? `<span style="margin-left:0.5rem;color:var(--accent-blue);cursor:pointer;" title="${_formatAdjustmentsTooltip(pos.adjustments)}">AI 已調整 ${pos.adjustments.length} 次</span>`
                    : ''}
            </div>
        </div>`;
    }).join('');
}

function _formatAdjustmentsTooltip(list) {
    try {
        return list.slice(-3).map(a => {
            const changes = (a.changes || []).map(c =>
                `${c.field === 'stop_loss' ? '停損' : '目標'}: ${c.old} → ${c.new}`
            ).join('; ');
            return `[${a.ts}] ${changes}\n理由: ${a.ai_reason || ''}`;
        }).join('\n\n');
    } catch {
        return '（無法格式化調整紀錄）';
    }
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
    const exitBuckets = { target: [], stop: [], reversal: [], stale: [], conf_crash: [], day_crash: [], signal_flip: [], rs_weak: [] };
    for (const h of history) {
        (exitBuckets[h.exit_reason] || (exitBuckets[h.exit_reason] = [])).push(h);
    }
    document.getElementById('ptExitStats').innerHTML = _renderExitTable(exitBuckets);

    // v11.5：盤勢分組勝率（用 entry_market_regime）
    const regimeBuckets = { '🐂 多頭': [], '🐻 空頭': [], '↔️ 盤整': [], '❓ 未知': [] };
    const regimeMap = { bull: '🐂 多頭', bear: '🐻 空頭', range: '↔️ 盤整' };
    for (const h of history) {
        const k = regimeMap[h.entry_market_regime] || '❓ 未知';
        regimeBuckets[k].push(h);
    }
    const regimeEl = document.getElementById('ptRegimeStats');
    if (regimeEl) {
        regimeEl.innerHTML = _renderBucketTable(regimeBuckets, '盤勢') +
            `<p class="scout-meta" style="margin-top:0.5rem;">💡 樣本 ≥10 筆時，引擎會在勝率 &lt;30% 的盤勢自動加嚴進場門檻 +5 分；&gt;60% 則放寬 -3 分（最低 70）。</p>`;
    }

    // v11.6：失敗模式讀回
    const pmEl = document.getElementById('ptPostMortem');
    if (pmEl) {
        pmEl.innerHTML = _renderPostMortem(_portfolio.post_mortem);
    }
}

function _renderPostMortem(pm) {
    if (!pm || !pm.stats) {
        return `<p class="text-muted">尚無失敗模式分析（每日 18:00 盤後產生，需至少 3 筆已平倉交易）</p>`;
    }
    const s = pm.stats;
    const ai = pm.ai_review || {};
    let html = `<div style="background:rgba(255,255,255,0.04);padding:0.8rem;border-radius:8px;margin-bottom:0.8rem;">
        <div style="font-size:0.9rem;"><b>📊 ${s.summary_zh || '-'}</b></div>
        <div class="text-muted" style="font-size:0.78rem;margin-top:4px;">產生時間：${pm.ts || '-'}</div>
    </div>`;

    // 虧損出場原因表
    if (s.reason_breakdown && Object.keys(s.reason_breakdown).length) {
        const reasonZh = { target:'達標', stop:'停損', reversal:'AI 翻空', stale:'逾期', conf_crash:'信心崩跌',
            day_crash:'單日急跌', signal_flip:'訊號翻轉', rs_weak:'弱於大盤', trailing_stop:'移動停利' };
        const rows = Object.entries(s.reason_breakdown).sort((a,b)=>b[1].count-a[1].count).map(([k,v]) =>
            `<tr><td>${reasonZh[k] || k}</td><td>${v.count}</td><td class="text-negative">${v.avg_pnl}</td></tr>`).join('');
        html += `<table class="pt-stats-tbl" style="margin-bottom:0.8rem;">
            <thead><tr><th>虧損出場原因</th><th>次數</th><th>平均虧損</th></tr></thead>
            <tbody>${rows}</tbody></table>`;
    }

    // AI 分析模式
    if (ai.patterns && ai.patterns.length) {
        html += `<div style="margin-top:0.6rem;"><b>🤖 AI 找出的失敗模式：</b><ol style="margin:0.4rem 0 0 1.2rem;padding:0;font-size:0.85rem;">`;
        for (const p of ai.patterns) {
            html += `<li style="margin-bottom:0.5rem;">
                <b>${p.pattern || '-'}</b><br>
                <span class="text-muted" style="font-size:0.78rem;">證據：${p.evidence || '-'}</span><br>
                <span style="color:var(--accent-blue);font-size:0.78rem;">💡 ${p.fix_rule || '-'}</span>
            </li>`;
        }
        html += `</ol></div>`;
    }
    if (ai.top_advice) {
        html += `<div style="margin-top:0.6rem;background:rgba(96,165,250,0.12);padding:0.6rem;border-radius:6px;font-size:0.86rem;">
            <b>🎯 最重要建議：</b>${ai.top_advice}
        </div>`;
    }
    return html;
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
    const reasonLabel = {
        target: '🎯達標', stop: '🛑停損', reversal: '🔄反轉', stale: '⏰逾期',
        conf_crash: '📉信心崩跌', day_crash: '💥急跌防禦',
        signal_flip: '⚡訊號轉弱', rs_weak: '📉弱於大盤',  // v11.2
    };
    const _name = (sym, fallback) => (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym])
        || (typeof STOCK_NAMES !== 'undefined' && STOCK_NAMES[sym])
        || fallback
        || sym.replace(/\.(TW|TWO)$/, '');
    container.innerHTML = `
        <table class="pt-history-tbl">
            <thead><tr>
                <th>股票</th><th>進→出</th><th>持有</th><th>信心</th><th>原因</th><th>損益</th>
            </tr></thead>
            <tbody>
                ${history.map(h => `
                <tr class="${h.pnl >= 0 ? 'pos-up' : 'pos-down'}">
                    <td><b>${_name(h.sym, h.name)}</b>${h.mode === 'adjusted' ? ' <span title="AI 盤後動態調整過" style="color:var(--accent-blue);">A</span>' : ''}<br><span class="text-muted">${h.sym}</span></td>
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
    document.getElementById('setEnableAiReview').checked = !!s.enable_ai_review;
    document.getElementById('setProfitLockArm').value = s.profit_lock_arm_pct ?? 7;
    document.getElementById('setProfitLockFloor').value = s.profit_lock_floor_pct ?? 3;
    document.getElementById('setMa5ExtLimit').value = s.ma5_extension_limit_pct ?? 3;
    document.getElementById('setSectorFilterMode').value = s.sector_filter_mode || 'weak_only';
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
            // v11.2: 相對強度 + 族群資金流向
            rs_vs_taiex: s.rs ?? null,
            sector_flow: s.sector_flow ?? null,
            conf_flip_count: p.conf_flip_count ?? 0,
            rs_weak_count: p.rs_weak_count ?? 0,
        };
    });

    // v11.2: 全市場族群資金流向
    const marketSectorFlow = _watchlistAnalysis?.sector_flow ? {
        taiex: _watchlistAnalysis.sector_flow.taiex,
        top_sectors: (_watchlistAnalysis.sector_flow.sectors || []).slice(0, 3),
        bottom_sectors: (_watchlistAnalysis.sector_flow.sectors || []).slice(-3),
        is_top_heavy: _watchlistAnalysis.sector_flow.concentration?.is_top_heavy,
    } : null;

    const status = _portfolio.last_engine_status || {};
    const cashSummary = {
        cash: _portfolio.cash,
        positions_count: keys.length,
        max_positions: _portfolio.settings?.max_positions ?? 5,
        last_engine_run: _portfolio.engine_updated_at,
        last_engine_summary: status.summary,
    };

    // 近 20 筆已平倉交易，讓 AI 能檢討自己的勝敗史
    const historyAll = _portfolio.history || [];
    const wins = historyAll.filter(h => (h.pnl || 0) > 0).length;
    const losses = historyAll.length - wins;
    const totalPnl = historyAll.reduce((s, h) => s + (h.pnl || 0), 0);
    const recentHistory = [...historyAll].reverse().slice(0, 20).map(h => {
        const sym = h.symbol || '';
        const zh = (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym]) ? TW_STOCK_MAP[sym] : sym;
        return {
            symbol: sym,
            name: zh,
            entry_date: h.entry_date,
            exit_date: h.exit_date,
            entry_price: h.entry_price,
            exit_price: h.exit_price,
            pnl: h.pnl,
            pnl_pct: h.pnl_pct,
            hold_days: h.hold_days,
            entry_confidence: h.entry_confidence,
            exit_reason: h.exit_reason,
            mode: h.mode,  // fixed / adjusted
        };
    });
    const historySummary = {
        total_trades: historyAll.length,
        wins, losses,
        win_rate_pct: historyAll.length ? +(wins / historyAll.length * 100).toFixed(1) : 0,
        cumulative_pnl: Math.round(totalPnl),
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
3. **市場脈絡檢查**：我這檔現在 RS vs 大盤、族群資金流向狀況如何？（rs_vs_taiex.label、sector_flow.strength）
   如果個股弱於大盤 + 族群也弱 → 這是「逆勢孤狼」，為什麼當初選進場？
4. 我接下來該怎麼辦？（繼續抱 / 減碼 / 出場，三選一，要有理由）
5. 如果續抱，我這週應該盯什麼訊號避免失誤？

最後：
- **整體而言，我這次的選股品質如何？系統訊號是不是真的有效？** 用一句話給自己打分。
- **今日市場資金集中在哪幾個族群？我的持倉是站對邊還是抽錯牌？**（引用「今日市場族群資金流向」的 top/bottom sectors）`;

    // 構造上下文 prompt — 餵給 chat.js 的 sendPresetPrompt
    const contextBlock = `
【我的持倉即時資料（這些是我買的）】
${JSON.stringify(payload, null, 2)}

【我的帳戶摘要】
${JSON.stringify(cashSummary, null, 2)}

【我的交易戰績總表】
${JSON.stringify(historySummary, null, 2)}

【我最近 20 筆已平倉交易（這些是我操作過的成績單，檢討時要參考）】
${JSON.stringify(recentHistory, null, 2)}

【今日市場族群資金流向（v11.2）】
${marketSectorFlow ? JSON.stringify(marketSectorFlow, null, 2) : '（無族群資料）'}

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
