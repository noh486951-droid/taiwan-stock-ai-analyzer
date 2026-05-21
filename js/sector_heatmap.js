// sector_heatmap.js — 產業漲跌熱力圖 (treemap) v12.1.1
//
// 純 JS 實作 squarified treemap 演算法（無 d3 依賴）
//   - 第一層：產業（按 total_value 排序，最大的放左上）
//   - 第二層：產業內個股（按 value 排序）
//   - 顏色：個股 change_pct 決定（紅 = 漲、綠 = 跌）

(function () {
    'use strict';

    const HEATMAP_FILE = 'data/heatmap.json';

    document.addEventListener('DOMContentLoaded', async () => {
        const container = document.getElementById('heatmapContainer');
        const meta = document.getElementById('heatmapMeta');
        if (!container) return;

        try {
            const r = await fetch(HEATMAP_FILE, { cache: 'no-store' });
            if (!r.ok) throw new Error('heatmap.json not available');
            const data = await r.json();
            renderHeatmap(container, data);
            if (meta) {
                meta.textContent = `📅 資料：${data.fetched_at || '-'} · 共 ${data.industries.length} 產業 · 點擊區塊查看詳情`;
            }
        } catch (e) {
            container.innerHTML = `<p class="text-muted" style="padding:1rem;">熱力圖尚未產生（盤後 14:40 / 18:10 才會跑）<br><span style="font-size:0.75rem;">錯誤：${e.message}</span></p>`;
        }
    });

    // ============================================================
    // Squarified Treemap 演算法
    // ============================================================
    function squarify(items, x, y, width, height) {
        // items: [{ value: number, ... }] 已按 value 降序
        // 回傳每個 item 的 rect: { x, y, w, h }
        const totalValue = items.reduce((s, it) => s + it.value, 0);
        if (totalValue <= 0) return items.map(it => ({ ...it, _rect: { x, y, w: 0, h: 0 } }));

        // 將 value 縮放到面積
        const scale = (width * height) / totalValue;
        const scaled = items.map(it => ({ ...it, _area: it.value * scale }));

        const result = [];
        let remaining = scaled.slice();
        let rx = x, ry = y, rw = width, rh = height;

        while (remaining.length > 0) {
            const row = [];
            const shortSide = Math.min(rw, rh);
            let bestRatio = Infinity;

            // 一個一個加入 row，直到 aspect ratio 變差
            while (remaining.length > 0) {
                const trial = row.concat([remaining[0]]);
                const ratio = worstRatio(trial, shortSide);
                if (ratio > bestRatio && row.length > 0) break;
                bestRatio = ratio;
                row.push(remaining.shift());
            }

            // 把這一 row 排出來
            const rowArea = row.reduce((s, it) => s + it._area, 0);
            const isHorizontal = (rw >= rh);
            if (isHorizontal) {
                // 垂直一條 column
                const colW = rowArea / rh;
                let cy = ry;
                row.forEach(it => {
                    const h = (it._area / rowArea) * rh;
                    result.push({ ...it, _rect: { x: rx, y: cy, w: colW, h: h } });
                    cy += h;
                });
                rx += colW; rw -= colW;
            } else {
                const rowH = rowArea / rw;
                let cx = rx;
                row.forEach(it => {
                    const w = (it._area / rowArea) * rw;
                    result.push({ ...it, _rect: { x: cx, y: ry, w: w, h: rowH } });
                    cx += w;
                });
                ry += rowH; rh -= rowH;
            }
        }

        return result;
    }

    function worstRatio(row, shortSide) {
        // 回傳該 row 中最差的長寬比
        const sum = row.reduce((s, it) => s + it._area, 0);
        let worst = 1;
        for (const it of row) {
            const ratio = Math.max(
                (shortSide * shortSide * it._area) / (sum * sum),
                (sum * sum) / (shortSide * shortSide * it._area)
            );
            if (ratio > worst) worst = ratio;
        }
        return worst;
    }

    // ============================================================
    // 顏色 (red = up, green = down, gray = flat)
    // ============================================================
    function colorForChange(pct) {
        if (pct == null || isNaN(pct)) return 'rgba(128,128,128,0.3)';
        const abs = Math.min(Math.abs(pct), 7);   // 7% 即飽和
        const intensity = abs / 7;
        if (pct > 0.1) {
            // 紅
            const r = Math.round(220 + 35 * intensity);
            const g = Math.round(100 - 60 * intensity);
            const b = Math.round(100 - 60 * intensity);
            return `rgb(${r},${g},${b})`;
        } else if (pct < -0.1) {
            // 綠
            const r = Math.round(80 - 60 * intensity);
            const g = Math.round(160 + 60 * intensity);
            const b = Math.round(100 - 30 * intensity);
            return `rgb(${r},${g},${b})`;
        } else {
            return 'rgb(150,150,160)';
        }
    }

    // ============================================================
    // 自訂 tooltip
    // ============================================================
    function _ensureTooltip() {
        let tip = document.getElementById('heatmapTooltip');
        if (tip) return tip;
        tip = document.createElement('div');
        tip.id = 'heatmapTooltip';
        tip.style.cssText = `
            position: fixed;
            background: rgba(20, 20, 30, 0.96);
            color: #fff;
            padding: 0.7rem 0.9rem;
            border-radius: 10px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(180,130,255,0.4);
            font-size: 0.85rem;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.12s;
            z-index: 99999;
            min-width: 180px;
            max-width: 240px;
        `;
        document.body.appendChild(tip);
        return tip;
    }

    function _showTooltip(s, ev) {
        const tip = _ensureTooltip();
        const sign = s.change_pct >= 0 ? '+' : '';
        const pctColor = s.change_pct >= 0 ? '#ff6b6b' : '#4ade80';
        const valueOku = (s.value / 1e8).toFixed(1);
        const volWan = (s.volume / 10000).toFixed(0);
        tip.innerHTML = `
            <div style="font-weight:700;font-size:1.02rem;margin-bottom:0.4rem;">
                ${s.name || ''} <span style="color:#aaa;font-weight:500;font-size:0.85rem;">(${s.code})</span>
            </div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:0.3rem 0.7rem;font-size:0.82rem;">
                <span style="color:#999;">股價：</span><span style="text-align:right;font-weight:600;">${s.close}</span>
                <span style="color:#999;">漲跌幅：</span><span style="text-align:right;font-weight:700;color:${pctColor};">${sign}${s.change_pct.toFixed(2)}%</span>
                <span style="color:#999;">成交額：</span><span style="text-align:right;">${valueOku} 億</span>
                <span style="color:#999;">成交量：</span><span style="text-align:right;">${Number(volWan).toLocaleString()} 萬股</span>
            </div>
            <div style="margin-top:0.4rem;font-size:0.7rem;color:#777;border-top:1px solid rgba(255,255,255,0.08);padding-top:0.3rem;">
                點擊複製代碼 ${s.code}.TW
            </div>
        `;
        tip.style.opacity = '1';
        _moveTooltip(ev);
    }

    function _moveTooltip(ev) {
        const tip = document.getElementById('heatmapTooltip');
        if (!tip) return;
        const rect = tip.getBoundingClientRect();
        let x = ev.clientX + 14;
        let y = ev.clientY + 14;
        if (x + rect.width > window.innerWidth - 10) x = ev.clientX - rect.width - 14;
        if (y + rect.height > window.innerHeight - 10) y = ev.clientY - rect.height - 14;
        tip.style.left = Math.max(8, x) + 'px';
        tip.style.top = Math.max(8, y) + 'px';
    }

    function _hideTooltip() {
        const tip = document.getElementById('heatmapTooltip');
        if (tip) tip.style.opacity = '0';
    }

    // ============================================================
    // 渲染
    // ============================================================
    function renderHeatmap(container, data) {
        container.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:100%;background:#0a0a0f;border-radius:8px;overflow:hidden;';
        const W = container.clientWidth || 1200;
        const H = Math.max(500, Math.min(700, W * 0.55));
        wrap.style.height = H + 'px';
        container.appendChild(wrap);

        // 把產業按 total_value 排序
        const industries = data.industries.map(ind => ({
            ...ind,
            value: ind.total_value,
        }));
        industries.sort((a, b) => b.value - a.value);

        // 第一層：把產業切成大區塊
        const industryRects = squarify(industries, 0, 0, W, H);

        for (const ind of industryRects) {
            const { x, y, w, h } = ind._rect;
            if (w < 40 || h < 30) continue;   // 太小不畫

            const block = document.createElement('div');
            block.style.cssText = `
                position:absolute; left:${x}px; top:${y}px;
                width:${w}px; height:${h}px;
                border:1px solid #000;
                box-sizing:border-box;
                overflow:hidden;
            `;
            wrap.appendChild(block);

            // 第二層：產業內個股
            const stocks = (ind.stocks || []).map(s => ({ ...s, value: s.value || 1 }));
            stocks.sort((a, b) => b.value - a.value);

            const stockRects = squarify(stocks, 0, 18, w, h - 18);   // 上方留 18px 給產業名

            // 產業名 label
            const lbl = document.createElement('div');
            lbl.style.cssText = `
                position:absolute; left:0; top:0; right:0; height:18px;
                line-height:18px; padding:0 6px;
                background:rgba(0,0,0,0.7); color:#eee;
                font-size:11.5px; font-weight:700;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                pointer-events:none;
                letter-spacing:0.3px;
                text-shadow:0 1px 2px rgba(0,0,0,0.8);
            `;
            const avgChg = ind.avg_change_pct || 0;
            const avgSign = avgChg >= 0 ? '+' : '';
            const avgColor = avgChg >= 0 ? '#ff8080' : '#5eebaa';
            lbl.innerHTML = `${ind.name} <span style="color:${avgColor};">${avgSign}${avgChg.toFixed(2)}%</span> <span style="color:#888;font-weight:500;font-size:10px;">${(ind.total_value/1e8).toFixed(0)}億</span>`;
            block.appendChild(lbl);

            // 每檔股票
            for (const s of stockRects) {
                const r = s._rect;
                if (r.w < 18 || r.h < 14) continue;

                const cell = document.createElement('div');
                cell.style.cssText = `
                    position:absolute; left:${r.x}px; top:${r.y}px;
                    width:${r.w}px; height:${r.h}px;
                    background:${colorForChange(s.change_pct)};
                    border:1px solid rgba(0,0,0,0.4);
                    box-sizing:border-box;
                    display:flex; flex-direction:column; align-items:center; justify-content:center;
                    color:white; text-shadow:0 1px 2px rgba(0,0,0,0.7);
                    overflow:hidden;
                    cursor:pointer;
                    transition: filter 0.15s;
                `;
                cell.addEventListener('mouseenter', (ev) => {
                    cell.style.filter = 'brightness(1.25)';
                    _showTooltip(s, ev);
                });
                cell.addEventListener('mousemove', _moveTooltip);
                cell.addEventListener('mouseleave', () => {
                    cell.style.filter = '';
                    _hideTooltip();
                });
                cell.onclick = () => {
                    // 點擊複製代碼方便加自選
                    try {
                        navigator.clipboard.writeText(`${s.code}.TW`);
                        cell.style.outline = '2px solid #fff';
                        setTimeout(() => cell.style.outline = '', 800);
                    } catch {}
                };

                // 文字內容根據格子大小決定顯示什麼
                const nameSize = r.w > 80 ? 13 : (r.w > 50 ? 11 : 9);
                const pctSize = r.w > 80 ? 12 : (r.w > 50 ? 10 : 9);
                const sign = s.change_pct >= 0 ? '+' : '';
                cell.innerHTML = `
                    <div style="font-size:${nameSize}px;font-weight:700;line-height:1.1;text-align:center;padding:0 2px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${r.w > 50 ? (s.name || s.code) : s.code}
                    </div>
                    ${r.h > 30 ? `<div style="font-size:${pctSize}px;line-height:1.1;margin-top:2px;">${sign}${s.change_pct.toFixed(2)}%</div>` : ''}
                `;
                block.appendChild(cell);
            }
        }

        // 圖例
        const legend = document.createElement('div');
        legend.style.cssText = `
            position:absolute; bottom:6px; right:8px;
            display:flex; align-items:center; gap:4px;
            font-size:11px; color:#aaa;
            background:rgba(0,0,0,0.5);
            padding:3px 8px; border-radius:4px;
        `;
        legend.innerHTML = `
            <span>跌</span>
            <span style="display:inline-block;width:14px;height:10px;background:rgb(20,220,130);"></span>
            <span style="display:inline-block;width:14px;height:10px;background:rgb(100,200,130);"></span>
            <span style="display:inline-block;width:14px;height:10px;background:rgb(150,150,160);"></span>
            <span style="display:inline-block;width:14px;height:10px;background:rgb(240,90,90);"></span>
            <span style="display:inline-block;width:14px;height:10px;background:rgb(255,40,40);"></span>
            <span>漲</span>
        `;
        wrap.appendChild(legend);
    }

    // window resize 時重繪
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const container = document.getElementById('heatmapContainer');
            if (container && container.dataset.heatmapData) {
                renderHeatmap(container, JSON.parse(container.dataset.heatmapData));
            }
        }, 300);
    });
})();
