/**
 * 雲端帳號綁定 — v13.2.1
 *
 * 為什麼獨立成一個檔：
 *   自選股頁與虛擬投資頁都要把「Google 登入的帳號」對應回「雲端資料的暱稱 uid」，
 *   原本只有 watchlist.js 有做，paper_trade.js 直接讀 localStorage → 新裝置永遠
 *   顯示「偵測不到登入狀態」，跟 Discord 通知（NOTIFY_UID=暱稱）對不起來。
 *
 * 為什麼不用 window.isLoggedIn()：
 *   auth.js 是 sidebar.js 動態插入的 <script>，非同步載入，通常比本檔的初始化晚
 *   200~800ms 完成。依賴它會讓對帳整段被跳過。改成直接檢查 token（與 sidebar.js
 *   line 135 相同做法）。token 過期時 /api/me 會回 401，走 r.ok 分支自然略過。
 */
(function () {
    'use strict';

    const WORKER = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';
    const UID_KEY = 'tw_stock_cloud_uid';
    const TOKEN_KEY = 'tw_stock_cloud_token';
    const JWT_KEY = 'tw_jwt_access';

    /**
     * 決定要「採用伺服器的」還是「把本地的回寫」。純函式，方便測試。
     * @returns {{uid:string, patch:string, reason:'adopt'|'heal'|'ok'|'none'}}
     */
    function _resolveCloudBinding(localUid, serverBn) {
        const local = (localUid || '').trim();
        const server = (serverBn || '').trim();
        if (!local && server) return { uid: server, patch: '', reason: 'adopt' };
        // 舊裝置在 v12.4.7 之前就有 uid，伺服器卻沒綁定 → 回寫，讓新裝置能自動接通
        if (local && !server) return { uid: local, patch: local, reason: 'heal' };
        return { uid: local, patch: '', reason: local ? 'ok' : 'none' };
    }

    /**
     * 與伺服器對帳並回傳最終該用的 uid（同時寫回 localStorage）。
     * 任何失敗都回退成本地值 — 綁定是加分項，不該讓頁面整個掛掉。
     */
    async function resolveCloudUid() {
        const localUid = localStorage.getItem(UID_KEY) || '';
        const jwt = localStorage.getItem(JWT_KEY) || '';
        if (!jwt) return localUid;

        try {
            const r = await fetch(`${WORKER}/api/me`, {
                headers: { 'Authorization': `Bearer ${jwt}` },
            });
            if (!r.ok) return localUid;
            const j = await r.json();
            const d = _resolveCloudBinding(localUid, j?.user?.bound_nickname);

            if (d.reason === 'adopt') {
                localStorage.setItem(UID_KEY, d.uid);
                if (!localStorage.getItem(TOKEN_KEY)) {
                    localStorage.setItem(TOKEN_KEY, crypto.randomUUID());
                }
                console.log(`[cloud-sync] 自動綁定舊暱稱：${d.uid}`);
            } else if (d.patch) {
                await fetch(`${WORKER}/api/me`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${jwt}`,
                    },
                    body: JSON.stringify({ bound_nickname: d.patch }),
                });
                console.log(`[cloud-sync] 已補綁「${d.patch}」，其他裝置登入即可自動接通`);
            }
            return d.uid;
        } catch (e) {
            console.warn('[cloud-sync] /api/me 對帳失敗:', e.message);
            return localUid;
        }
    }

    window._resolveCloudBinding = _resolveCloudBinding;
    window.resolveCloudUid = resolveCloudUid;
})();
