// kline_modal.js — K 線 + 進出場標記 (v12.3.3)
//
// 用法：window.showKlineModal('2330.TW', '台積電')
//
// 從以下來源拿資料：
//   - data/klines/{sym}.json    （OHLC 60 日，klines_builder.py 產出）
//   - window._portfolio          （目前持倉 + 歷史，標記用）
//
// 用 lightweight-charts (CDN, ~150KB)

(function () {
    'use strict';

    const LWC_SRC = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js';
    let _lwcLoaded = false;
    let _lwcLoadingPromise = null;

    function _loadLwc() {
        if (_lwcLoaded) return Promise.resolve();
        if (_lwcLoadingPromise) return _lwcLoadingPromise;
        _lwcLoadingPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = LWC_SRC;
            s.async = true;
            s.onload = () => { _lwcLoaded = true; resolve(); };
            s.onerror = () => reject(new Error('lightweight-charts failed to load'));
            document.head.appendChild(s);
        });
        return _lwcLoadingPromise;
    }

    async function _fetchKlines(sym) {
        const safe = sym.replace(/\//g, '_');
        const r = await fetch(`data/klines/${safe}.json`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`K 線檔案不存在（會在今晚 18:07 workflow 抓）`);
        const data = await r.json();
        if (!Array.isArray(data.ohlc) || data.ohlc.length === 0) {
            throw new Error('K 線資料為空');
        }
        return data;
    }

    function _gatherTradeMarkers(sym) {
        const p = window._portfolio || {};
        const markers = [];

        // 1. 目前持倉的進場
        const pos = (p.positions || {})[sym];
        if (pos && pos.entry_date) {
            markers.push({
                time: pos.entry_date,
                position: 'belowBar',
                color: pos.entry_side === 'left' ? '#fbbf24' : '#5a8aff',
                shape: 'arrowUp',
                text: `進 ${pos.entry_price}${pos.entry_side === 'left' ? ' 🩸' : ''}`,
            });
            // 分批止盈標記
            for (const lv of (pos.scale_out_plan || [])) {
                if (lv.executed && lv.executed_at) {
                    markers.push({
                        time: (lv.executed_at || '').slice(0, 10),
                        position: 'aboveBar',
                        color: '#fbbf24',
                        shape: 'circle',
                        text: `分批 +${lv.trigger_pct}%`,
                    });
                }
            }
        }

        // 2. 歷史交易（同 sym）
        for (const t of (p.history || [])) {
            const tsym = t.sym || t.symbol;
            if (tsym !== sym) continue;
            // 進場
            if (t.entry_date) {
                markers.push({
                    time: t.entry_date,
                    position: 'belowBar',
                    color: t.entry_side === 'left' ? '#fbbf24' : '#5a8aff',
                    shape: 'arrowUp',
                    text: `進 ${t.entry_price}`,
                });
            }
            // 出場
            if (t.exit_date) {
                const pnl = Number(t.pnl_pct ?? t.pnl_pct ?? 0);
                const sign = pnl >= 0 ? '+' : '';
                markers.push({
                    time: t.exit_date,
                    position: 'aboveBar',
                    color: pnl >= 0 ? '#22c55e' : '#ef4444',
                    shape: 'arrowDown',
                    text: `出 ${t.exit_price} (${sign}${pnl.toFixed(1)}%)`,
                });
            }
        }

        // 依日期排序
        markers.sort((a, b) => a.time.localeCompare(b.time));
        return markers;
    }

    window.showKlineModal = async function (sym, name) {
        // 移除舊 modal
        document.getElementById('klineModalOverlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'klineModalOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.85);
            z-index: 99990;
            display: flex; align-items: center; justify-content: center;
            padding: 1rem;
        `;
        overlay.innerHTML = `
            <div style="background:#16213e;border-radius:14px;width:min(900px,95vw);height:min(620px,90vh);
                        display:flex;flex-direction:column;padding:1rem 1.2rem;border:1px solid rgba(120,80,255,0.4);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
                    <div>
                        <b style="font-size:1.1rem;">📊 ${name || ''} <span style="color:#aaa;font-weight:500;font-size:0.9rem;">${sym}</span></b>
                        <div style="font-size:0.75rem;color:#888;margin-top:0.2rem;" id="klineSubtitle">60 日 K 線 · 進場 ▲ 出場 ▼</div>
                    </div>
                    <button onclick="document.getElementById('klineModalOverlay').remove()"
                            style="background:transparent;border:0;color:#aaa;font-size:1.4rem;cursor:pointer;">✕</button>
                </div>
                <div id="klineChartContainer" style="flex:1;background:#0d1117;border-radius:8px;overflow:hidden;position:relative;">
                    <div id="klineLoadingMsg" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;">
                        載入中…
                    </div>
                </div>
                <div id="klineTradesList" style="margin-top:0.6rem;max-height:120px;overflow-y:auto;font-size:0.78rem;color:#ccc;"></div>
            </div>
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);

        try {
            await _loadLwc();
        } catch (e) {
            document.getElementById('klineLoadingMsg').textContent = '❌ 圖表程式庫載入失敗';
            return;
        }

        let data;
        try {
            data = await _fetchKlines(sym);
        } catch (e) {
            document.getElementById('klineLoadingMsg').innerHTML =
                `❌ ${e.message}<br><small style="color:#666;margin-top:0.5rem;display:block;">需等今晚 18:07 workflow 跑 klines_builder.py 後才會有資料</small>`;
            return;
        }

        document.getElementById('klineLoadingMsg').remove();

        const container = document.getElementById('klineChartContainer');
        const chart = LightweightCharts.createChart(container, {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: {
                background: { color: '#0d1117' },
                textColor: '#ccc',
            },
            grid: {
                vertLines: { color: 'rgba(255,255,255,0.05)' },
                horzLines: { color: 'rgba(255,255,255,0.05)' },
            },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
            timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: false },
            crosshair: { mode: 1 },
        });

        // K 線（台股紅漲綠跌）
        const candleSeries = chart.addCandlestickSeries({
            upColor: '#ef4444', downColor: '#22c55e',
            borderUpColor: '#ef4444', borderDownColor: '#22c55e',
            wickUpColor: '#ef4444', wickDownColor: '#22c55e',
        });
        candleSeries.setData(data.ohlc.map(d => ({
            time: d.date, open: d.o, high: d.h, low: d.l, close: d.c,
        })));

        // 標記進出場
        const markers = _gatherTradeMarkers(sym);
        if (markers.length > 0) {
            candleSeries.setMarkers(markers);
        }

        // RWD: resize
        const ro = new ResizeObserver(() => {
            chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        });
        ro.observe(container);

        // 列表顯示
        const listEl = document.getElementById('klineTradesList');
        if (markers.length > 0) {
            listEl.innerHTML = `
                <div style="font-weight:600;color:#aaa;margin-bottom:0.3rem;">📍 交易紀錄（${markers.length}）</div>
                ${markers.map(m => `
                    <div style="display:flex;gap:0.7rem;padding:2px 0;">
                        <span style="color:${m.color};">●</span>
                        <span style="color:#888;min-width:90px;">${m.time}</span>
                        <span>${m.text}</span>
                    </div>
                `).join('')}
            `;
        } else {
            listEl.innerHTML = '<span style="color:#666;">尚無交易標記</span>';
        }

        // 訂閱 chart 銷毀
        overlay.addEventListener('remove', () => {
            try { chart.remove(); ro.disconnect(); } catch {}
        });
    };
})();
