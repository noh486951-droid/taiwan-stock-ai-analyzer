// holders_detail_modal.js — v12.4.2
//
// 點擊「🧬 籌碼結構」面板 → 彈出大圖詳細 modal
//
// 內容：
//   1. 集保分散（4 桶橫條 + 每週變化）放大版
//   2. 30 日法人累積走勢圖（外資/投信/自營三線疊加，hover 看當日數值）
//   3. 30 日法人逐日明細表（日期 / 外資 / 投信 / 自營 / 合計，紅綠標記）
//   4. 投信隔日沖偵測分析
//
// 使用：
//   window.showHoldersDetailModal(symbol, name, stockData)

(function () {
    'use strict';

    // 台股紅綠
    const C_BUY = '#ef4444';
    const C_SELL = '#22c55e';
    const C_FOREIGN = '#60a5fa';  // 外資 藍
    const C_TRUST = '#fbbf24';     // 投信 黃
    const C_DEALER = '#a78bfa';    // 自營 紫
    const C_RETAIL_EST = '#ffce5e'; // 散戶推估 金

    const C_RETAIL = '#5a8aff';
    const C_MID = '#a16eff';
    const C_BIG = '#fb923c';
    const C_MEGA = '#ef4444';

    function _lotsRound(n) {
        return Math.round((n || 0) / 1000);
    }

    function _fmtLots(n) {
        const v = _lotsRound(n);
        const sign = v >= 0 ? '+' : '';
        return `${sign}${v.toLocaleString()}`;
    }

    function _lotsClass(n) {
        return n > 0 ? 'text-positive' : (n < 0 ? 'text-negative' : 'text-muted');
    }

    // 大圖累積線（含 hover tooltip）
    function _renderBigCumulativeChart(daily) {
        if (!daily || daily.length < 2) return '<div style="color:#888;padding:1rem;text-align:center;">資料不足</div>';

        const W = 600, H = 200, P = 30;
        const pw = W - P * 2, ph = H - P - 20;

        // 累積四條線（外資/投信/自營/散戶推估）
        let fAcc = 0, tAcc = 0, dAcc = 0, rAcc = 0;
        const pts = daily.map((d, i) => {
            const fd = _lotsRound(d.foreign), td = _lotsRound(d.trust), dd = _lotsRound(d.dealer);
            fAcc += fd;
            tAcc += td;
            dAcc += dd;
            rAcc += -(fd + td + dd);  // 散戶推估 = -法人合計
            return { i, date: d.date, foreign: fAcc, trust: tAcc, dealer: dAcc, retail: rAcc };
        });

        const allY = pts.flatMap(p => [p.foreign, p.trust, p.dealer, p.retail, 0]);
        const minY = Math.min(...allY);
        const maxY = Math.max(...allY);
        const rangeY = (maxY - minY) || 1;
        const dx = pw / (pts.length - 1);
        const yPos = v => P + (ph - ((v - minY) / rangeY) * ph);
        const xPos = i => P + i * dx;

        const pathFor = (key) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(p[key]).toFixed(1)}`).join(' ');

        const zeroY = yPos(0);

        // hover overlay 區塊（每段對應一個 i）
        const hoverRects = pts.map((p, i) => `
            <rect x="${(xPos(i) - dx/2).toFixed(1)}" y="${P}" width="${dx.toFixed(1)}" height="${ph}"
                  fill="transparent" data-i="${i}" style="cursor:crosshair;"
                  class="holders-hover-rect" />
        `).join('');

        return `
        <div class="holders-big-chart" style="position:relative;background:#0d1117;border-radius:8px;padding:8px;">
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;" id="holdersBigSvg">
                <!-- 零軸 -->
                <line x1="${P}" y1="${zeroY}" x2="${W - P}" y2="${zeroY}" stroke="rgba(255,255,255,0.2)" stroke-dasharray="3,3" stroke-width="0.5"/>
                <!-- 四條累積線（散戶用虛線標示「推估」） -->
                <path d="${pathFor('retail')}" fill="none" stroke="${C_RETAIL_EST}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.85"/>
                <path d="${pathFor('foreign')}" fill="none" stroke="${C_FOREIGN}" stroke-width="1.8"/>
                <path d="${pathFor('trust')}" fill="none" stroke="${C_TRUST}" stroke-width="1.8"/>
                <path d="${pathFor('dealer')}" fill="none" stroke="${C_DEALER}" stroke-width="1.8"/>
                <!-- 末端標記 -->
                <circle cx="${xPos(pts.length-1).toFixed(1)}" cy="${yPos(pts[pts.length-1].foreign).toFixed(1)}" r="3" fill="${C_FOREIGN}"/>
                <circle cx="${xPos(pts.length-1).toFixed(1)}" cy="${yPos(pts[pts.length-1].trust).toFixed(1)}" r="3" fill="${C_TRUST}"/>
                <circle cx="${xPos(pts.length-1).toFixed(1)}" cy="${yPos(pts[pts.length-1].dealer).toFixed(1)}" r="3" fill="${C_DEALER}"/>
                <circle cx="${xPos(pts.length-1).toFixed(1)}" cy="${yPos(pts[pts.length-1].retail).toFixed(1)}" r="3" fill="${C_RETAIL_EST}"/>
                <!-- Y 軸標籤 -->
                <text x="${W - P + 4}" y="${zeroY + 4}" font-size="9" fill="#888">0</text>
                <text x="${W - P + 4}" y="${P + 4}" font-size="9" fill="#888">${maxY.toLocaleString()}</text>
                <text x="${W - P + 4}" y="${P + ph}" font-size="9" fill="#888">${minY.toLocaleString()}</text>
                <!-- X 起訖日期 -->
                <text x="${P}" y="${H - 4}" font-size="9" fill="#888">${pts[0].date}</text>
                <text x="${W - P}" y="${H - 4}" font-size="9" fill="#888" text-anchor="end">${pts[pts.length-1].date}</text>
                <!-- hover overlay 最後（蓋在上面才接得到 mouseover） -->
                ${hoverRects}
                <!-- crosshair + tooltip target -->
                <line id="holdersCrosshair" x1="0" y1="${P}" x2="0" y2="${P+ph}" stroke="rgba(255,255,255,0.3)" stroke-width="0.5" style="display:none;"/>
            </svg>
            <div id="holdersTooltip" style="position:absolute;background:#1a1a2e;border:1px solid rgba(120,80,255,0.4);
                 border-radius:6px;padding:6px 10px;font-size:0.78rem;pointer-events:none;display:none;z-index:5;
                 white-space:nowrap;">
            </div>
            <div style="display:flex;gap:1rem;justify-content:center;margin-top:8px;font-size:0.78rem;flex-wrap:wrap;">
                <span><span style="display:inline-block;width:10px;height:2px;background:${C_FOREIGN};vertical-align:middle;margin-right:4px;"></span>外資</span>
                <span><span style="display:inline-block;width:10px;height:2px;background:${C_TRUST};vertical-align:middle;margin-right:4px;"></span>投信</span>
                <span><span style="display:inline-block;width:10px;height:2px;background:${C_DEALER};vertical-align:middle;margin-right:4px;"></span>自營</span>
                <span><span style="display:inline-block;width:10px;height:2px;background:${C_RETAIL_EST};vertical-align:middle;margin-right:4px;border-top:1px dashed ${C_RETAIL_EST};"></span>散戶(推估)</span>
                <span style="color:#888;">累積張數 · 30 日內</span>
            </div>
        </div>`;
    }

    function _renderDailyTable(daily) {
        if (!daily || daily.length === 0) {
            return '<div style="color:#888;text-align:center;padding:1rem;">無逐日資料</div>';
        }
        // 散戶推估：zero-sum 觀點，散戶逐日 ≈ -法人合計（粗略）
        // 註：因有大戶/借券交易等，僅為「散戶情緒方向」近似指標
        const rows = [...daily].reverse().map(d => {
            const f = _lotsRound(d.foreign);
            const t = _lotsRound(d.trust);
            const dl = _lotsRound(d.dealer);
            const total = f + t + dl;
            const retail = -total;  // 散戶推估
            return `<tr>
                <td style="padding:4px 6px;color:#bbb;">${d.date}</td>
                <td style="padding:4px 6px;text-align:right;" class="${_lotsClass(f)}">${_fmtLots(d.foreign)}</td>
                <td style="padding:4px 6px;text-align:right;" class="${_lotsClass(t)}">${_fmtLots(d.trust)}</td>
                <td style="padding:4px 6px;text-align:right;" class="${_lotsClass(dl)}">${_fmtLots(d.dealer)}</td>
                <td style="padding:4px 6px;text-align:right;font-weight:600;" class="${_lotsClass(total)}">${total >= 0 ? '+' : ''}${total.toLocaleString()}</td>
                <td style="padding:4px 6px;text-align:right;font-weight:600;border-left:1px dashed rgba(255,255,255,0.15);" class="${_lotsClass(retail)}">${retail >= 0 ? '+' : ''}${retail.toLocaleString()}</td>
            </tr>`;
        }).join('');
        return `
        <div style="max-height:320px;overflow-y:auto;border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
        <table style="width:100%;border-collapse:collapse;font-size:0.78rem;font-variant-numeric:tabular-nums;">
            <thead style="background:rgba(120,80,255,0.1);position:sticky;top:0;">
                <tr>
                    <th style="padding:6px;text-align:left;color:#aaa;font-weight:600;">日期</th>
                    <th style="padding:6px;text-align:right;color:${C_FOREIGN};font-weight:600;">外資</th>
                    <th style="padding:6px;text-align:right;color:${C_TRUST};font-weight:600;">投信</th>
                    <th style="padding:6px;text-align:right;color:${C_DEALER};font-weight:600;">自營</th>
                    <th style="padding:6px;text-align:right;color:#fff;font-weight:600;">法人合計</th>
                    <th style="padding:6px;text-align:right;color:#ffce5e;font-weight:600;border-left:1px dashed rgba(255,255,255,0.15);" title="zero-sum 推估：散戶 ≈ -法人合計">散戶 (推估)</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        </div>
        <div style="font-size:0.7rem;color:#666;margin-top:4px;line-height:1.6;">
          單位：張（1000 股）｜
          <span style="color:#ffce5e;">散戶推估</span>：採 zero-sum 簡化（散戶 ≈ -法人合計），未扣除大戶/借券，僅供方向參考
        </div>
        `;
    }

    function _renderHoldersDistFull(hd) {
        if (!hd) {
            return '<div style="color:#888;padding:1rem;text-align:center;">集保資料尚未抓到（週六後補）</div>';
        }
        const r = hd.retail_pct || 0;
        const m = hd.mid_pct || 0;
        const b = hd.big_pct || 0;
        const mega = hd.mega_pct || 0;
        const other = hd.other_pct || 0;
        const wc = hd.weekly_change || {};
        const rowFor = (label, range, pct, color, wcKey) => {
            const ch = wc[wcKey];
            const chStr = ch == null ? '—' : `${ch > 0 ? '+' : ''}${ch.toFixed(2)}pp`;
            const chCls = ch == null ? 'text-muted' : (ch > 0 ? 'text-positive' : (ch < 0 ? 'text-negative' : 'text-muted'));
            return `<tr>
                <td style="padding:6px;">
                    <span style="display:inline-block;width:8px;height:8px;background:${color};border-radius:2px;vertical-align:middle;margin-right:6px;"></span>
                    <b>${label}</b> <span style="color:#888;font-size:0.72rem;">${range}</span>
                </td>
                <td style="padding:6px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${pct.toFixed(2)}%</td>
                <td style="padding:6px;text-align:right;" class="${chCls}">${chStr}</td>
            </tr>`;
        };
        return `
        <div style="background:rgba(120,80,255,0.04);border-radius:8px;padding:12px;">
            <div style="display:flex;height:14px;border-radius:4px;overflow:hidden;margin-bottom:10px;background:rgba(255,255,255,0.04);">
                <div style="width:${r}%;background:${C_RETAIL};" title="散戶 ${r.toFixed(1)}%"></div>
                <div style="width:${m}%;background:${C_MID};" title="中實戶 ${m.toFixed(1)}%"></div>
                <div style="width:${b}%;background:${C_BIG};" title="大戶 ${b.toFixed(1)}%"></div>
                <div style="width:${mega}%;background:${C_MEGA};" title="千張 ${mega.toFixed(1)}%"></div>
                <div style="width:${other}%;background:#555;" title="其他 ${other.toFixed(1)}%"></div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                <thead>
                    <tr style="color:#888;">
                        <th style="text-align:left;padding:6px;font-weight:600;">持股級距</th>
                        <th style="text-align:right;padding:6px;font-weight:600;">占比</th>
                        <th style="text-align:right;padding:6px;font-weight:600;">週變化</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowFor('散戶', '1 ~ 10 張', r, C_RETAIL, 'retail')}
                    ${rowFor('中實戶', '10 ~ 400 張', m, C_MID, 'mid')}
                    ${rowFor('大戶', '400 ~ 1000 張', b, C_BIG, 'big')}
                    ${rowFor('千張大戶', '> 1000 張', mega, C_MEGA, 'mega')}
                    ${other > 0 ? `<tr><td style="padding:6px;color:#888;">其他</td><td style="text-align:right;padding:6px;color:#888;">${other.toFixed(2)}%</td><td></td></tr>` : ''}
                </tbody>
            </table>
            <div style="font-size:0.72rem;color:#666;margin-top:8px;">資料截至：${hd.as_of_date || '—'}</div>
        </div>`;
    }

    function _renderShortSqueezeAnalysis(inst) {
        if (!inst || !inst.trust) return '';
        const t = inst.trust;
        const f = inst.foreign || {};
        const streak = t.streak || 0;
        const today = _lotsRound(t.today);
        const t5 = _lotsRound(t['5d_total']);
        const t20 = _lotsRound(t['20d_total']);
        const fStreak = f.streak || 0;

        let levels = [];

        if (streak >= 3) {
            levels.push({ icon: '🚨', col: '#fca5a5', text: `投信連 ${streak} 日買進，歷史上 60% 機率隔日沖出貨` });
        }
        if (streak === 1 && today > 0 && t5 < today * 2) {
            levels.push({ icon: '⚠️', col: '#fdba74', text: `投信單日進場 +${today} 張，但 5 日累計僅 ${t5}，疑似隔日沖試單` });
        }
        if (streak <= -3) {
            levels.push({ icon: '❄️', col: '#93c5fd', text: `投信連 ${Math.abs(streak)} 日賣超，賣壓持續` });
        }
        if (fStreak >= 5) {
            levels.push({ icon: '💪', col: '#86efac', text: `外資連 ${fStreak} 日買進，主力穩定加碼` });
        }
        if (fStreak <= -5) {
            levels.push({ icon: '⚡', col: '#fca5a5', text: `外資連 ${Math.abs(fStreak)} 日賣超，主力撤離訊號` });
        }

        if (levels.length === 0) {
            return `<div style="color:#888;padding:1rem;text-align:center;font-size:0.82rem;">目前無特殊籌碼訊號</div>`;
        }

        return levels.map(l => `
            <div style="display:flex;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:6px;font-size:0.82rem;border-left:3px solid ${l.col};">
                <span style="font-size:1.1rem;">${l.icon}</span>
                <span style="color:${l.col};">${l.text}</span>
            </div>
        `).join('');
    }

    function _attachHoverHandlers(daily) {
        // 算每點的累積值用於 tooltip
        let fAcc = 0, tAcc = 0, dAcc = 0, rAcc = 0;
        const pts = daily.map((d) => {
            const fd = _lotsRound(d.foreign), td = _lotsRound(d.trust), dd = _lotsRound(d.dealer);
            const rd = -(fd + td + dd);
            fAcc += fd;
            tAcc += td;
            dAcc += dd;
            rAcc += rd;
            return {
                date: d.date,
                fDay: fd, tDay: td, dDay: dd, rDay: rd,
                fAcc, tAcc, dAcc, rAcc,
            };
        });

        const svg = document.getElementById('holdersBigSvg');
        const tip = document.getElementById('holdersTooltip');
        const ch = document.getElementById('holdersCrosshair');
        if (!svg || !tip) return;

        svg.querySelectorAll('.holders-hover-rect').forEach(r => {
            r.addEventListener('mouseenter', (e) => {
                const i = parseInt(r.getAttribute('data-i'), 10);
                const p = pts[i];
                if (!p) return;
                const x = parseFloat(r.getAttribute('x')) + parseFloat(r.getAttribute('width')) / 2;
                if (ch) {
                    ch.setAttribute('x1', x);
                    ch.setAttribute('x2', x);
                    ch.style.display = '';
                }
                const cls = v => v > 0 ? 'text-positive' : (v < 0 ? 'text-negative' : 'text-muted');
                const sign = v => v > 0 ? '+' : '';
                tip.innerHTML = `
                    <div style="font-weight:600;margin-bottom:4px;">${p.date}</div>
                    <div style="display:grid;grid-template-columns:auto auto auto;gap:2px 10px;">
                      <span style="color:${C_FOREIGN};">外資</span>
                      <span class="${cls(p.fDay)}">${sign(p.fDay)}${p.fDay.toLocaleString()}</span>
                      <span style="color:#888;">累 ${p.fAcc.toLocaleString()}</span>
                      <span style="color:${C_TRUST};">投信</span>
                      <span class="${cls(p.tDay)}">${sign(p.tDay)}${p.tDay.toLocaleString()}</span>
                      <span style="color:#888;">累 ${p.tAcc.toLocaleString()}</span>
                      <span style="color:${C_DEALER};">自營</span>
                      <span class="${cls(p.dDay)}">${sign(p.dDay)}${p.dDay.toLocaleString()}</span>
                      <span style="color:#888;">累 ${p.dAcc.toLocaleString()}</span>
                      <span style="color:${C_RETAIL_EST};">散戶~</span>
                      <span class="${cls(p.rDay)}">${sign(p.rDay)}${p.rDay.toLocaleString()}</span>
                      <span style="color:#888;">累 ${p.rAcc.toLocaleString()}</span>
                    </div>
                    <div style="font-size:0.7rem;color:#666;margin-top:3px;">單位：張 · ~推估</div>`;
                tip.style.display = 'block';
                // 定位：把 tip 放在 svg 內對應位置
                const svgRect = svg.getBoundingClientRect();
                const ratio = svgRect.width / 600;
                tip.style.left = (x * ratio + 12) + 'px';
                tip.style.top = '20px';
            });
            r.addEventListener('mouseleave', () => {
                if (ch) ch.style.display = 'none';
                tip.style.display = 'none';
            });
        });
    }

    window.showHoldersDetailModal = function (symbol, name, data) {
        document.getElementById('holdersDetailOverlay')?.remove();
        const inst = data.institutional || {};
        const hd = data.holders_distribution || null;
        const daily = inst.daily || inst.foreign?.history && inst.foreign.history.map((_, i) => ({
            date: '',
            foreign: inst.foreign.history[i],
            trust: inst.trust?.history?.[i] ?? 0,
            dealer: inst.dealer?.history?.[i] ?? 0,
        })) || [];

        const overlay = document.createElement('div');
        overlay.id = 'holdersDetailOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.85);
            z-index: 99991;
            display: flex; align-items: center; justify-content: center;
            padding: 1rem;
        `;
        overlay.innerHTML = `
            <div style="background:#16213e;border-radius:14px;width:min(720px,96vw);max-height:92vh;overflow-y:auto;
                        padding:1.2rem 1.4rem;border:1px solid rgba(120,80,255,0.4);">
                <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1rem;">
                    <div>
                        <b style="font-size:1.15rem;">🧬 ${name || ''} <span style="color:#aaa;font-weight:500;font-size:0.9rem;">${symbol}</span></b>
                        <div style="font-size:0.75rem;color:#888;margin-top:2px;">籌碼面詳細分析</div>
                    </div>
                    <button onclick="document.getElementById('holdersDetailOverlay').remove()"
                            style="background:transparent;border:0;color:#aaa;font-size:1.4rem;cursor:pointer;">✕</button>
                </div>

                <!-- 集保戶分散 -->
                <div style="margin-bottom:1.2rem;">
                    <h4 style="font-size:0.92rem;margin:0 0 0.6rem 0;color:#c9b3ff;">📊 集保戶股權分散</h4>
                    ${_renderHoldersDistFull(hd)}
                </div>

                <!-- 累積走勢大圖 -->
                <div style="margin-bottom:1.2rem;">
                    <h4 style="font-size:0.92rem;margin:0 0 0.6rem 0;color:#c9b3ff;">📈 三大法人累積走勢 (30 日)</h4>
                    ${_renderBigCumulativeChart(daily)}
                </div>

                <!-- 籌碼分析 -->
                <div style="margin-bottom:1.2rem;">
                    <h4 style="font-size:0.92rem;margin:0 0 0.6rem 0;color:#c9b3ff;">🔍 籌碼訊號偵測</h4>
                    ${_renderShortSqueezeAnalysis(inst)}
                </div>

                <!-- 逐日明細表 -->
                <div>
                    <h4 style="font-size:0.92rem;margin:0 0 0.6rem 0;color:#c9b3ff;">📋 30 日逐日買賣超明細</h4>
                    ${_renderDailyTable(daily)}
                </div>
            </div>
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);

        // 綁定 hover
        setTimeout(() => _attachHoverHandlers(daily), 50);
    };
})();
