const STORAGE_KEY_PREFIX = 'tw_stock_watchlist';
const GROUPS_KEY = 'tw_stock_groups';
const FOLLOWED_KEY = 'tw_stock_followed';
const NEWS_TRACK_KEY = 'tw_stock_news_track';
const WORKER_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';
const CLOUD_SYNC_KEY = 'tw_stock_cloud_uid';
const CLOUD_TOKEN_KEY = 'tw_stock_cloud_token';
let _analysisCache = {};
let _currentGroup = '';
let _cloudUid = '';
let _cloudToken = '';
let _viewingRemote = '';  // 正在查看的他人帳號（空=看自己的）

document.addEventListener('DOMContentLoaded', () => {
    initGroups();
    document.getElementById('addStockBtn').addEventListener('click', addStock);

    const input = document.getElementById('addSymbolInput');
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') addStock();
    });
    input.addEventListener('input', onSearchInput);
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('stockModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('.watchlist-add')) closeSuggestions();
    });

    // 雲端同步初始化
    initCloudSync();
});

// ============================================================
// 群組管理
// ============================================================

function getGroups() {
    try {
        const groups = JSON.parse(localStorage.getItem(GROUPS_KEY));
        if (Array.isArray(groups) && groups.length > 0) return groups;
    } catch {}
    // 預設群組，並遷移舊資料
    const defaultGroups = [
        { id: 'default', name: '我的自選' },
        { id: 'group2', name: '群組二' }
    ];
    localStorage.setItem(GROUPS_KEY, JSON.stringify(defaultGroups));
    // 遷移舊版資料到 default 群組
    try {
        const oldData = localStorage.getItem('tw_stock_watchlist');
        if (oldData) {
            localStorage.setItem(STORAGE_KEY_PREFIX + '_default', oldData);
            localStorage.removeItem('tw_stock_watchlist');
        }
    } catch {}
    return defaultGroups;
}

function saveGroups(groups) {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    pushToCloud();
}

function getStorageKey() {
    return STORAGE_KEY_PREFIX + '_' + _currentGroup;
}

function initGroups() {
    const groups = getGroups();
    _currentGroup = localStorage.getItem('tw_stock_current_group') || groups[0].id;

    // 確認 currentGroup 存在於群組列表
    if (!groups.find(g => g.id === _currentGroup)) {
        _currentGroup = groups[0].id;
    }

    renderGroupSelector(groups);
}

function getFollowed() {
    try { return JSON.parse(localStorage.getItem(FOLLOWED_KEY)) || []; } catch { return []; }
}
function saveFollowed(list) { localStorage.setItem(FOLLOWED_KEY, JSON.stringify(list)); }

function renderGroupSelector(groups) {
    const container = document.getElementById('groupSelector');
    if (!container) return;
    const followed = getFollowed();

    container.innerHTML = `
        <div class="group-tabs">
            ${groups.map(g => `
                <button class="group-tab ${!_viewingRemote && g.id === _currentGroup ? 'active' : ''}" data-gid="${g.id}">
                    ${g.name}
                </button>
            `).join('')}
            <button class="group-tab group-add-btn" id="addGroupBtn" title="新增群組">＋</button>
            ${groups.length > 1 ? `<button class="group-tab group-manage-btn" id="manageGroupBtn" title="管理群組">⚙</button>` : ''}
            <span style="border-left:1px solid rgba(255,255,255,0.1);height:20px;margin:0 0.3rem;"></span>
            ${followed.map(f => `
                <button class="group-tab group-tab-remote ${_viewingRemote === f ? 'active' : ''}" data-remote="${f}" title="查看 ${f} 的自選股">
                    👁 ${f}
                </button>
            `).join('')}
            <button class="group-tab group-add-btn" id="followUserBtn" title="追蹤他人帳號">👥＋</button>
        </div>
    `;

    // 自己的群組 tab
    container.querySelectorAll('.group-tab[data-gid]').forEach(tab => {
        tab.addEventListener('click', () => {
            _viewingRemote = '';
            _currentGroup = tab.dataset.gid;
            localStorage.setItem('tw_stock_current_group', _currentGroup);
            renderGroupSelector(getGroups());
            loadWatchlist();
        });
    });

    // 別人的帳號 tab
    container.querySelectorAll('.group-tab-remote').forEach(tab => {
        tab.addEventListener('click', () => {
            _viewingRemote = tab.dataset.remote;
            renderGroupSelector(getGroups());
            loadRemoteWatchlist(tab.dataset.remote);
        });
        // 長按或右鍵移除追蹤
        tab.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (confirm(`取消追蹤「${tab.dataset.remote}」？`)) {
                const list = getFollowed().filter(f => f !== tab.dataset.remote);
                saveFollowed(list);
                if (_viewingRemote === tab.dataset.remote) { _viewingRemote = ''; loadWatchlist(); }
                renderGroupSelector(getGroups());
            }
        });
    });

    // 新增群組
    document.getElementById('addGroupBtn')?.addEventListener('click', () => {
        const name = prompt('請輸入新群組名稱：');
        if (!name || !name.trim()) return;
        const groups = getGroups();
        const id = 'g_' + Date.now();
        groups.push({ id, name: name.trim() });
        saveGroups(groups);
        _viewingRemote = '';
        _currentGroup = id;
        localStorage.setItem('tw_stock_current_group', id);
        renderGroupSelector(groups);
        loadWatchlist();
    });

    // 追蹤他人
    document.getElementById('followUserBtn')?.addEventListener('click', () => {
        const name = prompt('輸入要追蹤的使用者暱稱：');
        if (!name || !name.trim()) return;
        const trimmed = name.trim();
        if (trimmed === _cloudUid) { alert('不能追蹤自己'); return; }
        const list = getFollowed();
        if (list.includes(trimmed)) { alert('已在追蹤清單中'); return; }
        list.push(trimmed);
        saveFollowed(list);
        renderGroupSelector(getGroups());
        // 自動切換到該帳號
        _viewingRemote = trimmed;
        renderGroupSelector(getGroups());
        loadRemoteWatchlist(trimmed);
    });

    document.getElementById('manageGroupBtn')?.addEventListener('click', showGroupManager);
}

function showGroupManager() {
    const groups = getGroups();
    const modal = document.getElementById('stockModal');
    const body = document.getElementById('modalBody');

    let html = `<h2>⚙ 群組管理</h2><div style="margin-top:1rem;">`;
    groups.forEach(g => {
        html += `
        <div class="group-manage-row" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
            <input type="text" class="group-name-input" data-gid="${g.id}" value="${g.name}" style="flex:1;padding:0.4rem 0.6rem;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;font-size:0.9rem;" />
            ${groups.length > 1 ? `<button class="btn-remove group-del-btn" data-gid="${g.id}" title="刪除群組" style="font-size:1.2rem;">&times;</button>` : ''}
        </div>`;
    });
    html += `</div>
    <div style="margin-top:1rem;display:flex;gap:0.5rem;">
        <button class="btn-primary btn-sm" id="saveGroupsBtn">儲存</button>
        <button class="btn-secondary btn-sm" id="cancelGroupsBtn">取消</button>
    </div>`;

    body.innerHTML = html;
    modal.style.display = 'flex';

    document.getElementById('saveGroupsBtn').addEventListener('click', () => {
        const inputs = body.querySelectorAll('.group-name-input');
        const updated = [];
        inputs.forEach(inp => {
            const gid = inp.dataset.gid;
            const name = inp.value.trim() || gid;
            updated.push({ id: gid, name });
        });
        saveGroups(updated);
        closeModal();
        renderGroupSelector(updated);
    });

    document.getElementById('cancelGroupsBtn').addEventListener('click', closeModal);

    body.querySelectorAll('.group-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const gid = btn.dataset.gid;
            if (!confirm('確定刪除此群組？該群組的自選股清單將一併移除。')) return;
            let groups = getGroups().filter(g => g.id !== gid);
            localStorage.removeItem(STORAGE_KEY_PREFIX + '_' + gid);
            saveGroups(groups);
            if (_currentGroup === gid) {
                _currentGroup = groups[0].id;
                localStorage.setItem('tw_stock_current_group', _currentGroup);
            }
            closeModal();
            renderGroupSelector(groups);
            loadWatchlist();
        });
    });
}

// ============================================================
// 雲端同步 (Cloudflare Worker KV)
// ============================================================

async function initCloudSync() {
    _cloudUid = localStorage.getItem(CLOUD_SYNC_KEY) || '';
    _cloudToken = localStorage.getItem(CLOUD_TOKEN_KEY) || '';

    // 綁定 UI
    const nicknameInput = document.getElementById('syncNickname');
    const syncBtn = document.getElementById('syncLoginBtn');
    const logoutBtn = document.getElementById('syncLogoutBtn');
    const statusEl = document.getElementById('syncStatus');

    if (_cloudUid) {
        // 已登入狀態
        showSyncLoggedIn(nicknameInput, syncBtn, logoutBtn, statusEl);
        await pullFromCloud();
    } else {
        // 未登入 — 顯示輸入框
        showSyncLoggedOut(nicknameInput, syncBtn, logoutBtn, statusEl);
    }

    // 登入按鈕
    syncBtn?.addEventListener('click', async () => {
        const name = nicknameInput.value.trim();
        if (!name) { showMsg(document.getElementById('addMsg'), '請輸入暱稱', 'text-negative'); return; }

        // 先嘗試向 Worker 驗證暱稱是否可用（帶上本機 token 或產生新 token）
        if (!_cloudToken) _cloudToken = crypto.randomUUID();
        try {
            const checkRes = await fetch(`${WORKER_URL}/api/watchlist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: name, token: _cloudToken, groups: [], watchlists: {}, news_tracking: [] }),
            });
            const checkData = await checkRes.json();
            if (!checkRes.ok && checkData.error === 'NICKNAME_TAKEN') {
                showMsg(document.getElementById('addMsg'), `❌ 暱稱「${name}」已被其他人使用，請換一個`, 'text-negative');
                return;
            }
            // 如果 Worker 回傳 token，以伺服器為準
            if (checkData.token) {
                _cloudToken = checkData.token;
            }
        } catch (e) {
            console.warn('Nickname check failed, proceeding offline:', e.message);
        }

        _cloudUid = name;
        localStorage.setItem(CLOUD_SYNC_KEY, _cloudUid);
        localStorage.setItem(CLOUD_TOKEN_KEY, _cloudToken);
        showSyncLoggedIn(nicknameInput, syncBtn, logoutBtn, statusEl);
        showMsg(document.getElementById('addMsg'), '🔄 正在同步...', 'text-muted');
        await pullFromCloud();
        renderGroupSelector(getGroups());
        loadWatchlist();
        showMsg(document.getElementById('addMsg'), `✅ 已登入「${_cloudUid}」，自選股已同步`, 'text-positive');
    });

    // Enter 鍵觸發登入
    nicknameInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') syncBtn?.click();
    });

    // 登出
    logoutBtn?.addEventListener('click', () => {
        _cloudUid = '';
        localStorage.removeItem(CLOUD_SYNC_KEY);
        showSyncLoggedOut(nicknameInput, syncBtn, logoutBtn, statusEl);
        showMsg(document.getElementById('addMsg'), '已登出雲端同步，目前為本機模式', 'text-muted');
    });

    loadWatchlist();
}

function showSyncLoggedIn(input, loginBtn, logoutBtn, status) {
    if (input) input.style.display = 'none';
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) { logoutBtn.style.display = ''; logoutBtn.textContent = `🔓 登出 (${_cloudUid})`; }
    if (status) { status.textContent = `☁️ 已同步：${_cloudUid}`; status.className = 'text-positive'; }
}

function showSyncLoggedOut(input, loginBtn, logoutBtn, status) {
    if (input) { input.style.display = ''; input.value = ''; }
    if (loginBtn) loginBtn.style.display = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (status) { status.textContent = '未同步（僅本機）'; status.className = 'text-muted'; }
}

async function pullFromCloud() {
    try {
        const res = await fetch(`${WORKER_URL}/api/watchlist?uid=${encodeURIComponent(_cloudUid)}`);
        if (!res.ok) return;
        const cloud = await res.json();
        if (!cloud.groups || cloud.groups.length === 0) {
            // 雲端沒資料，把本地推上去
            await pushToCloud();
            return;
        }
        // 將雲端資料寫入 localStorage
        localStorage.setItem(GROUPS_KEY, JSON.stringify(cloud.groups));
        Object.entries(cloud.watchlists || {}).forEach(([gid, stocks]) => {
            localStorage.setItem(STORAGE_KEY_PREFIX + '_' + gid, JSON.stringify(stocks));
        });
        // 重新載入群組
        initGroups();
    } catch (e) {
        console.warn('Cloud pull failed (offline mode):', e.message);
    }
}

async function pushToCloud() {
    if (!_cloudUid) return;
    try {
        const groups = getGroups();
        const watchlists = {};
        groups.forEach(g => {
            try {
                watchlists[g.id] = JSON.parse(localStorage.getItem(STORAGE_KEY_PREFIX + '_' + g.id)) || [];
            } catch { watchlists[g.id] = []; }
        });
        const newsTracking = getNewsTracking();
        const res = await fetch(`${WORKER_URL}/api/watchlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: _cloudUid, token: _cloudToken, groups, watchlists, news_tracking: newsTracking }),
        });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok && resData.error === 'NICKNAME_TAKEN') {
            showMsg(document.getElementById('addMsg'), `❌ 暱稱衝突！「${_cloudUid}」已被其他人使用`, 'text-negative');
            return;
        }
        // 保存伺服器回傳的 token
        if (resData.token && !_cloudToken) {
            _cloudToken = resData.token;
            localStorage.setItem(CLOUD_TOKEN_KEY, _cloudToken);
        }
    } catch (e) {
        console.warn('Cloud push failed (offline mode):', e.message);
    }
}

async function loadRemoteWatchlist(remoteUid) {
    const container = document.getElementById('watchlistCards');
    container.innerHTML = `<div class="glass stock-card"><p class="loading">正在載入 ${remoteUid} 的自選股...</p></div>`;

    try {
        const res = await fetch(`${WORKER_URL}/api/watchlist?uid=${encodeURIComponent(remoteUid)}`);
        if (!res.ok) throw new Error('無法取得資料');
        const cloud = await res.json();
        if (!cloud.groups || cloud.groups.length === 0) {
            container.innerHTML = `<div class="glass stock-card empty-state"><p>找不到「${remoteUid}」的自選股資料</p><p class="text-muted">請確認暱稱是否正確</p></div>`;
            return;
        }
        // 合併所有群組的股票
        const allStocks = [];
        Object.values(cloud.watchlists || {}).forEach(stocks => {
            stocks.forEach(s => { if (!allStocks.includes(s)) allStocks.push(s); });
        });

        if (allStocks.length === 0) {
            container.innerHTML = `<div class="glass stock-card empty-state"><p>「${remoteUid}」目前沒有自選股</p></div>`;
            return;
        }

        // 用唯讀模式渲染（無刪除按鈕）
        renderCards(allStocks, _analysisCache, true);
    } catch (e) {
        container.innerHTML = `<div class="glass stock-card"><p class="text-negative">載入失敗：${e.message}</p></div>`;
    }
}

// ============================================================
// 新聞追蹤
// ============================================================

function getNewsTracking() {
    try { return JSON.parse(localStorage.getItem(NEWS_TRACK_KEY)) || []; } catch { return []; }
}

function saveNewsTracking(list) {
    localStorage.setItem(NEWS_TRACK_KEY, JSON.stringify(list));
    pushToCloud();
}

function toggleNewsTracking(symbol) {
    const list = getNewsTracking();
    const idx = list.indexOf(symbol);
    if (idx >= 0) {
        list.splice(idx, 1);
    } else {
        list.push(symbol);
    }
    saveNewsTracking(list);
    return idx < 0; // 回傳新狀態
}

// ============================================================
// LocalStorage 管理
// ============================================================

function getWatchlist() {
    try {
        return JSON.parse(localStorage.getItem(getStorageKey())) || [];
    } catch {
        return [];
    }
}

function saveWatchlist(list) {
    localStorage.setItem(getStorageKey(), JSON.stringify(list));
    // 非同步推送到雲端
    pushToCloud();
}

function addStock() {
    if (_viewingRemote) {
        showMsg(document.getElementById('addMsg'), '正在查看他人帳號，請先切回自己的群組', 'text-negative');
        return;
    }
    const input = document.getElementById('addSymbolInput');
    const msg = document.getElementById('addMsg');
    const raw = input.value.trim();

    if (!raw) {
        showMsg(msg, '請輸入股票代碼或中文名稱', 'text-negative');
        return;
    }

    // 用 searchStock 支援中文搜尋
    const symbol = searchStock(raw);

    const list = getWatchlist();
    if (list.includes(symbol)) {
        const name = getChineseName(symbol);
        showMsg(msg, `${name} (${symbol}) 已在自選股清單中`, 'text-negative');
        return;
    }

    list.push(symbol);
    saveWatchlist(list);
    input.value = '';
    closeSuggestions();

    const name = getChineseName(symbol);
    showMsg(msg, `已新增 ${name} (${symbol})。系統正規劃為您即時診斷...`, 'text-positive');
    loadWatchlist();
}

function removeStock(symbol) {
    const list = getWatchlist().filter(s => s !== symbol);
    saveWatchlist(list);
    loadWatchlist();
    const msg = document.getElementById('addMsg');
    showMsg(msg, `已移除 ${symbol}`, 'text-positive');
}

function showMsg(el, text, cls) {
    el.textContent = text;
    el.className = 'assistant-msg ' + (cls || '');
}

// ============================================================
// 搜尋建議下拉
// ============================================================

function onSearchInput(e) {
    const query = e.target.value.trim();
    const suggestions = getSearchSuggestions(query);

    if (suggestions.length === 0) {
        closeSuggestions();
        return;
    }

    let dropdown = document.getElementById('searchDropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'searchDropdown';
        dropdown.className = 'search-dropdown';
        e.target.parentElement.appendChild(dropdown);
    }

    dropdown.innerHTML = suggestions.map(s => `
        <div class="search-item" data-code="${s.code}">
            <span class="search-code">${s.code.replace('.TW', '').replace('.TWO', '')}</span>
            <span class="search-name">${s.name}</span>
        </div>
    `).join('');

    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.search-item').forEach(item => {
        item.addEventListener('click', () => {
            document.getElementById('addSymbolInput').value = item.dataset.code;
            closeSuggestions();
            addStock();
        });
    });
}

function closeSuggestions() {
    const dropdown = document.getElementById('searchDropdown');
    if (dropdown) dropdown.style.display = 'none';
}

// ============================================================
// 載入與渲染
// ============================================================

async function loadWatchlist() {
    const localList = getWatchlist();

    // 載入 AI 分析資料（僅用於顯示，不影響清單）
    try {
        const res = await fetch('data/watchlist_analysis.json');
        if (res.ok) {
            const json = await res.json();
            _analysisCache = json.stocks || {};
        }
    } catch {
        _analysisCache = {};
    }

    // 只顯示 localStorage 中的股票
    renderCards(localList, _analysisCache, false);
}

async function renderCards(symbols, analysisData, readOnly = false) {
    const container = document.getElementById('watchlistCards');

    if (symbols.length === 0) {
        container.innerHTML = `
            <div class="glass stock-card empty-state">
                <p>尚未新增任何自選股</p>
                <p class="text-muted">在上方輸入股票代碼或中文名稱開始追蹤</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    
    // First pass loop: render placeholders or static data
    for (const symbol of symbols) {
        let data = analysisData[symbol];
        
        if (!data || data.error) {
            // Check if we already fetched dynamically
            if (_analysisCache[symbol]) {
                data = _analysisCache[symbol];
            } else {
                // Render loading placeholder
                const cnName = getChineseName(symbol);
                container.innerHTML += `
                    <div class="glass stock-card" id="card-${symbol.replace('.', '-')}">
                        <div class="stock-card-header">
                            <div><span class="stock-symbol">${cnName}</span><span class="stock-name">${symbol}</span></div>
                            ${readOnly ? '' : `<button class="btn-remove" data-symbol="${symbol}" title="移除">&times;</button>`}
                        </div>
                        <p class="text-positive" style="margin-top:1rem; text-align:center;">🚀 AI 動態分析中，請稍候...</p>
                    </div>
                `;
                continue;
            }
        }
        
        container.innerHTML += renderStockCard(symbol, data, readOnly);
    }

    // Bind remove buttons initially
    bindCardEvents(container, analysisData);

    // Second pass loop: dynamically fetch missing data
    for (const symbol of symbols) {
        if (!analysisData[symbol] && !_analysisCache[symbol]) {
            try {
                const WORKER_ANALYZE_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev/api/analyze';
                const res = await fetch(WORKER_ANALYZE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: symbol })
                });
                
                if (res.ok) {
                    const dynamicData = await res.json();
                    _analysisCache[symbol] = dynamicData; // Cache it locally
                    
                    // Replace the placeholder with actual card
                    const cardDiv = document.getElementById(`card-${symbol.replace('.', '-')}`);
                    if (cardDiv) {
                        // [Fix] Pass readOnly through
                        cardDiv.outerHTML = renderStockCard(symbol, dynamicData, readOnly);
                        bindCardEvents(document.getElementById('watchlistCards'), _analysisCache);
                    }
                } else {
                    const cardDiv = document.getElementById(`card-${symbol.replace('.', '-')}`);
                    if (cardDiv) {
                        cardDiv.insertAdjacentHTML('beforeend', '<p class="text-negative" style="margin-top:0.5rem">取得動態分析失敗，API 限流或無法連線</p>');
                    }
                }
            } catch(e) {
                console.error("Fetch failed", e);
            }
        }
    }
}

function bindCardEvents(container, currentData) {
    container.querySelectorAll('.stock-card[data-symbol]').forEach(card => {
        // [修正] 統一在 clone 之後才綁定所有事件
        const clonedCard = card.cloneNode(true);
        card.parentNode.replaceChild(clonedCard, card);

        // 1. 刪除按鈕 — 必須 stopPropagation 並在 clone 後綁定
        clonedCard.querySelectorAll('.btn-remove').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                e.preventDefault();
                removeStock(btn.dataset.symbol);
            });
        });

        // 2. 整張卡片 click → 開彈窗
        clonedCard.addEventListener('click', (e) => {
            // 點刪除按鈕時不開 modal (防禦性檢查)
            if (e.target.closest('.btn-remove')) return;
            const sym = clonedCard.dataset.symbol;
            const dataToUse = currentData[sym] || _analysisCache[sym];
            openModal(sym, dataToUse);
        });
    });
}

function renderStockCard(symbol, data, readOnly = false) {
    const cnName = getChineseName(symbol, data?.name);

    if (!data || data.error) {
        return `
            <div class="glass stock-card" data-symbol="${symbol}">
                <div class="stock-card-header">
                    <div>
                        <span class="stock-symbol">${cnName}</span>
                        <span class="stock-name">${symbol}</span>
                    </div>
                    ${readOnly ? '' : `<button class="btn-remove" data-symbol="${symbol}" title="移除">&times;</button>`}
                </div>
                <p class="text-muted" style="margin-top:0.5rem;">等待下次排程更新分析...</p>
            </div>
        `;
    }

    const changeClass = data.change_pct >= 0 ? 'text-positive' : 'text-negative';
    const sign = data.change_pct >= 0 ? '+' : '';
    const tech = data.technical || {};
    const fund = data.fundamental || {};
    const ai = data.ai_analysis || {};

    const trendClass = ai.trend === '偏多' ? 'text-positive' : ai.trend === '偏空' ? 'text-negative' : 'text-muted';
    const riskColor = ai.risk_level === '高' ? 'text-negative' : ai.risk_level === '低' ? 'text-positive' : 'text-muted';

    return `
        <div class="glass stock-card" data-symbol="${symbol}">
            <div class="stock-card-header">
                <div>
                    <span class="stock-symbol">${cnName}</span>
                    <span class="stock-name">${symbol}</span>
                </div>
                ${readOnly ? '' : `<button class="btn-remove" data-symbol="${symbol}" title="移除">&times;</button>`}
            </div>

            <div class="stock-price-row">
                <span class="stock-price">${data.price}</span>
                <span class="${changeClass}">${sign}${data.change_pct}%</span>
                ${data.volume ? `<span class="text-muted vol">量 ${formatVolume(data.volume)}</span>` : ''}
            </div>

            <div class="stock-indicators">
                ${tech.RSI != null ? `<span class="tag">RSI ${tech.RSI}</span>` : ''}
                ${tech.K != null ? `<span class="tag">K${tech.K} D${tech.D}</span>` : ''}
                ${fund.PE != null ? `<span class="tag">PE ${fund.PE}</span>` : ''}
                ${fund.dividend_yield != null ? `<span class="tag">殖利率 ${fund.dividend_yield}%</span>` : ''}
            </div>

            ${data.chip_concentration ? `
            <div class="stock-indicators" style="margin-top:0.3rem;">
                <span class="tag ${data.chip_concentration.trend_10d === '集中' ? 'text-positive' : data.chip_concentration.trend_10d === '發散' ? 'text-negative' : ''}">10日: ${data.chip_concentration.trend_10d} (${data.chip_concentration.score_10d > 0 ? '+' : ''}${data.chip_concentration.score_10d})</span>
                <span class="tag ${data.chip_concentration.trend_20d === '集中' ? 'text-positive' : data.chip_concentration.trend_20d === '發散' ? 'text-negative' : ''}">20日: ${data.chip_concentration.trend_20d} (${data.chip_concentration.score_20d > 0 ? '+' : ''}${data.chip_concentration.score_20d})</span>
            </div>` : ''}

            ${ai.trend ? `
            <div class="stock-ai-brief">
                <span class="${trendClass}">趨勢：${ai.trend}</span>
                <span class="${riskColor}">風險：${ai.risk_level || '-'}</span>
                ${ai.confidence != null ? `<span class="text-muted">信心 ${ai.confidence}%</span>` : ''}
            </div>` : ''}

            <div class="stock-card-hint">點擊查看完整分析</div>
        </div>
    `;
}

// ============================================================
// 個股詳細彈窗
// ============================================================

function openModal(symbol, data) {
    const modal = document.getElementById('stockModal');
    const body = document.getElementById('modalBody');
    const cnName = getChineseName(symbol, data?.name);

    if (!data || data.error) {
        body.innerHTML = `
            <div class="modal-header-info">
                <h2>${cnName} <span class="text-muted">(${symbol})</span></h2>
                <div class="modal-price">
                    <button class="btn-primary btn-sm" onclick="reAnalyzeStock('${symbol}')">🚀 立即嘗試備援分析 (Mistral)</button>
                </div>
            </div>
            <p class="text-muted" style="margin-top:2rem;">目前尚無 AI 分析資料或原先分析失敗。點擊上方按鈕可即時啟動 Mistral 備援分析。</p>
        `;
        modal.style.display = 'flex';
        return;
    }

    const tech = data.technical || {};
    const fund = data.fundamental || {};
    const ai = data.ai_analysis || {};
    const changeClass = data.change_pct >= 0 ? 'text-positive' : 'text-negative';
    const sign = data.change_pct >= 0 ? '+' : '';
    const vd = normalizeVerdict(ai.verdict);

    body.innerHTML = `
        <div class="modal-header-info">
            <h2>${cnName} <span class="text-muted">(${symbol})</span></h2>
            <div class="modal-price">
                <span class="big-price">${data.price}</span>
                <span class="${changeClass}">${sign}${data.change_pct}%</span>
                ${data.volume ? `<span class="text-muted">成交量 ${formatVolume(data.volume)}</span>` : ''}
            </div>
            <div style="margin-top:0.5rem; display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
                <button class="btn-secondary btn-sm" onclick="reAnalyzeStock('${symbol}')" style="font-size:0.75rem;">🔄 重新分析 (Mistral 備援)</button>
                ${_viewingRemote ? '' : `
                <label class="news-track-label" style="cursor:pointer; display:flex; align-items:center; gap:0.3rem; font-size:0.8rem;" title="打開後 AI 晨間快報會特別追蹤此股新聞">
                    <input type="checkbox" class="news-track-modal-cb" data-symbol="${symbol}" ${getNewsTracking().includes(symbol) ? 'checked' : ''} style="cursor:pointer;" />
                    <span>📰 追蹤新聞</span>
                </label>`}
            </div>
        </div>

        <div class="modal-section">
            <h3>技術指標</h3>
            <div class="indicator-grid">
                ${indRow('MA5', tech.MA5)}
                ${indRow('MA10', tech.MA10)}
                ${indRow('MA20', tech.MA20)}
                ${indRow('MA60', tech.MA60)}
                ${indRow('MA120', tech.MA120)}
                ${indRow('MA240', tech.MA240)}
                ${indRow('RSI(14)', tech.RSI)}
                ${indRow('K 值', tech.K)}
                ${indRow('D 值', tech.D)}
                ${indRow('MACD', tech.MACD)}
                ${indRow('Signal', tech.MACD_signal)}
                ${indRow('柱狀體', tech.MACD_hist)}
                ${indRow('布林上軌', tech.BOLL_upper)}
                ${indRow('布林中軌', tech.BOLL_mid)}
                ${indRow('布林下軌', tech.BOLL_lower)}
            </div>
        </div>

        <div class="modal-section">
            <h3>基本面</h3>
            <div class="indicator-grid">
                ${indRow('本益比 PE', fund.PE)}
                ${indRow('預估 PE', fund.forward_PE)}
                ${indRow('股價淨值比', fund.PB)}
                ${indRow('EPS', fund.EPS)}
                ${indRow('殖利率', fund.dividend_yield != null ? fund.dividend_yield + '%' : null)}
                ${indRow('市值', fund.market_cap ? formatMarketCap(fund.market_cap) : null)}
                ${indRow('52 週高', fund['52w_high'])}
                ${indRow('52 週低', fund['52w_low'])}
                ${ai.industry_pe_avg ? indRow('產業平均 PE', ai.industry_pe_avg) : ''}
            </div>
        </div>

        ${ai.highlights && ai.highlights.length > 0 ? `
        <div class="modal-section">
            <h3>投資重點提示</h3>
            <ul class="highlights-list">
                ${ai.highlights.map(h => `<li>${h}</li>`).join('')}
            </ul>
        </div>` : ''}

        ${data.support_resistance ? `
        <div class="modal-section">
            <h3>支撐壓力位與停損建議</h3>
            <div class="margin-grid">
                ${data.support_resistance.supports.map((s, i) => `
                <div class="margin-item">
                    <span class="margin-label">支撐${i+1}</span>
                    <span class="margin-value text-positive">${s}</span>
                </div>`).join('')}
                ${data.support_resistance.resistances.map((r, i) => `
                <div class="margin-item">
                    <span class="margin-label">壓力${i+1}</span>
                    <span class="margin-value text-negative">${r}</span>
                </div>`).join('')}
            </div>
            <div class="margin-grid" style="margin-top:0.5rem;">
                <div class="margin-item">
                    <span class="margin-label">保守停損</span>
                    <span class="margin-value text-negative">${data.support_resistance.stop_loss.conservative} (-${data.support_resistance.stop_loss.conservative_pct}%)</span>
                </div>
                <div class="margin-item">
                    <span class="margin-label">積極停損</span>
                    <span class="margin-value text-negative">${data.support_resistance.stop_loss.aggressive} (-${data.support_resistance.stop_loss.aggressive_pct}%)</span>
                </div>
                <div class="margin-item">
                    <span class="margin-label">目標價</span>
                    <span class="margin-value text-positive">${data.support_resistance.target.price} (+${data.support_resistance.target.upside_pct}%)</span>
                </div>
                <div class="margin-item">
                    <span class="margin-label">風險報酬比</span>
                    <span class="margin-value">${data.support_resistance.risk_reward_ratio}x</span>
                </div>
            </div>
        </div>` : ''}

        ${data.chip_concentration ? `
        <div class="modal-section">
            <h3>籌碼集中度</h3>
            <div class="concentration-grid">
                <div class="conc-item">
                    <span class="conc-label">10日集中度</span>
                    <span class="conc-score ${data.chip_concentration.score_10d > 0 ? 'text-positive' : data.chip_concentration.score_10d < 0 ? 'text-negative' : 'text-muted'}">${data.chip_concentration.score_10d > 0 ? '+' : ''}${data.chip_concentration.score_10d}</span>
                    <span class="conc-trend ${data.chip_concentration.trend_10d === '集中' ? 'text-positive' : data.chip_concentration.trend_10d === '發散' ? 'text-negative' : 'text-muted'}">${data.chip_concentration.trend_10d}</span>
                    <div class="conc-bar-bg">
                        <div class="conc-bar-center"></div>
                        <div class="conc-bar-fill ${data.chip_concentration.score_10d > 0 ? 'score-pos' : 'score-neg'}" style="left:${data.chip_concentration.score_10d >= 0 ? '50%' : (50 + data.chip_concentration.score_10d / 2) + '%'};width:${Math.min(50, Math.abs(data.chip_concentration.score_10d) / 2)}%"></div>
                    </div>
                </div>
                <div class="conc-item">
                    <span class="conc-label">20日集中度</span>
                    <span class="conc-score ${data.chip_concentration.score_20d > 0 ? 'text-positive' : data.chip_concentration.score_20d < 0 ? 'text-negative' : 'text-muted'}">${data.chip_concentration.score_20d > 0 ? '+' : ''}${data.chip_concentration.score_20d}</span>
                    <span class="conc-trend ${data.chip_concentration.trend_20d === '集中' ? 'text-positive' : data.chip_concentration.trend_20d === '發散' ? 'text-negative' : 'text-muted'}">${data.chip_concentration.trend_20d}</span>
                    <div class="conc-bar-bg">
                        <div class="conc-bar-center"></div>
                        <div class="conc-bar-fill ${data.chip_concentration.score_20d > 0 ? 'score-pos' : 'score-neg'}" style="left:${data.chip_concentration.score_20d >= 0 ? '50%' : (50 + data.chip_concentration.score_20d / 2) + '%'};width:${Math.min(50, Math.abs(data.chip_concentration.score_20d) / 2)}%"></div>
                    </div>
                </div>
            </div>
            <div class="margin-grid" style="margin-top:0.5rem;">
                <div class="margin-item"><span class="margin-label">10日量比</span><span class="margin-value">${data.chip_concentration.vol_ratio_10d}x</span></div>
                <div class="margin-item"><span class="margin-label">20日量比</span><span class="margin-value">${data.chip_concentration.vol_ratio_20d}x</span></div>
                <div class="margin-item"><span class="margin-label">10日漲跌</span><span class="margin-value ${data.chip_concentration.price_change_10d >= 0 ? 'text-positive' : 'text-negative'}">${data.chip_concentration.price_change_10d >= 0 ? '+' : ''}${data.chip_concentration.price_change_10d}%</span></div>
                <div class="margin-item"><span class="margin-label">20日漲跌</span><span class="margin-value ${data.chip_concentration.price_change_20d >= 0 ? 'text-positive' : 'text-negative'}">${data.chip_concentration.price_change_20d >= 0 ? '+' : ''}${data.chip_concentration.price_change_20d}%</span></div>
            </div>
        </div>` : ''}

        ${ai.confidence != null ? `
        <div class="modal-section">
            <h3>AI 信心度與評分</h3>
            <div class="modal-verdict-row">
                <div class="verdict-badge verdict-${vd.cls}">${vd.label}</div>
                <div class="confidence-section" style="flex:1;">
                    <span class="confidence-label">信心度</span>
                    <div class="confidence-bar-bg">
                        <div class="confidence-bar-fill confidence-${vd.cls}" style="width: ${ai.confidence}%"></div>
                    </div>
                    <span class="confidence-value">${ai.confidence}%</span>
                </div>
            </div>
            ${ai.scores ? `
            <div class="scores-grid" style="margin-top:0.8rem;">
                ${['chip','technical','sentiment','macro'].map(k => {
                    const labels = {chip:'🏦 籌碼',technical:'📈 技術',sentiment:'📰 消息',macro:'🌍 總經'};
                    const v = ai.scores[k] || 0;
                    const cls = v > 0 ? 'score-pos' : v < 0 ? 'score-neg' : 'score-zero';
                    const pct = ((v + 3) / 6) * 100;
                    return `<div class="score-item">
                        <span class="score-icon">${labels[k].split(' ')[0]}</span>
                        <span class="score-label">${labels[k].split(' ')[1]}</span>
                        <div class="score-bar-bg">
                            <div class="score-bar-center"></div>
                            <div class="score-bar-fill ${cls}" style="left:${v>=0?'50%':pct+'%'};width:${Math.abs(v)/6*100}%"></div>
                        </div>
                        <span class="score-value ${cls}">${v>0?'+':''}${v}</span>
                    </div>`;
                }).join('')}
            </div>` : ''}
        </div>` : ''}

        ${ai.reasons && ai.reasons.length > 0 ? `
        <div class="modal-section">
            <h3>分析理由</h3>
            <div class="reasons-list">
                ${ai.reasons.map(r => {
                    const typeMap = {chip:'🏦 籌碼',technical:'📈 技術',sentiment:'📰 消息',macro:'🌍 總經',
                        'Technical':'📈 技術','Fundamental':'📊 基本面','Chip':'🏦 籌碼','News':'📰 消息','Sentiment':'📰 消息','Macro':'🌍 總經'};
                    const rType = r.type || r.category || '';
                    const rText = r.text || r.factor || '';
                    // weight: Gemini 用 0~1, Mistral 用 -3~3，統一轉為百分比
                    const rawW = Math.abs(r.weight || 0);
                    const widthPct = rawW <= 1 ? Math.round(rawW * 100) : Math.round((rawW / 3) * 100);
                    return `<div class="reason-item">
                        <span class="reason-type">${typeMap[rType] || rType}</span>
                        <span class="reason-text">${rText}</span>
                        <div class="reason-weight"><div class="reason-weight-bar" style="width:${widthPct}%"></div></div>
                    </div>`;
                }).join('')}
            </div>
        </div>` : ''}

        ${ai.analysis ? `
        <div class="modal-section">
            <h3>AI 深度分析</h3>
            <div class="ai-detail">
                ${ai.trend ? `<p><strong>趨勢判斷：</strong><span class="${ai.trend === '偏多' ? 'text-positive' : ai.trend === '偏空' ? 'text-negative' : ''}">${ai.trend}</span></p>` : ''}
                ${ai.support ? `<p><strong>支撐區間：</strong>${ai.support}</p>` : ''}
                ${ai.resistance ? `<p><strong>壓力區間：</strong>${ai.resistance}</p>` : ''}
                ${ai.risk_level ? `<p><strong>風險等級：</strong>${ai.risk_level}</p>` : ''}
                <p><strong>綜合分析：</strong>${ai.analysis}</p>
                ${ai.suggestion ? `<p><strong>操作建議：</strong>${ai.suggestion}</p>` : ''}
            </div>
        </div>` : ''}

        <div class="modal-footer-info">
            <p class="text-muted">資料日期：${data.date || '-'}</p>
        </div>
    `;
    modal.style.display = 'flex';

    // 綁定彈窗內的新聞追蹤 checkbox
    const modalCb = modal.querySelector('.news-track-modal-cb');
    if (modalCb) {
        modalCb.addEventListener('change', () => {
            toggleNewsTracking(modalCb.dataset.symbol);
        });
    }
}  // end openModal

function closeModal() {
    document.getElementById('stockModal').style.display = 'none';
}

async function reAnalyzeStock(symbol) {
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '🎯 正在分析中...';

    try {
        const WORKER_ANALYZE_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev/api/analyze';
        const res = await fetch(WORKER_ANALYZE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: symbol, force: true })
        });
        
        if (!res.ok) throw new Error('API 暫時不可用');
        
        const newData = await res.json();
        _analysisCache[symbol] = newData;
        
        // 重新渲染彈窗內容
        openModal(symbol, newData);
        
        // 同時更新背景的卡片
        const localList = getWatchlist();
        renderCards(localList, _analysisCache);
        
    } catch (err) {
        alert('分析失敗：' + err.message);
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function indRow(label, value) {
    if (value == null) return '';
    return `<div class="ind-item"><span class="ind-label">${label}</span><span class="ind-value">${value}</span></div>`;
}

// ============================================================
// 工具
// ============================================================

function formatVolume(vol) {
    if (vol >= 100000000) return (vol / 100000000).toFixed(1) + ' 億';
    if (vol >= 10000) return (vol / 10000).toFixed(0) + ' 萬';
    return vol.toLocaleString();
}

function formatMarketCap(cap) {
    if (cap >= 1e12) return (cap / 1e12).toFixed(1) + ' 兆';
    if (cap >= 1e8) return (cap / 1e8).toFixed(0) + ' 億';
    return cap.toLocaleString();
}

/**
 * 將各種 verdict 格式統一映射為 CSS class (bullish/bearish/neutral)
 * 支援 Worker/Mistral 回傳的中文格式與 Gemini 回傳的英文格式
 */
function normalizeVerdict(verdict) {
    if (!verdict) return { cls: 'neutral', label: '中立' };
    const v = verdict.toLowerCase();
    // English
    if (v === 'bullish') return { cls: 'bullish', label: '看多' };
    if (v === 'bearish') return { cls: 'bearish', label: '看空' };
    // Chinese — bullish variants
    if (['強烈買進', '買進', '偏多', '看多', '積極買進'].some(k => verdict.includes(k))) return { cls: 'bullish', label: verdict };
    // Chinese — bearish variants
    if (['強烈賣出', '賣出', '偏空', '看空', '逢高調節', '減碼'].some(k => verdict.includes(k))) return { cls: 'bearish', label: verdict };
    // Chinese — neutral variants (觀望, 波段操作, 中立, 盤整, etc.)
    return { cls: 'neutral', label: verdict };
}
