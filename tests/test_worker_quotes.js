/**
 * Worker 即時報價解析測試 — v13.1.0
 *
 * 重點：MIS 的 z（成交價）盤中常為 "-"（該秒無成交）。
 * Python 版遇到就跳過 → 前端 fallback 到昨收（看起來像沒更新）。
 * Worker 版改用最佳買/賣價中間值，必須驗證這條 fallback 鏈正確。
 *
 * 執行：node tests/test_worker_quotes.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 從 worker/index.js 抽出待測函式（該檔是 CF Worker module，不能直接 require）
const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'index.js'), 'utf8');
function extract(name) {
    const re = new RegExp(`function ${name}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`找不到函式 ${name}`);
    return m[0];
}
const ctx = {};
new Function('exports', [
    extract('_symToMis'), extract('_qnum'),
    extract('_firstLadder'), extract('_parseMisRow'),
    'exports._symToMis=_symToMis; exports._qnum=_qnum;',
    'exports._firstLadder=_firstLadder; exports._parseMisRow=_parseMisRow;',
].join('\n'))(ctx);
const { _symToMis, _qnum, _firstLadder, _parseMisRow } = ctx;

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}

console.log('\n[symbol → MIS 代碼轉換]');
test('上市 .TW → tse_', () => assert.strictEqual(_symToMis('2330.TW'), 'tse_2330.tw'));
test('上櫃 .TWO → otc_', () => assert.strictEqual(_symToMis('6223.TWO'), 'otc_6223.tw'));
test('小寫也能處理', () => assert.strictEqual(_symToMis('2330.tw'), 'tse_2330.tw'));
test('非法格式回 null', () => assert.strictEqual(_symToMis('AAPL'), null));
test('空值回 null', () => assert.strictEqual(_symToMis(null), null));

console.log('\n[數值解析]');
test('MIS 的 "-" 視為 null', () => assert.strictEqual(_qnum('-'), null));
test('空字串視為 null', () => assert.strictEqual(_qnum(''), null));
test('正常數字', () => assert.strictEqual(_qnum('2440.0000'), 2440));
test('階梯字串取第一檔', () => assert.strictEqual(_firstLadder('2400.0000_2395.0000_2390.0000_'), 2400));
test('階梯為 "-" 回 null', () => assert.strictEqual(_firstLadder('-'), null));

console.log('\n[報價解析 — 成交價正常]');
test('用成交價 z 並算漲跌幅', () => {
    const q = _parseMisRow({ z: '2460.0000', y: '2440.0000', v: '4717', o: '2415.0000', t: '09:32:00' });
    assert.strictEqual(q.price, 2460);
    assert.strictEqual(q.price_source, 'trade');
    assert.ok(Math.abs(q.change_pct - 0.82) < 0.01, `漲跌幅 ${q.change_pct}`);
    assert.strictEqual(q.volume, 4717000, '張要換算成股');
});

console.log('\n[報價解析 — z="-" 的 fallback 鏈（核心改善）]');
test('z="-" → 用買賣價中間值', () => {
    // 真實案例：台積電 09:32 z="-"，b 首檔 2400 / a 首檔 2405 → 2402.5
    const q = _parseMisRow({
        z: '-', y: '2440.0000', o: '2415.0000',
        b: '2400.0000_2395.0000_', a: '2405.0000_2410.0000_', v: '4717',
    });
    assert.strictEqual(q.price, 2402.5);
    assert.strictEqual(q.price_source, 'midpoint');
    assert.ok(q.change_pct < 0, '低於昨收應為負');
});
test('z 與 買賣價 都無 → 退回開盤價', () => {
    const q = _parseMisRow({ z: '-', y: '2440.0000', o: '2415.0000', b: '-', a: '-', v: '100' });
    assert.strictEqual(q.price, 2415);
    assert.strictEqual(q.price_source, 'open');
});
test('全部無價 → 回 null（讓 caller 保留舊值）', () => {
    assert.strictEqual(_parseMisRow({ z: '-', y: '2440.0000', o: '-', b: '-', a: '-' }), null);
});

console.log('\n[邊界情況]');
test('昨收為 0 不可除以零', () => {
    const q = _parseMisRow({ z: '100.0', y: '0', v: '10' });
    assert.strictEqual(q.change_pct, null);
});
test('昨收缺失時 change_pct 為 null', () => {
    const q = _parseMisRow({ z: '100.0', y: '-', v: '10' });
    assert.strictEqual(q.change_pct, null);
});
test('無成交量預設 0', () => {
    const q = _parseMisRow({ z: '100.0', y: '99.0', v: '-' });
    assert.strictEqual(q.volume, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
