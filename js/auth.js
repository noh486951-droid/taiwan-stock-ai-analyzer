// auth.js — v12 帳號系統前端邏輯
//
// 負責：
//   - login / register / google / logout / refresh / migrate
//   - token 存到 localStorage
//   - getCurrentUser() / isLoggedIn() 給其他模組查狀態
//   - onAuthChange(cb) 訂閱登入狀態變化

const WORKER_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';
const LS_ACCESS = 'tw_jwt_access';
const LS_REFRESH = 'tw_jwt_refresh';
const LS_USER = 'tw_user_profile';

const _authListeners = new Set();

function _notify() {
    const isIn = isLoggedIn();
    const user = getCurrentUser();
    _authListeners.forEach(cb => {
        try { cb({ isLoggedIn: isIn, user }); } catch {}
    });
}

window.onAuthChange = function (cb) { _authListeners.add(cb); return () => _authListeners.delete(cb); };

window.getAccessToken = function () { return localStorage.getItem(LS_ACCESS); };
window.getRefreshToken = function () { return localStorage.getItem(LS_REFRESH); };

// v12.0.6：isLoggedIn 改為驗證 token 是否還在有效期
//   防止「有舊 token 但已過期」造成 auth.html ↔ watchlist 死循環
window.isLoggedIn = function () {
    const token = localStorage.getItem(LS_ACCESS);
    if (!token) return false;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            // 格式壞 → 清掉
            localStorage.removeItem(LS_ACCESS);
            return false;
        }
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
            // 過期 → 自動嘗試 refresh（背景，不擋介面）
            // 但這個函數是同步的，先回 false 讓 UI 走「未登入」路徑
            // refresh 那邊會等下一次 fetchMe 時被觸發
            return false;
        }
        return true;
    } catch {
        // 解析失敗 → 視為未登入並清掉壞 token
        localStorage.removeItem(LS_ACCESS);
        return false;
    }
};

window.getCurrentUser = function () {
    try {
        const raw = localStorage.getItem(LS_USER);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
};

function _saveSession(data) {
    if (data.access_token) localStorage.setItem(LS_ACCESS, data.access_token);
    if (data.refresh_token) localStorage.setItem(LS_REFRESH, data.refresh_token);
    if (data.user) localStorage.setItem(LS_USER, JSON.stringify(data.user));
    _notify();
}

window.clearSession = function () {
    localStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_REFRESH);
    localStorage.removeItem(LS_USER);
    _notify();
};

async function _post(path, body) {
    const r = await fetch(`${WORKER_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
    return json;
}

window.authRegister = async function (email, password, displayName) {
    const data = await _post('/api/auth/register', {
        email, password, display_name: displayName,
    });
    _saveSession(data);
    return data.user;
};

window.authLogin = async function (email, password) {
    const data = await _post('/api/auth/login', { email, password });
    _saveSession(data);
    return data.user;
};

window.authGoogle = async function (idToken) {
    const data = await _post('/api/auth/google', { id_token: idToken });
    _saveSession(data);
    return data.user;
};

window.authLogout = async function () {
    const rt = localStorage.getItem(LS_REFRESH);
    try {
        if (rt) await _post('/api/auth/logout', { refresh_token: rt });
    } catch {}
    window.clearSession();
};

window.authRefresh = async function () {
    const rt = localStorage.getItem(LS_REFRESH);
    if (!rt) throw new Error('no_refresh_token');
    const data = await _post('/api/auth/refresh', { refresh_token: rt });
    if (data.access_token) localStorage.setItem(LS_ACCESS, data.access_token);
    if (data.user) localStorage.setItem(LS_USER, JSON.stringify(data.user));
    _notify();
    return data.access_token;
};

window.authMigrate = async function (oldNickname, editPassword) {
    return await authedFetch('/api/auth/migrate', {
        method: 'POST',
        body: JSON.stringify({ old_nickname: oldNickname, edit_password: editPassword || '' }),
    });
};

window.fetchMe = async function () {
    return await authedFetch('/api/me');
};

window.updateMe = async function (patch) {
    return await authedFetch('/api/me', {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });
};

window.deleteMe = async function () {
    return await authedFetch('/api/me', { method: 'DELETE' });
};

// 統一 fetch wrapper：自動帶 JWT、401 自動 refresh 重試一次
// v12.0.3：clearSession 只在「refresh token 也明確被拒」時才執行
//   - 網路錯誤 / CORS / 5xx 不應該登出用戶
//   - 只有 refresh API 回 401 才代表真的需要重新登入
window.authedFetch = async function (path, init = {}) {
    const url = path.startsWith('http') ? path : `${WORKER_URL}${path}`;
    const doFetch = async () => {
        const token = localStorage.getItem(LS_ACCESS);
        const headers = new Headers(init.headers || {});
        if (token) headers.set('Authorization', `Bearer ${token}`);
        if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
        return fetch(url, { ...init, headers });
    };
    let r;
    try {
        r = await doFetch();
    } catch (e) {
        // 網路錯誤 / CORS — 不清 token，丟回給呼叫者
        throw new Error('network_error: ' + (e.message || e));
    }
    if (r.status === 401) {
        // 只在這時候才考慮 refresh
        let refreshFailed = false;
        try {
            await authRefresh();
        } catch (e) {
            // 區分：refresh 端點明確說 token 無效 vs 網路問題
            const msg = String(e.message || e);
            if (msg.includes('refresh') || msg.includes('REVOKED') || msg.includes('401')) {
                refreshFailed = true;
            } else {
                // 網路錯誤 — 不清 token
                throw new Error('network_error_during_refresh: ' + msg);
            }
        }
        if (refreshFailed) {
            window.clearSession();
            throw new Error('session_expired');
        }
        try {
            r = await doFetch();
        } catch (e) {
            throw new Error('network_error_after_refresh: ' + (e.message || e));
        }
    }
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
    return json;
};

// 首次載入：刷新一下 user info（如果有 token）
(async () => {
    if (!isLoggedIn()) return;
    try {
        const data = await fetchMe();
        if (data && data.user) {
            localStorage.setItem(LS_USER, JSON.stringify(data.user));
            _notify();
        }
    } catch {
        // 靜默失敗 — 可能 token 過期且 refresh 也敗
    }
})();
