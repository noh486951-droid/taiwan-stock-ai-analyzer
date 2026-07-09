// checkup.js — 🧪 健檢中心 (v12.8.0)
//
// 三個 tab：
//   redflags — TWSE 注意/處置股 + 散戶擁擠 + 鯨魚出走
//   whales   — 千張大戶持股 Top + 週增 Top
//   aireport — AI verdict 5 日後對答案的準確率
//
// 資料：data/red_flags.json（red_flags_scanner.py）
//       data/verdict_history.json（verdict_recorder.py）

(function () {
    'use strict';

    let _flags = null;
    let _verdict = null;
    let _tab = 'redflags';

    function _nameOf(sym, fallback) {
        if (typeof TW_STOCK_MAP !== 'undefined' && TW_STOCK_MAP[sym]) return TW_STOCK_MAP[sym];
        return fallback || sym.replace(/\.(TW|TWO)$/, '');
    }

    function _pp(v) {
        if (v == null) return '<span style="color:#666;">—</span>';
        const cls = v > 0 ? 'text-negative' : (v < 0 ? 'text-positive' : '');
        // 注意：散戶增加 = 壞（紅），減少 = 好（綠）→ 呼叫端自行決定顏色
        return `${v > 0 ? '+' : ''}${v.toFixed(2)}pp`;
    }

    // ============ Tab 1：地雷紅旗 ============
    function renderRedflags() {
        if (!_flags) return '<p class="chk-empty">紅旗資料尚未生成（每天 18:07 EOD 更新）</p>';
        const f = _flags;
        let html = `<p style="font-size:0.75rem;color:#888;">TWSE 公告即時 · 集保資料截至 ${f.tdcc_as_of || '—'} · 產生於 ${f.generated_at || ''}</p>`;

        // 處置股票（最嚴重）
        html += `<div class="chk-section"><h4>🚫 處置股票（${(f.punish || []).length}）— 分盤交易中，流動性受限</h4>`;
        if ((f.punish || []).length) {
            html += `<div class="chk-scroll"><table class="chk-table"><thead><tr>
                <th>股票</th><th>處置期間</th><th>條件</th></tr></thead><tbody>`;
            for (const p of f.punish) {
                html += `<tr><td><b>${p.name}</b> <span style="color:#888;">${p.code}</span></td>
                    <td style="font-size:0.76rem;">${p.period}</td>
                    <td style="font-size:0.76rem;color:#aaa;">${p.condition}</td></tr>`;
            }
            html += '</tbody></table></div>';
        } else html += '<p class="chk-empty">目前無處置個股</p>';
        html += '</div>';

        // 注意股票
        html += `<div class="chk-section"><h4>⚠️ 注意股票（${(f.attention || []).length}）— 波動異常，追高風險高</h4>`;
        if ((f.attention || []).length) {
            html += `<div class="chk-scroll"><table class="chk-table"><thead><tr>
                <th>股票</th><th class="num">累計次數</th><th>原因</th></tr></thead><tbody>`;
            for (const a of f.attention) {
                html += `<tr><td><b>${a.name}</b> <span style="color:#888;">${a.code}</span></td>
                    <td class="num">${a.count}</td>
                    <td style="font-size:0.76rem;color:#aaa;">${a.reason}</td></tr>`;
            }
            html += '</tbody></table></div>';
        } else html += '<p class="chk-empty">目前無注意個股</p>';
        html += '</div>';

        // 鯨魚出走
        html += `<div class="chk-section"><h4>🏃 鯨魚出走（${(f.whale_exodus || []).length}）— 千張大戶週減 + 散戶接手（出貨型態）</h4>`;
        if ((f.whale_exodus || []).length) {
            html += `<div class="chk-scroll"><table class="chk-table"><thead><tr>
                <th>股票</th><th class="num">千張%</th><th class="num">千張週變化</th><th class="num">散戶週變化</th></tr></thead><tbody>`;
            for (const w of f.whale_exodus) {
                html += `<tr><td><b>${_nameOf(w.sym, w.name)}</b> <span style="color:#888;">${w.code}</span></td>
                    <td class="num">${(w.mega_pct || 0).toFixed(1)}%</td>
                    <td class="num text-positive">${_pp(w.mega_delta)}</td>
                    <td class="num text-negative">${_pp(w.retail_delta)}</td></tr>`;
            }
            html += '</tbody></table></div>';
        } else html += '<p class="chk-empty">需兩週 TDCC 資料才能算週變化（下週六後啟用）</p>';
        html += '</div>';

        // 散戶擁擠
        html += `<div class="chk-section"><h4>👥 散戶擁擠 Top 50 — 散戶佔比 > 40%，籌碼凌亂、易追殺</h4>`;
        if ((f.retail_crowded || []).length) {
            html += `<div class="chk-scroll"><table class="chk-table"><thead><tr>
                <th>#</th><th>股票</th><th class="num">散戶%</th><th class="num">千張%</th><th class="num">散戶週變化</th></tr></thead><tbody>`;
            f.retail_crowded.slice(0, 50).forEach((r, i) => {
                html += `<tr><td style="color:#666;">${i + 1}</td>
                    <td><b>${_nameOf(r.sym, r.name)}</b> <span style="color:#888;">${r.code}</span></td>
                    <td class="num text-negative"><b>${(r.retail_pct || 0).toFixed(1)}%</b></td>
                    <td class="num">${(r.mega_pct || 0).toFixed(1)}%</td>
                    <td class="num">${_pp(r.retail_delta)}</td></tr>`;
            });
            html += '</tbody></table></div>';
        } else html += '<p class="chk-empty">無資料</p>';
        html += '</div>';
        return html;
    }

    // ============ Tab 2：大戶排行 ============
    function renderWhalesTab() {
        if (!_flags) return '<p class="chk-empty">資料尚未生成</p>';
        const f = _flags;
        let html = `<p style="font-size:0.75rem;color:#888;">集保資料截至 ${f.tdcc_as_of || '—'}（每週五快照、週六更新）</p>`;

        html += `<div class="chk-section"><h4>📈 千張大戶週增 Top 50 — 大戶正在吸籌</h4>`;
        if ((f.mega_gainers || []).length) {
            html += `<div class="chk-scroll"><table class="chk-table"><thead><tr>
                <th>#</th><th>股票</th><th class="num">千張%</th><th class="num">週增</th><th class="num">散戶週變化</th></tr></thead><tbody>`;
            f.mega_gainers.forEach((r, i) => {
                html += `<tr><td style="color:#666;">${i + 1}</td>
                    <td><b>${_nameOf(r.sym, r.name)}</b> <span style="color:#888;">${r.code}</span></td>
                    <td class="num">${(r.mega_pct || 0).toFixed(1)}%</td>
                    <td class="num text-negative"><b>+${(r.mega_delta || 0).toFixed(2)}pp</b></td>
                    <td class="num">${_pp(r.retail_delta)}</td></tr>`;
            });
            html += '</tbody></table></div>';
        } else html += '<p class="chk-empty">需兩週 TDCC 資料才能算週增（下週六後啟用）</p>';
        html += '</div>';

        html += `<div class="chk-section"><h4>🏆 千張大戶持股比 Top 50 — 籌碼最集中</h4>`;
        if ((f.mega_top || []).length) {
            html += `<div class="chk-scroll"><table class="chk-table"><thead><tr>
                <th>#</th><th>股票</th><th class="num">千張%</th><th class="num">大戶%</th><th class="num">散戶%</th></tr></thead><tbody>`;
            f.mega_top.forEach((r, i) => {
                html += `<tr><td style="color:#666;">${i + 1}</td>
                    <td><b>${_nameOf(r.sym, r.name)}</b> <span style="color:#888;">${r.code}</span></td>
                    <td class="num text-negative"><b>${(r.mega_pct || 0).toFixed(1)}%</b></td>
                    <td class="num">${(r.big_pct || 0).toFixed(1)}%</td>
                    <td class="num">${(r.retail_pct || 0).toFixed(1)}%</td></tr>`;
            });
            html += '</tbody></table></div>';
        } else html += '<p class="chk-empty">無資料</p>';
        html += '</div>';
        return html;
    }

    // ============ Tab 3：AI 成績單 ============
    function renderAiReport() {
        if (!_verdict) return '<p class="chk-empty">AI 成績單資料尚未生成（每天 18:07 EOD 記錄，5 個交易日後開始對答案）</p>';
        const overall = _verdict.overall || {};
        const summary = _verdict.summary || {};
        const syms = Object.keys(summary);

        let html = `<p style="font-size:0.75rem;color:#888;">
            機制：每天記錄各股 AI verdict，${_verdict.eval_lag_days || 5} 個交易日後對答案
            （Bullish 命中 = 之後上漲 / Bearish 命中 = 之後下跌）· 更新於 ${_verdict.updated_at || ''}</p>`;

        if (!syms.length) {
            const nDays = (_verdict.days || []).length;
            html += `<p class="chk-empty">已累積 ${nDays} 天快照，需 ${(_verdict.eval_lag_days || 5) + 1} 天以上才有第一批成績。<br>
                <span style="font-size:0.75rem;">（開始記錄日之後的每個交易日都會自動累積）</span></p>`;
            return html;
        }

        const accCls = v => v >= 60 ? 'text-positive' : (v < 45 ? 'text-negative' : '');
        html += `<div class="chk-section">
            <h4>🎯 整體命中率：<span class="${accCls(overall.accuracy || 0)}">${overall.accuracy ?? '—'}%</span>
            <span style="color:#888;font-weight:400;font-size:0.8rem;">（${overall.n || 0} 筆已評分）</span></h4></div>`;

        const rows = syms.map(sym => ({ sym, ...summary[sym] }))
            .sort((a, b) => (b.n || 0) - (a.n || 0));

        html += `<div class="chk-scroll"><table class="chk-table"><thead><tr>
            <th>股票</th><th class="num">評分筆數</th><th class="num">總命中率</th>
            <th class="num">Bullish 命中率</th><th class="num">Bullish 後 5 日平均</th><th>信任度</th></tr></thead><tbody>`;
        for (const r of rows) {
            const acc = r.accuracy ?? 0;
            const trust = r.n < 3 ? '<span class="chk-badge warn">樣本少</span>'
                : acc >= 65 ? '<span class="chk-badge good">可信</span>'
                : acc < 45 ? '<span class="chk-badge danger">常錯</span>'
                : '<span class="chk-badge" style="background:rgba(255,255,255,0.08);color:#aaa;">普通</span>';
            const avgRet = r.avg_ret5_after_bullish;
            const avgCls = avgRet == null ? '' : (avgRet > 0 ? 'text-negative' : 'text-positive');
            html += `<tr>
                <td><b>${_nameOf(r.sym)}</b> <span style="color:#888;">${r.sym}</span></td>
                <td class="num">${r.n}</td>
                <td class="num ${accCls(acc)}"><b>${acc}%</b></td>
                <td class="num">${r.bullish_accuracy != null ? r.bullish_accuracy + '%' : '—'}</td>
                <td class="num ${avgCls}">${avgRet != null ? (avgRet > 0 ? '+' : '') + avgRet + '%' : '—'}</td>
                <td>${trust}</td></tr>`;
        }
        html += '</tbody></table></div>';
        html += `<p style="font-size:0.72rem;color:#666;margin-top:8px;">
            💡 用法：AI 對「常錯」的股票給 Bullish 時要打折看待；「可信」的股票訊號權重可以放大。</p>`;
        return html;
    }

    function render() {
        const el = document.getElementById('chkContent');
        if (!el) return;
        if (_tab === 'redflags') el.innerHTML = renderRedflags();
        else if (_tab === 'whales') el.innerHTML = renderWhalesTab();
        else el.innerHTML = renderAiReport();
    }

    document.addEventListener('DOMContentLoaded', async () => {
        document.querySelectorAll('.chk-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.chk-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _tab = btn.dataset.tab;
                render();
            });
        });
        try {
            const [fr, vr] = await Promise.all([
                fetch('data/red_flags.json', { cache: 'no-store' }),
                fetch('data/verdict_history.json', { cache: 'no-store' }),
            ]);
            if (fr.ok) _flags = await fr.json();
            if (vr.ok) _verdict = await vr.json();
        } catch (e) { console.warn('checkup load', e); }
        render();
    });
})();
