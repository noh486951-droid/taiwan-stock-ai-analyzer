# 台股 AI 盤勢分析器

由 AI 驅動的台灣股市深度洞察系統，結合即時市場數據、技術指標、三大法人籌碼、財經新聞與 Gemini AI 分析，提供散戶投資人每日盤勢觀點與個股診斷。

## 功能

- **AI 市場脈動分析** - Gemini AI 自動生成每日盤勢摘要與多空觀點
- **台股與國際指數監控** - 加權指數、費半、台積電、美元台幣、S&P500、NASDAQ、道瓊、VIX
- **三大法人籌碼動向** - 外資、投信、自營商每日買賣超數據
- **即時財經新聞** - Yahoo 台股 RSS 新聞獨立頁面
- **自選股管理** - 新增/刪除自選股，含完整技術面與基本面分析
- **個股 AI 診斷** - RSI、KD、MACD、均線、布林通道、PE、PB、EPS、殖利率
- **個股快速查詢** - 主頁即時查看自選股的技術指標與 AI 分析
- **自動化排程** - GitHub Actions 每日三次自動抓取、計算、AI 分析
- **PWA 支援** - 可安裝為手機桌面應用

## 個股分析參數

| 類別 | 指標 |
|------|------|
| 技術面 | MA5/10/20/60/120/240、RSI(14)、KD 隨機指標、MACD、布林通道 |
| 基本面 | 本益比 PE、預估 PE、股價淨值比 PB、EPS、殖利率、市值、52 週高低 |
| 量能 | 成交量 |
| AI 分析 | 趨勢判斷、支撐/壓力區間、風險等級、綜合分析、操作建議 |

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | HTML / CSS / JavaScript (Vanilla) |
| AI 引擎 | Google Gemini API (gemini-2.5-flash-lite) |
| 資料抓取 | Python (yfinance, feedparser, requests) |
| 技術指標 | Python (pandas, numpy) |
| CI/CD | GitHub Actions (每日三次排程) |
| 部署 | GitHub Pages |

## 資料來源

- **市場數據**: Yahoo Finance (yfinance) - 台股與國際指數
- **三大法人**: TWSE 證交所 API
- **財經新聞**: Yahoo 台股 RSS Feed
- **個股技術面/基本面**: Yahoo Finance (yfinance)

## 專案結構

```
taiwan-stock-ai-analyzer/
├── index.html              # 主頁 - 盤勢總覽 + 個股快速查詢
├── news.html               # 新聞頁 - 即時財經新聞
├── watchlist.html           # 自選股頁 - 個股管理與詳細分析
├── manifest.json            # PWA 設定
├── css/
│   └── style.css            # 全域樣式 (黑色系 + 自選股/Modal)
├── js/
│   ├── app.js               # 主頁邏輯 + 個股快速查詢
│   ├── news.js              # 新聞頁邏輯
│   └── watchlist.js         # 自選股管理 (localStorage + 分析顯示)
├── scripts/
│   ├── fetch_all.py         # 資料抓取 + 技術指標計算
│   ├── ai_analyzer.py       # Gemini AI 盤勢 + 個股分析
│   └── requirements.txt
├── data/
│   ├── raw_data.json        # 原始抓取資料
│   ├── market_pulse.json    # AI 盤勢分析結果
│   ├── watchlist.json       # 自選股清單 (GitHub Actions 讀取)
│   └── watchlist_analysis.json  # 自選股 AI 分析結果
└── .github/
    └── workflows/
        └── main.yml         # GitHub Actions 排程
```

## 自選股使用說明

1. 前往「自選股」頁面，輸入股票代碼新增
2. 台股格式：`2330.TW` (上市)、`6547.TWO` (上櫃)
3. 美股格式：`AAPL`、`TSLA`
4. 新增後，等待下次 GitHub Actions 排程執行 AI 分析
5. 分析完成後，卡片會顯示完整技術面、基本面與 AI 觀點
6. 點擊卡片查看詳細分析彈窗
7. 主頁「個股快速查詢」可即時查看已分析的個股資料

**同步自選股到排程分析**：編輯 `data/watchlist.json` 加入股票代碼，或手動觸發 GitHub Actions。

## 版本紀錄

### v7.0 (2026-04-13)
**重大更新：自選股系統 + 完整技術分析**
- 新增「自選股」獨立頁面 (`watchlist.html`)
  - 新增/刪除自選股 (localStorage 管理)
  - 股票卡片顯示價格、漲跌、關鍵指標、AI 摘要
  - 點擊展開完整分析彈窗 (技術面 + 基本面 + AI 觀點)
- 新增完整技術指標計算 (`fetch_all.py`)
  - 均線 MA5/10/20/60/120/240
  - RSI(14) 相對強弱指標
  - KD 隨機指標
  - MACD / Signal / 柱狀體
  - 布林通道 (Bollinger Bands)
- 新增基本面資料抓取
  - 本益比 PE / 預估 PE / 股價淨值比 PB
  - EPS / 殖利率 / 市值 / 52 週高低
- 新增國際指數：S&P 500、NASDAQ、道瓊、VIX 恐慌指數
- 新增成交量數據
- AI 個股分析：趨勢判斷、支撐壓力、風險等級、操作建議
- 主頁新增「個股快速查詢」功能
- 三頁導航系統 (盤勢總覽 / 財經新聞 / 自選股)
- 新聞系統獨立為專屬頁面
- UI 配色全面改為純黑色系 (`#000000`)

### v6.0 (2026-04-13)
- 初始版本上線
- Glassmorphism 玻璃擬態 UI 設計 (深藍底色)
- 整合 Gemini AI 市場分析 (多空判斷 + 觀察建議)
- 台股加權指數、費城半導體、台積電、美元台幣即時數據
- 三大法人籌碼數據 (TWSE API)
- Yahoo 台股 RSS 即時財經新聞
- AI 智能診斷助手 (個股分析觸發)
- GitHub Actions 自動化排程 (每日三次)
- PWA 支援

## 授權

MIT License
