// holders_chip_panel.js — v12.4.0
//
// 自選股卡片下方的「籌碼面」面板：
//   1. 集保戶股權分散條（散戶/中實戶/大戶/千張）+ 週對週變化
//   2. 三條 sparkline：
//      a. 外資 20 日累積買賣超（折線，累積走勢）
//      b. 投信近 10 日（柱狀，紅漲綠跌台股慣例：紅=買、綠=賣）
//      c. 千張大戶 % 4 週趨勢（只在有歷史時顯示）
//   3. 投信隔日沖警示徽章（連 3 日買進 / 單日進場且無延續）
//
// 暴露 window.renderHoldersChipPanel(stockData) → HTML string

(function () {
    'use strict';

    // 台股紅綠（紅 = 買 / 漲，綠 = 賣 / 跌）
    const C_BUY = '#ef4444';
    const C_SELL = '#22c55e';
    const C_NEUTRAL = '#888';

    // 集保 4 桶配色
    const C_RETAIL = '#5a8aff';   // 散戶 藍
    const C_MID = '#a16eff';      // 中實戶 紫
    const C_BIG = '#fb923c';      // 大戶 橘
    const C_MEGA = '#ef4444';     // 千張大戶 紅

    function _fmtPp(v) {
        if (v == null || v === 0) return '';
        const sign = v > 0 ? '+' : '';
        const cls = v > 0 ? 'text-positive' : 'text-negative';
        return `<span class="${cls}" style="font-size:0.72rem;margin-left:2px;">${sign}${v.toFixed(2)}pp</span>`;
    }

    function _renderDistribBar(hd) {
        const r = hd.retail_pct || 0;
        const m = hd.mid_pct || 0;
        const b = hd.big_pct || 0;
        const mega = hd.mega_pct || 0;
        const wc = hd.weekly_change || {};
        return `
            <div class="holders-distrib-bar" style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin-bottom:6px;background:rgba(255,255,255,0.04);">
                <div style="width:${r}%;background:${C_RETAIL};" title="散戶 ${r.toFixed(1)}%"></div>
                <div style="width:${m}%;background:${C_MID};" title="中實戶 ${m.toFixed(1)}%"></div>
                <div style="width:${b}%;background:${C_BIG};" title="大戶 ${b.toFixed(1)}%"></div>
                <div style="width:${mega}%;background:${C_MEGA};" title="千張 ${mega.toFixed(1)}%"></div>
            </div>
            <div class="holders-distrib-legend" style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;font-size:0.72rem;color:#bbb;line-height:1.5;">
                <span><span style="display:inline-block;width:6px;height:6px;background:${C_RETAIL};border-radius:1px;margin-right:4px;"></span>散戶 <b>${r.toFixed(1)}%</b>${_fmtPp(wc.retail)}</span>
                <span><span style="display:inline-block;width:6px;height:6px;background:${C_MID};border-radius:1px;margin-right:4px;"></span>中實戶 <b>${m.toFixed(1)}%</b>${_fmtPp(wc.mid)}</span>
                <span><span style="display:inline-block;width:6px;height:6px;background:${C_BIG};border-radius:1px;margin-right:4px;"></span>大戶 <b>${b.toFixed(1)}%</b>${_fmtPp(wc.big)}</span>
                <span><span style="display:inline-block;width:6px;height:6px;background:${C_MEGA};border-radius:1px;margin-right:4px;"></span>千張 <b>${mega.toFixed(1)}%</b>${_fmtPp(wc.mega)}</span>
            </div>
        `;
    }

    // 折線 sparkline（累積走勢）
    function _renderLineSparkline(series, color, w = 80, h = 24) {
        if (!series || series.length < 2) return '';
        let acc = 0;
        const cum = series.map(v => (acc += (v || 0)));
        const min = Math.min(...cum, 0);
        const max = Math.max(...cum, 0);
        const range = (max - min) || 1;
        const dx = w / (cum.length - 1);
        const pts = cum.map((v, i) => `${(i * dx).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(' ');
        const last = cum[cum.length - 1];
        const lastColor = last >= 0 ? C_BUY : C_SELL;
        const zeroY = h - ((0 - min) / range) * h;
        return `<svg viewBox="0 0 ${w} ${h}" style="width:${w}px;height:${h}px;">
            <line x1="0" y1="${zeroY.toFixed(1)}" x2="${w}" y2="${zeroY.toFixed(1)}" stroke="rgba(255,255,255,0.15)" stroke-dasharray="2,2" stroke-width="0.5"/>
            <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2"/>
            <circle cx="${(w - 0.5).toFixed(1)}" cy="${(h - ((last - min) / range) * h).toFixed(1)}" r="1.8" fill="${lastColor}"/>
        </svg>`;
    }

    // 柱狀 sparkline（每日多空）
    function _renderBarSparkline(series, w = 80, h = 24) {
        if (!series || series.length === 0) return '';
        const s = series.slice(-10);
        const absMax = Math.max(...s.map(v => Math.abs(v || 0)), 1);
        const bw = Math.max(2, (w / s.length) - 1);
        const dx = w / s.length;
        const mid = h / 2;
        const bars = s.map((v, i) => {
            const x = i * dx;
            const bh = (Math.abs(v || 0) / absMax) * (h / 2 - 1);
            const y = v >= 0 ? mid - bh : mid;
            const col = v >= 0 ? C_BUY : (v < 0 ? C_SELL : C_NEUTRAL);
            return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bh).toFixed(1)}" fill="${col}"/>`;
        }).join('');
        return `<svg viewBox="0 0 ${w} ${h}" style="width:${w}px;height:${h}px;">
            <line x1="0" y1="${mid}" x2="${w}" y2="${mid}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/>
            ${bars}
        </svg>`;
    }

    function _renderSparklineRow(label, svg, value, valueColor) {
        return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:0.72rem;padding:3px 0;">
            <span style="color:#aaa;min-width:62px;">${label}</span>
            <span style="flex:1;display:flex;justify-content:center;">${svg}</span>
            <span style="color:${valueColor};min-width:80px;text-align:right;font-variant-numeric:tabular-nums;">${value}</span>
        </div>`;
    }

    function _detectShortSqueeze(inst) {
        const t = inst.trust || {};
        const streak = t.streak || 0;
        const today = t.today || 0;
        const t5 = t['5d_total'] || 0;
        // 連續買 ≥3 日 → 高隔日沖風險
        if (streak >= 3) {
            return { level: 'high', text: `⚠️ 投信連 ${streak} 日買進，留意隔日沖出貨` };
        }
        // 單日大買，5 日累計沒明顯延續 → 疑似隔日沖
        if (streak === 1 && today > 0 && t5 > 0 && t5 < today * 2) {
            return { level: 'mid', text: '⚠️ 投信僅單日進場，疑似隔日沖' };
        }
        // 連續賣 ≥3 日 → 警示出貨
        if (streak <= -3) {
            return { level: 'high', text: `❄️ 投信連 ${Math.abs(streak)} 日賣超，賣壓持續` };
        }
        return null;
    }

    // 在 window 暫存 data，方便 onclick 取用（避免巨大 inline JSON）
    window._holdersDataCache = window._holdersDataCache || {};

    window.renderHoldersChipPanel = function (data, symbol) {
        const inst = data.institutional || null;
        const hd = data.holders_distribution || null;
        if (!inst && !hd) return '';
        const sym = symbol || data._symbol || '';
        const name = (data.name || '').replace(/'/g, '');
        window._holdersDataCache[sym] = data;

        // Sparkline 1: 外資 20 日累積
        let sp1 = '';
        if (inst?.foreign?.history?.length) {
            const f20 = inst.foreign.history.slice(-20);
            const sumLots = Math.round((inst.foreign['20d_total'] || 0) / 1000);
            const color = sumLots >= 0 ? C_BUY : C_SELL;
            sp1 = _renderSparklineRow(
                '外資 20D',
                _renderLineSparkline(f20, color),
                `${sumLots >= 0 ? '+' : ''}${sumLots.toLocaleString()} 張`,
                color
            );
        }

        // Sparkline 2: 投信近 10 日（bar）
        let sp2 = '';
        if (inst?.trust?.history?.length) {
            const t10 = inst.trust.history.slice(-10);
            const streak = inst.trust.streak || 0;
            const streakLabel = streak === 0 ? '—' : `連${streak > 0 ? '買' : '賣'} ${Math.abs(streak)} 日`;
            const color = streak > 0 ? C_BUY : (streak < 0 ? C_SELL : C_NEUTRAL);
            sp2 = _renderSparklineRow(
                '投信 10D',
                _renderBarSparkline(t10),
                streakLabel,
                color
            );
        }

        // Sparkline 3: 千張大戶（如有 weekly_change，秀比例 + 變化）
        let sp3 = '';
        if (hd && hd.mega_pct != null) {
            const wcMega = (hd.weekly_change || {}).mega;
            const arrow = wcMega == null ? '' : (wcMega > 0 ? '🔺' : (wcMega < 0 ? '🔻' : '➖'));
            const color = wcMega == null ? '#aaa' : (wcMega > 0 ? C_BUY : (wcMega < 0 ? C_SELL : '#aaa'));
            const wcText = wcMega == null ? '本週首次' : `${wcMega > 0 ? '+' : ''}${wcMega.toFixed(2)}pp`;
            sp3 = `<div style="display:flex;align-items:center;justify-content:space-between;font-size:0.72rem;padding:3px 0;">
                <span style="color:#aaa;min-width:62px;">千張大戶</span>
                <span style="flex:1;text-align:center;color:#ddd;">${hd.mega_pct.toFixed(2)}%</span>
                <span style="color:${color};min-width:80px;text-align:right;">${arrow} ${wcText}</span>
            </div>`;
        }

        // 隔日沖警示
        const sqz = inst ? _detectShortSqueeze(inst) : null;
        const sqzBadge = sqz ? `
            <div style="margin-top:6px;padding:4px 8px;border-radius:4px;font-size:0.72rem;
                background:${sqz.level === 'high' ? 'rgba(239,68,68,0.15)' : 'rgba(251,146,60,0.15)'};
                color:${sqz.level === 'high' ? '#fca5a5' : '#fdba74'};
                border-left:2px solid ${sqz.level === 'high' ? C_BUY : '#fb923c'};">
                ${sqz.text}
            </div>` : '';

        // 集保 as_of stale 提示
        const asOfTag = hd?.as_of_date
            ? `<span style="color:#777;font-weight:400;font-size:0.7rem;margin-left:4px;">截至 ${hd.as_of_date}</span>`
            : '';

        const openDetail = `event.stopPropagation();window.showHoldersDetailModal && window.showHoldersDetailModal('${sym}','${name}',window._holdersDataCache['${sym}']);return false;`;

        return `
        <div class="stock-holders-panel" style="margin-top:8px;padding:8px 10px;
             background:rgba(120,80,255,0.06);border-radius:6px;border:1px solid rgba(120,80,255,0.18);
             cursor:pointer;transition:all 0.15s;"
             onclick="${openDetail}"
             onmouseover="this.style.background='rgba(120,80,255,0.12)';this.style.borderColor='rgba(120,80,255,0.4)';"
             onmouseout="this.style.background='rgba(120,80,255,0.06)';this.style.borderColor='rgba(120,80,255,0.18)';"
             title="點擊查看大圖、30 日逐日明細、籌碼訊號分析">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:0.78rem;color:#c9b3ff;font-weight:600;">
                    🧬 籌碼結構${asOfTag}
                </span>
                <span style="font-size:0.7rem;color:#888;">點擊查看詳細 →</span>
            </div>
            ${hd ? _renderDistribBar(hd) : '<div style="color:#777;font-size:0.72rem;padding:4px 0;">集保資料尚未抓到（週六後補）</div>'}
            ${(sp1 || sp2 || sp3) ? `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed rgba(255,255,255,0.08);">
                ${sp1}${sp2}${sp3}
            </div>` : ''}
            ${sqzBadge}
        </div>`;
    };
})();
