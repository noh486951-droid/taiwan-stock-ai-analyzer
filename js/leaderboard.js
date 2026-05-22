// leaderboard.js — 跨用戶 + AI 交易戰績排行榜 (v11.14.11)

const LB_WORKER_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev';
const LB_AI_DATA = 'data/ai_bot_portfolio.json';

let _participants = [];
let _currentSort = 'total_pnl';
let _myUid = '';

document.addEventListener('DOMContentLoaded', async () => {
    _myUid = localStorage.getItem('tw_stock_cloud_uid') || '';
    document.querySelectorAll('.leaderboard-tab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('.leaderboard-tab').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            _currentSort = t.dataset.sort;
            renderTable();
        });
    });
    await loadAll();
});

async function loadAll() {
    const tasks = [loadAI(), loadUsers()];
    const results = await Promise.allSettled(tasks);
    _participants = [];
    for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            _participants.push(...r.value);
        }
    }
    renderTable();
}

async function loadAI() {
    try {
        const r = await fetch(LB_AI_DATA, { cache: 'no-store' });
        if (!r.ok) return [];
        const data = await r.json();
        const history = Array.isArray(data?.history) ? data.history : [];
        if (history.length === 0) return [];
        const stats = computeStats(history);
        return [{
            uid: 'AI 機器人',
            type: 'ai',
            stats,
            history,
        }];
    } catch (e) {
        console.warn('loadAI failed:', e);
        return [];
    }
}

async function loadUsers() {
    try {
        const r = await fetch(`${LB_WORKER_URL}/api/leaderboard`);
        if (!r.ok) return [];
        const data = await r.json();
        const users = Array.isArray(data?.users) ? data.users : [];
        // 已經帶 stats，直接用
        return users.map(u => ({
            uid: u.uid,
            type: 'user',
            stats: u.stats,
            history: u.history || [],
        }));
    } catch (e) {
        console.warn('loadUsers failed:', e);
        return [];
    }
}

function computeStats(history) {
    let wins = 0, losses = 0, totalPnl = 0, totalPnlPct = 0;
    let biggestWin = 0, biggestLoss = 0, totalDays = 0;
    for (const t of history) {
        const pnl = Number(t.pnl_abs ?? t.pnl) || 0;
        const pnlPct = Number(t.pnl_pct) || 0;
        totalPnl += pnl;
        totalPnlPct += pnlPct;
        if (pnl > 0) wins++;
        else if (pnl < 0) losses++;
        if (pnl > biggestWin) biggestWin = pnl;
        if (pnl < biggestLoss) biggestLoss = pnl;
        totalDays += Number(t.held_days ?? t.hold_days) || 0;
    }
    const n = history.length;
    return {
        total_trades: n,
        win_trades: wins,
        loss_trades: losses,
        win_rate: n > 0 ? (wins / n * 100) : 0,
        total_pnl: totalPnl,
        avg_pnl_pct: n > 0 ? (totalPnlPct / n) : 0,
        biggest_win: biggestWin,
        biggest_loss: biggestLoss,
        avg_hold_days: n > 0 ? (totalDays / n) : 0,
    };
}

function renderTable() {
    const el = document.getElementById('leaderboardContent');
    if (!_participants.length) {
        el.innerHTML = `
            <div class="lb-empty">
                <p>🚧 還沒有任何參賽者</p>
                <p style="margin-top:0.5rem;">AI 機器人需要等虛擬投資跑出交易紀錄；真實用戶要在自選股頁面勾選「加入排行榜」。</p>
            </div>`;
        return;
    }

    // 排序
    const sorted = [..._participants].sort((a, b) => {
        const va = a.stats?.[_currentSort] ?? 0;
        const vb = b.stats?.[_currentSort] ?? 0;
        return vb - va;   // 由大到小
    });

    const rows = sorted.map((p, i) => {
        const s = p.stats || {};
        const rankCls = i === 0 ? 'lb-rank lb-rank-1' : i === 1 ? 'lb-rank lb-rank-2' : i === 2 ? 'lb-rank lb-rank-3' : 'lb-rank';
        const isMe = (p.type === 'user' && p.uid === _myUid);
        const nameCls = p.type === 'ai' ? 'lb-name-ai' : (isMe ? 'lb-name-me' : '');
        const badge = p.type === 'ai' ? '<span class="lb-badge">AI</span>' : (isMe ? '<span class="lb-badge lb-badge-me">我</span>' : '');
        const totalPnlCls = s.total_pnl >= 0 ? 'text-positive' : 'text-negative';
        const avgPnlCls = s.avg_pnl_pct >= 0 ? 'text-positive' : 'text-negative';
        const winRateCls = s.win_rate >= 50 ? 'text-positive' : 'text-negative';
        const sign = s.total_pnl >= 0 ? '+' : '';
        const signPct = s.avg_pnl_pct >= 0 ? '+' : '';

        return `
            <tr>
                <td><span class="${rankCls}">${i + 1}</span></td>
                <td><span class="${nameCls}">${escapeHtml(p.uid)}</span>${badge}</td>
                <td class="num ${totalPnlCls}"><b>${sign}${formatMoney(s.total_pnl)}</b></td>
                <td class="num ${winRateCls}">${s.win_rate.toFixed(1)}%<br><span class="text-muted" style="font-size:0.72rem;">${s.win_trades}/${s.total_trades}</span></td>
                <td class="num ${avgPnlCls}">${signPct}${s.avg_pnl_pct.toFixed(2)}%</td>
                <td class="num">${s.total_trades}</td>
                <td class="num text-positive">+${formatMoney(s.biggest_win)}</td>
                <td class="num text-negative">${formatMoney(s.biggest_loss)}</td>
                <td class="num">${s.avg_hold_days.toFixed(1)} 天</td>
                <td>${p.history?.length ? `<button class="position-btn" onclick="showDetail('${escapeAttr(p.uid)}')">📜 明細</button>` : '-'}</td>
            </tr>
        `;
    }).join('');

    el.innerHTML = `
        <div style="overflow:auto;max-height:75vh;">
            <table class="lb-table">
                <thead><tr>
                    <th>#</th><th>暱稱</th>
                    <th class="num">累積獲利</th>
                    <th class="num">勝率</th>
                    <th class="num">平均單筆%</th>
                    <th class="num">總筆數</th>
                    <th class="num">最大獲利</th>
                    <th class="num">最大虧損</th>
                    <th class="num">平均持倉</th>
                    <th></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

window.showDetail = function (uid) {
    const p = _participants.find(x => x.uid === uid);
    if (!p) return;
    const history = [...(p.history || [])].sort((a, b) =>
        String(b.exit_date || '').localeCompare(String(a.exit_date || ''))
    );

    const rows = history.map(t => {
        const pnl = Number(t.pnl_abs ?? t.pnl) || 0;
        const pnlPct = Number(t.pnl_pct) || 0;
        const cls = pnl >= 0 ? 'text-positive' : 'text-negative';
        const sign = pnl >= 0 ? '+' : '';
        const sym = t.symbol || t.sym || '-';
        // v12.1.4：把代號翻成中文名（優先 getChineseName，fallback 原 name）
        let cnName = t.name || '';
        if (typeof getChineseName === 'function') {
            const looked = getChineseName(sym.includes('.') ? sym : sym + '.TW', t.name);
            if (looked && looked !== sym.replace(/\.(TW|TWO)$/, '')) cnName = looked;
        }
        return `
            <tr>
                <td><b>${sym.replace(/\.(TW|TWO)$/, '')}</b><br><span class="text-muted" style="font-size:0.7rem;">${escapeHtml(cnName)}</span></td>
                <td class="num">${t.shares ?? '-'}</td>
                <td class="num">${t.entry_price ?? '-'}</td>
                <td class="num">${t.exit_price ?? '-'}</td>
                <td>${t.entry_date || '-'}</td>
                <td>${t.exit_date || '-'}</td>
                <td class="num ${cls}"><b>${sign}${pnlPct.toFixed(2)}%</b><br><span style="font-size:0.7rem;">${sign}${Math.round(pnl).toLocaleString()}</span></td>
                <td class="text-muted" style="font-size:0.75rem;">${t.exit_reason || '-'}</td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;">無紀錄</td></tr>';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'display:flex;z-index:10000;';
    modal.innerHTML = `
        <div class="modal-content glass" style="max-width:900px;width:95vw;">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            <h2 style="margin-bottom:0.8rem;">📜 ${escapeHtml(uid)} 的交易明細（${history.length} 筆）</h2>
            <div style="overflow:auto;max-height:60vh;">
                <table class="lb-table">
                    <thead><tr>
                        <th>標的</th><th class="num">股數</th>
                        <th class="num">買入</th><th class="num">賣出</th>
                        <th>進場</th><th>出場</th><th class="num">損益</th><th>原因</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', ev => { if (ev.target === modal) modal.remove(); });
};

function formatMoney(n) {
    if (n == null || isNaN(n)) return '-';
    const abs = Math.abs(n);
    if (abs >= 10000) return '$' + (abs / 10000).toFixed(1) + '萬';
    return '$' + Math.round(abs).toLocaleString();
}

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) {
    return String(s ?? '').replace(/'/g, "\\'");
}
