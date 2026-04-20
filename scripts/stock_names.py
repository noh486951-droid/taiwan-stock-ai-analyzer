"""
台股中文名稱對照表 — Python 版
解析 js/stock_names.js 裡的 TW_STOCK_MAP，讓 Python 端（ai_analyzer / watchlist_quick）
也能拿到中文股名。

使用方式：
    from stock_names import load_stock_names, cn_name
    NAMES = load_stock_names()
    cn_name("2330.TW")   # → "台積電"
"""
import os
import re

_CACHE = None


def load_stock_names():
    """解析 js/stock_names.js 取回 dict: {symbol: 中文名}"""
    global _CACHE
    if _CACHE is not None:
        return _CACHE

    js_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "js", "stock_names.js",
    )
    mapping = {}
    if not os.path.exists(js_path):
        _CACHE = mapping
        return mapping
    try:
        with open(js_path, "r", encoding="utf-8") as f:
            text = f.read()
        # 擷取 TW_STOCK_MAP = { ... }; 的 body
        m = re.search(r"TW_STOCK_MAP\s*=\s*\{(.*?)\};", text, re.DOTALL)
        body = m.group(1) if m else text
        # 掃 'XXXX.TW': '中文名' 格式（忽略註解 // ...）
        pattern = re.compile(r"'([0-9A-Z]+\.TWO?)'\s*:\s*'([^']+)'")
        for sym, name in pattern.findall(body):
            mapping[sym] = name
    except Exception as e:
        print(f"  ⚠️ stock_names loader failed: {e}", flush=True)
    _CACHE = mapping
    return mapping


def cn_name(symbol, fallback=None):
    """回傳中文股名，找不到時回 fallback（預設為 symbol 本身去掉 .TW）"""
    names = load_stock_names()
    if symbol in names:
        return names[symbol]
    if fallback is not None:
        return fallback
    return symbol.replace(".TWO", "").replace(".TW", "")


def label(symbol):
    """回傳 "中文名(代碼)" 方便 AI prompt / UI"""
    names = load_stock_names()
    if symbol in names:
        return f"{names[symbol]}({symbol})"
    return symbol
