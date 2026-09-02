"""引擎即時報價整合測試 — v13.1.1

背景：GH Actions 排程限流導致 watchlist_analysis.json 盤中可能是數小時前的價，
引擎若用舊價做進出場判斷會出錯。改為優先用 CF Worker 的即時報價。

關鍵不變量：
- 有即時價 → 用即時價（含 change_pct，day_crash 等判斷才會用當下數字）
- Worker 掛掉 / 標記 stale → 降級用排程價，絕不可擋住交易
- 只覆蓋價格，AI 判斷（verdict/信心度）仍用排程分析版本
"""
import pytest


@pytest.fixture
def wa():
    """一份排程分析結果（價格已過時）"""
    return {'stocks': {'2330.TW': {
        'price': 2440.0, 'change_pct': 0.0, 'volume': 1000,
        'ai_analysis': {'verdict': 'Bullish', 'confidence': 85},
    }}}


def _mock_quotes(engine, monkeypatch, payload, status=200):
    class _Resp:
        status_code = status
        def json(self): return payload
    monkeypatch.setattr(engine.requests, 'get', lambda *a, **k: _Resp())


class TestLiveQuoteOverride:
    def test_uses_live_price_over_stale_schedule_price(self, engine, monkeypatch, wa):
        _mock_quotes(engine, monkeypatch, {'updated_at': 'x', 'quotes': {
            '2330.TW': {'price': 2397.5, 'change_pct': -1.74, 'volume': 5000}}})
        snap = engine._stock_snapshot('2330.TW', wa)
        assert snap['price'] == 2397.5, '應採用即時價而非排程的 2440'
        assert snap['data']['change_pct'] == -1.74, 'change_pct 要同步（day_crash 依賴它）'

    def test_preserves_ai_analysis(self, engine, monkeypatch, wa):
        """只覆蓋價格，AI 判斷必須維持排程版本"""
        _mock_quotes(engine, monkeypatch, {'quotes': {
            '2330.TW': {'price': 2397.5, 'change_pct': -1.74}}})
        snap = engine._stock_snapshot('2330.TW', wa)
        assert snap['ai']['verdict'] == 'Bullish'
        assert snap['ai']['confidence'] == 85

    def test_does_not_mutate_source_data(self, engine, monkeypatch, wa):
        """不可就地改 watchlist_analysis，否則污染後續使用者"""
        _mock_quotes(engine, monkeypatch, {'quotes': {
            '2330.TW': {'price': 2397.5, 'change_pct': -1.74}}})
        engine._stock_snapshot('2330.TW', wa)
        assert wa['stocks']['2330.TW']['price'] == 2440.0, '原始資料被就地修改'


class TestGracefulDegradation:
    """Worker 出問題時絕不可擋住交易"""

    def test_worker_down_falls_back(self, engine, monkeypatch, wa):
        def _boom(*a, **k):
            raise ConnectionError('worker unreachable')
        monkeypatch.setattr(engine.requests, 'get', _boom)
        snap = engine._stock_snapshot('2330.TW', wa)
        assert snap['price'] == 2440.0, 'Worker 掛掉應降級用排程價'

    def test_http_error_falls_back(self, engine, monkeypatch, wa):
        _mock_quotes(engine, monkeypatch, {}, status=500)
        assert engine._stock_snapshot('2330.TW', wa)['price'] == 2440.0

    def test_stale_quote_ignored(self, engine, monkeypatch, wa):
        """Worker 標記 is_stale（該輪沒抓到、沿用舊快取）→ 不比排程價可靠"""
        _mock_quotes(engine, monkeypatch, {'quotes': {
            '2330.TW': {'price': 9999.0, 'is_stale': True}}})
        assert engine._stock_snapshot('2330.TW', wa)['price'] == 2440.0

    def test_invalid_price_ignored(self, engine, monkeypatch, wa):
        for bad in (0, -5, None, 'abc'):
            engine._LIVE_QUOTES_CACHE = None
            _mock_quotes(engine, monkeypatch, {'quotes': {'2330.TW': {'price': bad}}})
            assert engine._stock_snapshot('2330.TW', wa)['price'] == 2440.0, f'異常價 {bad} 未被擋'

    def test_symbol_not_in_quotes(self, engine, monkeypatch, wa):
        _mock_quotes(engine, monkeypatch, {'quotes': {'2317.TW': {'price': 250.0}}})
        assert engine._stock_snapshot('2330.TW', wa)['price'] == 2440.0

    def test_unknown_symbol_returns_none(self, engine, monkeypatch, wa):
        _mock_quotes(engine, monkeypatch, {'quotes': {}})
        assert engine._stock_snapshot('9999.TW', wa) is None


class TestCaching:
    def test_fetches_worker_only_once(self, engine, monkeypatch, wa):
        """一次引擎執行只打 Worker 一次（每檔都打會拖垮執行時間）"""
        calls = []
        class _Resp:
            status_code = 200
            def json(self): return {'quotes': {'2330.TW': {'price': 2397.5}}}
        def _counted(*a, **k):
            calls.append(1)
            return _Resp()
        monkeypatch.setattr(engine.requests, 'get', _counted)
        for _ in range(5):
            engine._stock_snapshot('2330.TW', wa)
        assert len(calls) == 1, f'應只打一次，實際 {len(calls)} 次'
