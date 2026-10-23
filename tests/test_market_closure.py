"""臨時休市偵測 — v13.7.0

迴歸案例：2026-10-23 颱風停止交易，休市表沒有這天。Worker 把 10/22 收盤當即時價
（台積電「今日 -1.45%」其實是 10/22 的漲跌），引擎照常進出場，早上照常推新聞。
"""
import json
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, 'scripts')
import market_closure as mc   # noqa: E402

TW = timezone(timedelta(hours=8))


def _page(updated, taipei_text):
    """仿人事行政總處 nds.html 的實際結構"""
    return f'''<p>更新時間：{updated}</p>
    <TR><TD vAlign=center headers="city_Name Keelung City"><FONT>基隆市</FONT></TD>
        <TD vAlign=center><FONT color=#FF0000 >今天停止上班、停止上課。</FONT></TD></TR>
    <TR style="background: rgba(139, 241, 138, 0.15);">
        <TD vAlign=center align=middle width="17%" headers="city_Name Taipei City">
            <FONT>臺北市</FONT>
        </TD>
        <TD vAlign=center align=left width="70%">
            <FONT color=#FF0000 >{taipei_text}  </FONT>
        </TD>
    </TR>'''


class TestParseDgpa:
    def test_今天停止上班(self):
        d = mc.parse_dgpa(_page('2026/10/23 09:08:03', '今天停止上班、停止上課。'))
        assert list(d) == ['2026-10-23']

    def test_前一晚公布明天停止上班_以頁面時間為基準(self):
        # 前一晚 20:00 公布 → 早上 07:10 新聞推送前就能擋
        d = mc.parse_dgpa(_page('2026/10/22 20:00:00', '明天停止上班、停止上課。'))
        assert list(d) == ['2026-10-23']

    def test_下午才停班不算休市(self):
        assert mc.parse_dgpa(_page('2026/10/23 10:00:00', '今天下午停止上班、停止上課。')) == {}

    def test_上午停班算休市(self):
        d = mc.parse_dgpa(_page('2026/10/23 06:00:00', '今天上午停止上班，下午照常上班。'))
        assert '2026-10-23' in d

    def test_照常上班(self):
        assert mc.parse_dgpa(_page('2026/10/23 06:00:00', '今天照常上班、照常上課。')) == {}

    def test_只有別的縣市停班不算(self):
        html = _page('2026/10/23 06:00:00', '今天照常上班、照常上課。')
        assert mc.parse_dgpa(html) == {}, '基隆停班不影響證交所'

    def test_同一格寫今天與明天(self):
        d = mc.parse_dgpa(_page('2026/10/23 20:00:00', '今天停止上班、停止上課。明天停止上班、停止上課。'))
        assert set(d) == {'2026-10-23', '2026-10-24'}

    @pytest.mark.parametrize('html', ['', None, '<html>維護中</html>',
                                      '<p>更新時間：2026/10/23 09:00:00</p>沒有表格'])
    def test_格式不符回空_不可誤判休市(self, html):
        assert mc.parse_dgpa(html) == {}


class TestClosedReason:
    def _now(self, h, m=0, day=23):
        return datetime(2026, 10, day, h, m, tzinfo=TW)

    def test_總處公告優先(self):
        assert mc.closed_reason('2026-10-23', self._now(7, 10), {'2026-10-23': '颱風'}, None) == '颱風'

    def test_0905後報價日期仍是前一交易日_判定休市(self):
        r = mc.closed_reason('2026-10-23', self._now(9, 14), {}, '2026-10-22')
        assert r and '2026-10-22' in r

    def test_0905前無法從報價判斷(self):
        # 開盤前報價本來就是前一日，不能據此判休市
        assert mc.closed_reason('2026-10-23', self._now(8, 59), {}, '2026-10-22') is None

    def test_正常開盤日(self):
        assert mc.closed_reason('2026-10-22', self._now(10, 0, day=22), {}, '2026-10-22') is None

    def test_取不到任何資料不擋(self):
        # 寧可照常跑，也不要因網路問題整天停擺
        assert mc.closed_reason('2026-10-23', self._now(10, 0), {}, None) is None

    def test_跨午夜檢討前一天(self):
        # 10/24 00:50 檢討 10/23：Worker 最後成交日 10/22 → 10/23 確實沒開盤
        now = datetime(2026, 10, 24, 0, 50, tzinfo=TW)
        assert mc.closed_reason('2026-10-23', now, {}, '2026-10-22')

    def test_週末不判斷(self):
        assert mc.closed_reason('2026-10-24', self._now(10, 0, day=24), {}, '2026-10-23') is None


class TestPersistAndSession:
    def test_寫入且不重複(self, tmp_path):
        p = tmp_path / 'h.json'
        p.write_text(json.dumps({'holidays': ['2026-10-10'], 'source': 'twse'}), encoding='utf-8')
        assert mc.persist('2026-10-23', '颱風', str(p)) is True
        assert mc.persist('2026-10-23', '颱風', str(p)) is False
        d = json.loads(p.read_text(encoding='utf-8'))
        assert d['holidays'] == ['2026-10-10', '2026-10-23']
        assert d['manual']['2026-10-23'] == '颱風'
        assert d['source'] == 'twse', '不可弄丟原本的欄位'

    @pytest.mark.parametrize('h,expected', [(7, '2026-10-22'), (8, '2026-10-23'), (18, '2026-10-23')])
    def test_交易日歸屬(self, h, expected):
        assert mc.session_date(datetime(2026, 10, 23, h, tzinfo=TW)).isoformat() == expected


class TestEngineGuard:
    def test_臨時休市時引擎不交易(self, engine, monkeypatch):
        monkeypatch.setattr(engine, 'is_trading_hours', True)
        monkeypatch.setattr(engine, '_closed_today_reason', lambda: '颱風停班')
        monkeypatch.setattr(engine, 'load_json', lambda p: pytest.fail('休市日不該讀分析檔'))
        monkeypatch.setattr(engine, 'process_ai_bot', lambda wa: pytest.fail('休市日不該交易'))
        engine.main()

    def test_偵測失敗不擋(self, engine, monkeypatch):
        # market_closure 掛掉時回 None，引擎照常
        import builtins
        real_import = builtins.__import__

        def fake(name, *a, **k):
            if name == 'market_closure':
                raise ImportError('boom')
            return real_import(name, *a, **k)
        monkeypatch.setattr(builtins, '__import__', fake)
        assert engine._closed_today_reason() is None
