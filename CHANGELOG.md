# 更新紀錄 (CHANGELOG)

### v11.8 (2026-05-04)
**AI 機器人帳戶上線 (AI Bot Portfolio)**
- **資料流整合**：`watchlist_quick.py` 現在會自動讀取 `scout.py` 產生的 `ai_picked_watchlist.json`，並將 AI 選股清單（10 檔）併入進行盤中分析。
- **獨立沙盒引擎**：`paper_trade_engine.py` 實裝 `process_ai_bot` 模式。引擎直接讀寫 `data/ai_bot_portfolio.json`（純檔案制），與使用者的 KV 帳戶完全分家。當設定 `ai_curated_watchlist=true` 時，評估範圍僅限 AI 每日選股。
- **機器人預設參數**：提供 100 萬初始資金，與使用者同條件對打。設定為積極模式：每日最多進場 5 筆（個人 3 筆），最多持倉 10 檔（每筆 10 萬上限），且強迫開啟所有 v11.6/11.7 的防禦過濾器（profit_lock、MA5 ≤3%、weak_only、ATR 進場停損），盤後自動執行 AI Review。
- **自然汰換持倉**：AI 機器人遵守嚴格的正常出場機制（停損 / profit_lock / MA5 反轉 / stale 10 日）。即使 Scout AI 隔天更換選股名單，機器人也不會強制平倉，完美模擬真實交易行爲。
- **UI 觀戰模式**：`paper_trade.html` 標題列新增「👤 我的帳戶 / 🤖 AI 機器人帳戶（觀戰）」切換功能。機器人模式為純唯讀觀戰，即使未登入亦可查看，並隱藏手動介入操作。

### v11.7 (2026-05-04)
**三項進場過濾器全部上線 (MA5 乖離過濾 + 強勢族群過濾 + ATR 進場停損)**
- **MA5 乖離過濾 (#4)**：`paper_trade_engine.py` 實裝。現價偏離 MA5 超過上限（一般 ≤3% / 強勢股 ≤5%）直接拒絕進場，避免追高被套。原因碼 `ma5_extended_X_over_Y`。
- **強勢族群過濾 (#2)**：`paper_trade_engine.py` 實裝。預設擋弱勢/落後股（weak_only），支援三段設定：off / weak_only / top3_only。原因碼 `sector_weak_<族群>` 或 `sector_not_top_<族群>`，不浪費資金在錯殺族群。
- **ATR 進場停損 (#1)**：`paper_trade_engine.py` 實裝。AI 給的停損若太緊（<1.5×ATR）自動放寬，太鬆（>3×ATR）自動收緊。保留 ai_original_stop 供審計。開倉日誌會印製調整軌跡 `📐 [sym] ATR-adjust stop`。
- **UI 變化**：進階設定新增對應欄位，並將過濾原因明確顯示於 `last_engine_status.reasons_breakdown` 中，讓「無進場條件」訊息具體化。

### v11.6 (2026-04-28)
**宏觀防禦模式 + 移動停利 + 族群集中警示 + 失敗交易讀回**
- **晨報亂碼修復**：`ai_analyzer.py` 使用 Gemini Flash 主模型，並增加 Groq 退化備援 + 簡體字/已知亂碼模式品質檢查（>2% 簡體字直接退回）。
- **宏觀防禦模式 (#3)**：`paper_trade_engine.py` 與 `paper_trade.js` 新增 `get_macro_risk()`。基於 VIX/US10Y/USD-TWD/NVDA-SOX/TAIEX 五指標打分 → normal/elevated/defensive 三級。elevated +5 門檻、cap×0.7；defensive +10、cap×0.5、max_positions→3、daily_entry→1。前端橫條展示風險分數與觸發條件。
- **ATR 移動停利 (#2)**：`fetch_all.py`、`paper_trade_engine.py` 與 `paper_trade.js` 整合 `calculate_atr(14)`。持倉滿足 +5% 浮盈才啟動 trailing；stop = highest − 2×ATR，只升不降；前端顯示「移動停利 / 最高價」。
- **族群集中警示 (#1)**：`paper_trade_engine.py` 載入 `sector_map.json`，建 sym→sector 索引；同族群 ≥2 檔時直接拒絕第三檔，原因碼 `sector_full_<族群>`；engine_status 暴露當前 sector_concentration。
- **失敗交易讀回 (#4)**：`paper_trade_daily_review.py`、`paper_trade.html` 與 `paper_trade.js` 實裝規則式統計（虧損出場原因 / 盤勢 / 持有天數 / 訊號強度 4 維分桶）+ Gemini AI 提煉 2-4 條失敗模式與改進規則；前端新增「🔍 失敗模式讀回」區塊。

### v11.5 (2026-04-27)
**動態盤勢權重 + 企業法說行事曆 + 美股龍頭連動訊號**
- **動態權重回測 (Dynamic Regime Weights)**：
  - **scripts/fetch_all.py**：新增盤勢判定邏輯。基於 TAIEX 與 MA20/MA60 的關係，將市場自動歸類為「🐂 多頭 / 🐻 空頭 / ↔️ 盤整」。
  - **scripts/paper_trade_engine.py**：實裝分組勝率回測。引擎會記錄每個部位進場時的盤勢，並動態計算該盤勢下的歷史勝率。
  - **進場門檻自動化**：當某盤勢勝率 < 30% 時，自動調高信心度門檻 (+5) 以過濾雜訊；勝率 > 60% 時，調降門檻 (-3) 以捕捉更多機會。
  - **UI 強化**：`paper_trade.js` 新增「盤勢分組勝率」統計表，即時呈現不同市況下的模型表現。
- **企業行事曆 (Corporate Events System)**：
  - **scripts/fetch_corporate_events.py**：全新事件引擎。整合證交所 OpenAPI、MOPS 與除權息預告，提供法說會、股東會、配息與除權息之完整行事曆。
  - **即時徽章標註**：`js/watchlist.js` 新增事件徽章渲染。卡片右上角會依事件類型顯示「🎤 法說 / 🏛️ 股東 / 💵 配息 / ✂️ 除息」，並針對 3 日內事件增加呼吸燈特效。
- **美股龍頭隔夜訊號 (US Giants Signal)**：
  - **scripts/us_giants_signal.py**：建立「美股 9 檔龍頭 ↔ 台股 50+ 供應鏈」映射矩陣。
  - **影響評估**：每日根據美股隔夜漲跌幅，產出「高/中/低」三級警報，並列出受影響的台股組裝廠、散熱、PCB、IC 設計等板塊預期。
  - **UI 展示**：`index.html` 首頁新增美股龍頭訊號面板，無重大波動時自動隱藏，確保資訊純度。

### v11.4 (2026-04-25)
**市場雷達掃描器 + AI 智慧選股決策 + 跨日熱度追蹤**
- **市場雷達掃描器 (Market Scout Radar)**：
  - **scripts/scout.py**：新增獨立掃描引擎。每日自動抓取 TWSE T86 (三大法人買賣超) 與 STOCK_DAY_ALL (全市場量價)，產生 8 大雷達榜單：
    - 三大法人買超/賣超 TOP 10 (含外資、投信)。
    - 成交量能激增與成交金額排行榜。
    - 漲跌幅排行榜。
  - **連 3 日 HOT 偵測**：自動維護 `data/scout_history.json` (保留 30 天)，偵測連續 3 個交易日上榜的強勢股，標註為「🔥 連 3 日 HOT」。
- **AI 智慧選股 (AI Pick)**：
  - **決策邏輯**：整合 Gemini AI 進行大數據過濾。
  - **篩選規則**：產業多元化 (≥5 類)、優先選擇連買股、避開噴出漲停股、識別「對沖/融券回補」假買盤。
  - **產出**：每日自動挑選 **17 檔** 觀察股存入 `data/ai_picked_watchlist.json`。
- **UI 介面與導覽 (Market Scout UI)**：
  - **scout.html / js/scout.js**：全新雷達頁面。採用卡片式佈局展示 8 大榜單、AI Pick 專區與 HOT 區。
  - **導覽列整合**：全站頁面（index, news, watchlist, sectors, paper_trade）新增「🔭 市場雷達」導覽選項。
- **Workflow 整合**：
  - **.github/workflows/main.yml**：將 `scout.py --ai-pick` 整合進自動化排程，確保在每日收盤分析後執行。

### v11.3.3 (2026-04-24)
**防禦性渲染提升 + 零股交易支援 + 行事曆重新整理**
- **防禦性渲染 (Defensive Rendering)**：
  - **js/app.js**：將所有主要的渲染組件（市場脈動、指數、籌碼、指標等）全部包覆於 `_safe()` wrapper。
  - **效果**：避免單一卡片資料出錯（如 TWSE 異常或資料缺失）導致整個儀表板停止運作，確保系統「部分可用」優於「全盤崩潰」。
- **虛擬投資：零股交易支援 (Fractional Shares)**：
  - **scripts/paper_trade_engine.py**：修正進場邏輯。當個股單價過高導致「整張 (1000股)」超過每筆資金上限時，自動切換為以「1 股」為單位的零股買入，確保台積電 (2330) 等高價股也能納入 AI 投資組合。
  - **js/paper_trade.js**：UI 更新。持倉卡片現在會自動判定並顯示「X 張」或「X 股」。
- **數據與維護**：
  - **data/events_calendar.json**：更新 `last_updated` 戳記至 2026-04-24，維持資訊新鮮度。
  - **版本同步**：全站 CSS/JS 引用版本號同步更新至 `?v=11.3.3`。

### v11.3.2 (2026-04-24)
**TDCC 快取修正與市場寬度日期優化**
- **TDCC 籌碼集中度**：修復 `watchlist_quick.py` 中 TDCC 信號未正確從快取注入的問題。
- **市場寬度 (Breadth)**：修正 `fetch_all.py` 中 `breadth.date` 的抓取邏輯，確保在盤前非交易時段正確顯示前一交易日日期而非今日日期。

### v11.3 (2026-04-23)
**RS 相對強度 + Signal Flip 即時出場 + 族群資金流向整合**
- **相對強度 RS vs TAIEX (Feature #2)**：
  - **數據計算**：後端新增 `_compute_rs()`，計算個股漲跌 vs 大盤差值，分級為強勢(+2%)、跟漲(+0.5%)、平盤、弱勢(-0.5%)與極弱(-2%)。
  - **AI 整合**：`ai_analyzer.py` 新增 `rs_vs_taiex` 欄位，並在 Prompt 中強制引用 RS 數據。
  - **UI 顯示**：持倉卡片新增 RS Tag，遵循台股紅漲綠跌配色。
- **Signal Flip 即時出場 (Feature #4)**：
  - **風控邏輯**：`paper_trade_engine.py` 新增 `conf_flip_count`（信心驟降 ≥15 分）與 `rs_weak_count`（RS 持續弱勢）計數器。
  - **自動出場**：連 2 次觸發即執行出場 (`exit_reason` 為 `signal_flip` 或 `rs_weak`)，提升對盤勢轉弱的反應速度。
- **族群資金流向 (Feature #1)**：
  - **市場監控**：對接 TWSE MIS 抓取 18 個類股即時指數，並偵測「資金過度集中」異常 (is_top_heavy)。
  - **個股對照**：透過 `_INDUSTRY_TO_SECTOR` 將個股歸類至所屬族群。
  - **UI 強化**：總覽面板顯示強/弱勢族群摘要與資金集中警告；持倉卡片標註族群強度 Tag。
- **配套修正與優化**：
  - **Worker 設定**：`worker/index.js` 同步更新 `signal_flip_drop` 等風控預設值。
  - **AI 諮詢強化**：`consultAiAboutPortfolio()` Payload 整合 RS 與族群流向資料。
  - **版本更新**：全站相關 JS/CSS 引用版本號 bump 至 `?v=11.3` (Footer 標示為 v11.2)。

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
