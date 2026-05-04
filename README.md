# Taiwan Stock AI Analyzer (台股 AI 智慧分析儀)

![Taiwan Stock AI Analyzer](https://img.shields.io/badge/Status-Live-success)
![Version](https://img.shields.io/badge/Version-11.8-blue)
![AI-Powered](https://img.shields.io/badge/AI-Gemini%20%7C%20Groq%20%7C%20Mistral-blueviolet)
![License](https://img.shields.io/badge/License-MIT-green)

一個基於 Gemini 3.1 Flash-Lite 與多模型驅動的台股自動化分析系統。每日自動抓取證交所、期交所與 Yahoo Finance 數據，結合技術指標、三大法人籌碼、融資融券、市場寬度、期貨未平倉與 ADR 連動，產出結構化的 AI 盤勢分析與個股診斷報告。

## 🚀 快速開始

1. **GitHub Pages**: [點此開啟 Web 介面](https://noh486951-e8a.github.io/taiwan-stock-ai-analyzer/) (支援 PWA 客戶端安裝)
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
├── index.html                  # 主頁 - 盤勢總覽 + 異常預警 + 個股快速查詢
├── news.html                   # 新聞頁 - 晨間 AI 快報 + 即時新聞
├── watchlist.html              # 自選股頁 - 個股管理 + 支撐壓力與詳細分析
├── sectors.html                # 族群頁 - AI 族群熱度 + 產業鏈 + 行事曆
├── scout.html                  # 市場雷達頁 - 8 大榜單 + AI Pick 精選 (v11.4 New)
├── paper_trade.html            # 虛擬投資頁 - 帳戶總覽 + 持倉管理 + 自動交易設定
├── manifest.json               # PWA 設定
├── css/
│   └── style.css               # 全域樣式 (黑色系 + 響應式佈局)
├── js/
│   ├── app.js                  # 主頁邏輯 (異常預警 + 指數 + 三大法人)
│   ├── news.js                 # 新聞頁 + 晨間快報邏輯
│   ├── watchlist.js            # 自選股管理 (S/R 計算顯示 + 籌碼集中度)
│   ├── sectors.js              # 族群頁邏輯 (產業鏈渲染 + 行事曆)
│   ├── scout.js                # 市場雷達渲染 + AI Pick 顯示 (v11.4 New)
│   ├── chat.js                 # AI 聊天助手 (Gemini Streaming + 快速指令)
│   └── paper_trade.js          # 虛擬投資與自動交易前端邏輯
├── scripts/
│   ├── fetch_all.py            # 資料抓取 + 指標計算 + 盤勢判定 + 異常偵測
│   ├── ai_analyzer.py          # Gemini AI 盤勢 + 個股 + 族群地圖 + 晨間快報
│   ├── scout.py                # 市場雷達掃描 + AI 選股決策引擎
│   ├── fetch_corporate_events.py # v11.5 抓取法說、配息、股東會等重大事件 (New)
│   ├── us_giants_signal.py     # v11.5 監控美股龍頭與台股供應鏈連動 (New)
│   ├── paper_trade_engine.py   # v11.0 虛擬投資與 v11.5 動態權重交易引擎
│   └── requirements.txt
├── data/
│   ├── raw_data.json           # 原始抓取資料 (含異常預警與 S/R)
│   ├── market_pulse.json       # AI 盤勢分析結果
│   ├── watchlist.json          # 自選股清單
│   ├── watchlist_analysis.json # 自選股 AI 分析結果
│   ├── morning_digest.json     # 晨間 AI 財經快報
│   ├── sector_map.json         # AI 族群分析結果
│   ├── scout_radar.json        # 市場雷達 8 大榜單數據 (v11.4 New)
│   ├── scout_history.json      # 30 日榜單歷史紀錄 (用於連 3 日偵測)
│   ├── ai_picked_watchlist.json # AI 自動精選之 17 檔觀察股
│   ├── events_calendar.json    # 重大事件行事曆 (傳統)
│   └── corp_events.json        # v11.5 企業行事曆 (法說/配息/股東會) (New)
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

詳細的版本更新歷史請參閱 [CHANGELOG.md](CHANGELOG.md)。

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
