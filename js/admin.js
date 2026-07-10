/**
 * v10.8 總控管 Admin 前端
 */

const WORKER_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';
const ADMIN_PW_KEY = 'tw_stock_admin_pw';

let _adminPw = null;

document.addEventListener('DOMContentLoaded', () => {
    _adminPw = sessionStorage.getItem(ADMIN_PW_KEY) || null;
    document.getElementById('adminLoginBtn').addEventListener('click', tryLogin);
    document.getElementById('adminPwInput').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
    document.getElementById('adminRefreshBtn').addEventListener('click', loadUsers);
    document.getElementById('adminWatchRefreshBtn')?.addEventListener('click', () => loadWatchlists());
    if (_adminPw) { loadUsers(); loadWatchlists(); }
});

async function tryLogin() {
    const pw = document.getElementById('adminPwInput').value.trim();
    if (!pw) return;
    _adminPw = pw;
    const ok = await loadUsers(true);
    if (ok) {
        sessionStorage.setItem(ADMIN_PW_KEY, pw);
        document.getElementById('adminLoginCard').style.display = 'none';
        document.getElementById('adminContent').style.display = 'block';
        loadWatchlists();
    } else {
        _adminPw = null;
        document.getElementById('adminLoginMsg').textContent = '❌ 密碼錯誤';
    }
}

// ============================================================
// v12.8.5：自選股監控 — 看所有用戶標的 + 移除個股
// ============================================================

function _cnName(sym) {
    if (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym]) return TW_STOCK_MAP[sym];
    return '';
}

async function loadWatchlists() {
    const listEl = document.getElementById('adminWatchList');
    if (!listEl || !_adminPw) return;
    listEl.innerHTML = '<p class="text-muted">載入中…</p>';
    try {
        const r = await fetch(`${WORKER_URL}/api/watchlist/admin?admin_pw=${encodeURIComponent(_adminPw)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        renderWatchlists(data);
    } catch (e) {
        listEl.innerHTML = `<p class="text-negative">載入失敗：${escapeHtml(e.message)}</p>`;
    }
}

function renderWatchlists(data) {
    const listEl = document.getElementById('adminWatchList');
    const sumEl = document.getElementById('adminWatchSummary');
    const users = data.users || [];
    const totalUnique = data.total_unique_symbols || 0;
    const usage = data.symbol_usage || {};

    if (sumEl) {
        // 負載燈號：不重複標的 > 80 檔開始黃燈、> 150 紅燈（AI 分析 token 消耗基準）
        const light = totalUnique > 150 ? '🔴' : totalUnique > 80 ? '🟡' : '🟢';
        sumEl.textContent = `(${users.length} 用戶 · 不重複標的 ${totalUnique} 檔 ${light})`;
    }
    if (users.length === 0) {
        listEl.innerHTML = '<p class="text-muted">目前無用戶自選股。</p>';
        return;
    }

    listEl.innerHTML = users.map(u => {
        const chips = (u.symbols || []).map(sym => {
            const cn = _cnName(sym);
            const shared = (usage[sym] || 1) > 1;
            return `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px;padding:2px 8px;
                        border-radius:12px;font-size:0.75rem;background:${shared ? 'rgba(120,80,255,0.15)' : 'rgba(255,255,255,0.06)'};
                        border:1px solid rgba(255,255,255,0.1);"
                        title="${shared ? `另有 ${usage[sym] - 1} 個用戶也追蹤` : '只有這個用戶追蹤'}">
                ${cn ? `${cn} ` : ''}${escapeHtml(sym)}
                <span onclick="adminRemoveSymbol('${escapeHtml(u.uid)}','${escapeHtml(sym)}')"
                      style="cursor:pointer;color:#ff6b6b;font-weight:700;padding:0 2px;"
                      title="從 ${escapeHtml(u.uid)} 移除">✕</span>
            </span>`;
        }).join('');
        return `<div style="margin-bottom:1rem;padding:0.8rem 1rem;background:rgba(255,255,255,0.03);border-radius:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:0.4rem;">
                <b>${escapeHtml(u.uid)}</b>
                <span class="text-muted" style="font-size:0.75rem;">${u.count} 檔 · 更新 ${_fmtTime(u.updated_at)}</span>
            </div>
            <div>${chips || '<span class="text-muted" style="font-size:0.75rem;">（空清單）</span>'}</div>
        </div>`;
    }).join('');
}

async function adminRemoveSymbol(uid, symbol) {
    if (!confirm(`確定從「${uid}」移除 ${symbol}？\n（該用戶下次同步時會看到清單少了這檔）`)) return;
    try {
        const r = await fetch(`${WORKER_URL}/api/watchlist/admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_pw: _adminPw, action: 'remove_symbol', uid, symbol }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        showMsg('✅ ' + (data.summary || '已移除'));
        loadWatchlists();
    } catch (e) {
        showMsg('❌ ' + e.message);
    }
}

async function loadUsers(silent) {
    try {
        const r = await fetch(`${WORKER_URL}/api/paper-trade/admin?admin_pw=${encodeURIComponent(_adminPw)}`);
        if (r.status === 403) return false;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        document.getElementById('adminLoginCard').style.display = 'none';
        document.getElementById('adminContent').style.display = 'block';
        renderUsers(data.users || []);
        document.getElementById('adminUserCount').textContent = `(共 ${data.count || 0} 人)`;
        if (!silent) showMsg(`✅ 已載入 ${data.count} 位使用者`);
        return true;
    } catch (e) {
        showMsg('❌ ' + e.message);
        return false;
    }
}

function showMsg(txt) {
    const el = document.getElementById('adminActionMsg');
    el.textContent = txt;
    setTimeout(() => { if (el.textContent === txt) el.textContent = ''; }, 5000);
}

function _fmtMoney(n) {
    if (n == null) return '—';
    return new Intl.NumberFormat('zh-TW').format(Math.round(n));
}
function _fmtTime(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleString('zh-TW', { hour12: false }); }
    catch { return s; }
}

function renderUsers(users) {
    const container = document.getElementById('adminUserList');
    if (users.length === 0) {
        container.innerHTML = '<p class="text-muted">目前無使用者帳簿。</p>';
        return;
    }
    container.innerHTML = `
        <table class="pt-stats-tbl" style="width:100%;font-size:0.8rem;">
            <thead><tr>
                <th>暱稱</th>
                <th>自動交易</th>
                <th>密碼</th>
                <th>現金</th>
                <th>持倉</th>
                <th>已實現</th>
                <th>交易次數</th>
                <th>引擎</th>
                <th>動作</th>
            </tr></thead>
            <tbody>
                ${users.map(u => {
                    const autoIcon = u.auto_trade ? '<span class="text-positive">✅ 開</span>' : '<span class="text-muted">❌ 關</span>';
                    const pwIcon = u.has_password ? '🔒' : '🔓';
                    const pnlCls = u.realized_pnl > 0 ? 'text-positive' : u.realized_pnl < 0 ? 'text-negative' : '';
                    return `<tr>
                        <td><b>${escapeHtml(u.uid)}</b></td>
                        <td>${autoIcon}</td>
                        <td>${pwIcon}</td>
                        <td>${_fmtMoney(u.cash)}</td>
                        <td>${u.positions_count} 檔</td>
                        <td class="${pnlCls}">${_fmtMoney(u.realized_pnl)}</td>
                        <td>${u.total_trades}</td>
                        <td style="font-size:0.7rem;">${_fmtTime(u.engine_updated_at)}</td>
                        <td>
                            ${u.auto_trade
                                ? `<button class="btn-secondary btn-sm" onclick="adminAction('force_disable_auto_trade','${escapeHtml(u.uid)}','強制關閉 ${escapeHtml(u.uid)} 的自動交易？')">🛑 關 auto</button>`
                                : `<button class="btn-secondary btn-sm" onclick="adminAction('force_enable_auto_trade','${escapeHtml(u.uid)}','開啟 ${escapeHtml(u.uid)} 的自動交易？')">▶️ 開 auto</button>`
                            }
                            <button class="btn-secondary btn-sm" onclick="adminAction('clear_access_password','${escapeHtml(u.uid)}','解除 ${escapeHtml(u.uid)} 的存取密碼？')">🔓 清密碼</button>
                            <button class="btn-secondary btn-sm" onclick="adminAction('reset_account','${escapeHtml(u.uid)}','⚠️ 重置 ${escapeHtml(u.uid)} 的帳戶？持倉/歷史會清空，但密碼保留')">🔄 重置</button>
                            <button class="btn-secondary btn-sm" style="color:#ff6b6b;" onclick="adminAction('delete_user','${escapeHtml(u.uid)}','⚠️ 徹底刪除 ${escapeHtml(u.uid)} 的整份帳簿？此動作無法復原')">🗑️ 刪除</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
}

async function adminAction(action, uid, confirmText) {
    if (!confirm(confirmText)) return;
    try {
        const r = await fetch(`${WORKER_URL}/api/paper-trade/admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_pw: _adminPw, action, uid }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || data.message || `HTTP ${r.status}`);
        showMsg('✅ ' + (data.summary || '動作完成'));
        await loadUsers(true);
    } catch (e) {
        showMsg('❌ ' + e.message);
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 給 onclick 呼叫用
window.adminAction = adminAction;
