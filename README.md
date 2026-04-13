# 台股 AI 盤勢分析器

由 AI 驅動的台灣股市深度洞察系統，結合即時市場數據、技術指標、三大法人籌碼、財經新聞與 Gemini AI 分析，提供散戶投資人每日盤勢觀點、個股診斷與即時 AI 對話。

## 功能

- **AI 市場脈動分析** - Gemini AI 自動生成每日盤勢摘要與多空觀點
- **晨間 AI 財經快報** - 每日 08:00 產生約 5-10 分鐘閱讀量的完整市場分析報告
- **AI 聊天助手** - 即時與 AI 對話，AI 可存取所有市場資料回答你的問題
- **台股與國際指數監控** - 加權指數、費半、台積電、美元台幣、S&P500、NASDAQ、道瓊、VIX
- **三大法人籌碼動向** - 外資、投信、自營商每日買賣超數據
- **即時財經新聞** - Yahoo 台股 RSS 新聞獨立頁面
- **自選股管理** - 新增/刪除自選股，含完整技術面與基本面分析
- **個股 AI 診斷** - RSI、KD、MACD、均線、布林通道、PE、PB、EPS、殖利率
- **個股快速查詢** - 主頁即時查看自選股的技術指標與 AI 分析
- **自動化排程** - GitHub Actions 週一至週五四次自動更新
- **PWA 支援** - 可安裝為手機桌面應用

## 頁面架構

| 頁面 | 路徑 | 功能 |
|------|------|------|
| 盤勢總覽 | `index.html` | AI 市場脈動、8 大指數、三大法人、個股快速查詢 |
| 財經新聞 | `news.html` | 晨間 AI 快報 + Yahoo 即時新聞 |
| 自選股 | `watchlist.html` | 個股管理、技術面/基本面卡片、AI 分析彈窗 |
| AI 聊天 | 全頁面右下角浮動 | 即時對話，AI 可存取所有資料庫回答問題 |

## 個股分析參數

| 類別 | 指標 |
|------|------|
| 技術面 | MA5/10/20/60/120/240、RSI(14)、KD 隨機指標、MACD、布林通道 |
| 基本面 | 本益比 PE、預估 PE、股價淨值比 PB、EPS、殖利率、市值、52 週高低 |
| 量能 | 成交量 |
| AI 分析 | 趨勢判斷、支撐/壓力區間、風險等級、綜合分析、操作建議 |

## 晨間 AI 快報內容

每日 08:00 自動產生，包含五大段落：

1. **國際局勢快覽** - 美股、VIX、匯率、重大國際事件
2. **台股盤勢重點** - 加權指數、成交量、三大法人、多空研判
3. **熱門族群與個股** - 產業趨勢、值得關注的個股
4. **自選股體檢** - 逐檔分析追蹤中的自選股
5. **今日操作建議** - 整體建議、風險提醒、關鍵價位

## AI 聊天助手

- 點擊右下角 💬 按鈕即可開始對話，不需要任何設定
- AI 已載入所有市場數據、自選股分析、晨間快報，可直接提問
- 支援串流回覆，即時顯示 AI 回答
- 透過 Cloudflare Worker 代理，API Key 安全存在後端

**範例問題：**
- 今天台股大盤走勢如何？
- 台積電現在可以買嗎？技術面怎麼看？
- 幫我分析三大法人今天的動向
- VIX 恐慌指數目前多少？

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | HTML / CSS / JavaScript (Vanilla) |
| AI 引擎 | Google Gemini API (gemini-2.5-flash-lite) |
| AI 聊天代理 | Cloudflare Workers (Streaming SSE 轉發) |
| 資料抓取 | Python (yfinance, feedparser, requests) |
| 技術指標 | Python (pandas, numpy) |
| CI/CD | GitHub Actions (週一至週五，每日四次) |
| 部署 | GitHub Pages + Cloudflare Workers |

## 資料來源

- **市場數據**: Yahoo Finance (yfinance) - 台股與國際指數
- **三大法人**: TWSE 證交所 API
- **財經新聞**: Yahoo 台股 RSS Feed
- **個股技術面/基本面**: Yahoo Finance (yfinance)

## 專案結構

```
taiwan-stock-ai-analyzer/
├── index.html                  # 主頁 - 盤勢總覽 + 個股快速查詢
├── news.html                   # 新聞頁 - 晨間 AI 快報 + 即時新聞
├── watchlist.html              # 自選股頁 - 個股管理與詳細分析
├── manifest.json               # PWA 設定
├── css/
│   └── style.css               # 全域樣式 (黑色系 + 聊天 + 快報)
├── js/
│   ├── app.js                  # 主頁邏輯 + 個股快速查詢
│   ├── news.js                 # 新聞頁 + 晨間快報邏輯
│   ├── watchlist.js            # 自選股管理 (localStorage + 分析)
│   └── chat.js                 # AI 聊天助手 (Gemini Streaming)
├── scripts/
│   ├── fetch_all.py            # 資料抓取 + 技術指標計算
│   ├── ai_analyzer.py          # Gemini AI 盤勢 + 個股 + 晨間快報
│   └── requirements.txt
├── data/
│   ├── raw_data.json           # 原始抓取資料
│   ├── market_pulse.json       # AI 盤勢分析結果
│   ├── watchlist.json          # 自選股清單
│   ├── watchlist_analysis.json # 自選股 AI 分析結果
│   └── morning_digest.json     # 晨間 AI 財經快報
├── worker/
│   ├── index.js                # Cloudflare Worker 代理
│   └── wrangler.toml           # Worker 部署設定
└── .github/
    └── workflows/
        └── main.yml            # GitHub Actions 排程 (週一至五)
```

## GitHub Actions 排程

| 時間 (UTC+8) | 用途 |
|------|------|
| 08:00 | 晨間快報 + 盤前分析 |
| 10:00 | 盤中更新 |
| 14:30 | 收盤分析 |
| 18:00 | 盤後總結 |

排程僅於週一至週五執行。也可在 GitHub Actions 頁面手動觸發。

## 自選股使用說明

1. 前往「自選股」頁面，輸入股票代碼新增
2. 台股格式：`2330.TW` (上市)、`6547.TWO` (上櫃)
3. 美股格式：`AAPL`、`TSLA`
4. 新增後，等待下次 GitHub Actions 排程執行 AI 分析
5. 分析完成後，卡片會顯示完整技術面、基本面與 AI 觀點
6. 點擊卡片查看詳細分析彈窗
7. 主頁「個股快速查詢」可即時查看已分析的個股資料

## 部署指南

### 1. GitHub Pages（前端）
1. Fork 或 clone 本專案
2. 在 GitHub repo Settings > Pages 啟用，選擇 main branch
3. 在 Settings > Secrets 新增 `GOOGLE_API_KEY`（Gemini API Key）

### 2. Cloudflare Worker（聊天代理）
1. 安裝 Wrangler CLI：`npm install -g wrangler`
2. 登入：`wrangler login`
3. 進入 worker 資料夾：`cd worker`
4. 部署：`wrangler deploy`
5. 到 Cloudflare Dashboard > Workers > `tw-stock-ai-proxy` > Settings > Variables：
   - `GOOGLE_API_KEY` = 你的 Gemini API Key
   - `ALLOWED_ORIGIN` = `https://你的帳號.github.io`（限制來源）
6. 記下 Worker URL（例如 `https://tw-stock-ai-proxy.你的帳號.workers.dev`）
7. 修改 `js/chat.js` 第 8 行的 `WORKER_URL` 為你的 Worker URL

### 3. 驗證
- 開啟 GitHub Pages 網址
- 點右下角 💬 聊天，輸入問題測試
- 確認 GitHub Actions 排程正常運行

### v7.5 (2026-04-13)
**功能與體驗大升級：中文搜尋支援 + AI 分析強化**
- **自選股刪除 Bug 修復**：解決了因 `watchlist_analysis.json` 同步導致刪除失效的問題，現在刪除操作會即時生效。
- **中文搜尋支援**：新增 `js/stock_names.js` 台股名稱對照表，支援輸入代碼、完整中文名稱或模糊搜尋（如：台積、鴻海）。
- **UI 中文化**：個股卡片、彈窗標題全面顯示中文名稱（如：台積電 2330.TW）。
- **AI 分析深度強化**：
  - 新增 **產業平均本益比 (Industry PE)** 比較。
  - 新增 **投資重點提示 (Highlights)** 獨立區塊，快速掌握利多/利空。
  - 深度文字評述：涵蓋技術面、基本面、產業地位、除息/法說會事件提醒。
  - 建議進場價與停損價位具體化。

### v7.2 (2026-04-13)
**安全升級：Cloudflare Worker 代理**
- AI 聊天改為透過 Cloudflare Worker 代理，API Key 安全存在後端
- 使用者不需要自行設定 API Key，開啟網頁即可聊天
- 新增 IP 速率限制（每分鐘 10 次）防止濫用
- 移除前端 API Key 設定介面
- 新增 `worker/` 目錄含完整 Worker 代碼與部署設定

### v7.1 (2026-04-13)
**新增：晨間 AI 快報 + AI 聊天助手**
- 新增晨間 AI 財經快報，每日 08:00 自動產生
  - 5 大段落完整分析：國際局勢、台股重點、熱門族群、自選股體檢、操作建議
  - 風險警示獨立區塊
  - 快報置於新聞頁面頂部
- 新增 AI 聊天助手（全頁面浮動視窗）
  - AI 載入所有市場數據、自選股分析、晨間快報作為回答依據
  - 支援串流回覆 (SSE Streaming)
  - 簡易 Markdown 渲染
  - 對話歷史保留（自動裁剪避免 token 超限）
- GitHub Actions 排程改為週一至週五，每日四次 (08:00/10:00/14:30/18:00)
- 新增 `data/morning_digest.json` 輸出

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
