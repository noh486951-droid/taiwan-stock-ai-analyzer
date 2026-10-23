"""pytest 共用設定 — 台股 AI 分析器測試

重點限制（決定測試怎麼寫）：
1. paper_trade_engine.py 有 top-level 執行碼：
   - ENGINE_SECRET 未設 → sys.exit(0) → 測試必須先設環境變數
   - is_trading_hours / is_market_holiday 在 import 當下算死 → 測試需 monkeypatch 模組屬性
2. get_defense_mode 有模組級快取 _DEFENSE_MODE_CACHE → 每個測試前必須清掉
3. 部分函式讀 data/*.json → 用 tmp_path + monkeypatch.chdir 隔離
"""
import os
import sys
import importlib.util
import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(REPO, 'scripts')

# 讓測試能 import scripts/ 下的模組
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

# 引擎 import 時會檢查這個，沒設就 sys.exit
os.environ.setdefault('PAPER_TRADE_ENGINE_SECRET', 'test-secret')


def _load_module(name, rel_path):
    """用 spec 載入 scripts/ 下的檔案（避免套件結構問題）"""
    spec = importlib.util.spec_from_file_location(name, os.path.join(REPO, rel_path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='session')
def engine(tmp_path_factory):
    """paper_trade_engine 模組（session 級，import 成本高）

    引擎 import 時若「今天」在 data/tw_holidays.json 就 sys.exit(0)。
    2026-10-23 颱風假把當天加進休市表後，整批測試在準備階段全部失敗 ——
    所以 import 時改讀一份空的休市表（之後切回 repo 目錄，其他相對路徑不受影響）。
    """
    d = tmp_path_factory.mktemp('engine_import')
    (d / 'data').mkdir()
    (d / 'data' / 'tw_holidays.json').write_text('{"holidays": []}', encoding='utf-8')
    old = os.getcwd()
    os.chdir(d)
    try:
        return _load_module('pte_test', 'scripts/paper_trade_engine.py')
    finally:
        os.chdir(old)


@pytest.fixture(autouse=True)
def _reset_engine_caches(request):
    """每個測試前清掉引擎的模組級快取，避免測試互相污染"""
    if 'engine' not in request.fixturenames:
        yield
        return
    eng = request.getfixturevalue('engine')
    # 注意：各快取的「空值」語義不同，不能一律設成 {} 或 None
    #   _DEFENSE_MODE_CACHE   : `if cache is not None: return cache` → 必須設 None
    #   _MARKET_REGIME_CACHE  : `if cache: return cache`（dict.update 累加）→ 設 {}
    #   _MACRO_RISK_CACHE     : 同上 → 設 {}
    #   _GOLDEN_CROSS_CODES   : `if cache is not None: return cache` → 設 None
    #   _LEFT_POOL_CODES      : 同上 → 設 None
    none_caches = ('_DEFENSE_MODE_CACHE', '_GOLDEN_CROSS_CODES', '_LEFT_POOL_CODES',
                   '_LIVE_QUOTES_CACHE')
    dict_caches = ('_MARKET_REGIME_CACHE', '_MACRO_RISK_CACHE')
    for attr in none_caches:
        if hasattr(eng, attr):
            setattr(eng, attr, None)
    for attr in dict_caches:
        if hasattr(eng, attr):
            setattr(eng, attr, {})
    yield


@pytest.fixture
def tdcc():
    """tdcc_holders_fetcher 模組（止跌濾網 / 過熱過濾）"""
    return _load_module('tdcc_test', 'scripts/tdcc_holders_fetcher.py')


@pytest.fixture
def snapshot():
    """whale_picks_snapshot 模組（學習里程碑）"""
    return _load_module('wps_test', 'scripts/whale_picks_snapshot.py')
