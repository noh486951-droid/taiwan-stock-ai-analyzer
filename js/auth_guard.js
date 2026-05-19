// auth_guard.js — v12 訪客模式 + 鎖頁面覆蓋層
//
// 用法：每個需要鎖的頁面在 sidebar.js 載入後自動偵測。
//   - 受限頁面：watchlist.html / paper_trade.html / account.html
//   - 訪客可看：index / scout / sectors / news / leaderboard
//
// 訪客進限制頁 → 顯示 lock overlay → 引導到 auth.html

const RESTRICTED_PAGES = {
    'watchlist': { title: '⭐ 自選股', why: '自選股需要登入才能跨裝置同步、AI 分析' },
    'paper_trade': { title: '💰 虛擬投資', why: '虛擬投資涉及個人交易紀錄，需登入綁定帳號' },
    'account': { title: '👤 帳號設定', why: '此頁僅供已登入用戶' },
};

function _currentPageId() {
    const p = (location.pathname || '').toLowerCase();
    if (p.includes('watchlist')) return 'watchlist';
    if (p.includes('paper_trade')) return 'paper_trade';
    if (p.includes('account')) return 'account';
    return null;
}

function _injectStyles() {
    if (document.getElementById('authGuardStyles')) return;
    const css = `
        .auth-guard-overlay {
            position: fixed; inset: 0;
            background: rgba(10, 10, 20, 0.85);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 9000;
            display: flex; align-items: center; justify-content: center;
            padding: 1rem;
        }
        .auth-guard-card {
            background: linear-gradient(135deg, #1a1a2e, #16213e);
            border: 1px solid rgba(120, 80, 255, 0.4);
            border-radius: 16px;
            padding: 2rem 1.8rem;
            max-width: 420px;
            width: 100%;
            color: #eee;
            text-align: center;
            box-shadow: 0 8px 30px rgba(120, 80, 255, 0.2);
        }
        .auth-guard-icon { font-size: 3rem; margin-bottom: 0.8rem; }
        .auth-guard-title {
            font-size: 1.3rem; font-weight: 700;
            color: #c9b3ff; margin-bottom: 0.5rem;
        }
        .auth-guard-why {
            font-size: 0.9rem; color: #aaa;
            line-height: 1.6; margin-bottom: 1.4rem;
        }
        .auth-guard-actions { display: flex; flex-direction: column; gap: 0.6rem; }
        .auth-guard-btn {
            padding: 0.75rem 1.2rem;
            border: 0; border-radius: 10px; cursor: pointer;
            font-size: 0.92rem; font-weight: 600;
            transition: transform 0.15s;
        }
        .auth-guard-btn:hover { transform: translateY(-1px); }
        .auth-guard-btn-primary {
            background: linear-gradient(135deg, #7c5cff, #5a8aff);
            color: white;
        }
        .auth-guard-btn-secondary {
            background: rgba(255, 255, 255, 0.08);
            color: #ccc;
        }
        .auth-guard-note {
            font-size: 0.78rem; color: #777;
            margin-top: 1rem; line-height: 1.5;
        }
    `;
    const s = document.createElement('style');
    s.id = 'authGuardStyles';
    s.textContent = css;
    document.head.appendChild(s);
}

function _showLock(pageInfo) {
    _injectStyles();
    if (document.getElementById('authGuardOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'authGuardOverlay';
    overlay.className = 'auth-guard-overlay';
    overlay.innerHTML = `
        <div class="auth-guard-card">
            <div class="auth-guard-icon">🔒</div>
            <div class="auth-guard-title">${pageInfo.title} — 需要登入</div>
            <div class="auth-guard-why">${pageInfo.why}</div>
            <div class="auth-guard-actions">
                <button class="auth-guard-btn auth-guard-btn-primary" id="authGuardLogin">
                    🚀 登入 / 註冊
                </button>
                <button class="auth-guard-btn auth-guard-btn-secondary" id="authGuardBack">
                    ← 回首頁
                </button>
            </div>
            <div class="auth-guard-note">
                v12 起資料綁定帳號，可跨裝置同步、永久備份。<br>
                舊「暱稱模式」用戶請登入後點「從舊暱稱匯入」。
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('authGuardLogin').addEventListener('click', () => {
        const here = encodeURIComponent(location.pathname + location.search);
        location.href = `auth.html?next=${here}`;
    });
    document.getElementById('authGuardBack').addEventListener('click', () => {
        location.href = 'index.html';
    });
}

function _check() {
    const pageId = _currentPageId();
    if (!pageId) return;   // 不在受限頁
    const info = RESTRICTED_PAGES[pageId];
    if (!info) return;

    if (!window.isLoggedIn || !window.isLoggedIn()) {
        // 等 DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => _showLock(info));
        } else {
            _showLock(info);
        }
    }
}

// v12.0.3：先 poll 等 auth.js 載入，立刻檢查 + 訂閱後續變化
let _subscribed = false;
function _subscribeAuthChange() {
    if (_subscribed) return;
    if (!window.onAuthChange) return;
    _subscribed = true;
    window.onAuthChange(({ isLoggedIn: isIn }) => {
        const overlay = document.getElementById('authGuardOverlay');
        if (isIn && overlay) overlay.remove();
        else if (!isIn) _check();
    });
}

if (window.isLoggedIn) {
    _check();
    _subscribeAuthChange();
} else {
    let tries = 0;
    const timer = setInterval(() => {
        tries++;
        if (window.isLoggedIn) {
            clearInterval(timer);
            _check();
            _subscribeAuthChange();
        } else if (tries > 30) {
            clearInterval(timer);
            _check();   // 最後 fallback：show lock
        }
    }, 100);
}
