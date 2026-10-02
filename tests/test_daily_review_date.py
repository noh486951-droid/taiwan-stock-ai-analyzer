"""每日檢討日期歸屬 + 防重複 — v13.5.0

背景：排程 18:00，GitHub 常延遲到 22:00~隔天 02:00 才跑。
  - 週四的檢討在週五 00:54 跑 → 被當成週五，還觸發了週報
  - 週五的檢討拖到週六 → 被週末判斷整個略過
另外 CF 18:10 也會觸發，同一天可能跑兩次，不可重複推 Discord。
"""
import os
from datetime import datetime

import pytest
import pytz

TW = pytz.timezone('Asia/Taipei')


@pytest.fixture(scope='module')
def review():
    # 模組載入時有 sys.exit 判斷：無 Gemini key、週末都會直接結束
    os.environ.setdefault('GOOGLE_API_KEY2', 'test-key')
    os.environ['FORCE_DAILY_REVIEW'] = '1'
    import scripts.paper_trade_daily_review as m
    return m


def _tw(y, mo, d, h, mi=0):
    return TW.localize(datetime(y, mo, d, h, mi))


class TestReviewSessionDate:
    @pytest.mark.parametrize('dt,expected', [
        (_tw(2026, 10, 1, 18, 5), '2026-10-01'),   # 週四準時
        (_tw(2026, 10, 1, 23, 59), '2026-10-01'),  # 週四延遲但沒跨日
        (_tw(2026, 10, 2, 0, 54), '2026-10-01'),   # 真實案例：週四的檢討在週五凌晨跑
        (_tw(2026, 10, 3, 1, 30), '2026-10-02'),   # 週五的檢討拖到週六 → 仍是週五
        (_tw(2026, 10, 2, 7, 59), '2026-10-01'),   # 08:00 前都算前一天
        (_tw(2026, 10, 2, 8, 0), '2026-10-02'),    # 08:00 起算當天
    ])
    def test_歸屬到正確交易日(self, review, dt, expected):
        assert review._review_session_date(dt).isoformat() == expected

    def test_週五檢討拖到週六不會被週末判斷擋掉(self, review):
        d = review._review_session_date(_tw(2026, 10, 3, 0, 54))
        assert d.weekday() == 4, '應歸屬週五（weekday=4），不是週六'

    def test_週四檢討在週五凌晨跑不會被當成週五(self, review):
        # 原本 now.weekday()==4 會在週四的資料上發週報
        d = review._review_session_date(_tw(2026, 10, 2, 0, 54))
        assert d.weekday() == 3


class TestDedup:
    @pytest.fixture
    def env(self, review, monkeypatch):
        saved = []
        monkeypatch.setattr(review, 'FORCE', False)
        monkeypatch.setattr(review, '_nd', None)          # 不推 Discord
        monkeypatch.setattr(review, 'save_portfolio',
                            lambda uid, p: saved.append(dict(p.get('last_review_status') or {})))
        monkeypatch.setattr(review, '_record_daily_snapshot', lambda p, wa: None)
        return saved

    def test_同一交易日第二次觸發直接略過(self, review, monkeypatch, env):
        pf = {'settings': {}, 'positions': {}, 'history': [],
              'last_review_status': {'review_date': review.today_str}}
        monkeypatch.setattr(review, 'get_portfolio', lambda uid: pf)
        review.process_user('明芳', {})
        assert env == [], '已檢討過的日子不可再存檔或推送'

    def test_第一次觸發會在推送前先存下日期(self, review, monkeypatch, env):
        pf = {'settings': {}, 'positions': {}, 'history': [],
              'last_review_status': {'review_date': '2000-01-01', 'reviewed': 3}}
        monkeypatch.setattr(review, 'get_portfolio', lambda uid: pf)
        review.process_user('明芳', {})
        assert env, '必須存檔'
        assert env[0]['review_date'] == review.today_str
        assert env[0].get('reviewed') == 3, '標記日期時不可清掉原本的檢討狀態'

    def test_FORCE時即使已檢討也重跑(self, review, monkeypatch, env):
        monkeypatch.setattr(review, 'FORCE', True)
        pf = {'settings': {}, 'positions': {}, 'history': [],
              'last_review_status': {'review_date': review.today_str}}
        monkeypatch.setattr(review, 'get_portfolio', lambda uid: pf)
        review.process_user('明芳', {})
        assert env, 'FORCE_DAILY_REVIEW=1 用來手動補跑，不可被擋'

    def test_日期存在白名單欄位裡(self, review):
        # save_portfolio 與 Worker 都只收白名單欄位；新頂層欄位會被丟掉
        import inspect
        src = inspect.getsource(review.save_portfolio)
        assert '"last_review_status"' in src
        assert 'last_review_date' not in inspect.getsource(review)
