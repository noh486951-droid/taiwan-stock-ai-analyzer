/**
 * 跨裝置雲端綁定測試 — v13.2.1
 *
 * 背景：手機在 v12.4.7 之前就把暱稱存進 localStorage，之後沒再按過「登入同步」，
 * 所以伺服器的 bound_nickname 一直是空的 → 新電腦登入後拉不到任何資料。
 * 修正後改成雙向對帳：伺服器沒綁定就用本地的回寫（heal）。
 *
 * 執行：node tests/test_cloud_binding.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud_binding.js'), 'utf8');
// 函式包在 IIFE 裡（縮排 4 格），結尾要抓縮排的 }
const m = src.match(/    function _resolveCloudBinding\s*\([\s\S]*?\n    \}/m);
if (!m) throw new Error('找不到 _resolveCloudBinding');
const ctx = {};
new Function('exports', m[0] + '\nexports._resolveCloudBinding=_resolveCloudBinding;')(ctx);
const resolve = ctx._resolveCloudBinding;

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}

console.log('\n[新裝置：本地空、伺服器有綁定 → 採用]');
test('採用伺服器暱稱', () => {
    const d = resolve('', '明芳');
    assert.strictEqual(d.uid, '明芳');
    assert.strictEqual(d.reason, 'adopt');
    assert.strictEqual(d.patch, '', '採用時不該回寫');
});

console.log('\n[舊裝置：本地有、伺服器空 → 回寫（本次修正的核心）]');
test('把本地暱稱補綁到帳號', () => {
    const d = resolve('明芳', '');
    assert.strictEqual(d.uid, '明芳', '不可因伺服器空就清掉本地');
    assert.strictEqual(d.patch, '明芳');
    assert.strictEqual(d.reason, 'heal');
});
test('伺服器回 undefined 也視為未綁定', () => {
    assert.strictEqual(resolve('明芳', undefined).patch, '明芳');
});
test('伺服器回 null 也視為未綁定', () => {
    assert.strictEqual(resolve('明芳', null).patch, '明芳');
});

console.log('\n[兩邊都有 → 不動作，避免每次載入都打 PATCH]');
test('一致時不回寫', () => {
    const d = resolve('明芳', '明芳');
    assert.strictEqual(d.patch, '', '一致就不該產生網路請求');
    assert.strictEqual(d.reason, 'ok');
});
test('不一致時以本地為準且不覆蓋伺服器', () => {
    // 保守策略：不擅自改掉使用者已存在的綁定
    const d = resolve('明芳', '小明');
    assert.strictEqual(d.uid, '明芳');
    assert.strictEqual(d.patch, '');
});

console.log('\n[未登入 / 全空]');
test('兩邊皆空 → 什麼都不做', () => {
    const d = resolve('', '');
    assert.strictEqual(d.uid, '');
    assert.strictEqual(d.patch, '');
    assert.strictEqual(d.reason, 'none');
});
test('只有空白字元視同空', () => {
    assert.strictEqual(resolve('   ', '  ').reason, 'none');
});
test('前後空白會被清掉', () => {
    assert.strictEqual(resolve('', ' 明芳 ').uid, '明芳');
});

console.log('\n[不可依賴 auth.js — 它是 sidebar 動態非同步載入的]');
test('cloud_binding 只看 token，不呼叫 isLoggedIn', () => {
    // auth.js 由 sidebar.js 動態插入，通常晚 200~800ms；依賴它會讓對帳整段被跳過。
    // 註解裡提到它是可以的（那是說明「為何不用」），所以只檢查實際程式碼。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/isLoggedIn/.test(code), 'cloud_binding.js 不可呼叫 isLoggedIn');
    assert.ok(/tw_jwt_access/.test(src), '應直接檢查 JWT token');
});
test('虛擬投資頁有接上共用模組', () => {
    const pt = fs.readFileSync(path.join(__dirname, '..', 'js', 'paper_trade.js'), 'utf8');
    // 沒對帳 → 新裝置讀不到帳簿，與 Discord（NOTIFY_UID=暱稱）對不起來
    assert.ok(/resolveCloudUid/.test(pt), 'paper_trade.js 必須先對帳再取 uid');
});
test('兩個頁面都載入 cloud_binding.js', () => {
    for (const page of ['watchlist.html', 'paper_trade.html']) {
        const h = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
        assert.ok(/cloud_binding\.js/.test(h), page + ' 缺少 cloud_binding.js');
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
