// sector_heatmap.js — 產業漲跌熱力圖 (treemap) v12.1.1
//
// 純 JS 實作 squarified treemap 演算法（無 d3 依賴）
//   - 第一層：產業（按 total_value 排序，最大的放左上）
//   - 第二層：產業內個股（按 value 排序）
//   - 顏色：個股 change_pct 決定（紅 = 漲、綠 = 跌）

(function () {
    'use strict';

    const HEATMAP_FILE = 'data/heatmap.json';

    // v12.6.1：顯示模式 + 篩選 state
    let _heatmapData = null;
    let _viewMode = 'industries';   // 'industries' | 'sub_sectors'
    let _filter = { search: '', minChg: null, maxChg: null };

    function _applyFilter(data) {
        // 深拷貝 + 套用篩選 → 回傳新 data 物件
        const key = _viewMode;
        const buckets = (data[key] || []).map(b => ({ ...b, stocks: [...(b.stocks || [])] }));
        const s = (_filter.search || '').trim().toLowerCase();
        const minC = _filter.minChg, maxC = _filter.maxChg;
        const filtered = buckets.map(b => {
            let stocks = b.stocks;
            if (s) stocks = stocks.filter(st =>
                String(st.code).includes(s) || (st.name || '').toLowerCase().includes(s));
            if (minC !== null) stocks = stocks.filter(st => (st.change_pct || 0) >= minC);
            if (maxC !== null) stocks = stocks.filter(st => (st.change_pct || 0) <= maxC);
            return { ...b, stocks };
        }).filter(b => b.stocks.length > 0);
        return { ...data, industries: _viewMode === 'industries' ? filtered : (data.industries || []),
                       sub_sectors: _viewMode === 'sub_sectors' ? filtered : (data.sub_sectors || []) };
    }

    function _renderToolbar() {
        const tbId = 'heatmapToolbar';
        let tb = document.getElementById(tbId);
        if (!tb) {
            tb = document.createElement('div');
            tb.id = tbId;
            const container = document.getElementById('heatmapContainer');
            container?.parentNode?.insertBefore(tb, container);
        }
        const hasSub = !!(_heatmapData?.sub_sectors?.length);
        tb.style.cssText = 'display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-bottom:0.8rem;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.04);border-radius:8px;';
        tb.innerHTML = `
            <div style="display:flex;gap:4px;background:rgba(0,0,0,0.3);padding:3px;border-radius:6px;">
                <button data-mode="industries" class="hm-tab-btn ${_viewMode==='industries'?'active':''}" style="border:0;padding:5px 12px;border-radius:4px;font-size:0.78rem;cursor:pointer;background:${_viewMode==='industries'?'#6366f1':'transparent'};color:${_viewMode==='industries'?'#fff':'#aaa'};">官方產業</button>
                <button data-mode="sub_sectors" class="hm-tab-btn ${_viewMode==='sub_sectors'?'active':''}" ${hasSub?'':'disabled'} style="border:0;padding:5px 12px;border-radius:4px;font-size:0.78rem;cursor:pointer;background:${_viewMode==='sub_sectors'?'#6366f1':'transparent'};color:${_viewMode==='sub_sectors'?'#fff':'#666'};opacity:${hasSub?1:0.4};">細分次產業${hasSub?'':' (今晚生成)'}</button>
            </div>
            <input type="text" id="hmSearch" placeholder="🔍 搜尋代碼/名稱" value="${_filter.search}" style="padding:5px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff;font-size:0.78rem;min-width:160px;flex:1;max-width:240px;">
            <div style="display:flex;gap:4px;font-size:0.72rem;color:#888;">
                <span>漲跌:</span>
                <button data-range="up" class="hm-range-btn" style="border:1px solid rgba(255,255,255,0.15);padding:3px 8px;border-radius:4px;background:transparent;color:#ef4444;cursor:pointer;font-size:0.72rem;">紅 +%</button>
                <button data-range="down" class="hm-range-btn" style="border:1px solid rgba(255,255,255,0.15);padding:3px 8px;border-radius:4px;background:transparent;color:#22c55e;cursor:pointer;font-size:0.72rem;">綠 -%</button>
                <button data-range="strong" class="hm-range-btn" style="border:1px solid rgba(255,255,255,0.15);padding:3px 8px;border-radius:4px;background:transparent;color:#fb923c;cursor:pointer;font-size:0.72rem;">強勢 ≥3%</button>
                <button data-range="reset" class="hm-range-btn" style="border:1px solid rgba(255,255,255,0.15);padding:3px 8px;border-radius:4px;background:transparent;color:#aaa;cursor:pointer;font-size:0.72rem;">清除</button>
            </div>
        `;

        tb.querySelectorAll('.hm-tab-btn').forEach(b => b.addEventListener('click', (e) => {
            const m = e.currentTarget.getAttribute('data-mode');
            if (m && !e.currentTarget.disabled) {
                _viewMode = m;
                _rerender();
            }
        }));
        const sb = document.getElementById('hmSearch');
        if (sb) {
            sb.addEventListener('input', (e) => { _filter.search = e.target.value || ''; _rerender(); });
        }
        tb.querySelectorAll('.hm-range-btn').forEach(b => b.addEventListener('click', (e) => {
            const r = e.currentTarget.getAttribute('data-range');
            if (r === 'up') { _filter.minChg = 0.01; _filter.maxChg = null; }
            else if (r === 'down') { _filter.minChg = null; _filter.maxChg = -0.01; }
            else if (r === 'strong') { _filter.minChg = 3.0; _filter.maxChg = null; }
            else { _filter.minChg = null; _filter.maxChg = null; }
            _rerender();
        }));
    }

    function _rerender() {
        if (!_heatmapData) return;
        const container = document.getElementById('heatmapContainer');
        if (!container) return;
        const filtered = _applyFilter(_heatmapData);
        // 把 sub_sectors 改名成 industries 餵給原 render
        const renderInput = _viewMode === 'sub_sectors'
            ? { ...filtered, industries: filtered.sub_sectors }
            : filtered;
        renderHeatmap(container, renderInput);
        _renderToolbar();
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const container = document.getElementById('heatmapContainer');
        const meta = document.getElementById('heatmapMeta');
        if (!container) return;

        try {
            const r = await fetch(HEATMAP_FILE, { cache: 'no-store' });
            if (!r.ok) throw new Error('heatmap.json not available');
            const data = await r.json();
            _heatmapData = data;
            _renderToolbar();
            renderHeatmap(container, data);
            if (meta) {
                // v12.1.3：資料日期顯眼化 + 過期警告（提示「今晚 18:10 後更新」）
                const dataDate = data.date || '';
                const fetchedAt = data.fetched_at || '';
                let dateLabel = dataDate;
                if (dataDate.length === 8) {
                    dateLabel = `${dataDate.slice(0,4)}-${dataDate.slice(4,6)}-${dataDate.slice(6,8)}`;
                }
                // v12.9.6：改用「交易日差」判斷新鮮度，不再用 13:30+5h 誤判
                //   舊 bug：今日盤後看今日資料，因超過 13:30 5 小時 → 誤標「前一交易日」
                let staleWarn = '';
                try {
                    if (dataDate.length === 8) {
                        // 台北今日 YYYYMMDD
                        const twToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' })
                            .format(new Date()).replace(/-/g, '');
                        // 計算 dataDate → today 之間的「交易日數」(跳週末)
                        const _d = s => new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00+08:00`);
                        let td = 0;
                        const from = _d(dataDate), to = _d(twToday);
                        for (let c = new Date(from); c < to; c.setDate(c.getDate() + 1)) {
                            const wd = c.getDay();
                            if (wd !== 0 && wd !== 6) td++;
                        }
                        if (dataDate === twToday) {
                            staleWarn = `<span style="color:#4ade80;font-size:0.78rem;">✅ 今日資料</span>`;
                        } else if (td <= 1) {
                            // 差 1 個交易日 = 正常（今日 EOD 18:10 尚未跑）
                            staleWarn = `<span style="color:#ffa502;font-size:0.78rem;">📌 前一交易日收盤 — 今晚 18:10 workflow 後更新成今日</span>`;
                        } else {
                            staleWarn = `<span style="color:#fbbf24;font-weight:600;">⚠️ 已 ${td} 個交易日未更新（EOD workflow 可能中斷）</span>`;
                        }
                    }
                } catch {}
                meta.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.6rem;">
                        <div>📅 資料日期：<b style="color:#fff;font-size:0.92rem;">${dateLabel}</b>
                            <span style="color:#666;font-size:0.76rem;margin-left:0.4rem;">(掃描 ${fetchedAt.slice(11) || fetchedAt})</span>
                        </div>
                        <div>${staleWarn}</div>
                        <div style="font-size:0.76rem;color:#888;">${data.industries.length} 產業 · Hover 看詳情</div>
                    </div>
                `;
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
    // v12.1.4：直接加入自選股（寫 localStorage，watchlist 頁載入時會同步雲端）
    // ============================================================
    function _addToWatchlistFromHeatmap(fullSymbol, name) {
        const group = localStorage.getItem('tw_stock_current_group') || 'default';
        const key = 'tw_stock_watchlist_' + group;
        let list = [];
        try { list = JSON.parse(localStorage.getItem(key)) || []; } catch {}
        if (list.includes(fullSymbol)) {
            _heatmapToast(`「${name}」已在自選股清單裡`, 'info');
            return;
        }
        list.push(fullSymbol);
        localStorage.setItem(key, JSON.stringify(list));
        _heatmapToast(`✅ 已加入「${name}」到自選股`, 'success');
    }

    // v12.1.5：點擊後的詳情卡片（含加入自選股按鈕）
    function _showStockPopover(s, ev) {
        _hideTooltip();
        const existing = document.getElementById('heatmapPopover');
        if (existing) existing.remove();

        const fullSymbol = getStockSymbol(s.code);
        const sign = s.change_pct >= 0 ? '+' : '';
        const pctColor = s.change_pct >= 0 ? '#ff6b6b' : '#4ade80';
        const valueOku = (s.value / 1e8).toFixed(1);

        const pop = document.createElement('div');
        pop.id = 'heatmapPopover';
        pop.style.cssText = `
            position: fixed;
            background: rgba(24,24,36,0.98);
            color: #fff;
            padding: 1rem 1.1rem;
            border-radius: 12px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6), 0 0 0 1.5px rgba(180,130,255,0.5);
            font-size: 0.88rem;
            z-index: 100000;
            min-width: 220px;
        `;
        pop.innerHTML = `
            <div style="font-weight:700;font-size:1.1rem;margin-bottom:0.6rem;">
                ${s.name || ''} <span style="color:#aaa;font-weight:500;font-size:0.85rem;">(${s.code})</span>
            </div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:0.35rem 0.8rem;font-size:0.85rem;margin-bottom:0.9rem;">
                <span style="color:#999;">股價</span><span style="text-align:right;font-weight:600;">${s.close}</span>
                <span style="color:#999;">漲跌幅</span><span style="text-align:right;font-weight:700;color:${pctColor};">${sign}${s.change_pct.toFixed(2)}%</span>
                <span style="color:#999;">成交額</span><span style="text-align:right;">${valueOku} 億</span>
            </div>
            <div style="display:flex;gap:0.5rem;">
                <button id="popAddWatch" style="flex:1;padding:0.6rem;border:0;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85rem;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#000;">⭐ 加入自選股</button>
                <button id="popClose" style="padding:0.6rem 0.9rem;border:0;border-radius:8px;cursor:pointer;font-size:0.85rem;background:rgba(255,255,255,0.1);color:#ccc;">關閉</button>
            </div>
        `;
        document.body.appendChild(pop);

        // 定位
        const rect = pop.getBoundingClientRect();
        let x = ev.clientX + 12, y = ev.clientY + 12;
        if (x + rect.width > window.innerWidth - 10) x = window.innerWidth - rect.width - 10;
        if (y + rect.height > window.innerHeight - 10) y = ev.clientY - rect.height - 12;
        pop.style.left = Math.max(8, x) + 'px';
        pop.style.top = Math.max(8, y) + 'px';

        pop.querySelector('#popAddWatch').onclick = (e) => {
            e.stopPropagation();
            _addToWatchlistFromHeatmap(fullSymbol, s.name || s.code);
            pop.remove();
        };
        pop.querySelector('#popClose').onclick = (e) => { e.stopPropagation(); pop.remove(); };

        // 點外面關閉
        setTimeout(() => {
            const closeOnOutside = (e) => {
                if (!pop.contains(e.target)) {
                    pop.remove();
                    document.removeEventListener('click', closeOnOutside);
                }
            };
            document.addEventListener('click', closeOnOutside);
        }, 50);
    }

    function _heatmapToast(txt, type) {
        const bg = type === 'success' ? 'rgba(34,197,94,0.95)'
                 : type === 'info' ? 'rgba(120,80,255,0.95)'
                 : 'rgba(239,68,68,0.95)';
        const t = document.createElement('div');
        t.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%) translateY(-20px);
            background:${bg};color:#fff;padding:0.7rem 1.3rem;border-radius:10px;
            box-shadow:0 8px 30px rgba(0,0,0,0.4);z-index:99999;font-weight:600;font-size:0.9rem;
            opacity:0;transition:all 0.25s;`;
        t.textContent = txt;
        document.body.appendChild(t);
        requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
        setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(-20px)'; }, 2200);
        setTimeout(() => t.remove(), 2600);
    }

    // ============================================================
    // 自訂 tooltip
    // ============================================================
    function getStockSymbol(code) {
        if (typeof TW_STOCK_MAP !== 'undefined') {
            if (TW_STOCK_MAP[code + '.TWO']) return code + '.TWO';
            if (TW_STOCK_MAP[code + '.TW']) return code + '.TW';
        }
        return code + '.TW';
    }

    function _ensureTooltip() {
        let tip = document.getElementById('heatmapTooltip');
        if (tip) return tip;
        tip = document.createElement('div');
        tip.id = 'heatmapTooltip';
        tip.style.cssText = `
            position: fixed;
            background: rgba(17, 24, 39, 0.95);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            color: #f3f4f6;
            padding: 12px 16px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1), 0 0 15px rgba(139, 92, 246, 0.25);
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            font-size: 0.85rem;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s ease, transform 0.12s ease;
            z-index: 99999;
            min-width: 200px;
            line-height: 1.5;
        `;
        document.body.appendChild(tip);
        return tip;
    }

    function _showTooltip(s, ev) {
        const tip = _ensureTooltip();
        const sign = s.change_pct >= 0 ? '+' : '';
        const pctColor = s.change_pct >= 0 ? '#ef4444' : '#22c55e';
        const valueOku = (s.value / 1e8).toFixed(2);
        const volWan = (s.volume / 10000).toFixed(1);
        const fullSymbol = getStockSymbol(s.code);
        
        tip.innerHTML = `
            <div style="font-weight: 700; font-size: 1.05rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <span>${s.name || '未定義'}</span>
                <span style="color: #c084fc; font-size: 0.8rem; font-weight: 600; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); padding: 2px 6px; border-radius: 4px; font-family: monospace; white-space: nowrap;">${fullSymbol}</span>
            </div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 0.85rem;">
                <span style="color: #9ca3af;">股價</span>
                <span style="text-align: right; font-weight: 600; color: #f9fafb;">${s.close != null ? s.close.toFixed(2) : '-'}</span>
                
                <span style="color: #9ca3af;">漲跌幅</span>
                <span style="text-align: right; font-weight: 700; color: ${pctColor};">${sign}${s.change_pct.toFixed(2)}%</span>
                
                <span style="color: #9ca3af;">成交額</span>
                <span style="text-align: right; font-weight: 600; color: #f9fafb;">${Number(valueOku).toLocaleString()} 億</span>
                
                <span style="color: #9ca3af;">成交量</span>
                <span style="text-align: right; font-weight: 600; color: #f9fafb;">${Number(volWan).toLocaleString()} 萬股</span>
            </div>
            <div style="margin-top: 10px; font-size: 0.75rem; color: #a78bfa; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; text-align: center; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 4px;">
                <span>👆 點擊看詳情 / 加入自選</span>
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

            // v12.4.9：自適應產業 label — 過小時略過或精簡
            const isTiny = w < 80 || h < 50;
            const isSmall = w < 130;
            const labelH = isTiny ? 0 : (isSmall ? 17 : 20);

            // 第二層：產業內個股
            const stocks = (ind.stocks || []).map(s => ({ ...s, value: s.value || 1 }));
            stocks.sort((a, b) => b.value - a.value);

            const stockRects = squarify(stocks, 0, labelH, w, h - labelH);

            // 產業名 label（依大小自適應）
            if (labelH > 0) {
                const lbl = document.createElement('div');
                const fontSize = isSmall ? 10 : 12.5;
                lbl.style.cssText = `
                    position:absolute; left:0; top:0; right:0; height:${labelH}px;
                    line-height:${labelH}px; padding:0 ${isSmall ? 4 : 6}px;
                    background:rgba(10, 10, 15, 0.88); color:#f8fafc;
                    font-size:${fontSize}px; font-weight:700;
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                    pointer-events:none;
                    letter-spacing:${isSmall ? 0 : 0.3}px;
                    text-shadow:0 1px 2px rgba(0,0,0,0.9);
                    border-bottom:1px solid rgba(255,255,255,0.08);
                `;
                const avgChg = ind.avg_change_pct || 0;
                const avgSign = avgChg >= 0 ? '+' : '';
                const avgColor = avgChg >= 0 ? '#ff8080' : '#4ade80';

                if (isSmall) {
                    // 窄 label：只顯示「產業名 +X%」省略成交額徽章
                    lbl.innerHTML = `${ind.name} <span style="color:${avgColor};font-weight:800;">${avgSign}${avgChg.toFixed(1)}%</span>`;
                } else {
                    lbl.innerHTML = `${ind.name} <span style="color:${avgColor}; font-weight:800;">${avgSign}${avgChg.toFixed(2)}%</span> <span style="color:#cbd5e1; font-weight:600; font-size:10.5px; margin-left:4px; background:rgba(255,255,255,0.12); padding:1px 4px; border-radius:3px; display:inline-block; line-height:1;">總成交額 ${(ind.total_value/1e8).toFixed(1)}億</span>`;
                }
                block.appendChild(lbl);
            } else {
                // 太小無 label → 用左上角產業圓徽章替代
                const badge = document.createElement('div');
                const avgChg = ind.avg_change_pct || 0;
                const avgColor = avgChg >= 0 ? 'rgba(239,68,68,0.85)' : 'rgba(34,197,94,0.85)';
                badge.style.cssText = `
                    position:absolute; left:2px; top:2px; z-index:2;
                    background:${avgColor}; color:#fff;
                    font-size:9px; font-weight:700;
                    padding:1px 4px; border-radius:3px;
                    pointer-events:none; line-height:1.2;
                    text-shadow:0 1px 1px rgba(0,0,0,0.5);
                    max-width:${w-4}px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
                `;
                badge.textContent = ind.name;
                badge.title = `${ind.name} ${avgChg >= 0 ? '+' : ''}${avgChg.toFixed(2)}%`;
                block.appendChild(badge);
            }

            // 每檔股票
            for (const s of stockRects) {
                const r = s._rect;
                if (r.w < 14 || r.h < 12) continue;  // v12.4.9：下調最小門檻顯示更多個股

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
                cell.onclick = (ev) => {
                    // v12.1.5：點擊跳出詳情卡片（含「加入自選股」按鈕），不再直接加入
                    ev.stopPropagation();
                    _showStockPopover(s, ev);
                };

                // v12.4.9：文字三段式自適應 + 縮短代碼/名稱讓更多窄格也能讀
                const nameSize = r.w > 90 ? 13 : (r.w > 60 ? 11 : (r.w > 35 ? 9 : 8));
                const pctSize = r.w > 90 ? 12 : (r.w > 60 ? 10 : 9);
                const sign = s.change_pct >= 0 ? '+' : '';
                // 名稱：寬>60 全名, 35-60 簡碼, <35 代碼前4碼
                let displayText;
                if (r.w > 60 && s.name) {
                    displayText = s.name.length > 5 ? s.name.slice(0, 5) : s.name;
                } else if (r.w > 30) {
                    displayText = s.code;
                } else {
                    displayText = s.code.slice(0, 4);
                }
                // 中型格：垂直空間夠就顯示百分比；極小格只顯示代碼
                const showPct = r.h > 24;
                cell.innerHTML = `
                    <div style="font-size:${nameSize}px;font-weight:700;line-height:1.1;text-align:center;padding:0 1px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${displayText}
                    </div>
                    ${showPct ? `<div style="font-size:${pctSize}px;line-height:1.1;margin-top:1px;font-variant-numeric:tabular-nums;">${sign}${s.change_pct.toFixed(r.w > 50 ? 2 : 1)}%</div>` : ''}
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
