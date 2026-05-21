/**
 * v11.14 共用 Sidebar 元件
 *
 * 用法（每個 HTML 在 body 最開頭加）：
 *   <div id="sidebarRoot"></div>
 *   <script src="js/sidebar.js"></script>
 *
 * 自動：
 *   - 注入 sidebar HTML + hamburger 按鈕 + backdrop
 *   - 偵測當前頁面標記 active
 *   - 記住收合狀態（localStorage: tw_sidebar_collapsed）
 *   - 桌機桌面 / 手機 burger menu 切換
 *   - 子選單展開（市場雷達下展開子分類）
 */

(function () {
    const STORAGE_KEY = 'tw_sidebar_collapsed';
    const SUBMENU_KEY = 'tw_sidebar_submenu_open';

    // 目前頁面的檔名（去掉 query / hash）
    const currentPage = (location.pathname.split('/').pop() || 'index.html')
        .split('?')[0].split('#')[0] || 'index.html';

    // 選單結構
    const MENU = [
        { id: 'home', icon: '📊', label: '盤勢總覽', href: 'index.html' },
        { id: 'news', icon: '📰', label: '財經新聞', href: 'news.html' },
        { id: 'watchlist', icon: '⭐', label: '自選股', href: 'watchlist.html' },
        { id: 'sectors', icon: '🗺️', label: '族群地圖', href: 'sectors.html' },
        {
            id: 'scout', icon: '🔭', label: '市場雷達', href: 'scout.html',
            submenu: [
                { label: '🚀 法人籌碼',  href: 'scout.html#inst' },
                { label: '🔥 強勢股(日/週/月)',  href: 'scout.html#momentum' },
                { label: '📈 漲跌幅榜',  href: 'scout.html#movers' },
                { label: '⚡ 量價異常',  href: 'scout.html#volume' },
                { label: '🎯 籌碼集中',  href: 'scout.html#chip' },
                { label: '🚀 月營收 YoY', href: 'scout.html#revenue' },
                { label: '🐳 大戶布局',  href: 'scout.html#whale' },
            ],
        },
        { id: 'paper_trade', icon: '💰', label: '虛擬投資', href: 'paper_trade.html' },
        { id: 'leaderboard', icon: '🏆', label: '排行榜', href: 'leaderboard.html' },
    ];

    function _isActive(item) {
        if (item.href.split('#')[0] === currentPage) return true;
        if (item.submenu) {
            return item.submenu.some(s => s.href.split('#')[0] === currentPage);
        }
        return false;
    }

    function buildSidebarHTML() {
        const items = MENU.map(item => {
            const active = _isActive(item) ? ' active' : '';
            const hasSub = !!item.submenu;
            const submenuOpen = hasSub && _isActive(item) ? ' open' : '';
            const subHtml = hasSub ? `
                <ul class="sidebar-submenu">
                    ${item.submenu.map(s => `
                        <li>
                            <a class="sidebar-link" href="${s.href}">
                                <span class="sidebar-link-text">${s.label}</span>
                            </a>
                        </li>
                    `).join('')}
                </ul>
            ` : '';
            const caret = hasSub
                ? `<span class="sidebar-link-caret">▶</span>`
                : '';
            return `
                <li class="${hasSub ? 'has-submenu' : ''}${submenuOpen}" data-id="${item.id}">
                    <a class="sidebar-link${active}" href="${item.href}" ${hasSub ? 'data-has-submenu="1"' : ''}>
                        <span class="sidebar-link-icon">${item.icon}</span>
                        <span class="sidebar-link-text">${item.label}</span>
                        ${caret}
                    </a>
                    ${subHtml}
                </li>
            `;
        }).join('');

        return `
            <button class="sidebar-hamburger" id="sidebarHamburger" aria-label="開啟選單">☰</button>
            <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
            <aside class="app-sidebar" id="appSidebar">
                <div class="sidebar-header">
                    <span class="sidebar-logo">⚡</span>
                    <span class="sidebar-title">台股 AI</span>
                </div>
                <!-- v12：使用者 profile 區（已登入 = 頭像+暱稱，未登入 = 訪客）-->
                <div class="sidebar-profile" id="sidebarProfile"></div>
                <button class="sidebar-toggle" id="sidebarToggle" title="收合/展開">
                    ☰
                </button>
                <ul class="sidebar-menu">${items}</ul>
                <div class="sidebar-footer">
                    v12.0 · AI 操盤系統
                </div>
            </aside>
        `;
    }

    // v12：用 user.display_name 的第一個字當頭像 fallback
    function _avatarLetter(name) {
        if (!name) return '?';
        // 中文/英文/數字 都取第一個字符
        return name.trim().charAt(0).toUpperCase();
    }

    // v12：依 display_name hash 出一個穩定顏色
    function _avatarColor(name) {
        if (!name) return '#7c5cff';
        let h = 0;
        for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff;
        const palette = [
            'linear-gradient(135deg, #7c5cff, #5a8aff)',
            'linear-gradient(135deg, #ff6b6b, #ff8e72)',
            'linear-gradient(135deg, #4ade80, #22c55e)',
            'linear-gradient(135deg, #facc15, #fb923c)',
            'linear-gradient(135deg, #f472b6, #ec4899)',
            'linear-gradient(135deg, #06b6d4, #3b82f6)',
            'linear-gradient(135deg, #a78bfa, #c084fc)',
        ];
        return palette[Math.abs(h) % palette.length];
    }

    // v12.0.8：直接讀 localStorage 判斷登入狀態，不依賴 auth.js 已載入
    function _checkLoginRaw() {
        const token = localStorage.getItem('tw_jwt_access');
        if (!token) return { loggedIn: false, user: null };
        // 驗 exp
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return { loggedIn: false, user: null };
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (payload.exp && payload.exp * 1000 < Date.now()) {
                return { loggedIn: false, user: null };
            }
        } catch {
            return { loggedIn: false, user: null };
        }
        // 讀 user profile
        let user = null;
        try {
            const raw = localStorage.getItem('tw_user_profile');
            if (raw) user = JSON.parse(raw);
        } catch {}
        return { loggedIn: true, user };
    }

    // v12：渲染使用者 profile 區（已登入 / 訪客）
    function _renderProfile() {
        const el = document.getElementById('sidebarProfile');
        if (!el) return;
        let { loggedIn, user } = _checkLoginRaw();

        // v12.0.8：token 有效但 profile 還沒同步 → 從 JWT payload 取 name/email 當 fallback
        if (loggedIn && !user) {
            try {
                const token = localStorage.getItem('tw_jwt_access');
                const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                user = {
                    display_name: payload.name || '使用者',
                    email: payload.email || '',
                };
            } catch {
                user = { display_name: '使用者', email: '' };
            }
        }

        if (loggedIn && user) {
            const letter = _avatarLetter(user.display_name);
            const color = _avatarColor(user.display_name);
            // email 可能很長，截掉 @ 之後
            const emailShort = (user.email || '').split('@')[0];
            el.innerHTML = `
                <a class="sidebar-profile-link" href="account.html" title="帳號設定">
                    <div class="sidebar-avatar" style="background:${color};">${letter}</div>
                    <div class="sidebar-profile-info">
                        <div class="sidebar-profile-name">${user.display_name || '未命名'}</div>
                        <div class="sidebar-profile-meta">@${emailShort}</div>
                    </div>
                    <span class="sidebar-profile-chev">›</span>
                </a>
            `;
        } else {
            el.innerHTML = `
                <a class="sidebar-profile-link guest" href="auth.html" title="登入或註冊">
                    <div class="sidebar-avatar sidebar-avatar-guest">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </div>
                    <div class="sidebar-profile-info">
                        <div class="sidebar-profile-name">訪客</div>
                        <div class="sidebar-profile-meta">點此登入 / 註冊</div>
                    </div>
                    <span class="sidebar-profile-chev">›</span>
                </a>
            `;
        }
    }

    // v12：把 profile 樣式注入（避免改 style.css 影響太大）
    function _injectProfileStyles() {
        if (document.getElementById('sidebarProfileStyles')) return;
        const css = `
            .sidebar-profile {
                padding: 0.6rem 0.7rem;
                margin: 0.4rem 0.5rem 0.6rem;
                border-bottom: 1px solid rgba(255,255,255,0.07);
            }
            .sidebar-profile-link {
                display: flex; align-items: center; gap: 0.65rem;
                padding: 0.55rem 0.6rem;
                border-radius: 10px;
                text-decoration: none;
                color: #eee;
                transition: background 0.15s;
                background: rgba(255,255,255,0.03);
            }
            .sidebar-profile-link:hover { background: rgba(120,80,255,0.15); }
            .sidebar-profile-link.guest .sidebar-profile-meta { color: #b794ff; }
            .sidebar-avatar {
                width: 38px; height: 38px;
                border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-weight: 700; font-size: 1.05rem;
                color: white;
                flex-shrink: 0;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }
            .sidebar-avatar-guest {
                background: rgba(255,255,255,0.08);
                color: #aaa;
            }
            .sidebar-profile-info {
                min-width: 0; flex: 1;
                overflow: hidden;
            }
            .sidebar-profile-name {
                font-size: 0.92rem; font-weight: 600;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .sidebar-profile-meta {
                font-size: 0.72rem; color: #888;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                margin-top: 0.1rem;
            }
            .sidebar-profile-chev {
                color: #666; font-size: 1.1rem;
                flex-shrink: 0;
            }
            /* 收合狀態：只顯示頭像 */
            .app-sidebar.collapsed .sidebar-profile-info,
            .app-sidebar.collapsed .sidebar-profile-chev {
                display: none;
            }
            .app-sidebar.collapsed .sidebar-profile-link {
                justify-content: center;
                padding: 0.4rem;
            }
            .app-sidebar.collapsed .sidebar-profile {
                padding: 0.4rem;
                margin: 0.4rem 0.3rem;
            }
        `;
        const s = document.createElement('style');
        s.id = 'sidebarProfileStyles';
        s.textContent = css;
        document.head.appendChild(s);
    }

    function init() {
        const root = document.getElementById('sidebarRoot');
        if (!root) return;
        root.innerHTML = buildSidebarHTML();
        document.body.classList.add('has-sidebar');

        // 載入收合偏好
        if (localStorage.getItem(STORAGE_KEY) === '1') {
            document.getElementById('appSidebar').classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
        }

        // 收合 / 展開按鈕（桌機）
        const toggleBtn = document.getElementById('sidebarToggle');
        toggleBtn.addEventListener('click', () => {
            // 手機：開啟 / 關閉滑出
            if (window.innerWidth <= 768) {
                document.body.classList.toggle('sidebar-open');
                return;
            }
            const sb = document.getElementById('appSidebar');
            sb.classList.toggle('collapsed');
            document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem(STORAGE_KEY, sb.classList.contains('collapsed') ? '1' : '0');
        });

        // 手機 hamburger
        const hamburger = document.getElementById('sidebarHamburger');
        hamburger.addEventListener('click', () => {
            document.body.classList.add('sidebar-open');
        });

        // 點背景關閉手機 sidebar
        document.getElementById('sidebarBackdrop').addEventListener('click', () => {
            document.body.classList.remove('sidebar-open');
        });

        // 點子選單父項可展開 / 收合（同時導航也要進去主頁）
        document.querySelectorAll('.sidebar-menu .has-submenu > .sidebar-link').forEach(link => {
            link.addEventListener('click', (e) => {
                // 只在點 caret 或 collapsed 模式下攔截
                const li = link.closest('.has-submenu');
                if (li && !document.getElementById('appSidebar').classList.contains('collapsed')) {
                    // 桌機：點父項，先 toggle 子選單
                    if (e.target.classList.contains('sidebar-link-caret')) {
                        e.preventDefault();
                        li.classList.toggle('open');
                    } else if (_isActive({ href: link.getAttribute('href'), submenu: [] }) === false) {
                        // 如果不是當前頁，正常跳轉
                    } else {
                        // 當前頁：toggle 子選單
                        e.preventDefault();
                        li.classList.toggle('open');
                    }
                }
            });
        });

        // 手機點任何 link 後自動關閉 sidebar
        document.querySelectorAll('.sidebar-menu a.sidebar-link').forEach(a => {
            a.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    setTimeout(() => document.body.classList.remove('sidebar-open'), 50);
                }
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // v11.14.13：所有頁面自動載入 PWA 安裝引導（手機 + 未安裝才會彈）
    function loadPwaInstall() {
        if (document.querySelector('script[src*="pwa_install"]')) return;
        const s = document.createElement('script');
        s.src = 'js/pwa_install.js?v=11.14.13';
        s.async = true;
        document.head.appendChild(s);
    }
    // v12：所有頁面自動載入 auth.js + auth_guard.js
    function loadAuth() {
        if (!document.querySelector('script[src*="js/auth.js"]')) {
            const s1 = document.createElement('script');
            s1.src = 'js/auth.js?v=12.0.3';
            s1.async = false;
            document.head.appendChild(s1);
        }
        if (!document.querySelector('script[src*="auth_guard"]')) {
            const s2 = document.createElement('script');
            s2.src = 'js/auth_guard.js?v=12.0.4';
            s2.async = false;
            document.head.appendChild(s2);
        }
    }
    // v12：登入狀態反映到 sidebar profile 區
    function refreshAccountLink() {
        _injectProfileStyles();
        _renderProfile();
    }
    // v11.14.15：所有頁面自動載入首次使用導覽（只在首頁自動彈）
    function loadOnboarding() {
        if (document.querySelector('script[src*="onboarding"]')) return;
        const s = document.createElement('script');
        s.src = 'js/onboarding.js?v=12.0.5';
        s.async = true;
        document.head.appendChild(s);
    }
    function addTourButton() {
        const root = document.getElementById('sidebarRoot');
        if (!root) return;
        const menu = root.querySelector('.sidebar-menu');
        if (!menu || root.querySelector('.sidebar-tour-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'sidebar-link sidebar-tour-btn';
        btn.style.cssText = 'background:transparent;border:0;color:#888;width:100%;text-align:left;cursor:pointer;padding:0.5rem 1rem;font-size:0.85rem;display:flex;align-items:center;gap:0.6rem;border-top:1px solid rgba(255,255,255,0.05);margin-top:0.5rem;';
        btn.innerHTML = '<span style="font-size:1.1rem;">❓</span><span class="sidebar-label">重看導覽</span>';
        btn.title = '重新開始首次使用導覽';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.__resetTour === 'function') window.__resetTour();
        });
        menu.appendChild(btn);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            loadAuth();
            loadPwaInstall();
            loadOnboarding();
            setTimeout(() => { addTourButton(); refreshAccountLink(); }, 300);
        });
    } else {
        loadAuth();
        loadPwaInstall();
        loadOnboarding();
        setTimeout(() => { addTourButton(); refreshAccountLink(); }, 300);
    }
    // 登入狀態變化時更新 sidebar 連結
    setTimeout(() => {
        if (window.onAuthChange) window.onAuthChange(refreshAccountLink);
    }, 500);
    // v12.0.8：用 storage event 監聽其他 tab 的登入/登出，並追加一次定時 refresh
    //   避免 auth.js 載入延遲導致 sidebar 一開始顯示「訪客」
    window.addEventListener('storage', (e) => {
        if (e.key === 'tw_jwt_access' || e.key === 'tw_user_profile') {
            refreshAccountLink();
        }
    });
    // 載入後再追幾次 refresh，確保 token 有抓到（auth.js IIFE 可能晚 200-800ms 完成 /api/me）
    setTimeout(refreshAccountLink, 800);
    setTimeout(refreshAccountLink, 1800);
})();
