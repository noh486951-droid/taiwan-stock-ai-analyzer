// calendar_page.js — 📆 事件日曆 (v12.8.0)
//
// 合併兩個資料源成單一時間軸（未來 30 天）：
//   data/macro_calendar.json  — 總經大事（FOMC / CPI / 台積電財報等）
//   data/corp_events.json     — 自選股企業行事曆（法說 / 除息 / 股東會）
//
// 顯示：依日期分組，importance=high 紅框、medium 橘框

(function () {
    'use strict';

    const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
    const CAT_LABEL = {
        us_cpi: '美 CPI', fomc: 'FOMC', us_nfp: '非農', us_pce: 'PCE',
        earnings: '財報', tw_cpi: '台 CPI', triple_witching: '結算',
        dividend: '除息', investor_conf: '法說會', shareholders: '股東會',
        revenue: '營收公佈',
    };

    function _nameOf(sym) {
        if (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym]) return TW_STOCK_MAP[sym];
        return (sym || '').replace(/\.(TW|TWO)$/, '');
    }

    function _catLabel(cat) {
        return CAT_LABEL[cat] || cat || '事件';
    }

    async function load() {
        const el = document.getElementById('calContent');
        if (!el) return;

        let macro = {}, corp = {};
        try {
            const [mr, cr] = await Promise.all([
                fetch('data/macro_calendar.json', { cache: 'no-store' }),
                fetch('data/corp_events.json', { cache: 'no-store' }),
            ]);
            if (mr.ok) macro = await mr.json();
            if (cr.ok) corp = await cr.json();
        } catch (e) { console.warn('calendar load', e); }

        // 統一事件格式 {date, time, title, category, importance, impact, sym}
        const events = [];
        for (const ev of (macro.events || [])) {
            if (!ev.date) continue;
            events.push({
                date: ev.date,
                time: ev.time || '',
                title: ev.title || '',
                category: ev.category || '',
                importance: ev.importance || 'medium',
                impact: ev.expected_impact || '',
                source: 'macro',
            });
        }
        // corp_events: events_by_date = { 'YYYY-MM-DD': [ {symbol, type, title...} ] }
        const ebd = corp.events_by_date || {};
        for (const [date, list] of Object.entries(ebd)) {
            for (const ev of (list || [])) {
                const sym = ev.symbol || ev.sym || '';
                events.push({
                    date,
                    time: ev.time || '',
                    title: `${_nameOf(sym)}${sym ? ` (${sym.replace(/\.(TW|TWO)$/, '')})` : ''} — ${ev.title || ev.type || '事件'}`,
                    category: ev.type || ev.category || 'corp',
                    importance: ev.importance || 'medium',
                    impact: ev.note || ev.description || '',
                    source: 'corp',
                });
            }
        }

        // 過濾：今天 ~ 未來 35 天
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const horizon = new Date(today.getTime() + 35 * 86400000);
        const todayStr = today.toISOString().slice(0, 10);

        const upcoming = events.filter(ev => {
            const d = new Date(ev.date + 'T00:00:00');
            return d >= today && d <= horizon;
        });

        if (upcoming.length === 0) {
            el.innerHTML = `<p class="cal-empty">未來 35 天沒有已知事件<br>
                <span style="font-size:0.75rem;">總經日曆與企業行事曆由每日排程更新（macro_calendar / corp_events）</span></p>`;
            return;
        }

        // 依日期分組
        const byDate = {};
        for (const ev of upcoming) {
            (byDate[ev.date] = byDate[ev.date] || []).push(ev);
        }
        const dates = Object.keys(byDate).sort();

        let html = `<p style="font-size:0.75rem;color:#888;margin-bottom:1rem;">
            共 ${upcoming.length} 個事件 · 總經更新於 ${macro.updated_at || '—'} · 企業事件更新於 ${corp.updated_at || '—'}</p>`;

        for (const date of dates) {
            const d = new Date(date + 'T00:00:00');
            const isToday = date === todayStr;
            const daysAway = Math.round((d - today) / 86400000);
            const dayLabel = isToday ? '（今天）' : (daysAway === 1 ? '（明天）' : `（${daysAway} 天後）`);
            html += `<div class="cal-day ${isToday ? 'today' : ''}">
                <div class="cal-day-header">${date.slice(5).replace('-', '/')}
                    <span class="weekday">週${WEEKDAYS[d.getDay()]} ${dayLabel}</span></div>`;
            // high 排前面
            byDate[date].sort((a, b) => (a.importance === 'high' ? -1 : 1) - (b.importance === 'high' ? -1 : 1));
            for (const ev of byDate[date]) {
                html += `<div class="cal-event ${ev.importance}">
                    <span class="time">${ev.time || ''}</span>
                    <div style="flex:1;">
                        <span class="cal-cat">${_catLabel(ev.category)}</span>
                        <b style="margin-left:4px;">${ev.title}</b>
                        ${ev.impact ? `<span class="impact">${ev.impact}</span>` : ''}
                    </div>
                </div>`;
            }
            html += '</div>';
        }
        el.innerHTML = html;
    }

    document.addEventListener('DOMContentLoaded', load);
})();
