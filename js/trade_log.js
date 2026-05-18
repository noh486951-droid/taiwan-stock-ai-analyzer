// trade_log.js — 已實現交易記錄 + 個人儀表板 (v11.14.11)
//
// 設計：
//   - 每筆出場結算寫一筆到 localStorage `tw_trade_log`（陣列）
//   - 登入後跟 watchlist 同一個 KV payload 同步（多 trade_log 欄位）
//   - 加上 leaderboard_opt_in 旗標決定是否參加跨用戶排行榜

const TRADE_LOG_KEY = 'tw_trade_log';
const LEADERBOARD_OPT_IN_KEY = 'tw_leaderboard_opt_in';

window._tradeLog = window._tradeLog || null;

function getTradeLog() {
    if (window._tradeLog !== null) return window._tradeLog;
    try {
        const raw = localStorage.getItem(TRADE_LOG_KEY);
        window._tradeLog = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(window._tradeLog)) window._tradeLog = [];
    } catch {
        window._tradeLog = [];
    }
    return window._tradeLog;
}

function saveTradeLog(list) {
    window._tradeLog = Array.isArray(list) ? list : [];
    localStorage.setItem(TRADE_LOG_KEY, JSON.stringify(window._tradeLog));
    try { if (typeof pushToCloud === 'function') pushToCloud(); } catch {}
}

window.appendTradeLogEntry = function (entry) {
    const list = getTradeLog();
    if (!entry.id) entry.id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
    list.push(entry);
    saveTradeLog(list);
    return entry;
};

window.removeTradeLogEntry = function (id) {
    const list = getTradeLog().filter(t => t.id !== id);
    saveTradeLog(list);
};

window.getTradeLogForCloud = function () {
    return getTradeLog();
};
window.applyTradeLogFromCloud = function (list) {
    if (Array.isArray(list)) {
        window._tradeLog = list;
        localStorage.setItem(TRADE_LOG_KEY, JSON.stringify(list));
    }
};

// ========== Opt-in ==========

window.getLeaderboardOptIn = function () {
    return localStorage.getItem(LEADERBOARD_OPT_IN_KEY) === '1';
};
window.setLeaderboardOptIn = function (flag) {
    localStorage.setItem(LEADERBOARD_OPT_IN_KEY, flag ? '1' : '0');
    try { if (typeof pushToCloud === 'function') pushToCloud(); } catch {}
};
window.getOptInForCloud = function () {
    return window.getLeaderboardOptIn();
};
window.applyOptInFromCloud = function (flag) {
    localStorage.setItem(LEADERBOARD_OPT_IN_KEY, flag ? '1' : '0');
};

// ========== Stats 計算 ==========

window.computeTradeStats = function (trades) {
    const list = Array.isArray(trades) ? trades : [];
    if (list.length === 0) {
        return {
            total_trades: 0, win_trades: 0, loss_trades: 0,
            win_rate: 0, total_pnl: 0, avg_pnl_pct: 0,
            biggest_win: 0, biggest_loss: 0, avg_hold_days: 0,
        };
    }
    let wins = 0, losses = 0, totalPnl = 0, totalPnlPct = 0;
    let biggestWin = 0, biggestLoss = 0, totalDays = 0;
    for (const t of list) {
        const pnl = Number(t.pnl_abs ?? t.pnl) || 0;
        const pnlPct = Number(t.pnl_pct) || 0;
        totalPnl += pnl;
        totalPnlPct += pnlPct;
        if (pnl > 0) wins++;
        else if (pnl < 0) losses++;
        if (pnl > biggestWin) biggestWin = pnl;
        if (pnl < biggestLoss) biggestLoss = pnl;
        totalDays += (Number(t.held_days ?? t.hold_days) || 0);
    }
    return {
        total_trades: list.length,
        win_trades: wins,
        loss_trades: losses,
        win_rate: list.length > 0 ? (wins / list.length * 100) : 0,
        total_pnl: totalPnl,
        avg_pnl_pct: list.length > 0 ? (totalPnlPct / list.length) : 0,
        biggest_win: biggestWin,
        biggest_loss: biggestLoss,
        avg_hold_days: list.length > 0 ? (totalDays / list.length) : 0,
    };
};

// ========== 個人儀表板（自選股頁頂部）==========

window.renderTradeDashboard = function () {
    const container = document.getElementById('tradeDashboard');
    if (!container) return;

    const list = getTradeLog();
    const stats = window.computeTradeStats(list);
    const optIn = window.getLeaderboardOptIn();

    if (stats.total_trades === 0) {
        container.innerHTML = `
            <div class="trade-dash-empty">
                <span class="text-muted">📊 還沒有出場結算的交易紀錄。在持倉設好後，按「📤 出場結算」就會記錄到這裡。</span>
            </div>`;
        return;
    }

    const formatMoney = (n) => {
        if (n == null || isNaN(n)) return '-';
        const abs = Math.abs(n);
        const sign = n >= 0 ? '' : '-';
        if (abs >= 10000) return sign + '$' + (abs / 10000).toFixed(1) + '萬';
        return sign + '$' + Math.round(abs).toLocaleString();
    };

    const totalCls = stats.total_pnl >= 0 ? 'text-positive' : 'text-negative';
    const winCls = stats.win_rate >= 50 ? 'text-positive' : 'text-negative';
    const avgCls = stats.avg_pnl_pct >= 0 ? 'text-positive' : 'text-negative';

    container.innerHTML = `
        <div class="trade-dash">
            <div class="trade-dash-header">
                <h3>📊 我的交易戰績</h3>
                <div class="trade-dash-actions">
                    <label class="opt-in-toggle" title="勾選後會出現在排行榜，公開暱稱與戰績">
                        <input type="checkbox" id="optInCheckbox" ${optIn ? 'checked' : ''}>
                        加入排行榜
                    </label>
                    <a href="leaderboard.html" class="btn-secondary btn-sm">🏆 看排行榜</a>
                </div>
            </div>
            <div class="trade-dash-grid">
                <div class="trade-stat">
                    <div class="trade-stat-label">總筆數</div>
                    <div class="trade-stat-value">${stats.total_trades}</div>
                </div>
                <div class="trade-stat">
                    <div class="trade-stat-label">勝率</div>
                    <div class="trade-stat-value ${winCls}">${stats.win_rate.toFixed(1)}%</div>
                    <div class="trade-stat-sub">${stats.win_trades} 勝 / ${stats.loss_trades} 敗</div>
                </div>
                <div class="trade-stat">
                    <div class="trade-stat-label">累積損益</div>
                    <div class="trade-stat-value ${totalCls}">${formatMoney(stats.total_pnl)}</div>
                </div>
                <div class="trade-stat">
                    <div class="trade-stat-label">平均單筆</div>
                    <div class="trade-stat-value ${avgCls}">${stats.avg_pnl_pct >= 0 ? '+' : ''}${stats.avg_pnl_pct.toFixed(2)}%</div>
                </div>
                <div class="trade-stat">
                    <div class="trade-stat-label">最大單筆獲利</div>
                    <div class="trade-stat-value text-positive">${formatMoney(stats.biggest_win)}</div>
                </div>
                <div class="trade-stat">
                    <div class="trade-stat-label">最大單筆虧損</div>
                    <div class="trade-stat-value text-negative">${formatMoney(stats.biggest_loss)}</div>
                </div>
                <div class="trade-stat">
                    <div class="trade-stat-label">平均持倉</div>
                    <div class="trade-stat-value">${stats.avg_hold_days.toFixed(1)} 天</div>
                </div>
                <div class="trade-stat">
                    <button class="btn-secondary btn-sm" onclick="window._showTradeHistory()">📜 看歷史</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('optInCheckbox')?.addEventListener('change', (e) => {
        window.setLeaderboardOptIn(e.target.checked);
    });
};

// ========== 歷史明細彈窗 ==========

window._showTradeHistory = function () {
    const list = [...getTradeLog()].sort((a, b) =>
        String(b.exit_date || '').localeCompare(String(a.exit_date || ''))
    );

    const rows = list.length === 0
        ? '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:1rem;">尚無紀錄</td></tr>'
        : list.map(t => {
            const pnl = Number(t.pnl_abs ?? t.pnl) || 0;
            const pnlPct = Number(t.pnl_pct) || 0;
            const cls = pnl >= 0 ? 'text-positive' : 'text-negative';
            const sign = pnl >= 0 ? '+' : '';
            return `
                <tr>
                    <td><b>${t.symbol || t.sym || '-'}</b><br><span class="text-muted" style="font-size:0.75rem;">${t.name || ''}</span></td>
                    <td class="num">${t.shares ?? '-'}</td>
                    <td class="num">${t.entry_price ?? (t.total_cost && t.shares ? (t.total_cost/t.shares).toFixed(2) : '-')}</td>
                    <td class="num">${t.exit_price ?? '-'}</td>
                    <td>${t.entry_date || '-'}</td>
                    <td>${t.exit_date || '-'}</td>
                    <td class="num ${cls}"><b>${sign}${pnlPct.toFixed(2)}%</b><br><span style="font-size:0.75rem;">${sign}${Math.round(pnl).toLocaleString()}</span></td>
                    <td><button class="position-btn" onclick="window._deleteTradeEntry('${t.id}', this)" title="刪除這筆紀錄">🗑</button></td>
                </tr>
            `;
        }).join('');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay position-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content glass" style="max-width:900px;width:95vw;">
            <button class="modal-close" onclick="this.closest('.position-modal').remove()">&times;</button>
            <h2 style="margin-bottom:0.8rem;">📜 交易歷史紀錄（${list.length} 筆）</h2>
            <div style="overflow:auto;max-height:60vh;">
                <table class="scout-table">
                    <thead><tr>
                        <th>標的</th><th class="num">股數</th><th class="num">買入</th><th class="num">賣出</th>
                        <th>進場日</th><th>出場日</th><th class="num">損益</th><th></th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', ev => { if (ev.target === modal) modal.remove(); });
};

window._deleteTradeEntry = function (id, btn) {
    if (!confirm('確定刪除這筆交易紀錄？無法復原。')) return;
    window.removeTradeLogEntry(id);
    btn.closest('tr').remove();
    if (typeof window.renderTradeDashboard === 'function') window.renderTradeDashboard();
};
