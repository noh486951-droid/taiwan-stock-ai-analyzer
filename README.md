# 台股 AI 盤勢分析器

由 AI 驅動的台灣股市深度洞察系統，結合即時市場數據、技術指標、三大法人籌碼、財經新聞與 Gemini AI 分析，提供散戶投資人每日盤勢觀點、個股診斷與即時 AI 對話。

## 功能

- **AI 市場脈動分析** - Gemini AI 自動生成每日盤勢摘要與多空觀點
- **晨間 AI 財經快報** - 每日 07:00 產出（v10.4 提前）盤前/盤中/盤後四時段深度報告
- **雙 AI 意見對照** - **Gemini 3.1 Flash-Lite** (技術+基本面) vs **Groq Llama 3** (即時新聞情感) 觀點對照
- **量價關係研判** - 全新量能比校正系統，支援盤中時間校正 (B 方案) 與五色量能徽章
- **AI 聊天助手** - 即時與 AI 對話，AI 可存取所有市場資料回答你的問題
- **台股與國際指數監控** - 加權指數、費半、台積電、美元台幣、S&P500、NASDAQ、道瓊、VIX
- **三大法人籌碼動向** - 外資、投信、自營商每日買賣超數據
- **即時財經新聞** - Yahoo 台股 RSS 新聞獨立頁面
- **自選股管理** - 多群組、雲端同步、支撐壓力位分析、停損/目標價建議
- **異常波動預警** - 7 大類市場異動即時偵測與預警介面
- **系統高穩定性** - 內建 JSON 解析三層防禦與 Groq API 退避演算法
- **個股 AI 診斷** - RSI、KD、MACD、均線、布林通道、PE、PB、EPS、殖利率
- **個股快速查詢** - 主頁即時查看自選股的技術指標與 AI 分析
- **支撐壓力與停損建議** - 自動識別 3 道支撐與壓力位，提供保守/積極停損建議
- **異常波動預警** - 7 大類市場異動即時偵測與警報
- **族群熱度地圖** - 產業鏈上中下游分析與資金輪動訊號
- **自動化排程** - GitHub Actions 每日 07:00 / 10:00 / 14:30 / 18:00 自動更新
- **PWA 支援** - 可安裝為手機/電腦桌面應用

## 頁面架構

| 頁面 | 路徑 | 功能 |
|------|------|------|
| 盤勢總覽 | `index.html` | AI 市場脈動、異常預警、8 大指數、三大法人、融資融券、漲跌比、期貨/PCR、**新：量能比圖示** |
| 財經新聞 | `news.html` | **四時段動態 AI 快報** + Yahoo 即時新聞 + 個股追蹤報導 |
| 自選股 | `watchlist.html` | 清單管理、雲端同步、**雙 AI 意見 (Gemini vs Groq)**、**量價分析區塊**、支撐壓力分析 |
| 族群地圖 | `sectors.html` | AI 族群熱度排行、產業鏈分析、資金輪動訊號、重大行事曆 |
| AI 聊天 | 全頁面右下角浮動 | 即時對話，AI 可存取所有資料庫回答問題 |

## 個股分析參數

| 類別 | 指標 |
|------|------|
| 技術面 | MA5/10/20/60/120/240、RSI(14)、KD 隨機指標、MACD、布林通道 |
| 基本面 | 本益比 PE、預估 PE、股價淨值比 PB、EPS、殖利率、市值、52 週高低 |
| 量能 | 成交量、**量能比 (Ratio)**、**量價關係研判 (Volume Verdict)** |
| AI 分析 | 趨勢判斷、支撐/壓力區間、風險等級、**雙 AI 意見對照**、綜合分析、操作建議 |
| AI 結構化 | 多空研判 (Verdict)、信心度 (0-100)、分析理由 (reasons)、四維評分 (籌碼/技術/消息/總經 -3~+3) |
| 融資融券 | 融資餘額/增減、融券餘額/增減、券資比 |
| 漲跌家數 | 上漲/下跌/持平家數、漲停/跌停數、漲跌比 |
| 期貨未平倉 | 外資多/空單口數、淨部位、自營商淨部位 |
| Put/Call Ratio | 成交量 PCR、未平倉 PCR、情緒判讀 |
| 籌碼集中度 | 10/20 日集中度分數 (-100~+100)、量比、趨勢判斷 |
| 連動分析 | 費半/台積電/台積電 ADR 走勢比較、背離偵測、ADR 溢折價 |
| 支撐壓力 | 布林通道/均線/近期高低點支撐壓力位、停損建議（保守/積極）、目標價、風險報酬比 |
| 異常預警 | 大盤劇烈波動、VIX 恐慌、漲跌家數極端、融資斷頭、PCR 極端、期貨部位突變、美股大幅波動 |
| 族群分析 | AI 產業族群熱度排行、產業鏈上中下游分析、資金輪動訊號 |
| 行事曆 | 法說會、除息日、Fed 利率決議、休市日等重大事件追蹤 |

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

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | HTML / CSS / JavaScript (Vanilla) |
| **AI 引擎核心** | **Google Gemini 3.1 Flash-Lite** |
| **新聞/快報引擎** | **Groq (Llama-3.3-70B-Versatile)** |
| **分析備援** | **Mistral Small (mistral-small-latest)** |
| **動態後端** | **Cloudflare Workers (KV 資料庫 + API 代理 + 指標運算)** |
| 資料抓取 | Python (yfinance, requests) + **TAIFEX OpenAPI** |
| CI/CD | GitHub Actions (每日 4 次自動執行量能預抓與 AI 分析) |
| 部署 | GitHub Pages + Cloudflare Workers |

## 資料來源

- **市場數據**: Yahoo Finance (yfinance) - 台股與國際指數
- **三大法人**: TWSE Open Data API (外資/投信/自營商)
- **融資融券**: TWSE 證交所 MI_MARGN API
- **漲跌家數**: TWSE 證交所 MI_INDEX API
- **期貨未平倉**: **TAIFEX OpenAPI** (v1/MarketDataOfMajor...) 
- **Put/Call Ratio**: **TAIFEX OpenAPI** (v1/PutCallRatio)
- **台積電 ADR**: Yahoo Finance (TSM)
- **財經新聞**: Yahoo 台股 RSS Feed
- **個股技術面/基本面**: Yahoo Finance (yfinance)

## 專案結構

```
taiwan-stock-ai-analyzer/
├── index.html                  # 主頁 - 盤勢總覽 + 異常預警 + 個股快速查詢
├── news.html                   # 新聞頁 - 晨間 AI 快報 + 即時新聞
├── watchlist.html              # 自選股頁 - 個股管理 + 支撐壓力與詳細分析
├── sectors.html                # 族群頁 - AI 族群熱度 + 產業鏈 + 行事曆
├── manifest.json               # PWA 設定
├── css/
│   └── style.css               # 全域樣式 (黑色系 + 響應式佈局)
├── js/
│   ├── app.js                  # 主頁邏輯 (異常預警 + 指數 + 三大法人)
│   ├── news.js                 # 新聞頁 + 晨間快報邏輯
│   ├── watchlist.js            # 自選股管理 (S/R 計算顯示 + 籌碼集中度)
│   ├── sectors.js              # 族群頁邏輯 (產業鏈渲染 + 行事曆)
│   └── chat.js                 # AI 聊天助手 (Gemini Streaming)
├── scripts/
│   ├── fetch_all.py            # 資料抓取 + 指標計算 + 異常偵測 + S/R 計算
│   ├── ai_analyzer.py          # Gemini AI 盤勢 + 個股 + 族群地圖 + 晨間快報
│   └── requirements.txt
├── data/
│   ├── raw_data.json           # 原始抓取資料 (含異常預警與 S/R)
│   ├── market_pulse.json       # AI 盤勢分析結果
│   ├── watchlist.json          # 自選股清單
│   ├── watchlist_analysis.json # 自選股 AI 分析結果
│   ├── morning_digest.json     # 晨間 AI 財經快報
│   ├── sector_map.json         # AI 族群分析結果
│   └── events_calendar.json    # 重大事件行事曆
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
| 07:00 | 晨間快報 + 盤前分析 |
| 10:00 | 盤中更新 |
| 14:30 | 收盤分析 |
| 18:00 | 盤後總結 |

排程僅於週一至週五執行。也可在 GitHub Actions 頁面手動觸發。

## 版本紀錄

### v10.6 (2026-04-17)
**系統穩定性強化：JSON 容錯機制 + Groq 頻率限制優化**
- **JSON 解析三層防禦**：
  - 新增 `_safe_json_loads`：針對 Gemini 3.1 Flash-Lite 偶發的 ExtraData（JSON 後多餘垃圾）進行容錯。
  - 核心邏輯：自動去 Markdown Fence → `json.loads` → `raw_decode` (取第一個合法 JSON 物件)。
  - 已將全系統 7 處 API 回應解析全面替換為此安全方法。
- **Groq 429 頻率限制修復**：
  - **動態退避**：`groq_generate` 現在會主動讀取 `Retry-After` Header 並暫停相應秒數。
  - **任務間隔**：在 `analyze_watchlist` 與 `generate_morning_digest` 兩項 Groq 密集任務間加入 15 秒冷卻時間。
  - **備援順序優化**：`sector_map` 失敗時，順序調整為 Gemini → Mistral (優先) → Groq (最後 + 20秒間隔)，有效分散 TPM 壓力。
- **維護資訊**：
  - 確認 TWSE T86 (三大法人) 資料於盤中無資料屬正常規格限制（15:00 後才發布），系統已正確處理 Fallback。

### v10.5 (2026-04-17)
**量價關係研判系統 + 雙 AI 意見對照 + 盤中時間校正 (B 方案)**
- **量價關係研判 (Volume-Price Verdict)**：
  - **新功能**：`ai_analyzer.py` 加入量價研判規則。AI 會根據 `ratio`（成交量比）與 `change_pct` 判斷「量增價揚」、「量增價跌」、「量縮價穩」或「高檔爆量」。
  - **時間校正邏輯 (B 方案)**：`watchlist_quick.py` 導入盤中進度校正。計算 `(當前量 / (MA5 * 盤中進度))`，解決盤中早段量能被低估的問題。
  - **每日基準預抓**：新增 `scripts/daily_base_prefetch.py` 於 07:00 預抓 MA5 成交量，大幅減少盤中 GitHub Actions 的 API 消耗。
- **雙 AI 意見對照 (Dual Opinion System)**：
  - **Gemini + Groq**：自選股卡片與 Modal 同時顯示 Gemini（技術+基本面）與 Groq（即時新聞情感）的對照觀點。
  - **Groq 批次情感分析**：`groq_batch_news_sentiment()` 一次處理所有新聞，極速產出情感面 verdict。
- **TAIFEX OpenAPI 遷移 (Stability Upgrade)**：
  - **期貨未平倉**：改用 `openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate`。
  - **Put/Call Ratio**：改用 `openapi.taifex.com.tw/v1/PutCallRatio`。
  - **自動 Fallback**：若 OpenAPI 失敗，系統自動 fallback 回原有的 Worker HTML 抓取模式。
- **介面強化 (UI/UX)**：
  - **量能徽章**：卡片新增「⚡ 量激增 2.1x」、「🔥 爆量」、「💤 量縮」等 5 色徽章。
  - **意見面板**：Modal 新增「雙 AI 意見對照」與「量能分析（量價關係）」專屬區塊。
  - **重型任務節流**：新聞抓取僅於整點 (10/11/13) 執行，其餘時段讀取快取，節省 API 配額。
- **Workflow 優化**：
  - GitHub Actions 新增 `Daily Base Prefetch` 步驟，確保每日基準資料準確。

### v10.4 (2026-04-16)
**模型全面升級 gemini-3.1-flash-lite + 批次分析機制 + 個股法人籌碼強化**
- **模型全面升級**：
  - `MODEL_FLASH` 與 `MODEL_FLASH_LITE` 全面改用 `gemini-3.1-flash-lite-preview`。
  - 提升分析精準度，同時降低延遲。
- **批次分析機制 (Efficiency Boost)**：
  - `ai_analyzer.py` 重寫 `analyze_watchlist()`：將所有個股（≤50 檔）打包成一個 JSON Payload 一次發送。
  - 避免循環呼叫 API，極速完成全自選股診斷。
  - 若批次失敗，自動 fallback 回逐檔分析，兼顧效率與穩健。
- **個股法人買賣超追蹤**：
  - `fetch_all.py` 新增 `fetch_stock_institutional()`：透過 TWSE API（TWT38U/TWT44U/TWT43U）抓取個股外資/投信/自營商買賣超。
  - **10 日籌碼歷史紀錄**：新增 `chip_history.json` 每日累積三大法人數據（保留 10 天）。
  - 個股卡片新增「🏛 三大法人：+600 張」顯示，含外資/投信/自營明細。
- **介面優化與人性化格式**：
  - **金額人性化格式**：55,710,101,810 → +557.1 億 / +5.5 萬。
  - **張數格式化**：股數自動換算為張數。
  - **5 日趨勢長條圖**：籌碼區塊新增純 CSS 水平長條圖，紅色買超/綠色賣超，快速判讀法人連續進出。
- **AI 快報動態標題**：
  - 晨間快報頁面標題改為動態顯示，依時段顯示：☀ 台股早安 (08:00)、📊 台股盤中快訊 (10:00)、🌤 台股午安 (14:30)、🌙 台股晚安 (18:00)。
- **排程優化**：
  - 早報 GitHub Actions 排程從 08:00 提前至 **07:00**（0 23 * * 0-4 UTC），確保開盤前產出完整分析。

### v10.1 (2026-04-14)
**TWSE/TAIFEX Cloudflare 代理 + 自選股全自動同步分析**
- **TWSE/TAIFEX 資料改走 Cloudflare Worker 代理**：
  - 根本解決 GitHub Actions（美國 IP）被 TWSE/TAIFEX 封鎖的問題。
  - Worker 新增 `GET /api/twse-proxy?target=chip|margin|breadth|futures|pcr` 端點。
  - Cloudflare 在台灣有邊緣節點 (PoP)，從台灣 IP 向 TWSE/TAIFEX 發起請求，不會被封鎖。
  - `fetch_all.py` 的 5 個 TWSE/TAIFEX 函式全部改為透過 Worker 代理，不再直連。
  - 影響範圍：三大法人買賣超、融資融券、漲跌家數比、外資期貨未平倉、Put/Call Ratio。
- **排程自動拉取雲端自選股**：
  - `fetch_all.py` 新增 `fetch_cloud_watchlist_symbols()` 函式，每次排程自動呼叫 Worker `GET /api/watchlist/all-symbols`。
  - 合併所有使用者的自選股清單（去重），加上本地 `watchlist.json` 作為 fallback。
  - 合併後自動更新 `data/watchlist.json`，確保 `ai_analyzer.py` 能讀到完整清單。
- **Worker 新增 `/api/watchlist/all-symbols` 端點**：
  - 掃描 KV 中所有使用者的 watchlists，合併成唯一股票代碼清單。
  - 供 GitHub Actions 排程使用，不暴露使用者身份或 token。
- **AI 個股分析 RPM 節流**：
  - `ai_analyzer.py` 每檔個股 AI 分析之間加入 **10 秒延遲**，避免撞 Gemini 15 RPM 限制。
  - 20 檔自選股 ≈ 200 秒（3.3 分鐘），GitHub Actions 10 分鐘超時內完全足夠。
- **效果**：
  - 三大法人、融資融券、漲跌家數、期貨未平倉、PCR 資料恢復正常顯示。
  - 自選股在下一次排程（每天 4 次）自動獲得完整分析，進入頁面直接顯示。

### v10.0 (2026-04-14)
**台股配色修正 + Gemini 雙 Key 備援**
- **紅漲綠跌（台股慣例）**：
  - CSS 變數 `--positive` 改為紅色 `#ef4444`、`--negative` 改為綠色 `#22c55e`，全站自動適用。
  - 所有 hardcoded rgba 背景色（verdict、sentiment、breadth-limit、sector-trend）同步對調。
  - 新增 `--danger` 變數，讓刪除按鈕等 UI 危險操作維持紅色不受漲跌配色影響。
- **Gemini 雙 Key 自動輪替**：
  - `ai_analyzer.py` 支援 `GOOGLE_API_KEY` + `GOOGLE_API_KEY2` 雙 Key。
  - 遇到 429/RESOURCE_EXHAUSTED 時自動切換至備援 Key 並重試。
  - GitHub Actions workflow 已加入 `GOOGLE_API_KEY2` 環境變數。

### v9.9 (2026-04-14)
**Token 節省里程碑：KV AI 分析持久化快取**
- [x] **AI 分析結果持久化快取 (Persistence Cache)**: 利用 Cloudflare KV 儲存分析結果，設定 2 小時過期，達成 Token 零重複消耗。 (v9.9 已完成)
  - **節省 Token**：同一檔股票只要有人分析過，2 小時內全球使用者查詢皆直接讀取 KV 快取，不再消耗 AI Token。
  - **自動過期**：設定 `expirationTtl: 7200` (2 小時)，確保資料在一段時間後自動刷新以維持時效。
  - **強制分析功能**：自選股 Modal 點擊「重新分析」會帶入 `force: true` 參數，繞過快取執行最新診斷。
  - **雙層載入優化**：網頁端優先顯示 GitHub 靜態 JSON -> 若無資料則進入「快取讀取」-> 若無快取才觸發「AI 運算」。

### v9.8 (2026-04-14)
**暱稱防呆 + 分析理由修復 + 股票資料庫擴充**
- **暱稱碰撞保護**：
  - 首次使用暱稱登入時，系統會自動產生唯一 token 綁定至該暱稱。
  - 若其他人嘗試使用已被佔用的暱稱，會收到「暱稱已被使用，請換一個」錯誤提示（HTTP 409）。
  - token 存在本機 localStorage，跨裝置只需用同帳號首次綁定的裝置授權。
- **修復「分析理由 undefined undefined」Bug**：
  - Worker/Mistral 即時分析回傳 `{category, factor, weight}` 格式，但前端期望 `{type, text, weight}`。
  - 前端 `openModal()` 現在同時相容兩種格式：`r.type || r.category`、`r.text || r.factor`。
  - 新增 Mistral 類別對照：`Technical` → 📈 技術、`Fundamental` → 📊 基本面。
  - weight 自動適配：Gemini 0~1 範圍與 Mistral -3~3 範圍皆正確轉換為百分比。
- **股票名稱資料庫擴充至 500+ 檔**：
  - `js/stock_names.js` 從 ~70 檔擴充至 500+ 檔，涵蓋上市 (TWSE) 與上櫃 (TPEx) 主要標的。
  - 覆蓋半導體、電子、金融、傳產、航運、電信、生技、營建、觀光、食品、鋼鐵、化工等全產業。

### v9.7 (2026-04-14)
**多帳號共存 + 個股新聞追蹤**
- **多帳號查看功能**：
  - 可追蹤其他使用者的自選股（如同事、朋友），以「👁 暱稱」標籤顯示。
  - 點擊他人標籤可查看對方的完整自選股清單（唯讀模式，不可編輯）。
  - 右鍵標籤可取消追蹤，不影響對方資料。
- **📰 個股新聞追蹤**：
  - 每檔自選股卡片新增「📰 追蹤新聞」勾選開關。
  - 勾選後，AI 晨間快報會特別搜尋該股的相關新聞並詳細報導。
  - 無相關新聞時會明確顯示「近期無相關新聞」。
  - 追蹤清單雲端同步至 Worker KV，GitHub Actions 排程自動讀取。
  - Worker 新增 `GET /api/news-tracking` 端點，供排程取得所有使用者的追蹤清單。

### v9.6 (2026-04-14)
**跨裝置同步 + TWSE 反爬蟲強化**
- **自選股雲端同步 (Cloudflare Worker KV)**：
  - 輸入暱稱即可登入雲端同步，所有裝置輸入相同暱稱即自動共享自選股清單。
  - 開啟頁面自動從雲端拉取最新清單；新增/刪除股票即時推送至雲端。
  - 支援離線模式：未登入或網路斷線時退回 localStorage 本機模式。
  - Worker 新增 `GET/POST /api/watchlist` 端點，綁定 KV 命名空間。
- **群組管理功能**：
  - 支援多群組（如「我的自選」「群組二」等），可自由新增、重新命名、刪除。
  - 群組 Tab 切換 UI，不同群組各自獨立自選股清單。
  - 群組管理彈窗（⚙）。
- **TWSE/TAIFEX 資料抓取反爬蟲強化**：
  - 全域共用 `requests.Session`，帶完整瀏覽器 Headers（Accept / Accept-Language / Accept-Encoding / Cache-Control）。
  - 首頁預熱：先訪問 TWSE 首頁取得 session cookies 再呼叫 API。
  - 每次請求帶正確的 `Referer` 頁面來源。
  - 隨機延遲 1.5~4 秒模擬人類行為，避免被判定為自動化腳本。
  - 影響範圍：三大法人、融資融券、漲跌家數、期貨未平倉、Put/Call Ratio。

### v9.5 (2026-04-14)
**穩定性里程碑：API 自癒重試機制與 UI 判斷優化**
- **Gemini API 彈性重試邏輯**：
  - 新增 `gemini_generate_with_retry()` 核心函式，針對 `503 Service Unavailable`（API 過載）與 `429 Rate Limit`（頻率限制）自動進行 3 次重試。
  - 導入指數退避 (Exponential Backoff) 策略：失敗後依序等待 5s → 15s → 30s 再次呼叫，大幅提升 GitHub Actions 在尖峰時段的成功率。
  - 已套用至：大盤分析、個股診斷、晨間快報、族群地圖四大模組。
- **UI 色彩判斷修復 (Verdict Normalization)**：
  - 新增 `normalizeVerdict()` 處理邏輯，確保 Mistral/Gemini 回傳的各種中英文分析結果（如：強烈買進、逢高調節、觀望等）能精準映射至對應的 CSS 樣式。
  - 修復了自選股信心度進度條與多空標誌顏色顯示異常的 Bug。
- **族群地圖 (Sector Map) 修復**：
  - 配合正確的模型名稱與重試機制，徹底解決先前因過載導致 `sector_map.json` 內容異常的問題。

### v9.4 (2026-04-13)

### v9.3 (2026-04-13)

### v9.2 (2026-04-13)

### v9.1 (2026-04-13)
**架構重大轉移：動態後端 AI 診斷 + 防封鎖穩定性強化**
- **即時動態分析引擎 (Dynamic Backend)**：
  - 將 Cloudflare Worker 升級為「動態分析 API」，由 `worker/index.js` 直接串接 Yahoo Finance 即時股價數據。
  - 內建 JS 技術指標運算引擎 (MA, RSI, MACD, KD)，無需依賴 Python 即可在 0.1 秒內產出指標。
  - **AI 快取機制**：三小時內重複查詢個股不耗費 Gemini Token，提升效率並防範 API 限流。
  - **體驗升級**：在前端輸入冷門股或點擊新自選股時，系統會立即顯示「AI 即時診斷中」，約 10 秒內產出專屬分析報告，無需等待 GitHub 排程。
- **市場寬度抓取修復 (Breadth Fix)**：
  - 改用輕量級摘要表抓取邏輯，取代舊版全樣本個股計數法，徹底解決「999」抓取失敗代碼問題。
  - 加入備援 API (BFT41U) 確保在證交所官網高峰期仍能獲取正確漲跌家數資料。
- **資料抓取防封鎖升級**：
  - 全面在 `fetch_all.py` 請求中加入 Chrome User-Agent 偽裝，解決證交所偵測自動化腳本而回傳空資料的問題。
- **搜尋庫擴充**：手動加入更多熱門權值股與小型股（如：兆赫 2485）至中文搜尋對照表。

### v9.0 (2026-04-13)
**Batch 3 重大升級：異常預警 + 支撐壓力位 + 族群地圖 + 行事曆**
- **異常波動預警系統**：
  - 7 大複合觸發條件：大盤劇烈波動(>1.5%/3%)、VIX 恐慌(>20/30)、漲跌家數極端、漲停/跌停潮、融資斷頭風險、PCR 極端值、外資期貨部位突變、美股大幅波動
  - 三級警報：Critical(紅) / Warning(黃) / Info(藍)
  - 主頁置頂顯示，含具體描述與操作建議
- **支撐壓力位與停損建議**：
  - 布林通道、均線(MA5~MA120)、近期 20/60 日高低點綜合計算
  - 自動識別 3 個支撐位 + 3 個壓力位
  - 保守/積極兩級停損建議（含百分比）
  - 目標價與風險報酬比計算
  - 自選股 Modal 彈窗完整顯示
- **AI 族群分層地圖**（全新頁面 `sectors.html`）：
  - AI 產業族群熱度排行（6+ 族群，含熱度分數 1-5）
  - 產業鏈上中下游分析（受惠/受壓狀態）
  - 資金輪動偵測
  - AI 預測催化劑整合
- **重大行事曆整合**：
  - 手動維護 `data/events_calendar.json`（法說會、除息、Fed、休市）
  - 依日期排序，區分即將到來/已過事件
  - 高/中/低影響度標記
  - AI 自動整合到族群分析催化劑中
- **導航系統升級**：四頁導航（盤勢總覽/財經新聞/自選股/族群地圖）

### v8.5 (2026-04-13)
**Batch 2 升級：期貨/選擇權 + 籌碼集中度 + SOX-ADR 連動**
- **外資期貨未平倉量**（TAIFEX API）：
  - 外資多/空單口數、淨部位、偏多/偏空判斷
  - 自營商淨部位
- **Put/Call Ratio**（TAIFEX 選擇權 API）：
  - 成交量 PCR 與未平倉 PCR 雙指標
  - Call/Put 成交量明細
  - 自動情緒判讀（極度恐慌↔極度樂觀 五段式）
- **10/20 日籌碼集中度**：
  - 量價動能分析，產出集中度分數 (-100 ~ +100)
  - 趨勢判定：集中/發散/持平
  - 量比指標（5日均量 vs 10/20日均量）
  - 自選股卡片與 Modal 彈窗顯示
- **費半 + 台積電 ADR 連動分析**：
  - 新增台積電 ADR (TSM) 即時數據
  - 計算 ADR 折算台幣價與溢折價百分比
  - 費半/台積電走勢背離偵測與警告
  - 獨立 UI 區塊含四格比較與背離提示
- **AI 分析資料源擴充**：所有新數據（期貨、PCR、籌碼集中度、SOX-ADR）納入 AI 盤勢分析、個股分析、晨間快報與聊天上下文

### v8.0 (2026-04-13)
**重大升級：結構化 AI 分析 + 融資融券 + 漲跌家數**
- **AI 結構化輸出升級**：
  - 新增 **多空研判 (Verdict)** + **信心度 (Confidence 0-100)** 視覺化信心條
  - 新增 **四維評分面板**：籌碼面 / 技術面 / 消息面 / 總經面各 -3 ~ +3 分，含視覺化分數條
  - 新增 **分析理由 (Reasons)** 展開區塊，每條標註面向分類與權重
  - 個股 AI 分析同步升級，Modal 彈窗新增信心度與四維評分
- **融資融券數據**（TWSE MI_MARGN API）：
  - 融資買進/賣出/餘額/增減
  - 融券賣出/買進/餘額/增減
  - 券資比計算
- **漲跌家數比**（TWSE MI_INDEX API）：
  - 上漲/下跌/持平家數視覺化比例條
  - 漲停/跌停家數標記
  - 漲跌比數據
- **AI 聊天上下文增強**：AI 對話已可存取融資融券與漲跌家數資料
- **晨間快報資料源擴充**：融資融券與市場寬度資料納入晨間分析

### v7.5 (2026-04-13)
**功能與體大升級：中文搜尋支援 + AI 分析強化**
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
- 新增 AI 聊天助手（全頁面浮動視窗）
- GitHub Actions 排程改為週一至週五，每日四次 (08:00/10:00/14:30/18:00)

### v7.0 (2026-04-13)
**重大更新：自選股系統 + 完整技術分析**
- 新增「自選股」獨立頁面 (`watchlist.html`)
- 新增完整技術指標計算 (`fetch_all.py`)
- 新增基本面資料抓取
- 新增國際指數：S&P 500、NASDAQ、道瓊、VIX 恐慌指數
- AI 個股分析：趨勢判斷、支撐壓力、風險等級、操作建議
- UI 配色全面改為純黑色系 (`#000000`)

### v6.0 (2026-04-13)
- 初始版本上線
- Glassmorphism 玻璃擬態 UI 設計
- 整合 Gemini AI 市場分析
- 盤後自動化排程與 PWA 支援

## 核心演算法說明

### 1. 異常波動預警系統 (Anomaly Detection)
系統監控 7 大類指標，當觸發臨界值時會自動產生預警：
- **大盤波動**: 單日漲跌超過 1.5% (Warning) 或 3% (Critical)。
- **恐慌指數**: VIX 指數超過 20 (Warning) 或 30 (Critical)。
- **漲跌比率**: 漲跌家數比大於 5 或小於 0.2。
- **漲跌停潮**: 漲停或跌停家數超過 30 檔。
- **籌碼斷頭**: 單日融資減少超過 5,000 張。
- **情緒極端**: Put/Call Ratio 大於 1.5 或小於 0.4。
- **美股連動**: S&P500 或 NASDAQ 波動超過 2%。

### 2. 支撐壓力位計算 (Support & Resistance)
綜合分析以下關鍵價位，自動識別最近 3 個支撐與壓力：
- **均線支撐**: MA5, MA10, MA20, MA60, MA120。
- **通道指標**: 布林通道上軌（壓力）與下軌（支撐）。
- **歷史高低點**: 近期 20 日與 60 日最高/最低點。
- **停損建議**: 依據第一支撐位計算保守 (2%) 與積極 (1%) 停損價。

## 授權

MIT License
