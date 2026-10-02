"""語音友善快報測試 — v13.4.0

使用者早上開車用手機朗讀收聽 Discord 推播。要守住三件事：
  1. 只推一則（原本最多 3 張 embed，朗讀要切三次）
  2. 用純文字 content —— 手機通知只顯示 content，embed 在通知裡是空的
  3. 不含會被念成雜訊的東西（emoji、markdown、股票代碼）
"""
import pytest

import scripts.notify_discord as nd


@pytest.fixture
def sent(monkeypatch):
    calls = {'text': [], 'embed': []}
    monkeypatch.setattr(nd, 'send_text',
                        lambda content, msg_type='': calls['text'].append((content, msg_type)) or True)
    monkeypatch.setattr(nd, 'send_embed',
                        lambda *a, **k: calls['embed'].append((a, k)) or True)
    return calls


DIGEST = {
    'session': 'morning', 'show_name': '台股早安', 'title': '輝達大漲 台股可望開高',
    'greeting': '各位早安。',
    'sections': [{'heading': f'段{i}', 'body': f'第{i}段第一句。第{i}段第二句。'} for i in range(1, 7)],
    'risk_alerts': ['留意外資期貨空單。'],
    'closing': '祝操作順利。',
}


class TestToSpeechText:
    @pytest.mark.parametrize('raw,expected', [
        ('🚀 輝達大漲', '輝達大漲'),
        ('**重點**：台積電', '重點：台積電'),
        ('## 標題', '標題'),
        ('中興電(1513)走強', '中興電走強'),
        ('中興電（1513）走強', '中興電走強'),
        ('台積電(2330.TW)守季線', '台積電守季線'),
        ('上櫃 6223.TWO 漲停', '上櫃 6223 漲停'),
        ('⚠️ 風險', '風險'),
    ])
    def test_清掉朗讀雜訊(self, raw, expected):
        assert nd.to_speech_text(raw) == expected

    def test_一般百分比與中文保留(self):
        t = '費半漲1.2%，加權指數小漲百分之零點三。'
        assert nd.to_speech_text(t) == t

    def test_空值(self):
        assert nd.to_speech_text('') == '' and nd.to_speech_text(None) == ''


class TestCardMorningDigest:
    def test_有voice_script只推一則純文字(self, sent):
        d = {**DIGEST, 'voice_script': '各位早安，昨晚輝達大漲，今天台股可望開高。'}
        assert nd.card_morning_digest(d) is True
        assert len(sent['text']) == 1, '必須只推一則'
        assert sent['embed'] == [], '不可用 embed：手機通知顯示不出來，朗讀念不到'
        content, msg_type = sent['text'][0]
        assert '昨晚輝達大漲' in content
        assert msg_type == 'morning_digest', '要走原本的總經頻道'

    def test_第一行是節目名與標題(self, sent):
        nd.card_morning_digest({**DIGEST, 'voice_script': '內容。'})
        first = sent['text'][0][0].split('\n')[0]
        assert '台股早安' in first and '輝達大漲' in first

    def test_稿子裡的emoji與代碼會被清掉(self, sent):
        nd.card_morning_digest({**DIGEST, 'voice_script': '🚀 **中興電(1513)** 強勢'})
        body = sent['text'][0][0].split('\n\n', 1)[1]
        assert body == '中興電 強勢'

    def test_舊版無voice_script_用各段第一句拼(self, sent):
        assert nd.card_morning_digest(DIGEST) is True
        body = sent['text'][0][0]
        assert '各位早安' in body and '第1段第一句' in body
        assert '第1段第二句' not in body, '退路只取每段第一句，否則太長'
        assert len(sent['text']) == 1

    def test_退路稿有長度上限(self):
        long = {**DIGEST, 'sections': [{'body': '很長' * 200 + '。'} for _ in range(6)]}
        assert len(nd._fallback_voice_script(long, max_chars=600)) <= 600

    def test_總長度在Discord上限內(self, sent):
        nd.card_morning_digest({**DIGEST, 'voice_script': '字' * 3000})
        # send_text 會截到 1900；這裡確認不會因超長而失敗
        assert len(sent['text']) == 1

    def test_空digest不推(self, sent):
        assert nd.card_morning_digest({}) is False
        assert nd.card_morning_digest(None) is False
        assert sent['text'] == []
