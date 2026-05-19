// onboarding.js — 首次使用導覽 (v11.14.15)
//
// 行為：
//   - 第一次進站 (localStorage 沒 flag) → 自動彈出歡迎卡
//   - 用戶按「開始導覽」→ 依序高亮各功能（spotlight overlay）
//   - 任一步驟可跳過 / 上一步 / 下一步
//   - 結束後存 flag，再進站不再彈
//   - 用戶可透過 sidebar「？」按鈕或 console.__startTour() 重啟

(function () {
    'use strict';

    const STORAGE_KEY = 'tw_onboarding_completed_v1';

    // 步驟定義：選器、標題、說明
    const STEPS = [
        {
            selector: null,
            title: '👋 歡迎使用台股 AI 盤勢分析器',
            body: `這是由 AI 驅動的台股分析系統，整合<b>盤勢、自選股、族群輪動、市場雷達、虛擬投資</b>。<br><br>
                   讓我用 30 秒帶你看一遍最重要的功能。`,
            position: 'center',
        },
        {
            selector: '.sidebar-menu a[href*="index.html"]',
            title: '📊 盤勢總覽',
            body: '首頁顯示<b>大盤、晨間 AI 快報、美股龍頭、宏觀風險</b>等。每天三場（07/10/14/18）自動更新。',
            position: 'right',
        },
        {
            selector: '.sidebar-menu a[href*="watchlist.html"]',
            title: '⭐ 自選股',
            body: '加入你關注的個股，每 15 分鐘 AI 自動更新分析。<br><br>v11.14.10 起可<b>填入投資成本</b>讓 AI 給「續抱/加碼/停損」具體建議。',
            position: 'right',
        },
        {
            selector: '.sidebar-menu a[href*="sectors.html"]',
            title: '🗺️ 族群地圖',
            body: '<b>產業鏈分析 + 資金輪動</b>。看哪個族群在燒、哪個被棄、明天可能輪到誰。',
            position: 'right',
        },
        {
            selector: '.sidebar-menu li[data-id="scout"]',
            title: '🔭 市場雷達',
            body: `<b>每日盤後從全市場掃 8 個榜：</b><br>
                   🚀 法人籌碼 / 🔥 強勢股(日/週/月) / 📊 量增榜 / 🎯 籌碼集中 / 🚀 月營收 YoY / 🐳 大戶布局<br><br>
                   一眼看完今天哪些股值得追蹤。`,
            position: 'right',
        },
        {
            selector: '.sidebar-menu a[href*="paper_trade.html"]',
            title: '💰 虛擬投資',
            body: 'AI 機器人會用<b>真實規則 + 即時資料</b>做模擬交易。<br><br>你可以看 AI 怎麼進場、出場、停損、分批止盈，學交易邏輯。',
            position: 'right',
        },
        {
            selector: '.sidebar-menu a[href*="leaderboard.html"]',
            title: '🏆 排行榜',
            body: '已實現損益排名 — 你 vs AI vs 其他用戶。<br><br>在自選股頁勾選「加入排行榜」就會出現你的戰績。',
            position: 'right',
        },
        {
            selector: null,
            title: '🎉 完成！',
            body: `你可以隨時點 sidebar 底部的 <b>「❓ 重看導覽」</b> 重新看一次。<br><br>
                   有問題可以用 <b>「💬 AI 助手」</b>（右下角紫色泡泡），直接問股市相關問題。<br><br>
                   <span style="color:#ffce5e;">祝交易順利 💰</span>`,
            position: 'center',
        },
    ];

    let currentStep = 0;

    function injectStyles() {
        if (document.getElementById('onboardingStyles')) return;
        const css = `
            /* v11.14.16 fix：backdrop 改透明（只負責接 click），
               變暗完全交給 spotlight 的 box-shadow，避免雙重暗化 */
            .onb-backdrop {
                position: fixed; inset: 0;
                background: rgba(0, 0, 0, 0.45);   /* 沒有 spotlight 時（首/末頁）才會看到 */
                z-index: 99990;
                animation: onbFadeIn 0.2s ease;
            }
            @keyframes onbFadeIn { from { opacity: 0 } to { opacity: 1 } }
            /* spotlight 顯示時，覆蓋 backdrop 讓 hole 區域露出原本背景 */
            body.onb-spotlight-active .onb-backdrop {
                background: transparent;
            }
            .onb-spotlight {
                position: fixed;
                z-index: 99993;   /* 比 backdrop 高，box-shadow 才能蓋住 backdrop */
                pointer-events: none;
                border-radius: 12px;
                /* 用 box-shadow 9999px 從 hole 向外擴出半透明黑，配合下方亮紫框 */
                box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55),
                            0 0 0 3px rgba(180, 130, 255, 0.85),
                            0 0 25px rgba(180, 130, 255, 0.4);
                transition: all 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1);
            }
            .onb-card {
                position: fixed;
                z-index: 99992;
                /* v12.0.3：背景加亮並加紫色光暈，跟頁面對比強烈 */
                background: linear-gradient(135deg, #2d2d4f, #34457a);
                border: 2px solid rgba(180, 130, 255, 0.7);
                border-radius: 14px;
                padding: 1.3rem 1.4rem;
                max-width: 380px;
                width: calc(100vw - 2rem);
                box-shadow:
                    0 12px 40px rgba(0, 0, 0, 0.8),
                    0 0 40px rgba(180, 130, 255, 0.35),
                    inset 0 1px 0 rgba(255, 255, 255, 0.08);
                color: #fff;
                animation: onbSlide 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1);
            }
            @keyframes onbSlide { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
            .onb-card-title {
                font-size: 1.15rem; font-weight: 700;
                color: #ffe9c2;
                margin-bottom: 0.7rem;
                line-height: 1.4;
                text-shadow: 0 1px 2px rgba(0,0,0,0.4);
            }
            .onb-card-body {
                font-size: 0.92rem; line-height: 1.7;
                color: #f0e8ff;
                margin-bottom: 1rem;
            }
            .onb-card-body b { color: #ffd966; font-weight: 700; }
            .onb-card-progress {
                font-size: 0.78rem;
                color: #c9b3ff;
                margin-bottom: 0.5rem;
                font-weight: 600;
            }
            .onb-progress-bar {
                width: 100%; height: 3px;
                background: rgba(255, 255, 255, 0.08);
                border-radius: 2px; overflow: hidden;
                margin-bottom: 1rem;
            }
            .onb-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #7c5cff, #b794ff);
                transition: width 0.3s;
            }
            .onb-actions {
                display: flex; gap: 0.5rem; align-items: center;
            }
            .onb-btn {
                padding: 0.55rem 1rem;
                border: 0; border-radius: 8px;
                cursor: pointer; font-size: 0.85rem;
                font-weight: 600;
                transition: all 0.15s;
            }
            .onb-btn-primary {
                background: linear-gradient(135deg, #7c5cff, #5a8aff);
                color: white;
                margin-left: auto;
            }
            .onb-btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
            .onb-btn-secondary {
                background: rgba(255, 255, 255, 0.08);
                color: #aaa;
            }
            .onb-btn-secondary:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
            .onb-btn-skip {
                background: transparent;
                color: #777;
                font-size: 0.78rem;
                padding: 0.55rem 0.5rem;
            }
            .onb-btn-skip:hover { color: #ccc; }
            /* 手機 RWD：card 永遠在底部 */
            @media (max-width: 768px) {
                .onb-card {
                    left: 1rem !important;
                    right: 1rem !important;
                    bottom: 1rem !important;
                    top: auto !important;
                    transform: none !important;
                    max-width: none;
                    width: auto;
                }
            }
        `;
        const s = document.createElement('style');
        s.id = 'onboardingStyles';
        s.textContent = css;
        document.head.appendChild(s);
    }

    function findTarget(selector) {
        if (!selector) return null;
        return document.querySelector(selector);
    }

    function positionElements(step) {
        const backdrop = document.getElementById('onbBackdrop');
        const spotlight = document.getElementById('onbSpotlight');
        const card = document.getElementById('onbCard');
        if (!backdrop || !card) return;

        const target = findTarget(step.selector);

        if (!target) {
            // 沒有 target → spotlight 隱藏，card 置中，backdrop 變正常黑
            if (spotlight) spotlight.style.display = 'none';
            document.body.classList.remove('onb-spotlight-active');
            card.style.cssText += '; left: 50%; top: 50%; transform: translate(-50%, -50%);';
            return;
        }
        // 有 spotlight → backdrop 變透明（避免雙重暗化）
        document.body.classList.add('onb-spotlight-active');

        // 手機：先確保 sidebar 是打開的，讓 target 可見
        if (window.innerWidth <= 768) {
            if (step.selector && step.selector.includes('.sidebar-menu')) {
                document.body.classList.add('sidebar-open');
            }
        }

        const rect = target.getBoundingClientRect();
        const padding = 8;

        // 滾動目標進入視窗
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 滾動後 rect 會變，延後重新定位
            setTimeout(() => positionElements(step), 350);
            return;
        }

        // 重新 measure
        const r = target.getBoundingClientRect();
        spotlight.style.display = 'block';
        spotlight.style.left = (r.left - padding) + 'px';
        spotlight.style.top = (r.top - padding) + 'px';
        spotlight.style.width = (r.width + padding * 2) + 'px';
        spotlight.style.height = (r.height + padding * 2) + 'px';

        // 桌機：card 放在 spotlight 右側
        if (window.innerWidth > 768) {
            const cardWidth = 380;
            let left = r.right + 20;
            // 螢幕右側放不下 → 改放下方
            if (left + cardWidth > window.innerWidth - 20) {
                left = r.left;
            }
            const top = Math.max(20, r.top);
            card.style.cssText += `; left: ${left}px; top: ${top}px; transform: none;`;
        }
    }

    function renderStep(idx) {
        const step = STEPS[idx];
        const card = document.getElementById('onbCard');
        if (!card) return;
        const isFirst = idx === 0;
        const isLast = idx === STEPS.length - 1;
        const progressPct = ((idx + 1) / STEPS.length) * 100;

        card.innerHTML = `
            <div class="onb-card-progress">第 ${idx + 1} 步 / 共 ${STEPS.length} 步</div>
            <div class="onb-progress-bar"><div class="onb-progress-fill" style="width:${progressPct}%;"></div></div>
            <div class="onb-card-title">${step.title}</div>
            <div class="onb-card-body">${step.body}</div>
            <div class="onb-actions">
                ${!isFirst ? '<button class="onb-btn onb-btn-secondary" id="onbPrev">← 上一步</button>' : ''}
                <button class="onb-btn onb-btn-skip" id="onbSkip">${isLast ? '' : '跳過導覽'}</button>
                <button class="onb-btn onb-btn-primary" id="onbNext">${isLast ? '✓ 開始使用' : (isFirst ? '🚀 開始導覽' : '下一步 →')}</button>
            </div>
        `;

        document.getElementById('onbPrev')?.addEventListener('click', () => goTo(idx - 1));
        document.getElementById('onbSkip')?.addEventListener('click', exitTour);
        document.getElementById('onbNext')?.addEventListener('click', () => {
            if (isLast) exitTour();
            else goTo(idx + 1);
        });

        positionElements(step);
    }

    function goTo(idx) {
        if (idx < 0 || idx >= STEPS.length) return;
        currentStep = idx;
        renderStep(idx);
    }

    function exitTour() {
        const ids = ['onbBackdrop', 'onbSpotlight', 'onbCard'];
        ids.forEach(id => document.getElementById(id)?.remove());
        document.body.classList.remove('onb-spotlight-active');
        localStorage.setItem(STORAGE_KEY, '1');
        if (window.innerWidth <= 768) {
            document.body.classList.remove('sidebar-open');
        }
    }

    function startTour() {
        injectStyles();
        // 避免重複
        if (document.getElementById('onbBackdrop')) return;

        const backdrop = document.createElement('div');
        backdrop.id = 'onbBackdrop';
        backdrop.className = 'onb-backdrop';
        backdrop.addEventListener('click', exitTour);
        document.body.appendChild(backdrop);

        const spotlight = document.createElement('div');
        spotlight.id = 'onbSpotlight';
        spotlight.className = 'onb-spotlight';
        spotlight.style.display = 'none';
        document.body.appendChild(spotlight);

        const card = document.createElement('div');
        card.id = 'onbCard';
        card.className = 'onb-card';
        document.body.appendChild(card);

        currentStep = 0;
        renderStep(0);

        // resize 時重新定位
        window.addEventListener('resize', () => {
            if (document.getElementById('onbCard')) {
                positionElements(STEPS[currentStep]);
            }
        });
    }

    // 自動啟動（首次進站）
    function maybeAutoStart() {
        if (localStorage.getItem(STORAGE_KEY) === '1') return;
        // 只在首頁自動跑（避免進其他頁也跳）
        const path = (location.pathname || '').toLowerCase();
        const isHome = path.endsWith('/') || path.endsWith('index.html') || path === '' || path === '/';
        if (!isHome) return;
        // 等 sidebar 載入完成
        setTimeout(startTour, 1200);
    }

    // Console / sidebar 按鈕用
    window.__startTour = startTour;
    window.__resetTour = () => {
        localStorage.removeItem(STORAGE_KEY);
        startTour();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeAutoStart);
    } else {
        maybeAutoStart();
    }
})();
