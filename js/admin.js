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
    if (_adminPw) loadUsers();
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
    } else {
        _adminPw = null;
        document.getElementById('adminLoginMsg').textContent = '❌ 密碼錯誤';
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
