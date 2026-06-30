// whales.js — 🐳 鯨魚追蹤頁面 (v12.6.3)
//
// 顯示：
//   1. 累計戰績 (勝率 / 平均報酬 / 最佳/最差 / 總筆數)
//   2. 歷史鯨魚名單 — 預設 4 週（含本週進行中 + 過去 3 週 evaluated）
//      用戶可按「載入更多」往前看更多週
//   3. 即時刷新按鈕 — 重抓最新 raw_data 重算 running 報酬
//
// 資料來源：
//   data/whale_picks_history.json (snapshot 由 scripts/whale_picks_snapshot.py 寫入)
//   data/raw_data.json            (即時收盤價，用來算 running %)

(function () {
    'use strict';

    const HISTORY_PATH = 'data/whale_picks_history.json';
    const RAW_DATA_PATH = 'data/raw_data.json';
    const WHALES_PATH = 'data/whale_candidates.json';
    const DEFAULT_WEEKS_SHOWN = 4;

    let _history = null;
    let _rawPrices = {};
    let _shownCount = DEFAULT_WEEKS_SHOWN;

    function _nameOf(sym) {
        if (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym]) return TW_STOCK_MAP[sym];
        return sym.replace(/\.(TW|TWO)$/, '');
    }

    function _getLatestPrice(sym) {
        const s = _rawPrices[sym];
        if (s && typeof s === 'object') {
            for (const k of ['price', 'close', 'last_close']) {
                const v = s[k];
                if (typeof v === 'number' && v > 0) return v;
            }
        }
        return null;
    }

    function _computeRunningPct(pick) {
        // 優先用 raw_data 即時價，沒有就用 pick 內存的 running 或 return
        const entry = pick.entry_price;
        if (!entry) return null;
        const cur = _getLatestPrice(pick.sym);
        if (cur != null) return Math.round((cur - entry) / entry * 10000) / 100;
        if (pick.return_pct != null) return pick.return_pct;
        if (pick.running_return_pct != null) return pick.running_return_pct;
        return null;
    }

    function _retClass(v) {
        if (v == null) return 'text-muted';
        if (v > 0.05) return 'text-positive';
        if (v < -0.05) return 'text-negative';
        return 'text-muted';
    }

    function _renderStats() {
        const grid = document.getElementById('whalesStatsGrid');
        if (!grid) return;
        const weeks = _history?.weeks || [];
        const evalWeeks = weeks.filter(w => w.evaluated);
        const allPicks = evalWeeks.flatMap(w => w.picks || []);
        const evaluated = allPicks.filter(p => p.return_pct != null);

        if (evaluated.length === 0) {
            grid.innerHTML = `<div class="whale-stat-card" style="grid-column:1/-1;">
                <div class="label">尚無評估完成的鯨魚紀錄</div>
                <div class="value" style="font-size:0.9rem;color:#888;">需累積至少 1 完整週 (週一鎖定 → 週五評估)</div>
            </div>`;
            return;
        }

        const wins = evaluated.filter(p => p.return_pct > 0).length;
        const winRate = wins / evaluated.length * 100;
        const avgRet = evaluated.reduce((s, p) => s + p.return_pct, 0) / evaluated.length;
        const bestPick = evaluated.reduce((a, b) => (a.return_pct > b.return_pct ? a : b));
        const worstPick = evaluated.reduce((a, b) => (a.return_pct < b.return_pct ? a : b));

        const wrColor = winRate >= 60 ? 'text-positive' : (winRate < 40 ? 'text-negative' : '');
        const avgColor = avgRet >= 0 ? 'text-positive' : 'text-negative';

        grid.innerHTML = `
            <div class="whale-stat-card">
                <div class="label">總筆數</div>
                <div class="value">${evaluated.length}</div>
            </div>
            <div class="whale-stat-card">
                <div class="label">勝率</div>
                <div class="value ${wrColor}">${winRate.toFixed(0)}%</div>
            </div>
            <div class="whale-stat-card">
                <div class="label">平均週報酬</div>
                <div class="value ${avgColor}">${avgRet >= 0 ? '+' : ''}${avgRet.toFixed(2)}%</div>
            </div>
            <div class="whale-stat-card">
                <div class="label">最佳</div>
                <div class="value text-positive" style="font-size:1.05rem;">${_nameOf(bestPick.sym)} +${bestPick.return_pct.toFixed(2)}%</div>
            </div>
            <div class="whale-stat-card">
                <div class="label">最差</div>
                <div class="value text-negative" style="font-size:1.05rem;">${_nameOf(worstPick.sym)} ${worstPick.return_pct.toFixed(2)}%</div>
            </div>
            <div class="whale-stat-card">
                <div class="label">累計週數</div>
                <div class="value">${evalWeeks.length} 週</div>
            </div>
        `;
    }

    function _renderWeekCard(week, isLast) {
        const picks = week.picks || [];
        const isActive = !week.evaluated;
        const cardCls = isActive ? 'whale-week-card active' : 'whale-week-card evaluated';
        const status = isActive ? '🟢 進行中' : `🏁 已結算`;
        const dateLabel = week.snapshot_date || week.week_key || '—';

        const rows = picks.map(p => {
            const ret = _computeRunningPct(p);
            const cls = _retClass(ret);
            const sign = ret == null ? '' : (ret > 0 ? '+' : '');
            const retLabel = ret == null ? '—' : `${sign}${ret.toFixed(2)}%`;
            const entryLabel = p.entry_price ? `進 ${p.entry_price.toFixed(2)}` : '—';
            const cur = _getLatestPrice(p.sym);
            const curLabel = cur ? `現 ${cur.toFixed(2)}` : '';
            return `<div class="whale-pick-row">
                <div class="sym-label">
                    <span style="font-size:0.78rem;">${p.label || '🐳'}</span>
                    <b>${_nameOf(p.sym)}</b>
                    <span class="text-muted" style="font-size:0.72rem;">${p.sym}</span>
                </div>
                <span class="price">${entryLabel}</span>
                <span class="price">${curLabel}</span>
                <span class="ret ${cls}">${retLabel}</span>
            </div>`;
        }).join('');

        // 平均當週
        const valid = picks.map(_computeRunningPct).filter(v => v != null);
        const avgWeek = valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length) : null;
        const avgLabel = avgWeek == null ? '' : `<span class="${avgWeek >= 0 ? 'text-positive' : 'text-negative'}">平均 ${avgWeek >= 0 ? '+' : ''}${avgWeek.toFixed(2)}%</span>`;

        return `<div class="${cardCls}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;flex-wrap:wrap;gap:6px;">
                <div>
                    <b style="font-size:0.95rem;">${dateLabel} 那週</b>
                    <span class="text-muted" style="font-size:0.75rem;margin-left:6px;">${status}</span>
                </div>
                <div style="font-size:0.85rem;">${avgLabel}</div>
            </div>
            ${rows || '<p class="text-muted" style="text-align:center;font-size:0.8rem;">無 picks</p>'}
        </div>`;
    }

    function _renderList() {
        const listEl = document.getElementById('whalesList');
        if (!listEl) return;
        const weeks = (_history?.weeks || []).slice().reverse();   // 新→舊
        if (weeks.length === 0) {
            listEl.innerHTML = `<p class="text-muted" style="text-align:center;padding:1.5rem;">
                尚無鯨魚 snapshot 記錄。<br>
                <span style="font-size:0.78rem;">每週一 18:07 EOD 會自動鎖定本週 Top 4 鯨魚</span>
            </p>`;
            return;
        }
        const shown = weeks.slice(0, _shownCount);
        let html = shown.map((w, i) => _renderWeekCard(w, i === shown.length - 1)).join('');
        if (weeks.length > _shownCount) {
            html += `<div style="text-align:center;margin-top:0.8rem;">
                <button class="whale-refresh-btn" onclick="loadMoreWeeks()">📂 載入更多（還有 ${weeks.length - _shownCount} 週）</button>
            </div>`;
        }
        listEl.innerHTML = html;
    }

    async function _loadData() {
        try {
            const [hr, rr] = await Promise.all([
                fetch(HISTORY_PATH, { cache: 'no-store' }),
                fetch(RAW_DATA_PATH, { cache: 'no-store' }),
            ]);
            if (hr.ok) _history = await hr.json();
            if (rr.ok) {
                const raw = await rr.json();
                _rawPrices = raw.stocks || {};
            }
        } catch (e) {
            console.warn('whales load failed', e);
        }
        _renderStats();
        _renderList();
    }

    window.refreshWhales = async function () {
        const btn = document.querySelector('.whale-refresh-btn');
        if (btn) btn.textContent = '⏳ 載入中...';
        await _loadData();
        if (btn) btn.textContent = '🔄 更新即時報酬';
    };

    window.loadMoreWeeks = function () {
        _shownCount += 4;
        _renderList();
    };

    document.addEventListener('DOMContentLoaded', _loadData);
})();
