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
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadPwaInstall);
    } else {
        loadPwaInstall();
    }
})();
