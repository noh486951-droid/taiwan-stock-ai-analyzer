# 更新紀錄 (CHANGELOG)

### v11.2 (2026-04-23)
**UI 慣例修正 + AI 持倉諮詢強化 + RS/族群資金流向整合**
- **UI/配色修正**：
  - **紅漲綠跌慣例**：修正「偏多/偏空」顏色顛倒問題，將 `.verdict-bullish` 設為紅色、`.verdict-bearish` 設為綠色，符合台股市場直覺。
  - **聊天 Emoji 同步**：聊天助手輸出之 emoji 改為 🔴 偏多 / 🟢 偏空。
- **AI 持倉諮詢升級**：
  - **戰績回饋與檢討**：Payload 新增 `historySummary`（總勝率/累計損益）與 `recentHistory`（近 20 筆已平倉紀錄），讓 AI 能參考過去戰績進行自我檢討（Prompt 調整為第一人稱）。
  - **輸出長度擴張**：解決諮詢回覆被截斷問題，將 `sendPresetPrompt` 的 `maxOutputTokens` 提升至 4096。
- **數據層與引擎強化**：
  - **相對強度 (RS)**：新增個股 vs 大盤相對漲跌幅 (Relative Strength) 計算與展示。
  - **族群資金流向**：整合族群強度數據，AI 可判斷個股是否為「領漲族群」或「逆勢孤狼」。
  - **自動化交易邏輯**：`paper_trade_engine.py` 新增「訊號轉弱 (Signal Flip)」與「RS 持續弱勢」即時出場規則，強化避險反應速度。
  - **版本更新**：全站相關 JS/CSS 引用版本號 bump 至 `?v=11.2`。

---

### v11.0 (2026-04-21)
**防禦機制 A+B + 即時持倉諮詢 + Groq 效能深度優化**
- **虛擬投資引擎重大升級 (Paper Trade Engine v2.0)**：
  - **實裝防禦機制 A+B**：新增「信心崩跌 (A)」與「單日急跌 (B)」自動出場邏輯，顯著強化風險控管。
  - **進場與決策透視**：引擎現在會回寫詳細 AI 研判狀態，UI 可直接顯示「AI 買入原因」及「未進場理由」。
  - **即時持倉諮詢**：持倉介面新增「💬 AI 持倉諮詢」按鈕，可將買入時與現況數據打包請 AI 進行最新的持倉重評。
- **系統穩定性與 Groq 效能優化**：
  - **Groq 429 深度緩解**：優化退避等待機制，並實施 `watchlist_quick` 節流（僅整點執行 Groq 呼叫），將盤中呼叫量下修 84%，徹底解決 Workflow 超時問題。
  - **UI 資訊美化**：強化虛擬投資頁面的狀態顯示與互動反饋。

---

### v10.8 (2026-04-19)
**AI 聊天快速指令 + 虛擬投資與自動交易引擎 (方案 Y)**
- **AI 聊天快速指令 (Chat Quick Commands)**：
  - **📈 盤勢大檢閱**：串接 `market_pulse.json` 結構化資料，由 AI 進行敘事化解讀與盤面重點導覽。
  - **🐳 尋找大鯨魚**：本地端即時篩選 TDCC 籌碼訊號，快速識別大戶吸籌個股。
  - **⚡ 技術面噴發**：基於 MACD、RSI、均線、KD 與布林通道的多因子評分系統 (加總 ≥4 分觸發)。
  - **⭐ 自選股體檢**：依 AI Verdict 分組並按信心度排序，提供視覺化診斷摘要。
- **虛擬投資 & 全自動交易引擎 (Paper Trade Engine)**：
  - **決策引擎 (方案 Y)**：`paper_trade_engine.py` 整合連續訊號確認（連續 2 次 Bullish 且信心度 >80%）與進出場邏輯。
  - **交易參數限制**：支援 5 個持倉席位、20 萬單筆資金上限、每日 3 筆進場限制。
  - **冷卻機制**：出場後該個股進入 **5 個交易日**（非日曆天）冷卻期，避免頻繁過度交易。
  - **風控邏輯**：內建停損（Stop Loss）、達標（Target Price）、反轉（Reversal）與逾期（Stale）多重出場條件。
- **安全與效能優化 (Security & Performance)**：
  - **總控管 Admin 面板 (Solution B)**：新增 `admin.html` 與 `js/admin.js`。支援管理員密鑰驗證、列出所有使用者帳簿摘要、強制開關自動交易、解除存取密碼、重置帳戶與刪除使用者等完整管理功能。每次動作皆記錄 `_last_admin_action` 稽核軌跡。
  - **虛擬投資密碼保護**：新增帳戶存取保護功能。採用 SHA-256 雜湊存儲，支援跨裝置驗證與 `_issued_token` 快速通關機制，確保模擬交易部位與績效隱私。
  - **Auto-Trade 安全閥**：全平台自動交易預設為 **OFF**，使用者需手動開啟並承諾風險。
  - **後端 API 傳輸安全**：新增 `PAPER_TRADE_ENGINE_SECRET` 密鑰校驗機制。
- **每月營收快報 + AI 智慧過濾 + 財務異動偵測 (Part 1)**：
- **每月營收快報 (Monthly Revenue Report)**：
  - **資料流優化**：`daily_base_prefetch.py` (07:00) 新增 `fetch_monthly_revenue()`。與 MA5、財務警訊一同預抓，存入 `daily_base_data.json`。
  - **分層節流機制 (Token Optimization)**：
    - **無異常個股**：僅前端顯示 YoY 標籤，不佔用 AI Prompt 額度 (0 token)。
    - **有異常個股** (爆發/衰退/觀察)：自動塞進 AI Prompt，平均每批 batch (50檔) 僅 5-10 檔觸發，節省 90% 以上的營收分析 Token。
  - **AI 整合代碼**：`ai_analyzer.py` 新增 `revenue_summary` 欄位（15字內摘要），AI 會根據營收爆發/衰退自動調整 `risk_level` 或在 `highlights` 中加註。
- **異常判定規則 (Anomaly Rules)**：
  - **🔥 surge**：YoY ≥ 20% 且 MoM > 0 (橘紅色脈動徽章)。
  - **🚀 surge**：YoY ≥ 50% (提醒可能一次性入帳風險)。
  - **📉 decline**：YoY ≤ -20% 或 (MoM ≤ -15% 且 YoY < 0) (藍色警告)。
  - **📈 watch_positive**：YoY 15~20% (綠色觀察)。
- **UI/UX 強化**：
  - 自選股卡片新增 **💰 營收徽章**，異動狀態一目了然。
  - Modal 段落新增「每月營收分析」專屬區塊，顯示具體數值與 AI 點評。
- **穩定性優化：Gemini 快速輪換與模型降級鏈 (v10.8 Hotfix)**：
  - **快速 Key 輪換**：針對 Google 端 503 (Overloaded) 錯誤，將 retry 間隔從原本的 5/15/30 秒大幅縮減為 **2 秒**，並在同一模型內優先跑完所有可用 Key (Primary/Secondary/Backup)。
  - **模型降級鏈 (Model Chain Fallback)**：當 `gemini-3.1-flash-lite` 全線（3 把 Key）皆 503 時，自動降級至穩定 GA 版本 `gemini-2.0-flash` (原 v1.5 Flash 升級版) 重新嘗試。
  - **自動重置機制**：換模型時自動重置 Key Chain 指標，確保新模型從最優先 Key 開始測試，最大化成功率。
  - **效能提升**：總最壞情況重試時間從 50s 縮短至約 15s，兼顧系統穩健性與 Workflow 執行效率。
- **配額管理精確化**：
  - 族群地圖 (sector_map) 維持每日/日頻執行。
  - 新功能與批次分析合併執行，**不增加獨立 API 呼叫次數**，僅增加約 3-5% 的 Prompt Token 消耗。

---

### v10.7 (2026-04-18)
**TDCC 籌碼集中度 + 美債 10Y 殖利率 + 財務預警系統 (功能整合)**
- **TDCC 大戶/散戶持股 (Feature 1)**：
  - **資料抓取**：`fetch_all.py` 新增 `fetch_tdcc_concentration()`，自動抓取 17 分級持股數據，聚合為大戶/散戶結構。
  - **指標運算**：計算週對週 delta 與 4 種訊號（強烈集聚/集聚/分散/散戶堆積）。
  - **預抓優化**：`daily_base_prefetch.py` 將 TDCC 數據併入 `daily_base_data.json`；`watchlist_quick.py` 從 base 注入 `sd["tdcc"]`。
  - **AI 整合**：`ai_analyzer.py` 僅在訊號非中性時帶入 Prompt 以節省 Token；新增 TDCC 研判規則與輸出 schema 欄位 `tdcc_summary`。
  - **UI/UX**：`watchlist.js` 新增 `renderTdccBadge()` 與 `renderTdccSection()` (Modal Grid + Week Delta)；`style.css` 新增 4 色籌碼徽章。
- **美債 10Y 殖利率 (Feature 2)**：
  - **總經信號**：`fetch_all.py` 監控 `^TNX` 並計算 macro signals（4.8/4.5/4.0/3.5% 門檻）。
  - **資料流**：`ai_analyzer.py` 將信號寫入 `market_pulse.json`。
  - **前端展示**：`index.html` 新增 `#macroSignalsContainer`；`app.js` 新增 `renderMacroSignals()` 色系與 risk_flags；`style.css` 新增 `.macro-flag`。
- **財務預警系統 (Financial Alert System)**：
  - **後端運算**：`fetch_all.py` 新增連年虧損、淨值過低、高負債比、營收衰退(>30%)等判定邏輯。
  - **資料流優化**：早盤 `daily_base_prefetch.py` 預先計算警訊，盤中 `watchlist_quick.py` 直接注入。
- **介面語意優化**：
  - 全站「Neutral / 中立」統一翻譯為「**中性**」。
  - `normalizeVerdict()` 強化英文 verdict 的對照映射。
- **TAIFEX 修正**：
  - 修復外資期貨未平倉量顯示為 0 的問題，精準對照 TAIFEX OpenAPI 帶括號的欄位名稱。

---

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
- **排程自動拉取雲端自選股**：
  - `fetch_all.py` 新增 `fetch_cloud_watchlist_symbols()` 函式，每次排程自動呼叫 Worker `GET /api/watchlist/all-symbols`。
  - 合併所有使用者的自選股清單（去重），加上本地 `watchlist.json` 作為 fallback。
- **Worker 新增 `/api/watchlist/all-symbols` 端點**：
  - 掃描 KV 中所有使用者的 watchlists，合併成唯一股票代碼清單。
- **AI 個股分析 RPM 節流**：
  - `ai_analyzer.py` 每檔個股 AI 分析之間加入 **10 秒延遲**，避免撞 Gemini 15 RPM 限制。

### v10.0 (2026-04-14)
**台股配色修正 + Gemini 雙 Key 備援**
- **紅漲綠跌（台股慣例）**：
  - CSS 變數 `--positive` 改為紅色 `#ef4444`、`--negative` 改為綠色 `#22c55e`，全站自動適用。
- **Gemini 雙 Key 自動輪替**：
  - `ai_analyzer.py` 支援 `GOOGLE_API_KEY` + `GOOGLE_API_KEY2` 雙 Key。

### v9.9 (2026-04-14)
**Token 節省里程碑：KV AI 分析持久化快取**
- [x] **AI 分析結果持久化快取 (Persistence Cache)**: 利用 Cloudflare KV 儲存分析結果，設定 2 小時過期，達成 Token 零重複消耗。

### v9.8 (2026-04-14)
**暱稱防呆 + 分析理由修復 + 股票資料庫擴充**
- **暱稱碰撞保護**：
  - 首次使用暱稱登入時，系統會自動產生唯一 token 綁定至該暱稱。
- **修復「分析理由 undefined undefined」Bug**：
  - Worker/Mistral 即時分析回傳 `{category, factor, weight}` 格式，前端期望 `{type, text, weight}`。
- **股票名稱資料庫擴充至 500+ 檔**：
  - `js/stock_names.js` 從 ~70 檔擴充至 500+ 檔。

### v9.7 (2026-04-14)
**多帳號共存 + 個股新聞追蹤**
- **多帳號查看功能**：
  - 可追蹤其他使用者的自選股。
- **📰 個股新聞追蹤**：
  - 每檔自選股卡片新增「📰 追蹤新聞」勾選開關。

### v9.6 (2026-04-14)
**跨裝置同步 + TWSE 反爬蟲強化**
- **自選股雲端同步 (Cloudflare Worker KV)**：
  - 輸入暱稱即可登入雲端同步。
- **群組管理功能**：
  - 支援多群組（如「我的自選」「群組二」等）。
- **TWSE/TAIFEX 資料抓取反爬蟲強化**：
  - 隨機延遲 1.5~4 秒模擬人類行為。

### v9.5 (2026-04-14)
**穩定性里程碑：API 自癒重試機制與 UI 判斷優化**
- **Gemini API 彈性重試邏輯**：
  - 新增 `gemini_generate_with_retry()` 核心函式。
- **UI 色彩判斷修復 (Verdict Normalization)**：
  - 新增 `normalizeVerdict()` 處理邏輯。

### v9.0 (2026-04-13)
**Batch 3 重大升級：異常預警 + 支撐壓力位 + 族群地圖 + 行事曆**
- **異常波動預警系統**
- **支撐壓力位與停損建議**
- **AI 族群分層地圖**
- **重大行事曆整合**

### v8.5 (2026-04-13)
**Batch 2 升級：期貨/選擇權 + 籌碼集中度 + SOX-ADR 連動**
- **外資期貨未平倉量**（TAIFEX API）
- **Put/Call Ratio**（TAIFEX 選擇權 API）
- **10/20 日籌碼集中度**
- **費半 + 台積電 ADR 連動分析**

### v8.0 (2026-04-13)
**重大升級：結構化 AI 分析 + 融資融券 + 漲跌家數**
- **AI 結構化輸出升級**
- **融資融券數據**
- **漲跌家數比**

### v7.5 (2026-04-13)
**功能與體大升級：中文搜尋支援 + AI 分析強化**
- **自選股刪除 Bug 修復**
- **中文搜尋支援**
- **AI 分析深度強化**

### v7.0 (2026-04-13)
**重大更新：自選股系統 + 完整技術分析**

### v6.0 (2026-04-13)
- 初始版本上線
