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
        // v12：帳號連結 — 已登入 = 「我的帳號」，未登入 = 「登入 / 註冊」
        { id: 'account', icon: '👤', label: '我的帳號', href: 'account.html', _dynamic: 'account' },
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
                <button class="sidebar-toggle" id="sidebarToggle" title="收合/展開">
                    ☰
                </button>
                <ul class="sidebar-menu">${items}</ul>
                <div class="sidebar-footer">
                    v11.14 · AI 操盤系統
                </div>
            </aside>
        `;
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
            s1.src = 'js/auth.js?v=12.0.0';
            s1.async = false;
            document.head.appendChild(s1);
        }
        if (!document.querySelector('script[src*="auth_guard"]')) {
            const s2 = document.createElement('script');
            s2.src = 'js/auth_guard.js?v=12.0.0';
            s2.async = false;
            document.head.appendChild(s2);
        }
    }
    // v12：登入狀態反映到 sidebar
    function refreshAccountLink() {
        const root = document.getElementById('sidebarRoot');
        if (!root) return;
        const li = root.querySelector('li[data-id="account"]');
        if (!li) return;
        const link = li.querySelector('a.sidebar-link');
        if (!link) return;
        const loggedIn = window.isLoggedIn && window.isLoggedIn();
        const user = window.getCurrentUser && window.getCurrentUser();
        if (loggedIn && user) {
            link.href = 'account.html';
            link.innerHTML = `<span class="sidebar-icon">👤</span><span class="sidebar-label">${user.display_name || '我的帳號'}</span>`;
        } else {
            link.href = 'auth.html';
            link.innerHTML = `<span class="sidebar-icon">🔑</span><span class="sidebar-label">登入 / 註冊</span>`;
        }
    }
    // v11.14.15：所有頁面自動載入首次使用導覽（只在首頁自動彈）
    function loadOnboarding() {
        if (document.querySelector('script[src*="onboarding"]')) return;
        const s = document.createElement('script');
        s.src = 'js/onboarding.js?v=11.14.15';
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
})();
