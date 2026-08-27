"""學習里程碑測試 — v13.0.0 Phase 2/3 資料驅動自動觸發

這機制要 ~3 個月後樣本累積夠才會真的觸發，屆時沒人在旁邊看，
所以必須先用測試保證：門檻判斷正確、只推播一次、統計算得對。
"""
import json
import pytest


def _pick(ret, **feats):
    base = {'mega_delta': 1.0, 'big_delta': 0.5, 'retail_delta': -0.5,
            'price_chg_5d': -5.0, 'dist_from_low5': 3.0, 'ma5_slope': 0.2, 'rsi14': 40.0}
    base.update(feats)
    return {'sym': 'T.TW', 'return_pct': ret, 'features': base}


def _history(n_samples, ret_pattern=None):
    """造出 n 筆已評估、含特徵的 picks"""
    picks = []
    for i in range(n_samples):
        ret = ret_pattern(i) if ret_pattern else (5.0 if i % 2 == 0 else -3.0)
        picks.append(_pick(ret))
    return {'weeks': [{'week_key': 'W1', 'picks': picks, 'evaluated': True}]}


@pytest.fixture(autouse=True)
def _no_discord(snapshot, monkeypatch):
    """攔截 Discord 推播，記錄呼叫而非真的發送"""
    calls = []
    monkeypatch.setattr(snapshot, '_push_discord', lambda t, m: calls.append((t, m)))
    return calls


class TestSampleCollection:
    def test_only_counts_evaluated_with_features(self, snapshot):
        """沒 return_pct 或沒 features 的不算樣本"""
        h = {'weeks': [{'picks': [
            _pick(5.0),                                    # 合格
            {'sym': 'X', 'return_pct': 3.0},               # 無 features
            {'sym': 'Y', 'features': {'mega_delta': 1}},   # 未評估
        ]}]}
        assert len(snapshot._collect_evaluated(h)) == 1

    def test_win_flag_derived_correctly(self, snapshot):
        h = {'weeks': [{'picks': [_pick(5.0), _pick(-2.0), _pick(0.0)]}]}
        wins = [s['win'] for s in snapshot._collect_evaluated(h)]
        assert wins == [True, False, False], '0% 不算勝'


class TestPhase2Threshold:
    def test_not_fired_below_threshold(self, snapshot, tmp_path, monkeypatch, _no_discord):
        monkeypatch.chdir(tmp_path)
        (tmp_path / 'data').mkdir()
        h = _history(snapshot.PHASE2_THRESHOLD - 1)
        snapshot._check_milestones_and_learn(h)
        assert _no_discord == [], '未達門檻不該推播'
        assert not (tmp_path / 'data' / 'whale_learning.json').exists()

    def test_fires_at_threshold(self, snapshot, tmp_path, monkeypatch, _no_discord):
        monkeypatch.chdir(tmp_path)
        (tmp_path / 'data').mkdir()
        h = _history(snapshot.PHASE2_THRESHOLD)
        snapshot._check_milestones_and_learn(h)
        assert len(_no_discord) == 1
        assert 'Phase 2' in _no_discord[0][0]
        assert (tmp_path / 'data' / 'whale_learning.json').exists()

    def test_does_not_refire(self, snapshot, tmp_path, monkeypatch, _no_discord):
        """已觸發過就不再推播（milestones_fired 旗標）"""
        monkeypatch.chdir(tmp_path)
        (tmp_path / 'data').mkdir()
        h = _history(snapshot.PHASE2_THRESHOLD)
        h['milestones_fired'] = ['phase2']
        snapshot._check_milestones_and_learn(h)
        assert _no_discord == []


class TestPhase3Threshold:
    def test_fires_at_threshold(self, snapshot, tmp_path, monkeypatch, _no_discord):
        monkeypatch.chdir(tmp_path)
        (tmp_path / 'data').mkdir()
        h = _history(snapshot.PHASE3_THRESHOLD)
        h['milestones_fired'] = ['phase2']   # phase2 已觸發過
        snapshot._check_milestones_and_learn(h)
        titles = [t for t, _ in _no_discord]
        assert any('Phase 3' in t for t in titles)


class TestPhase2Analysis:
    """_phase2_learn 會寫 data/whale_learning.json，必須隔離工作目錄，
    否則會污染 repo 的真實 data/（曾實際發生）"""

    @pytest.fixture(autouse=True)
    def _isolate_cwd(self, tmp_path, monkeypatch):
        (tmp_path / 'data').mkdir()
        monkeypatch.chdir(tmp_path)

    def test_detects_feature_edge(self, snapshot):
        """rsi14 低的贏、高的輸 → edge 應為明顯負值（低值較好）"""
        samples = []
        for i in range(40):
            low_rsi = i < 20
            samples.append({'rsi14': 25.0 if low_rsi else 70.0,
                            'ret': 5.0 if low_rsi else -5.0,
                            'win': low_rsi})
        payload, lines = snapshot._phase2_learn(samples)
        edge = payload['features']['rsi14']['edge']
        assert edge < -50, f'應偵測到低 RSI 較優，實得 edge={edge}'

    def test_skips_features_with_too_few_samples(self, snapshot):
        """樣本 <20 的特徵不該產出統計（避免雜訊當結論）"""
        samples = [{'rsi14': 30.0, 'ret': 1.0, 'win': True} for _ in range(10)]
        payload, _ = snapshot._phase2_learn(samples)
        assert 'rsi14' not in payload['features']

    def test_reports_sample_size(self, snapshot):
        samples = [{'mega_delta': float(i), 'ret': 1.0, 'win': i % 2 == 0} for i in range(30)]
        payload, _ = snapshot._phase2_learn(samples)
        assert payload['sample_size'] == 30
