// pwa_install.js — PWA 安裝引導 (v11.14.13)
//
// 行為：
//   - Android Chrome / Edge：擋下 beforeinstallprompt，用自製 UI 引導，按下「安裝」呼叫原生 prompt
//   - iOS Safari：沒有自動 prompt API，只能顯示「分享 → 加入主畫面」教學步驟
//   - 桌機：擋掉不顯示（桌機 Chrome 有自己的 install icon）
//   - 已安裝：不顯示（display-mode: standalone 偵測）
//   - 用戶按過「不再提醒」：localStorage flag 永不再彈
//   - 用戶 dismiss：14 天後可再彈

(function () {
    'use strict';

    const STORAGE_KEY_NEVER = 'tw_pwa_install_never';
    const STORAGE_KEY_LAST_DISMISS = 'tw_pwa_install_last_dismiss';
    const COOLDOWN_DAYS = 14;

    let deferredPrompt = null;

    // ===== 偵測環境 =====
    function isMobile() {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    }
    function isIOS() {
        return /iPhone|iPad|iPod/i.test(navigator.userAgent);
    }
    function isInStandalone() {
        return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;   // iOS specific
    }
    function shouldShow() {
        if (!isMobile()) return false;
        if (isInStandalone()) return false;
        if (localStorage.getItem(STORAGE_KEY_NEVER) === '1') return false;
        const lastDismiss = parseInt(localStorage.getItem(STORAGE_KEY_LAST_DISMISS) || '0', 10);
        if (lastDismiss) {
            const elapsed = Date.now() - lastDismiss;
            if (elapsed < COOLDOWN_DAYS * 86400000) return false;
        }
        return true;
    }

    // ===== Android：beforeinstallprompt =====
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (shouldShow()) {
            setTimeout(() => showInstallSheet(false), 1500);  // 進站 1.5s 後彈
        }
    });

    // ===== iOS：手動顯示教學 =====
    document.addEventListener('DOMContentLoaded', () => {
        if (isIOS() && shouldShow()) {
            setTimeout(() => showInstallSheet(true), 2000);
        }
    });

    // ===== UI =====
    function showInstallSheet(isIOSMode) {
        if (document.getElementById('pwaInstallSheet')) return;

        const styles = `
            .pwa-sheet-backdrop {
                position: fixed; inset: 0;
                background: rgba(0, 0, 0, 0.7);
                z-index: 99998;
                animation: pwaFadeIn 0.25s ease;
            }
            .pwa-sheet {
                position: fixed; left: 0; right: 0; bottom: 0;
                background: #1a1a1f;
                border-radius: 18px 18px 0 0;
                padding: 1.2rem 1.2rem 2rem;
                z-index: 99999;
                box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5);
                animation: pwaSlideUp 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1);
                color: #eee;
            }
            @keyframes pwaFadeIn { from { opacity: 0 } to { opacity: 1 } }
            @keyframes pwaSlideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
            .pwa-sheet-header {
                display: flex; align-items: center; gap: 0.8rem;
                margin-bottom: 1rem;
            }
            .pwa-sheet-icon {
                width: 48px; height: 48px;
                background: linear-gradient(135deg, #b794ff, #7c5cff);
                border-radius: 12px;
                display: flex; align-items: center; justify-content: center;
                font-size: 1.8rem;
                flex-shrink: 0;
            }
            .pwa-sheet-title { font-size: 1.05rem; font-weight: 700; line-height: 1.3; }
            .pwa-sheet-subtitle { font-size: 0.82rem; color: #aaa; margin-top: 0.2rem; }
            .pwa-sheet-close {
                margin-left: auto; background: transparent;
                border: 0; color: #aaa; font-size: 1.3rem; cursor: pointer;
                padding: 0.3rem 0.5rem;
            }
            .pwa-tabs {
                display: flex; gap: 0.5rem; margin-bottom: 1rem;
                background: rgba(255, 255, 255, 0.04);
                border-radius: 10px; padding: 0.25rem;
            }
            .pwa-tab {
                flex: 1; padding: 0.5rem; text-align: center;
                background: transparent; border: 0;
                color: #aaa; cursor: pointer;
                border-radius: 8px; font-size: 0.85rem;
                transition: all 0.15s;
            }
            .pwa-tab.active {
                background: rgba(120, 80, 255, 0.25);
                color: #c9b3ff; font-weight: 700;
            }
            .pwa-steps { display: flex; flex-direction: column; gap: 0.7rem; margin-bottom: 1rem; }
            .pwa-step {
                display: flex; gap: 0.6rem; align-items: flex-start;
                background: rgba(255, 255, 255, 0.04);
                padding: 0.7rem 0.8rem; border-radius: 10px;
                font-size: 0.85rem; line-height: 1.5;
            }
            .pwa-step-num {
                width: 26px; height: 26px; border-radius: 50%;
                background: #2d8f4f; color: white;
                display: flex; align-items: center; justify-content: center;
                font-weight: 700; font-size: 0.85rem;
                flex-shrink: 0;
            }
            .pwa-step kbd {
                display: inline-flex; align-items: center;
                padding: 1px 6px; background: rgba(255, 255, 255, 0.1);
                border-radius: 4px; font-size: 0.78rem;
                border: 1px solid rgba(255, 255, 255, 0.15);
            }
            .pwa-tip { font-size: 0.75rem; color: #888; line-height: 1.5; margin-top: 0.5rem; }
            .pwa-actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
            .pwa-btn {
                flex: 1; padding: 0.7rem;
                border: 0; border-radius: 10px; cursor: pointer;
                font-size: 0.9rem; font-weight: 600;
            }
            .pwa-btn-primary { background: linear-gradient(135deg, #7c5cff, #5a8aff); color: white; }
            .pwa-btn-secondary { background: rgba(255, 255, 255, 0.08); color: #ccc; }
            .pwa-btn-never { background: transparent; color: #777; font-size: 0.75rem; padding: 0.5rem; }
        `;
        if (!document.getElementById('pwaInstallStyles')) {
            const s = document.createElement('style');
            s.id = 'pwaInstallStyles';
            s.textContent = styles;
            document.head.appendChild(s);
        }

        const initialTab = isIOSMode ? 'ios' : 'android';
        const backdrop = document.createElement('div');
        backdrop.className = 'pwa-sheet-backdrop';
        backdrop.addEventListener('click', dismiss);
        document.body.appendChild(backdrop);

        const sheet = document.createElement('div');
        sheet.id = 'pwaInstallSheet';
        sheet.className = 'pwa-sheet';
        sheet.innerHTML = `
            <div class="pwa-sheet-header">
                <div class="pwa-sheet-icon">⚡</div>
                <div>
                    <div class="pwa-sheet-title">安裝台股 AI 盤勢分析器</div>
                    <div class="pwa-sheet-subtitle">釘在桌面像 App 一樣使用</div>
                </div>
                <button class="pwa-sheet-close" id="pwaSheetClose">✕</button>
            </div>
            <div class="pwa-tabs">
                <button class="pwa-tab ${initialTab === 'ios' ? 'active' : ''}" data-tab="ios">🍎 iPhone / iPad</button>
                <button class="pwa-tab ${initialTab === 'android' ? 'active' : ''}" data-tab="android">🤖 Android / Chrome</button>
            </div>
            <div id="pwaTabContent"></div>
            <button class="pwa-btn-never" id="pwaNever">不再顯示</button>
        `;
        document.body.appendChild(sheet);

        function renderTab(tab) {
            const html = tab === 'ios' ? renderIOS() : renderAndroid();
            sheet.querySelector('#pwaTabContent').innerHTML = html;
            sheet.querySelectorAll('.pwa-tab').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === tab);
            });
            // 綁定 Android 的安裝按鈕
            const btn = sheet.querySelector('#pwaInstallBtn');
            if (btn && deferredPrompt) {
                btn.addEventListener('click', triggerInstall);
            }
        }

        sheet.querySelectorAll('.pwa-tab').forEach(b => {
            b.addEventListener('click', () => renderTab(b.dataset.tab));
        });
        sheet.querySelector('#pwaSheetClose').addEventListener('click', dismiss);
        sheet.querySelector('#pwaNever').addEventListener('click', () => {
            localStorage.setItem(STORAGE_KEY_NEVER, '1');
            dismiss();
        });

        renderTab(initialTab);

        function renderAndroid() {
            const supportsAuto = !!deferredPrompt;
            return `
                <div class="pwa-steps">
                    ${supportsAuto ? `
                        <div class="pwa-step">
                            <div class="pwa-step-num">1</div>
                            <div>點下方「立即安裝」按鈕，瀏覽器會跳出系統確認視窗</div>
                        </div>
                        <div class="pwa-step">
                            <div class="pwa-step-num">2</div>
                            <div>選擇 <kbd>安裝</kbd>，圖示會出現在桌面</div>
                        </div>
                    ` : `
                        <div class="pwa-step">
                            <div class="pwa-step-num">1</div>
                            <div>點擊 Chrome 網址列右側的 <kbd>⋮</kbd> 選單</div>
                        </div>
                        <div class="pwa-step">
                            <div class="pwa-step-num">2</div>
                            <div>選擇 <kbd>📥 安裝應用程式</kbd> 或 <kbd>加到主畫面</kbd></div>
                        </div>
                        <div class="pwa-step">
                            <div class="pwa-step-num">3</div>
                            <div>桌面就會看到 App 圖示</div>
                        </div>
                    `}
                </div>
                <div class="pwa-tip">💡 若桌面圖示不見，請長按桌面空白處 → 確認沒鎖定主畫面後再試一次</div>
                <div class="pwa-actions">
                    ${supportsAuto
                        ? `<button class="pwa-btn pwa-btn-primary" id="pwaInstallBtn">⚡ 立即安裝</button>`
                        : `<button class="pwa-btn pwa-btn-secondary" id="pwaSheetClose2" onclick="document.getElementById('pwaSheetClose').click()">我知道了</button>`}
                </div>
            `;
        }

        function renderIOS() {
            return `
                <div class="pwa-steps">
                    <div class="pwa-step">
                        <div class="pwa-step-num">1</div>
                        <div>點 Safari 底部的「分享」按鈕 <kbd>⬆️</kbd></div>
                    </div>
                    <div class="pwa-step">
                        <div class="pwa-step-num">2</div>
                        <div>下滑找到 <kbd>📲 加入主畫面</kbd></div>
                    </div>
                    <div class="pwa-step">
                        <div class="pwa-step-num">3</div>
                        <div>右上角按 <kbd>新增</kbd>，圖示就會出現在主畫面</div>
                    </div>
                </div>
                <div class="pwa-tip">💡 必須用 <b>Safari</b>。Chrome / Line / Threads 內建瀏覽器都不支援 PWA 安裝。</div>
                <div class="pwa-actions">
                    <button class="pwa-btn pwa-btn-secondary" onclick="document.getElementById('pwaSheetClose').click()">我知道了</button>
                </div>
            `;
        }
    }

    async function triggerInstall() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            console.log('PWA install accepted');
        }
        deferredPrompt = null;
        dismiss();
    }

    function dismiss() {
        const sheet = document.getElementById('pwaInstallSheet');
        const backdrop = document.querySelector('.pwa-sheet-backdrop');
        if (sheet) sheet.remove();
        if (backdrop) backdrop.remove();
        localStorage.setItem(STORAGE_KEY_LAST_DISMISS, String(Date.now()));
    }

    // 已經安裝：監聽事件清除提示
    window.addEventListener('appinstalled', () => {
        localStorage.setItem(STORAGE_KEY_NEVER, '1');
        dismiss();
    });

    // ===== Debug：給 console 用，強制顯示 =====
    window.__pwaShowInstall = function () {
        localStorage.removeItem(STORAGE_KEY_NEVER);
        localStorage.removeItem(STORAGE_KEY_LAST_DISMISS);
        showInstallSheet(isIOS());
    };
})();
