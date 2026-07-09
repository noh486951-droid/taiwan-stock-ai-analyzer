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
    if (data.user) {
        localStorage.setItem(LS_USER, JSON.stringify(data.user));
        // v12.4.7：若 user 有綁定的舊暱稱，自動寫進 cloud_uid → 自選股/虛擬投資跨裝置自動接通
        const bn = (data.user.bound_nickname || '').trim();
        if (bn && !localStorage.getItem('tw_stock_cloud_uid')) {
            localStorage.setItem('tw_stock_cloud_uid', bn);
        }
        // v12.7.4：雲端手續費折數 → 本地（含費損益跨裝置一致）
        const fdVal = parseFloat(data.user.fee_discount);
        if (fdVal > 0 && fdVal <= 1) {
            localStorage.setItem('tw_fee_discount', String(fdVal));
        }
    }
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
    if (data.user) {
        localStorage.setItem(LS_USER, JSON.stringify(data.user));
        // v12.7.4：token refresh 時也同步雲端手續費折數
        const fdVal = parseFloat(data.user.fee_discount);
        if (fdVal > 0 && fdVal <= 1) {
            localStorage.setItem('tw_fee_discount', String(fdVal));
        }
    }
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
// v12.0.7：**完全不自動 clearSession**
//   - 401/refresh 失敗只拋錯，token 保留在 LS
//   - 唯一清 token 的時機：用戶按登出 / isLoggedIn() 偵測過期自動清
//   - 這樣避免「網路抖動或 race 把用戶踢出」
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
        throw new Error('network_error: ' + (e.message || e));
    }
    if (r.status === 401) {
        // 試 refresh 一次（不管成功失敗都不主動清 token）
        try {
            await authRefresh();
            r = await doFetch();
        } catch (e) {
            // refresh 也失敗 — 拋給呼叫者讓它自己決定，但「不」 clearSession
            throw new Error('auth_required: ' + (e.message || e));
        }
    }
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
    return json;
};

// v12.1.5：首次載入啟動續期
//   - access token 還有效 → fetchMe 更新 user
//   - access 過期但 refresh token 還在（30 天）→ 自動 refresh 續命
//   這修了「關掉瀏覽器再開就要重登」的問題（access 只有 1hr，但 refresh 30 天）
(async () => {
    const hasAccess = isLoggedIn();   // 已驗 exp
    const refreshToken = localStorage.getItem(LS_REFRESH);

    if (!hasAccess && refreshToken) {
        // access 過期，但有 refresh → 自動續期
        try {
            await authRefresh();
            _notify();
        } catch {
            // refresh 也失效（超過 30 天或被撤銷）→ 清乾淨
            window.clearSession();
            return;
        }
    }

    if (!isLoggedIn()) return;
    try {
        const data = await fetchMe();
        if (data && data.user) {
            localStorage.setItem(LS_USER, JSON.stringify(data.user));
            _notify();
        }
    } catch {
        // fetchMe 失敗不清 token（可能只是網路問題）
    }
})();
