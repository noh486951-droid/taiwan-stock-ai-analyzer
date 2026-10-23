"""
臨時休市偵測（颱風假等）— v13.7.0

問題：tw_holidays.json 只有證交所「事先公告」的休市日。2026-10-23 颱風臨時停止交易，
      系統照常跑：Worker 把前一日收盤當成即時價（台積電「今日 -1.45%」其實是 10/22 的漲跌），
      引擎據此進出場，早上也照常推送新聞。

兩個訊號互補：
  1. 人事行政總處停班停課公告 —— 證交所規則：臺北市停止上班即停止交易。
     前一晚就會公布「明天停止上班」，所以早上 07:10 的新聞推送前就能擋。
  2. 交易所即時報價的成交日期 —— 09:05 後若最新成交日仍是前一個交易日，代表今天沒開盤。
     不靠外部公告，作為總處網站抓不到時的備援。

只用標準函式庫：GitHub Actions 的 pre_check job 沒裝任何套件。

CLI：python3 scripts/market_closure.py [--date YYYY-MM-DD] [--session]
     輸出第一行 CLOSED <原因> 或 OPEN；偵測到休市會寫入 data/tw_holidays.json。
     --session：08:00 前執行視為前一天（給每日檢討用，它常延遲到跨午夜）。
"""
import json
import os
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

TW = timezone(timedelta(hours=8))
DGPA_URL = 'https://www.dgpa.gov.tw/typh/daily/nds.html'
QUOTES_URL = 'https://tw-stock-ai-proxy.noh486951-e8a.workers.dev/api/quotes'
HOLIDAYS_PATH = 'data/tw_holidays.json'
MIS_CHECK_AFTER = (9, 5)   # 09:05 前的成交日期無法判斷（開盤前本來就是前一日）


def _fetch(url, timeout=15):
    # 台灣政府網站憑證常缺 Subject Key Identifier，Python 3.13 的 VERIFY_X509_STRICT 會拒絕。
    # 只放寬這個嚴格檢查，憑證鏈與主機名稱仍照常驗證。
    ctx = ssl.create_default_context()
    ctx.verify_flags &= ~getattr(ssl, 'VERIFY_X509_STRICT', 0)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


def parse_dgpa(html):
    """回傳 {日期: 原因}：臺北市（全天或上午起）停止上班的日期。

    「今天/明天」以頁面的「更新時間」為基準，不用執行當下，避免跨午夜誤判。
    只有「下午停止上班」不算休市 —— 當天上午已開盤交易。
    """
    if not html:
        return {}
    m = re.search(r'更新時間[：:]\s*(\d{4})/(\d{1,2})/(\d{1,2})', html)
    if not m:
        return {}
    base = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    row = re.search(r'headers="city_Name Taipei City"[^>]*>.*?</TD>\s*<TD[^>]*>(.*?)</TD>',
                    html, re.S | re.I)
    if not row:
        return {}
    text = re.sub(r'<[^>]+>', ' ', row.group(1))
    text = re.sub(r'\s+', '', text)
    out = {}
    # 一格可能同時寫今天與明天，逐句判斷
    for sent in re.split(r'[。；;]', text):
        if '停止上班' not in sent:
            continue
        if '下午' in sent and '上午' not in sent:
            continue
        if sent.startswith(('今天', '今日')):
            d = base
        elif sent.startswith(('明天', '明日')):
            d = base + timedelta(days=1)
        else:
            continue
        out[d.strftime('%Y-%m-%d')] = f'颱風停班（人事行政總處：臺北市{sent}）'
    return out


def worker_trade_date(timeout=15):
    """Worker 即時報價裡最新的成交日期（YYYY-MM-DD）；取不到回 None。"""
    try:
        data = json.loads(_fetch(QUOTES_URL, timeout))
    except Exception as e:
        print(f'  ⚠️ 讀 Worker 報價失敗：{e}', file=sys.stderr)
        return None
    if data.get('trade_date'):
        return data['trade_date']
    dates = [q.get('trade_date') for q in (data.get('quotes') or {}).values()
             if q.get('trade_date') and not q.get('is_stale')]
    return max(dates) if dates else None


def closed_reason(date_str, now, dgpa=None, trade_date=None):
    """date_str 那天是否臨時休市；是則回傳原因字串，否則 None。

    dgpa: parse_dgpa 的結果；trade_date: worker_trade_date 的結果。
    """
    if dgpa and date_str in dgpa:
        return dgpa[date_str]
    if not trade_date:
        return None
    d = datetime.strptime(date_str, '%Y-%m-%d').replace(tzinfo=TW)
    if d.weekday() >= 5:
        return None
    check_from = d.replace(hour=MIS_CHECK_AFTER[0], minute=MIS_CHECK_AFTER[1])
    if now < check_from:
        return None
    if trade_date < date_str:
        return f'交易所即時報價最新成交日 {trade_date}，{date_str} 未開盤'
    return None


def persist(date_str, reason, path=HOLIDAYS_PATH):
    """寫入休市表（holidays + manual 原因）。已存在回 False。"""
    data = {'holidays': []}
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f) or {'holidays': []}
    if date_str in (data.get('holidays') or []):
        return False
    data['holidays'] = sorted(set(data.get('holidays') or []) | {date_str})
    data.setdefault('manual', {})[date_str] = reason
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return True


def session_date(now):
    return (now - timedelta(days=1)).date() if now.hour < 8 else now.date()


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    now = datetime.now(TW)
    date_str = None
    if '--date' in argv:
        date_str = argv[argv.index('--date') + 1]
    elif '--session' in argv:
        date_str = session_date(now).isoformat()
    else:
        date_str = now.date().isoformat()

    try:
        dgpa = parse_dgpa(_fetch(DGPA_URL))
    except Exception as e:
        print(f'  ⚠️ 讀人事行政總處失敗：{e}', file=sys.stderr)
        dgpa = {}
    # 「明天停止上班」也先寫入，隔天早上就算總處網站掛了也擋得住
    for d, why in dgpa.items():
        if d > date_str and persist(d, why):
            print(f'  📅 預先登記 {d}：{why}', file=sys.stderr)

    reason = closed_reason(date_str, now, dgpa, worker_trade_date())
    if reason:
        persist(date_str, reason)
        print(f'CLOSED {reason}')
    else:
        print('OPEN')
    return 0


if __name__ == '__main__':
    sys.exit(main())
