"""防禦模式測試 — v12.9.5 台股脫鉤覆寫 + NaN 防護

回歸案例：週五美股大跌(SOX -4.78%)觸發 extreme 擋掉所有進場，
但當日台股脫鉤創新高，AI 完全沒參與到 → 必須有脫鉤覆寫。
"""
import json
import pytest


def _write_market(tmp_path, monkeypatch, **kv):
    """寫一份假的 raw_data.json 並切到該目錄"""
    data_dir = tmp_path / 'data'
    data_dir.mkdir(exist_ok=True)
    market = {}
    for k, v in kv.items():
        key = {'nvda': 'NVDA', 'sox': 'SOX', 'taiex': 'TAIEX',
               'vix': 'VIX', 'usd_twd': 'USD/TWD'}.get(k, k)
        market[key] = {'price': v} if k in ('vix', 'usd_twd') else {'change_pct': v}
    (data_dir / 'raw_data.json').write_text(
        json.dumps({'market_data': market}, ensure_ascii=False), encoding='utf-8')
    monkeypatch.chdir(tmp_path)


class TestDefenseModeBasics:
    def test_normal_when_all_calm(self, engine, tmp_path, monkeypatch):
        _write_market(tmp_path, monkeypatch, sox=0.5, taiex=0.3, vix=15.0)
        assert engine.get_defense_mode()['level'] == 'normal'

    def test_us_crash_triggers_extreme(self, engine, tmp_path, monkeypatch):
        """美股 <= -4% 且台股跟跌 → extreme"""
        _write_market(tmp_path, monkeypatch, sox=-4.78, taiex=-2.0, vix=16.0)
        assert engine.get_defense_mode()['level'] == 'extreme'

    def test_us_weak_triggers_defensive(self, engine, tmp_path, monkeypatch):
        """美股 -2%~-4% 且台股跟跌 → defensive"""
        _write_market(tmp_path, monkeypatch, sox=-2.5, taiex=-1.0, vix=16.0)
        assert engine.get_defense_mode()['level'] == 'defensive'


class TestTaiwanDecoupling:
    """v12.9.5 核心：美股跌但台股脫鉤走強 → 降級，別錯過行情"""

    def test_strong_rally_overrides_to_normal(self, engine, tmp_path, monkeypatch):
        """台股 >= +1.0% → 完全脫鉤，回 normal 全參與"""
        _write_market(tmp_path, monkeypatch, sox=-4.78, taiex=1.5, vix=16.38)
        info = engine.get_defense_mode()
        assert info['level'] == 'normal'
        assert any('脫鉤' in r for r in info['reasons'])

    def test_mild_strength_downgrades_one_level(self, engine, tmp_path, monkeypatch):
        """實際回歸案例：SOX -4.78% / TAIEX +0.55% → extreme 降 defensive"""
        _write_market(tmp_path, monkeypatch, sox=-4.78, taiex=0.55, vix=16.38)
        assert engine.get_defense_mode()['level'] == 'defensive'

    def test_no_override_when_taiwan_also_falls(self, engine, tmp_path, monkeypatch):
        """台股也在跌 → 防禦正確，不可覆寫"""
        _write_market(tmp_path, monkeypatch, sox=-4.78, taiex=-2.0, vix=16.38)
        info = engine.get_defense_mode()
        assert info['level'] == 'extreme'
        assert not any('脫鉤' in r for r in info['reasons'])

    def test_vix_extreme_keeps_defensive_despite_rally(self, engine, tmp_path, monkeypatch):
        """VIX >= 30 極端恐慌：即使台股大漲也最多降到 defensive"""
        _write_market(tmp_path, monkeypatch, sox=-5.0, taiex=2.0, vix=32.0)
        assert engine.get_defense_mode()['level'] == 'defensive'


class TestNanGuard:
    """v12.9.5：NVDA change_pct=nan 混入 min() 會回傳 nan → 美股偵測靜默失效"""

    def test_nan_does_not_break_us_detection(self, engine, tmp_path, monkeypatch):
        """NVDA=nan 但 SOX=-4.78 → 仍須偵測到美股崩盤"""
        _write_market(tmp_path, monkeypatch,
                      nvda=float('nan'), sox=-4.78, taiex=-2.0, vix=16.0)
        info = engine.get_defense_mode()
        assert info['level'] == 'extreme', 'NaN 汙染導致美股偵測失效'
        assert info['triggers']['us_worst'] == pytest.approx(-4.78)

    def test_all_nan_falls_back_to_normal(self, engine, tmp_path, monkeypatch):
        """全部 nan → 不應誤判成防禦（資料缺失不等於危險）"""
        _write_market(tmp_path, monkeypatch,
                      nvda=float('nan'), sox=float('nan'), taiex=0.5, vix=15.0)
        assert engine.get_defense_mode()['level'] == 'normal'


class TestCaching:
    def test_result_is_cached(self, engine, tmp_path, monkeypatch):
        """同一次執行內重複呼叫應回傳快取（避免重複讀檔）"""
        _write_market(tmp_path, monkeypatch, sox=-4.78, taiex=-2.0, vix=16.0)
        first = engine.get_defense_mode()
        assert engine.get_defense_mode() is first
