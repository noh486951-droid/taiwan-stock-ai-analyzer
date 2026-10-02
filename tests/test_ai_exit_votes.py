"""AI 出場訊號多數決 — v13.5.0

背景：盤中每 15 分 AI 用輕量模型重跑，判斷非常跳（2026-09-29 聯電一天內變了 13 次）。
      原本單次看空就出場；7/4~9/29 訊號反轉類出場 22 筆，出場後 5 日 12 漲 10 跌、
      平均 +0.60%（等於丟硬幣）。
修正：保留最近 4 份「不同的」分析，至少 3 票符合、且最新一份不是看多才出場。
回測（git 歷史重建 20 筆）：5 筆不會在原出場日觸發，那 5 筆出場後 5 日平均 +5.1%；
      其餘 15 筆照樣出場 —— 這不是萬靈丹，只擋掉短暫雜訊。
"""
import json

import pytest

ENTRY = '2026-08-20'          # 距 today(8/27) 已 5 個交易日，過了最短持有 3 天


@pytest.fixture
def today(engine, monkeypatch):
    monkeypatch.setattr(engine, 'today_str', '2026-08-27')


def _ai(v, c, text=None):
    # analysis 文字不同才算「不同的一份分析」
    return {'verdict': v, 'confidence': c, 'analysis': text or f'{v}-{c}'}


def _feed(engine, pos, seq):
    """依序餵 AI 讀數，回傳最後一次 _should_exit 結果（模擬引擎每 tick 的流程）"""
    result = (False, '')
    for i, (v, c) in enumerate(seq):
        ai = _ai(v, c, text=f'tick{i}-{v}-{c}')
        engine._push_ai_reading(pos, ai)
        low, flip, bear = engine._ai_exit_votes(pos)
        pos['conf_low_count'], pos['conf_flip_count'], pos['reversal_votes'] = low, flip, bear
        result = engine._should_exit(pos, {'price': 100.0, 'ai': ai, 'data': {}}, {}, '2303.TW')
        if result[0]:
            return result
    return result


def _pos(**kw):
    p = {'entry_date': ENTRY, 'entry_price': 100.0, 'shares': 1000,
         'entry_verdict': 'Bullish', 'entry_confidence': 80}
    p.update(kw)
    return p


class TestReadingWindow:
    def test_同一份分析重複讀不重複算票(self, engine):
        pos = {}
        ai = _ai('Bearish', 80)
        assert engine._push_ai_reading(pos, ai) is True
        assert engine._push_ai_reading(pos, ai) is False, 'EOD 重跑讀到同一份不可再加'
        assert len(pos['ai_readings']) == 1

    def test_視窗只保留最近4份(self, engine):
        pos = {}
        for i in range(7):
            engine._push_ai_reading(pos, _ai('Neutral', 60, text=str(i)))
        assert len(pos['ai_readings']) == 4

    def test_沒有判斷不記錄(self, engine):
        pos = {}
        assert engine._push_ai_reading(pos, {}) is False
        assert engine._push_ai_reading(pos, {'confidence': 70}) is False


class TestNoiseVsTrend:
    def test_盤中短暫兩次看空後轉回看多_不出場(self, engine, today):
        # 仿 9/29 聯電盤中的跳動型態（但不含前一晚的讀數；實際回測聯電加上前晚讀數仍會出場）
        seq = [('Bearish', 80), ('Bearish', 70), ('Bullish', 75), ('Bullish', 75),
               ('Bullish', 80), ('Bullish', 75), ('Neutral', 60)]
        should, reason = _feed(engine, _pos(), seq)
        assert not should, '舊規則在第一次看空就會出場'

    def test_持續看空仍會出場(self, engine, today):
        seq = [('Bearish', 75), ('Bearish', 70), ('Neutral', 60), ('Bearish', 65)]
        assert _feed(engine, _pos(), seq) == (True, 'reversal')


class TestReversalVotes:
    def test_3票看空但最新轉看多_不出場(self, engine, today):
        # 逐 tick 餵的話第 3 票就出場了，這個狀態只能直接建構
        pos = _pos(reversal_votes=3, ai_readings=[
            {'v': 'Bearish', 'c': 75, 'fp': 'a'}, {'v': 'Bearish', 'c': 75, 'fp': 'b'},
            {'v': 'Bearish', 'c': 75, 'fp': 'c'}, {'v': 'Bullish', 'c': 80, 'fp': 'd'}])
        should, _ = engine._should_exit(pos, {'price': 100.0, 'ai': _ai('Bullish', 80), 'data': {}},
                                        {}, '2303.TW')
        assert should is False

    def test_只有2票不出場(self, engine, today):
        # 信心維持 72~75（掉不到 15），避免同時湊滿「訊號轉弱」的票
        seq = [('Bearish', 75), ('Neutral', 72), ('Bearish', 75), ('Neutral', 72)]
        assert _feed(engine, _pos(), seq)[0] is False

    def test_未過最短持有期不出場(self, engine, today):
        seq = [('Bearish', 70)] * 1 + [('Bearish', 60), ('Bearish', 50), ('Bearish', 55)]
        should, _ = _feed(engine, _pos(entry_date='2026-08-26'), seq)
        assert should is False


class TestSignalFlipVotes:
    def test_信心掉15以上且非看多_3票才出場(self, engine, today):
        # 進場 80，掉到 <=65 且非看多算一票
        seq = [('Neutral', 60), ('Bullish', 80), ('Bullish', 78), ('Neutral', 64)]
        assert _feed(engine, _pos(), seq)[0] is False      # 只有 2 票（看多的不算）
        seq = [('Neutral', 60), ('Neutral', 62), ('Neutral', 64)]
        assert _feed(engine, _pos(), seq) == (True, 'signal_flip')


class TestPriorityUnchanged:
    def test_停損仍優先於AI票數(self, engine, today):
        pos = _pos(stop_loss=95.0)
        should, reason = engine._should_exit(pos, {'price': 94.0, 'ai': _ai('Bullish', 90), 'data': {}},
                                             {}, '2303.TW')
        assert (should, reason) == (True, 'stop')

    def test_舊持倉沒有視窗資料_不會誤觸發(self, engine, today):
        # 部署前的持倉沒有 ai_readings，舊欄位 conf_flip_count=2 在新規則下不足 3 票
        pos = _pos(conf_flip_count=2)
        should, _ = engine._should_exit(pos, {'price': 100.0, 'ai': _ai('Bearish', 50), 'data': {}},
                                        {}, '2303.TW')
        assert should is False


class TestExitShadow:
    @pytest.fixture(autouse=True)
    def _cwd(self, tmp_path, monkeypatch):
        (tmp_path / 'data').mkdir()
        monkeypatch.chdir(tmp_path)

    def test_同日多個tick合併_先記到的價格優先(self, engine):
        path = 'data/exit_shadow_log.json'
        engine._flush_shadow({'A.TW': {'p': 100, 'reason': 'reversal'}}, '2026-09-29', path=path)
        engine._flush_shadow({'A.TW': {'p': 105, 'reason': 'reversal'},
                              'B.TW': {'p': 50, 'reason': 'target'}}, '2026-09-29', path=path)
        log = json.load(open(path, encoding='utf-8'))
        recs = log['days'][0]['records']
        assert set(recs) == {'A.TW', 'B.TW'}, '後面的 tick 不可蓋掉前面記到的'
        assert recs['A.TW']['p'] == 100, '第一次記到的才是出場當下的價'

    def test_空紀錄不寫檔(self, engine):
        engine._flush_shadow({}, '2026-09-29', path='data/exit_shadow_log.json')
        import os
        assert not os.path.exists('data/exit_shadow_log.json')
