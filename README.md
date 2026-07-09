# Taiwan Stock AI Analyzer (台股 AI 智慧分析儀)

![Taiwan Stock AI Analyzer](https://img.shields.io/badge/Status-Live-success)
![Version](https://img.shields.io/badge/Version-12.7.3-blue)
![AI-Powered](https://img.shields.io/badge/AI-Gemini%20%7C%20Groq%20%7C%20Mistral-blueviolet)
![License](https://img.shields.io/badge/License-MIT-green)

一個基於 Gemini 3.1 Flash-Lite 與多模型驅動的台股自動化分析系統。每日自動抓取證交所、期交所與 Yahoo Finance 數據，結合技術指標、三大法人籌碼、融資融券、市場寬度、期貨未平倉與 ADR 連動，產出結構化的 AI 盤勢分析與個股診斷報告。

## 🚀 快速開始

1. **GitHub Pages**: [點此開啟 Web 介面](https://noh486951-droid.github.io/taiwan-stock-ai-analyzer/) (支援 PWA 客戶端安裝)
2. **免設定 AI**: 系統已內建 Cloudflare Worker 代理與 AI 分析快取，開啟即用。
3. **雲端同步**: 輸入暱稱即可跨裝置同步您的自選股清單。

## 🌟 核心功能

- **多維度資料抓取**: 自動整合台股個股、大盤、國際指數、三大法人、期貨、PCR、融資融券。
- **結構化 AI 分析**: Gemini 3.1 產出包含「多空研判、信心度、四維評分、分析理由」的深度報告。
- **即時診斷助手**: 內建 Mistral 備援引擎，輸入代碼 10 秒內獲取最新 AI 診斷。
- **異常波動預警**: 7 大預警條件監控市場風險（如爆量、劇烈波動、融資斷頭風險等）。
- **支撐壓力建議**: 自動計算 3 段支撐與壓力位，提供保守/積極停損點與目標價。
- **AI 財經快報**: 每日開盤前自動生成晨間快報，追蹤全球總經與追蹤股新聞。
- **每月營收快報**: 自動追蹤自選股營收 YoY/MoM 異動，識別營收爆發（Surge）或衰退（Decline）。
- **AI 智慧過濾**: 僅針對營收異常個股進行 AI 分析，節省 90% 以上的營收 Token 消耗。
- **多模型聊天與快速指令**: 整合 Gemini、Groq 與 Mistral，並新增 4 大快速指令（盤勢大檢閱、尋找大鯨魚、技術面噴發、自選股體檢），極速獲取深度分析。
- **TDCC 籌碼集中分析**: 自動偵測大戶/散戶持股比例變化（雙週對照），產出「強烈集聚/散戶堆積」等籌碼信號。
- **總經風險監控**: 實時監測美債 10Y 殖利率 (^TNX)，依據門檻（4.5%/4.8%）產出警戒信號與風險評估。
- **虛擬投資 & 自動交易引擎 (v11.0)**: 全面升級的方案 Y 後端引擎。支援 5 個自選股席位、20 萬資金上限、連續訊號確認、5 交易日 cold-down 與「信心崩跌/單日急跌」防禦機制，實現全自動進出場模擬。
- **市場雷達掃描器 & AI 選股 (v11.4)**: 每日自動掃描 T86 法人買賣超與成交量異動。內建 8 大排行榜（外資/投信買賣超、漲跌幅、成交量、金額），並連動 Gemini AI 進行「市場強弱勢診斷」與「17 檔精選觀察股」自動產出。
- **動態權重回測 & 盤勢分組 (v11.5)**: 自動識別「多頭/空頭/盤整」盤勢，並根據不同盤勢下的歷史交易勝率動態調整進場門檻（信心度門檻），樣本累積 10 筆即自動啟動。
- **企業行事曆 (法說/配息) (v11.5)**: 整合證交所與 MOPS 數據，自動識別自選股未來 30 天的法說會、股東會、配息與除息事件，並在卡片標註即時徽章（含脈動動畫預警）。
- **美股龍頭隔夜訊號 (v11.5)**: 每日監控 NVDA、AAPL 等 9 檔美股龍頭走勢，自動關聯超過 50 檔台股供應鏈廠商，產出高/中/低嚴重度預警與對應供應鏈影響評估。
- **宏觀防禦模式 & 移動停利 (v11.6)**: 新增 VIX/US10Y 等五大指標組成的宏觀風險打分機制，遇高風險自動縮減曝險與倉位。同時結合 ATR 移動停利、族群集中警示與失敗交易 AI 讀回機制，大幅升級虛擬投資風控。
- **三項進場過濾系統 (v11.7)**: 新增 MA5 乖離過濾（防追高被套）、強勢族群過濾（自動擋弱勢落後股）、及動態 ATR 進場停損（AI 給的停損若太緊或太鬆會自動調校為 1.5~3×ATR 區間），全面強化防守。
- **全自動 AI 機器人帳戶 (v11.8)**: 整合 Scout 雷達與虛擬投資引擎，自動讀取每日 AI 選股名單（AI Picked Watchlist）進行無人值守的沙盒交易。具備 100 萬初始資金、獨立帳簿與專屬策略參數，提供使用者與 AI 對打觀戰的全新體驗。
- **全方位交易支援 (v11.9)**: 導入全球總經行事曆（FOMC/CPI/財報）、策略回測模擬器（6 維參數即時對比）、ETF 穿透與風險集中度分析、5-10 日產業輪動熱力圖、盤中量能激增 Fast Track 與尾盤 5 分鐘量價警示。AI 會在大事件前自動調整信心度，並在曝險過高時發出紅字警告，全面提升風控深度。
- **Discord 智慧通知與 AI 穩定性提升 (v11.10.4)**: 實裝全自動 Discord 機器人推送（含進出場、階梯預警、量能激增、尾盤分析等 11 種情境）。新增「AI 持倉諮詢」即時推送功能，透過前端直接傳送全文並由 Worker 動態分頁（最多推播 4 條連續訊息），確保萬字分析長文不再被截斷。同時，導入強制量化結構模板，要求 AI 產出明確的 5 大關鍵數字（加碼、減碼、停利、停損、明日盯盤點）及整體警戒線，全面消滅模糊的「視情況」用語。
- **AI 早安主播與 Discord 互動機器人 (v11.12)**: 實裝「AI 主播」晨間風格快報，自動推送到專屬頻道。Discord Bot 指令全面充至 14 個，新增歷史查詢、風險穿透、連勝統計等高階功能。全線通知卡片實裝「互動式按鈕」，支援一鍵查詢現況與諮詢 AI。此外，整合 PNG 視覺化圖表推送與自動月報系統。
- **收盤總結與數據強化 (v11.13.4)**: 升級市場雷達與收盤分析引擎。收盤總結新增「今日總計 (Daily Total)」損益追蹤；自選股診斷整合「營收年增率 (Revenue YoY)」動態看板；同時實裝「大戶持股 Top」追蹤機制，自動識別主力持倉變動趨勢。

- **首次使用 Onboarding 引導與 PWA 支援 (v11.14.15)**: 實裝 8 步 spotlight 遮罩引導（`onboarding.js`）與 PWA 漸進式 Web 應用安裝引導（`pwa_install.js`），偵測設備並引導手機用戶安裝為桌面應用，提升首頁使用質感。
- **交易戰績儀表板與跨用戶/AI 排行榜 (v11.14.11)**: 提供自選持倉一鍵出場結算與損益歷史記錄；自選股頂部新增 8 格戰績儀表板；新增獨立 `leaderboard.html` 排行榜，支持獲利/勝率等 4 大維度排名，並讓 AI 機器人自動參賽，開放用戶隱私選擇。
- **自選股持倉成本管理與 AI 精準建議 (v11.14.9)**: 支援填入「投資總額」並自動推算每股平均成本，卡片即時顯示浮動損益%及金額；手動點擊「AI 建議」即時結合技術面、基本面與籌碼數據給出精確操作動作（加碼/續抱/減碼/停利/停損）。
- **v12 全新帳號與認證系統 (v12.0)**: 導入 Google OAuth 2.0 與 Email/Password 雙軌註冊登入方案，支援 JWT (JSON Web Token) 簽章認證、30天登入免重登與跨分頁同步登出保護，保障模擬交易部位與自選股隱私。
- **系統介紹與操作手冊 (v12.0.3)**: 內建系統介紹頁面 `system_intro.html` 與詳細的操作手冊 `system_manual.html`，引導新用戶快速上手。
- **受控左側交易與勝率分組 (v12.2)**: 支援受控左側交易機制（逢低抄底）與左右側勝率分組，並於持倉卡片加入左右側交易屬性徽章標註。

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | HTML / CSS / JavaScript (Vanilla) |
| **帳號與驗證** | **Google OAuth 2.0 / Email & Password** 雙軌 + **JWT (JSON Web Tokens)** |
| **AI 引擎核心** | **Google Gemini 3.1 Flash-Lite** |
| **新聞/快報引擎** | **Groq (Llama-3.1-8B-Instant)** (v11.14.8 升級) |
| **分析備援** | **Mistral Small (mistral-small-latest)** (v11.14.5 / v12.2.4) |
| **動態後端** | **Cloudflare Workers (KV 資料庫 + API 代理 + 備份遷移 API + 指標運算)** |
| 資料抓取 | Python (yfinance, requests) + **TAIFEX OpenAPI** |
| CI/CD | GitHub Actions (每日 4 次自動執行量能預抓與 AI 分析) |
| 部署 | GitHub Pages + Cloudflare Workers |

## 資料來源

- **市場數據**: Yahoo Finance (yfinance) - 台股與國際指數
- **三大法人**: TWSE Open Data API (外資/投信/自營商)
- **融資融券**: TWSE 證交所 MI_MARGN API
- **漲跌家數**: TWSE 證交所 MI_INDEX API
- **期貨未平倉**: **TAIFEX OpenAPI** (v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate) 
- **Put/Call Ratio**: **TAIFEX OpenAPI** (v1/PutCallRatio)
- **台積電 ADR**: Yahoo Finance (TSM)
- **財經新聞**: Yahoo 台股 RSS Feed
- **個股技術面/基本面**: Yahoo Finance (yfinance)
- **大戶/散戶持股**: 集保結算所 (TDCC) 分級數據
- **美債 10Y 殖利率**: Yahoo Finance (^TNX)

## 專案結構

```
taiwan-stock-ai-analyzer/
├── index.html                  # 主頁 - 盤勢總覽 + 異常預警 + 美股龍頭連動 + 系統通知
├── news.html                   # 新聞頁 - AI 早安主播快報 + 即時財經新聞
├── watchlist.html              # 自選股頁 - 個股管理 + 支撐壓力與籌碼集中度 + 持倉設定與 AI 建議
├── sectors.html                # 族群頁 - AI 類股熱度 + 10 日資金資金輪動熱力圖 + 企業行事曆
├── scout.html                  # 市場雷達頁 - 8 大榜單 + AI 選股精選 + 大戶/強勢股排行榜
├── paper_trade.html            # 虛擬投資頁 - 帳戶總覽 + 持倉管理 + 自動交易設定 + 策略回測模擬器
├── auth.html                   # 登入註冊頁 - Google OAuth 2.0 與 Email/Password 帳號系統
├── account.html                # 個人帳戶頁 - Display Name 修改 + 跨裝置同步 + 歷史交易紀錄明細
├── admin.html                  # 管理端控制台 - 所有帳簿管理 + 自動交易安全閥 + KV 密鑰清理
├── leaderboard.html            # 排行榜頁 - 用戶/AI 跨參賽者競技排行榜 (獲利/勝率/筆數等多維度)
├── migrate.html                # 數據遷移頁 - 舊版 KV 使用者自選股與持倉資料遷移
├── system_intro.html           # 系統介紹頁 - 核心架構、防禦機制與 AI 角色定位說明
├── system_manual.html          # 操作手冊頁 - 網頁版及 Discord Bot 之詳細使用指南與功能指引
├── manifest.json               # PWA 設定 (漸進式 Web 應用安裝設定)
├── css/
│   └── style.css               # 全域樣式 (科技暗黑系 + 自適應響應式佈局)
├── js/
│   ├── app.js                  # 主頁邏輯 (異常監控、三大法人、指數、美股連動渲染)
│   ├── news.js                 # 新聞與早安主播渲染邏輯
│   ├── watchlist.js            # 自選股 (支撐壓力、TDCC 籌碼、法說除權息事件徽章)
│   ├── sectors.js              # 族群頁邏輯 (產業鏈地圖渲染)
│   ├── sector_heatmap.js       # 10 日資金輪動熱力圖 (R/G 視覺化與互動卡片)
│   ├── scout.js                # 市場雷達 8 大榜單與 AI 選股卡片渲染
│   ├── paper_trade.js          # 虛擬投資前端 (交易明細、戰績儀表板、策略回測器)
│   ├── chat.js                 # AI 聊天助手 (Gemini/Groq/Mistral 多模型串流 + 快速指令)
│   ├── auth.js                 # JWT 帳號系統登入、註冊與狀態變更邏輯
│   ├── auth_guard.js           # 前端路由守衛 (防網路斷線誤判、跨頁籤登出與鎖屏)
│   ├── google_client_config.js # Google Identity Services OAuth 2.0 配置
│   ├── onboarding.js           # 首次使用 8 步 Spotlight 遮罩導覽引導
│   ├── pwa_install.js          # Android/iOS PWA 安裝提示與冷卻控制
│   ├── sidebar.js              # 全域側邊欄 (Sidebar) 響應式切換與 Profile Header 渲染
│   ├── stock_names.js          # 全市場台股/美股代號對應中文名稱對照表
│   ├── positions.js            # 帳戶部位詳細狀態輔助模組
│   ├── trade_log.js            # 歷史交易紀錄彈窗渲染
│   └── kline_modal.js          # 日線 K 線 Modal 渲染
├── scripts/
│   ├── fetch_all.py            # 資料抓取主程式 (大盤、三大法人、融資券、ADR、期貨、PCR)
│   ├── ai_analyzer.py          # Gemini AI 盤勢分析 + 營收異常判定與 AI 財經快報產出
│   ├── scout.py                # 市場雷達掃描與 AI 智慧選股決策引擎 (T86 + HOT 偵測)
│   ├── momentum_scanner.py     # 全市場多週期 (1d/5d/20d) K 線漲幅掃描器
│   ├── paper_trade_engine.py   # 虛擬投資交易引擎 (含盤勢動態權重、防禦機制A/B、進場三過濾)
│   ├── paper_trade_daily_review.py # 每日持倉 Review、ATR移動停利更新與失敗交易讀回分析
│   ├── weekly_review.py        # 每週一自動檢討 (獲利/虧損 TOP 3 對比與下週策略微調)
│   ├── monthly_report.py       # 每月最後交易日自動產出 AI 評分月報
│   ├── morning_brief.py        # 晨間總經情報與重大新聞擷取
│   ├── push_morning_digest.py  # 將晨間 AI 主播快報推播至 Discord
│   ├── notify_discord.py       # Discord 11大智慧通知推送、長文多頁分段發送核心
│   ├── daily_base_prefetch.py  # 每日 07:00 盤前預抓 (MA5、營收數據等)
│   ├── fetch_corporate_events.py # 企業法說會、除權息、股東會事件抓取與快取
│   ├── fetch_macro_calendar.py # FOMC/CPI/非農/財報等全球總經行事曆抓取
│   ├── track_sector_history.py # 每日紀錄族群熱度歷史用於熱力圖
│   ├── track_closing_action.py # 尾盤 5 分鐘量價異動監控與預警
│   ├── us_giants_signal.py     # 美股 9 檔龍頭連動台股 50+ 供應鏈影響評估
│   ├── export_users_to_txt.py  # 數據遷移與備份轉換工具
│   ├── engine_health_check.py  # 引擎運行健康度檢查
│   ├── update_tw_holidays.py   # 自動下載並更新台灣證交所休市行事曆
│   ├── klines_builder.py       # 歷史 K 線數據構建器
│   ├── stock_names.py          # Python 端中文股名對照抓取輔助
│   └── watchlist_quick.py      # 盤中快速掃描與交易執行主排程 (整合 Weekend Guard)
├── data/
│   ├── raw_data.json           # 盤後即時指標數據快取
│   ├── market_pulse.json       # AI 盤勢分析報告數據
│   ├── morning_digest.json     # 晨間 AI 財經主播快報數據
│   ├── sector_map.json         # 類股熱度與資金集中度數據
│   ├── sector_history.json     # 10 日類股熱度歷史紀錄 (熱力圖數據源)
│   ├── scout_radar.json        # 市場雷達 8 大排行榜數據
│   ├── scout_history.json      # 30 日雷達榜單歷史 (HOT 偵測數據源)
│   ├── ai_picked_watchlist.json # AI 精選觀察股名單 (Scout AI 決策)
│   ├── corp_events.json        # 企業行事曆快取 (法說/除權息/股東會)
│   ├── macro_calendar.json     # 全球總經重大事件行事曆
│   └── etf_holdings.json       # 10 大熱門 ETF 成份股持倉權重資料
├── worker/
│   ├── index.js                # Cloudflare Worker API 網關與代理
│   ├── auth.js                 # JWT 使用者認證與 API 跨域 CORS 處置
│   ├── discord_bot.js          # Discord slash commands 斜線指令與互動式按鈕端點
│   ├── register_bot_commands.js # 註冊 Discord 14 個斜線指令之腳本
│   └── wrangler.toml           # Cloudflare Worker 部署配置
└── .github/
    └── workflows/
        └── main.yml            # GitHub Actions 每日 4 次自動化排程 (含錯峰執行與 Weekend Guard)
```

## GitHub Actions 排程

系統目前設有三個主要的自動化排程工作流程，已全面導入 **Weekend Guard 週末防護**與**交易時段過濾**（台北時間）：

1. **主排程 (`main.yml`)**：每日 4 次錯峰執行，負責數據抓取、AI 盤勢分析、營收判定與 Discord 智慧推播。
   - **07:07 (23:07 UTC)**：晨間快報 + 盤前 AI 分析 (主播風格推播)
   - **10:07 (02:07 UTC)**：盤中更新
   - **14:37 (06:37 UTC)**：收盤分析
   - **18:07 (10:07 UTC)**：盤後總結與 AI Review (含更新停損停利價與週五週報)
2. **自動交易與結算排程 (`paper_trade_daily_review.yml`)**：
   - **18:00 (10:00 UTC)**：每日持倉 Review、交易結算、ATR 移動停利點更新與每週一敗筆/贏家交易檢討。
3. **盤中即時交易排程 (`watchlist_quick.yml`)**：
   - **09:07 - 13:52 (01:07 - 05:52 UTC)**：每 15 分鐘執行一次（`7,22,37,52` 分），負責執行自選股的盤中 AI 診斷、量能激增 Fast Track 與自動進出場交易。

> [!NOTE]
> - **Weekend Guard**：所有 Workflow 均在首步驟自動檢測台北時間是否為週末，若為週末則在 5~10 秒內快速退出，節省 GitHub Actions 配額。
> - **Failsafe 雙軌備援**：為防範 GitHub Actions 內建 Cron 排程漏發，Cloudflare Worker 設定了 failsafe 觸發器（每 15 分鐘於 `:02, :17, :32, :47` 執行），透過 `repository_dispatch` 發射信號補漏，確保系統 100% 覆蓋。

## 版本紀錄

詳細的版本更新歷史請參閱 [CHANGELOG.md](file:///c:/Users/明芳/.gemini/antigravity/scratch/taiwan-stock-ai-analyzer/CHANGELOG.md)

### v12.7.3 (2026-07-09)
**自選股持倉加「含費損益」與未實現損益券商口徑對齊**
- **功能新增與升級**：
  - 自選持倉明細新增「含費損益（券商口徑）」(v12.7.3)。
  - 成本計算公式新增買/賣手續費與證交稅：手續費買賣各 0.1425% (預設低消 20 元) 並支援從 `localStorage.tw_fee_discount` 設定自訂折數；證交稅計算賣出 0.3% (v12.7.3)。
  - 支援點擊「含費損益列」彈出 prompt 設定券商手續費折數（如 0.6 或 0.28），並即時顯示「費+稅 約 X 元」，讓損益透明度更高 (v12.7.3)。

### v12.7.2 (2026-07-09)
**新聞面 AI 進場 Gate 阻擋與信心度校準統計報表**
- **功能新增與升級**：
  - 實裝新聞面過濾機制（Groq 新聞面 Gate）：當 Gemini 技術面看多但 Groq 新聞面偏空（且有實際匹配的壞消息標題）時，AI 信心度門檻需額外增加 5 分才放行進場，以防短線地雷 (v12.7.2)。
  - 新增 confidence 校準統計報表工具 (`scripts/confidence_calibration.py`)：自動將已平倉交易依信心度分桶統計真實勝率，並產出 `data/confidence_calibration.json` 由每日 EOD 自動跑完更新 (v12.7.2)。
  - 統計結果實裝 reliable 標記（樣本數 $\ge 15$），為下一階段自動調整信心門檻做數據準備 (v12.7.2)。

### v12.7.1 (2026-07-08)
**盤前晨報去重推送與 daily_review 快照回寫優化**
- **功能新增與升級**：
  - 修正盤前準備卡 7 點/8 點重複推送問題：新增 `data/_pushed_morning_brief.json` 記錄當日推送狀態，推播成功後才記 state，同日第二次自動跳過 (v12.7.1)。
- **重大 Bug 修復**：
  - 修正快照圖表「資料不足」問題：修正 `daily_review` 儲存時漏回寫 `daily_snapshots` 欄位至 KV 的 Bug (v12.7.1)。

### v12.7.0 (2026-07-08)
**自選股快取邏輯優化與 sessionStorage 導入**
- **重大 Bug 修復**：
  - 修正「新增一檔自選股時導致全部重新打 AI 分析 API」的 Bug。改為「合併」不「覆蓋」的快取機制，避免覆蓋尚未寫入排程 JSON 的動態快取 (v12.7.0)。
  - 導入 sessionStorage 快取機制（有效期限 4 小時），即使瀏覽器按 F5 重整頁面亦不會重複發起 `/api/analyze` 請求，節省 AI API Token 消耗 (v12.7.0)。

### v12.6.9 (2026-07-07)
**個股追高過濾與急跌防禦觸發放寬**
- **功能新增與升級**：
  - 實裝個股追高過濾機制（_should_enter 早期阻擋）：個股當日漲幅 > 2%、距 20 日高點 < 2% 或 MA5 乖離超過 3% 時自動拒絕進場，防範追高風險 (v12.6.9)。
  - 放寬急跌防禦觸發條件：改為持有 $\ge 2$ 個交易日後才啟動急跌防禦（給予剛進場個股喘息空間），且個股單日急跌門檻由 -4% 放寬至 -5% 以免被正常波動洗出場 (v12.6.9)。

### v12.6.8 (2026-07-07)
**精簡 AI 主持人排程與 daily_snapshots 儲存機制修復**
- **功能新增與升級**：
  - 停用 midday (10:00) 與 afternoon (14:30) 的 AI 主播晨/盤後快報，僅保留 morning (盤前) 與 evening (盤後)，每日節省約 10K Tokens (v12.6.8)。
- **重大 Bug 修復**：
  - 修正 paper_trade 圖表「快照資料不足」問題，補上 `save_portfolio` 中漏掉的 `daily_snapshots` 與 `defense_mode` 回寫欄位 (v12.6.8)。

### v12.6.7 (2026-07-07)
**前端 Footer 版本標示與部署狀態檢測**
- **功能新增與升級**：
  - 於頁面 Footer 新增版本號顯示區塊，並加上 GitHub Pages CDN 部署狀態檢測提示，協助使用者目視確認是否已載入最新版本 (v12.6.7)。

### v12.6.6 (2026-07-07)
**Whales 頁面快取防呆更新**
- **功能新增與升級**：
  - 在 `whales.html` 中加入 Cache-Control / Pragma / Expires meta 標籤，強制瀏覽器重抓 HTML 本身以避免載入舊版快取 (v12.6.6)。

### v12.6.5 (2026-07-07)
**鯨魚 Picks 抓價 Fallback 機制優化**
- **重大 Bug 修復**：
  - 修正鯨魚 Picks 因多為非自選股而無現價導致顯示「—」的問題：若 raw_data 中無對應股票，自動使用 yfinance history 進行抓價補回，並加入 `_YF_PRICE_CACHE` 防止重複呼叫 (v12.6.5)。

### v12.6.4 (2026-07-07)
**鯨魚鎖定排程防漏與補鎖機制優化**
- **功能新增與升級**：
  - 將鯨魚鎖定由僅限週一改為「週一至週五平日」只要本週尚未鎖定即進行鎖定，保障因故漏抓時能在平日補鎖 (v12.6.4)。

### v12.6.3 (2026-07-07)
**獨立鯨魚追蹤頁面 whales.html 上線**
- **功能新增與升級**：
  - 新增獨立的 `whales.html` 鯨魚追蹤頁面，支援查看過去 26 週的主力資金流向歷史紀錄，並於 Sidebar 加入跳轉入口 (v12.6.3)。
  - 支援累計戰績統計（勝率、平均報酬、累計週數等），並提供「🔄 更新即時報酬」按鈕即時重算最新 running 損益 (v12.6.3)。

### v12.6.2 (2026-07-07)
**次產業分類庫擴充與精細化**
- **功能新增與升級**：
  - 次產業分類大擴充，由 26 類增加至 37 類（新增被動元件、散熱、AI伺服器、重電、工具機等獨立分類），並拆分生技醫療為「生技/製藥」與「醫療器材」(v12.6.2)。

### v12.6.1 (2026-07-07)
**產業熱力圖細分次產業與前端即時篩選器**
- **功能新增與升級**：
  - 產業熱力圖新增細分「次產業」視圖（使用 `sub_sector_map.json` 做反向分類索引）(v12.6.1)。
  - 於熱力圖頁面加入多功能工具列，支援關鍵字即時搜尋、快速過濾強勢/弱勢股，不須重新載入即可重繪 (v12.6.1)。

### v12.6.0 (2026-07-07)
**大盤防禦模式 (Defense Mode) 與隔夜美股訊號聯動**
- **功能新增與升級**：
  - 新增超靈敏大盤防禦模式，區分 `defensive` (暫停右側進場) 與 `extreme` (暫停所有進場，含左側抄底) 兩級防禦 (v12.6.0)。
  - 防禦模式觸發條件包含：美股龍頭隔夜跌超 2% / 4%、VIX 飆高、TAIEX 當日急跌、或匯率貶破 threshold (v12.6.0)。
  - 虛擬投資頁面頂部新增紅/橘色動態防禦 Banner，提示目前防禦狀態與觸發原因 (v12.6.0)。

### v12.5.9 (2026-07-06)
**新聞抓取時段精簡與 Discord 重複推播過濾**
- **功能新增與升級**：
  - 移除 10:00 與 14:00 的新聞抓取排程，精簡至僅在 18:07 盤後抓取新聞，節省 API 負擔 (v12.5.9)。
  - 導入 Discord 新聞 alert hash dedup 機制，利用 SHA-1 雜湊判定，若同檔個股推送內容相同則自動跳過，避免洗版 (v12.5.9)。

### v12.5.8 (2026-07-06)
**鯨魚 picks 每日 running 報酬追蹤**
- **功能新增與升級**：
  - 鯨魚精選（Whale Picks）改為週一收盤 EOD 正式鎖定，且每日更新 cumulative running return，並在進行 5 個交易日後標記結算 (v12.5.8)。

### v12.5.7 (2026-07-06)
**鯨魚選股過濾優化與自動納入虛擬交易候選**
- **功能新增與升級**：
  - 鯨魚選股過濾器排除金融股干擾，顯示隻數調整為 Top 4 (v12.5.7)。
  - 鯨魚精選個股自動回寫併入 `ai_picked_watchlist.json`，納入 AI 自動交易的候選池內 (v12.5.7)。

### v12.5.6 (2026-07-06)
**主力資金推估法 (Pseudo Whale Finder) 與雙保留設計**
- **功能新增與升級**：
  - 當 TDCC 集保 Opendata 當機回傳 No Data 時，自動啟動 B 方案（Pseudo Whale Finder）：利用 TWSE T86 三大法人買賣超、連續日數與散戶推估阻力綜合評分，推估主力吸籌標的 (v12.5.6)。
  - 支援雙 Schema 渲染，自動依數據源顯示「千張大戶%」或「主力資金連續買超張數與日數」(v12.5.6)。

### v12.5.5 (2026-07-06)
**集保 Opendata SSL 驗證繞過**
- **功能新增與升級**：
  - 繞過集保 (TDCC) 官方 SSL 證書 Subject Key Identifier 缺失導致的驗證失敗問題，設置 `verify=False` 以保證排程能正常下載 (v12.5.5)。

### v12.5.4 (2026-06-26)
**CF Worker Failsafe Dispatch 開關與假日 Workflow 優化**
- **功能新增與升級**：
  - 新增 CF Worker failsafe dispatch 全域開關 (`env.CF_DISPATCH_ENABLED`) (v12.5.4)。
  - 假日/週末 Workflow 執行時自動跳過新聞抓取，手動觸發亦會進行阻擋，避免無謂的 API 消耗 (v12.5.2)。
  - 產業熱力圖小區塊 UI 體驗優化 (v12.5.1)。
  - 鯨魚搜尋功能升級為全市場掃描，並新增回測勝率追蹤功能 (v12.4.8)。
- **重大 Bug 修復**：
  - 週末/假日 Workflow 使用 `needs` + `outputs` 機制取代直接 `exit 1`，避免 GitHub UI 顯示紅叉 (v12.5.3)。

### v12.2.6 (2026-06-03)
**AI 備援鏈升級、持倉出場修復與 UI 體驗優化**
- **功能新增與升級**：
  - 實裝 Mistral 作為 watchlist 分析第三層 fallback，避免 AI 過載時無法進行虛擬交易 (v12.2.4)。
  - 受控左側交易機制（逢低抄底）與左右側勝率分組 (v12.2.0)。
  - 登入續期功能上線，支援 30 天免重登 (v12.1.5)。
  - 日線熱力圖紅綠對調，新增資料日期與過期警告，點擊改為彈出卡片並支援一鍵加入自選股 (v12.1.3 - v12.1.7)。
  - 黃金交叉個股直接加入自選，AI 選股於盤中 3 次自動刷新 (v12.1.7)。
  - 排行榜全面實裝中文名顯示，持倉卡片加入左右側 badge (v12.1.4, v12.2.2)。
- **重大 Bug 修復**：
  - 修復「scout 加自選股後 watchlist 沒出現」的雲端同步覆蓋問題 (v12.2.6)。
  - 將真實用戶持倉併入 `watchlist_quick`，解決「stale 永不出場」的本質性 Bug，確保舊股能正常平倉 (v12.2.5)。
  - 修正 AI bot 持倉舊股無法出場的問題，並優化 stale 出場邏輯 (v12.2.2 - v12.2.3)。
  - 修復自選股價格大量沒更新的問題，加強 TWSE MIS 部分失敗時之容錯處理 (v12.2.1)。
  - 修正持倉 AI 建議回覆中斷的問題 (v12.1.6)。
  - 解決虛擬交易引擎 Crash 問題 (v12.1.4)。

### v12.0.5 (2026-05-19)
**引導導覽跳轉與快取防呆優化**
- **非首頁啟動導覽跳轉**：修復當用戶在非首頁（如自選股 watchlist）點擊「重看導覽」時，因步驟對應不一致導致引導錯亂的問題。當偵測到非首頁，系統將自動跳轉至 `index.html?tour=1` 觸發引導，並在載入後使用 `history.replaceState` 清除 URL 參數。
- **全站 HTML 資源快取更新**：同步更新所有頁面的 query string 為 `v12.0.5`，強制瀏覽器載入最新靜態資源。

### v12.0.4 (2026-05-19)
**鎖屏 Race Condition 修復與引導卡片遮罩亮度優化**
- **解決已登入仍鎖屏問題**：修復 `auth_guard.js` 載入與 `auth.js` 內 `window.isLoggedIn` 函式宣告先後順序不一引起的競態條件。改為直接讀取並在前端 inline 解析 `localStorage.tw_jwt_access` 的 `exp` 期效，免除第三方函式依賴。
- **跨頁籤同步登出機制**：增加 `storage` 事件監聽器，當使用者在其他瀏覽器分頁登出時，同步更新並鎖住當前頁面，防止身分外洩。
- **Spotlight 引導卡片亮度修正**：調整 onboarding 導覽遮罩的 z-index 排序，將 `spotlight-card` 層級提高至 `99995`（高於遮罩層的 `99991`），使引導卡片完全凸顯，不被背景陰影調暗。

### v12.0.3 (2026-05-19)
**連線錯誤防誤判登出與 Onboarding 視覺質感升級**
- **區分網路錯誤與 Token 失效**：修正 `authedFetch` 在因網路中斷或 CORS 跨域失敗時，誤將非 401 錯誤視為 token 遺失而強行登出用戶的 Bug。現僅有 `/api/auth/refresh` 回傳 `401` 或 `REVOKED` 時才會清空 session，大幅提升穩定性。
- **輪詢安全防護**：`auth_guard` 載入時新增 30 次（共 3 秒）的輪詢，預留充足時間給 `auth.js` 載入，並添加訂閱防護防止重複監聽。
- **引導卡片視覺樣式升級**：大幅優化 onboarding 卡片外觀。背景色改為更具科技感的紫色調 `#2d2d4f`，新增 40px 紫色外發光與內側高亮，邊框加粗，標題改為米黃色 (`#ffe9c2`) 並加文字陰影，重點文字以金黃色 (`#ffd966`) 突顯。
- **新增系統說明文件**：新增系統介紹頁面 `system_intro.html` 與操作手冊 `system_manual.html`。

### v12.0.2 (2026-05-19)
**按鈕 async 狀態回饋與 Display Name 即時更新**
- **按鈕 Loading 狀態回饋**：在 `account.html` 導入 `withButtonLoading()`，讓 async 修改操作（如更新個人資料）時，按鈕呈現灰色旋轉載入、成功時綠色 ✅、失敗時紅色 ❌ 並伴隨手機震動回饋，提升操作手感。
- **頂部平滑 Toast 提示**：以滑入式的頂部綠色/紅色 Toast 取代舊有的靜態 banner，改善通知體驗。
- **個人資料修改即時更新**：更換 display_name 後，不需重新整理即可即時同步更新 sidebar 上的頭像與名稱。

### v12.0.1 (2026-05-19)
**側邊欄個人資料 Header 與 Worker 跨域 CORS 修復**
- **Sidebar Profile Header**：重新設計側邊欄 UX，將帳號連結移至最上方 Logo 下方。登入時顯示基於 display_name hash 生成的漸層色圓形頭像、暱稱與隱藏 Email；訪客狀態則顯示預設頭像並提示「點此登入/註冊」。
- **Worker 跨域 CORS 修復**：為了解決 `account.html` 跨域 Preflight 失敗問題，於 Worker 中開通 `PATCH`、`DELETE` 方法與 `Authorization` 請求標頭，並設定 `Max-Age: 600` 以減少重複的 Preflight 請求次數。

### v12.0.0-prep (2026-05-19)
**v12 帳號系統準備：帳號系統實作方案與舊用戶備份匯出工具**
- **帳號系統實作方案 (`IMPLEMENTATION_PLAN_AUTH.md`)**：設計詳細的 Google OAuth 與 Email/Password 雙軌註冊登入方案，規劃新舊 KV schema 升級路徑 (`user:*` / `watchlist_v2:*`)、JWT 簽章認證機制、前端登入介面與 4 階段 Rollout 計畫。
- **管理端一次性備份匯出 API**：於 Cloudflare Worker 新增 `/api/admin/export-all-users` 管理員專用端點，可安全地一次性匯出所有舊用戶的自選股與持倉資料，為系統升級做好備份準備。
- **舊用戶備份轉換腳本**：新增 `scripts/export_users_to_txt.py`，將備份 JSON 自動轉換為每位用戶的純文字備份檔案 (`backups/users/{暱稱}.txt`)，供遷移過程中與舊用戶比對。

### v11.14.15 (2026-05-19)
**首次使用 Onboarding 引導導覽與強勢股中文股名翻譯**
- **首次使用 spotlight 導覽 (`js/onboarding.js`)**：為新用戶實裝 8 步 spotlight 遮罩引導（歡迎 -> 5大核心功能 -> 排行榜 -> 完成）。首次進站 1.2 秒後自動觸發，利用 `localStorage` 記錄完成狀態防干擾，支援手機 RWD 與 Spotlight 重看按鈕。
- **強勢股中文名稱自動對照**：修正強勢股表格中只顯示股票代號（如 6209）的問題，於前端 `scout.js` 的 `renderMomentumTable` 整合對照庫 `js/stock_names.js` 自動轉換為中文股名。

### v11.14.14 (2026-05-19)
**強勢股多週期掃描與集保大戶持股張數切換面板**
- **強勢股日/週/月排行榜 (`scripts/momentum_scanner.py`)**：新增全市場多週期 K 線漲幅掃描管線，於盤後定時分析台股/美股的 1d/5d/20d 累積漲幅並輸出為漲幅 Top 20 排行榜，於 `scout.html` 整合「台股/美股」與「日/週/月」雙層頁籤。
- **集保大戶持股張數切換 (200-1000張+)**：大戶排行榜新增 Buckets 11-15 欄位（對應 200/400/600/800/1000張以上大戶），前端 `scout.js` 實裝 5 個大戶頁籤，支援切換時即時重算佔比、delta 變動（`上週% → 本週% (+X.XXpp)`）並自動排序。

### v11.14.13 (2026-05-19)
**PWA 漸進式 Web 應用安裝引導彈窗 (PWA Install Dialog)**
- **PWA 安裝引導 (`js/pwa_install.js`)**：偵測並引導手機用戶安裝 PWA 應用。
  - **Android/Chrome/Edge**：攔截原生 `beforeinstallprompt` 事件，自訂 Bottom Sheet 安裝底欄，點擊即可觸發原生安裝。
  - **iOS/Safari**：提供「分享 -> 加入主畫面」三步驟視覺教學引導。
- **智慧冷卻防干擾**：偵測 PWA 獨立視窗 (standalone) 則永不彈出；用戶關閉後有 14 天冷卻期；點擊不再顯示則永久關閉。提供 `__pwaShowInstall()` 方便開發測試。

### v11.14.12 (2026-05-18)
**Mistral 深度建議落地：半導體美股聯動 entry filter、分批止盈 (Scale-out) 與每週敗筆檢討**
- **半導體 × 美股聯動進場過濾**：新增 `enable_semi_us_link_filter` 進場防禦開關，若該股為半導體類股且盤前 SOX/NVDA 跌幅達到 **-3%** 以上，今日進場信號將會自動跳過，規避極端開盤踩踏。
- **分批減倉止盈機制 (Scale-out)**：
  - 引進 `scale_out_plan` 分批出局計劃，預設於浮盈達到 +10% 賣出 1/3，達 +20% 再賣出 1/3，剩下 1/3 採用 trailing stop 一路抱緊。
  - **動態停損點優化**：第一級觸發時，停損點自動上調至進場成本（保本點）；第二級觸發時，停損點上調鎖定首級獲利的一半；剩餘持倉低於 2% 時自動全平倉以免遭遇突然倒貨。歷史交易記錄增加 `partial=true` 標註。
- **每週交易勝敗筆對比分析**：新增 `scripts/weekly_review.py` 每週自動檢討。排程固定於每週一收盤後跑完 `daily_review` 後執行，篩選出過去 7 天最獲利與最虧損的各 3 筆交易，發送給 Gemini 進行深度對照分析（包含贏家共通點、輸家共通點與下週策略微調建議），並將結果寫入 `weekly_review.json` 且即時推送到 Discord SUMMARY 頻道。

### v11.14.11 (2026-05-18)
**交易戰績儀表板 + 用戶/AI 跨參賽者排行榜與出場結算系統**
- **自選持倉出場結算**：持倉卡片增加「📤 出場結算」動作按鈕，支援實時損益預覽，填入賣出價後寫入實現損益歷史，並清空該個股持倉，彈窗提示「✅ 已結算 XXX +$X萬」。
- **個人交易戰績儀表板**：自選股頂部架設 8 格戰績看版（總筆數/勝率/累積損益/平均單筆%/最大獲利/最大虧損/平均持倉/歷史明細），支援歷史明細彈窗。
- **跨參賽者競技排行榜**：新增獨立 `leaderboard.html`，依據四種排名規則（獲利/勝率/單筆%/筆數）切換，展示金銀銅前三名獎牌。
- **AI 自動參賽**：AI 機器人根據 `data/ai_bot_portfolio.json` 的 9 筆模擬交易數據（5勝4敗，+$4,665）自動加入排行，並標有 AI 標記。
- **排行榜 Opt-in**：提供「☑ 加入排行榜」勾選，保護隱私。
- **全系統導覽升級**：在 Sidebar 全域選單中新增「🏆 排行榜」跳轉連結。

### v11.14.10 (2026-05-18)
**自選持倉記錄優化：輸入「投資總額」取代平均成本**
- **投資總額輸入**：將持倉編輯輸入欄位改為直覺填寫「投資總額」，並以藍字即時渲染提示折合的「每股平均成本」，降低用戶計算難度。
- **舊資料向下相容**：歷史數據將以 `每股成本 * 股數` 反向推算得出總成本。

### v11.14.9 (2026-05-18)
**自選股「持倉成本 + AI 建議下一步」上線**
- **持倉成本設定**：卡片新增「💼 + 設定持倉成本」按鈕，可設定投資總額、股數、日期與備註，自動顯示實時浮動損益%及金額。
- **持倉 AI 智能諮詢**：點擊「🤖 AI 建議」將串接 multi-model 備援鏈，AI 針對持倉成本、即時走勢與各項技術指標給出明確的操作建議（加碼/續抱/減碼/停利/停損），消滅模糊回答。

### v11.14.8 (2026-05-18)
**Chat 備援鏈核心優化：更換 Groq 模型與 context 智慧壓縮**
- **Groq 備援模型更換**：全面改用 `llama-3.1-8b-instant` (TPM 14400)，取代舊有的 `llama-3.3-70b` (TPM 6K)，極大提升備援承載力、大幅緩解 429 TPM 限制，且回應更為迅速。
- **System Prompt 自動裁切**：當 System Prompt 長度超過 10,000 字時自動截斷，避免超出 413 限制或被免費版 TPM 撐爆。
- **對話歷史與單則訊息裁剪**：限制對話歷史只保留最後 6 輪，且每則訊息內容設置 5,000 字上限，避免 context 膨脹。
- **標頭對齊修正**：修正 API 回應中的 `X-Gemini-Model` 標頭值為 `groq-fallback:llama-3.1-8b-instant`。

### v11.14.7 (2026-05-18)
**排程終極方案：取消 DOW 限制改為全週觸發，依賴 Weekend Guard 與程式內時段過濾**
- **取消 DOW 限制改為每日觸發 (`*`)**：徹底解決 GitHub Actions 與 Cloudflare Worker 對 `1-5` / `MON-FRI` 等 Day-of-Week 欄位的解析分歧，直接改用 `*` 全天候每天打。
- **Weekend Guard 週末防護**：自動排程（`main`、`watchlist_quick`、`daily_review` 3 個 Workflow）在 GitHub Actions 頂部首步驟判定台北時間週末 (`TZ='Asia/Taipei' date +%u >= 6`) 即快速退出，耗時僅 5-10 秒，零配額負擔。
- **程式內交易時段過濾**：`watchlist_quick.py` 與 `paper_trade_daily_review.py` 等腳本精準落實交易時段（08:55-13:40 TW）與週末排除邏輯。
- **Worker 重新部署**：更新 `wrangler.toml` 中的 cron triggers 並成功重新部署 Cloudflare Worker。

### v11.14.6 (2026-05-15)
**定時排程重大修復：全面導入命名週期 (Named DOW)**
- **修復 Cron 誤判 Bug**：解決 GitHub Actions 與 Cloudflare Worker 對 `1-5` (Quartz 式解讀為 Sun-Thu) 的認知歧義。
- **實裝 MON-FRI 週期**：將所有自動化分析排程全面改為明確的 `MON-FRI` 與 `SUN-THU` 命名方式，確保禮拜五收盤分析準確執行，並徹底杜絕禮拜日誤觸發。
- **Worker 同步優化**：同步更新 Worker 內部的 `scheduled` Handler 比對邏輯。

### v11.14.5 (2026-05-15)
**AI 穩定性與透明度升級：三層備援鏈 + 錯誤診斷暴露**
- **三層 Fallback 備援鏈 (Core)**：實裝 Gemini → Groq → Mistral 三層自動備援。當 Gemini 輪替失敗且 Groq 也故障時，由 Mistral Small 接力。
- **錯誤診斷暴露 (Transparency)**：失敗回應新增 `groq_error` 與 `mistral_error` 欄位，精準標示失敗原因（如 401、Timeout），大幅提升維護效率。
- **前端 Debug 強化**：Chat 介面錯誤訊息上限放寬至 400 字，確保診斷資訊完整顯示。

### v11.14.4 (2026-05-14)
**AI 備援鏈初啟動 + 資料新鮮度警示**
- **Groq Relay 救援機制**：實裝 Groq Llama 3.3 70B 作為 Gemini 503 的第一層備援，維持 chat 解析無感。
- **資料過期警示 (Data Freshness Guard)**：Scout 雷達新增日期檢查。若資料日期距今超過 26 小時，自動於 UI 最上方彈出橘色警示條。

### v11.14.3 (2026-05-13)
**AI 穩定性與效能極致優化：Groq 救援鏈 + 壞模型記憶 + 快速跳過機制**
- **Groq Relay 救援機制 (Core)**：
  - **Gemini 故障接力**：當 Gemini 發生批次失敗時，系統自動將 Prompt 轉發至 Groq Llama 3.3 70B 模型（單次呼叫約 3 秒）。
  - **無縫解析**：沿用原有的解析邏輯，確保分析品質與格式一致，大幅提升系統在 Google API 不穩定時的可用性。
- **壞模型記憶與跨 Batch 略過**：
  - **運行狀態記憶**：實裝 `_BROKEN_MODELS_THIS_RUN` 機制。若某模型在第一批次確認故障，後續批次將直接略過，節省 90 秒以上的無效等待。
  - **時間預估優化**：在 Gemini Preview 全掛情況下，總分析時間從 7 分鐘大幅縮短至 1.5 分鐘。
- **快速跳過 (Skip on Failure)**：
  - **不再逐檔 Fallback**：廢除高耗時的逐檔備援邏輯。若 Gemini 與 Groq 雙雙失效，直接標記 `skipped: True` 並由系統自動保留前次 AI 分析結果，徹底杜絕 Workflow 超時中斷。

### v11.14.2 (2026-05-12)
**Scout 籌碼集中跳升修復 (全市場掃描)**
- **籌碼集中跳升 Bug 修復**：
  - **全市場掃描**：修正原本僅掃描自選股導致命中率極低的 Bug。現在 Scout 會從全市場約 4000 檔個股中自動篩選大戶籌碼顯著集中的標的。
  - **篩選門檻強化**：設定大戶增減 > 0.5pp 或千張大戶增減 > 0.3pp 或籌碼信號為「集聚」。
  - **流動性過濾**：新增「日成交量 ≥ 100 張」門檻，排除流動性不佳的冷門股干擾。
  - **UI 表格升級**：Scout 介面新增「千張大戶 Δ」、「籌碼信號」與「所屬產業」欄位，並以最具代表性的「千張大戶變動」進行排序。

### v11.14.1 (2026-05-12)
**候選池擴張 + 第四階段趨勢過濾**
- **策略候選池翻倍**：
  - **月營收榜**：候選名單從 30 檔放寬至 60 檔。
  - **大戶布局榜**：候選名單從 50 檔放寬至 100 檔，確保各細分產業有更多優質標的進入評選。
- **實裝第四階段過濾器 (MA60 趨勢)**：
  - **絕對排除邏輯**：新增「收盤價 > 60MA」且「60MA 斜率 > 0」的強制檢查。自動排除處於空頭排列或中期走勢疲軟的個股。
- **效能優化**：
  - 整合 `yfinance` 批次抓取技術指標，利用多執行緒提升 Workflow 執行速度。

### v11.14 (2026-05-12)
**UI 介面大改版：左側側邊欄 (Sidebar) + Scout 子選單導航**
- **全新左側導航 (Left Sidebar)**：
  - 捨棄頂部導覽列，改用現代化的左側側邊欄，提升操作空間與專業感。
  - **智慧狀態記憶**：自動記錄側邊欄收合狀態，並根據目前所在頁面自動標註選取項目。
  - **響應式設計**：在手機端自動轉為底部/側邊抽屜模式，優化移動端體驗。
- **Scout 市場雷達深度導航**：
  - 新增 Scout 子選單，支援一鍵跳轉至「法人籌碼」、「漲跌幅榜」、「量價異常」、「籌碼集中」、「月營收 YoY」及「大戶布局」等六大分析區塊。
- **共用模組化**：
  - 實裝 `js/sidebar.js` 統一管理全站導覽邏輯，大幅簡化後續頁面維護成本。

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

### 3. 每月營收異常判定 (Monthly Revenue Anomaly)
根據每月營收趨勢，系統會自動歸類異常狀態並標記徽章：
- **🔥 surge**: YoY ≥ 20% 且 MoM > 0，代表成長動能強勁。
- **🚀 surge (極端)**: YoY ≥ 50%，提醒潛在一次性入帳風險。
- **📉 decline**: YoY ≤ -20% 或 (MoM ≤ -15% 且 YoY < 0)，代表營收大幅萎縮。
- **📈 watch_positive**: YoY 15~20%，屬於潛在轉強觀察區。

這些異常資料會優先送入 AI Prompt 產出 `revenue_summary` 報告。

MIT License
