import os

readme_path = 'README.md'

with open(readme_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Normalize line endings to LF for easier replacement, then write back with CRLF if needed
# Actually Python handles \r\n automatically on write if opened with 'w' or we can just keep LF.
content_lf = content.replace('\r\n', '\n')

# 1. Replace the misplaced changelog block under 🌟 核心功能
# We search for the start of the misplaced changelog and the end of it
start_anchor = "### v12.2.6 (2026-06-03)"
end_anchor = """- **數據透視強化**：
  - **營收 YoY 動態顯示**：在自選股診斷中更直觀地整合「營收年增率」數據。
  - **大戶持股 Top 追蹤**：實裝「大戶持股比例變化」追蹤機制。"""

new_features = """- **首次使用 Onboarding 引導與 PWA 支援 (v11.14.15)**: 實裝 8 步 spotlight 遮罩引導（`onboarding.js`）與 PWA 漸進式 Web 應用安裝引導（`pwa_install.js`），偵測設備並引導手機用戶安裝為桌面應用，提升首頁使用質感。
- **交易戰績儀表板與跨用戶/AI 排行榜 (v11.14.11)**: 提供自選持倉一鍵出場結算與損益歷史記錄；自選股頂部新增 8 格戰績儀表板；新增獨立 `leaderboard.html` 排行榜，支持獲利/勝率等 4 大維度排名，並讓 AI 機器人自動參賽，開放用戶隱私選擇。
- **自選股持倉成本管理與 AI 精準建議 (v11.14.9)**: 支援填入「投資總額」並自動推算每股平均成本，卡片即時顯示浮動損益%及金額；手動點擊「AI 建議」即時結合技術面、基本面與籌碼數據給出精確操作動作（加碼/續抱/減碼/停利/停損）。
- **v12 全新帳號與認證系統 (v12.0)**: 導入 Google OAuth 2.0 與 Email/Password 雙軌註冊登入方案，支援 JWT (JSON Web Token) 簽章認證、30天登入免重登與跨分頁同步登出保護，保障模擬交易部位與自選股隱私。
- **系統介紹與操作手冊 (v12.0.3)**: 內建系統介紹頁面 `system_intro.html` 與詳細的操作手冊 `system_manual.html`，引導新用戶快速上手。
- **受控左側交易與勝率分組 (v12.2)**: 支援受控左側交易機制（逢低抄底）與左右側勝率分組，並於持倉卡片加入左右側交易屬性徽章標註。"""

# Find the block and replace it
if start_anchor in content_lf and end_anchor in content_lf:
    idx_start = content_lf.find(start_anchor)
    idx_end = content_lf.find(end_anchor) + len(end_anchor)
    content_lf = content_lf[:idx_start] + new_features + content_lf[idx_end:]
    print("Successfully replaced misplaced changelog block!")
else:
    # If not found, print debug info
    print("Failed to find misplaced changelog anchors!")
    print("start_anchor in content_lf:", start_anchor in content_lf)
    print("end_anchor in content_lf:", end_anchor in content_lf)

# 2. Replace the 技術架構 section
old_arch = """## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | HTML / CSS / JavaScript (Vanilla) |
| **AI 引擎核心** | **Google Gemini 3.1 Flash-Lite** |
| **新聞/快報引擎** | **Groq (Llama-3.3-70B-Versatile)** |
| **分析備援** | **Mistral Small (mistral-small-latest)** |
| **動態後端** | **Cloudflare Workers (KV 資料庫 + API 代理 + 指標運算)** |
| 資料抓取 | Python (yfinance, requests) + **TAIFEX OpenAPI** |
| CI/CD | GitHub Actions (每日 4 次自動執行量能預抓與 AI 分析) |
| 部署 | GitHub Pages + Cloudflare Workers |"""

new_arch = """## 技術架構

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
| 部署 | GitHub Pages + Cloudflare Workers |"""

if old_arch in content_lf:
    content_lf = content_lf.replace(old_arch, new_arch)
    print("Successfully replaced Technical Architecture section!")
else:
    print("Failed to find Technical Architecture section!")

# 3. Replace the 專案結構 section
# Let's find by prefix and suffix of the block
struct_start = "## 專案結構\n\n```\ntaiwan-stock-ai-analyzer/"
struct_end = "└── .github/\n    └── workflows/\n        └── main.yml            # GitHub Actions 排程 (週一至五)\n```"

new_struct = """## 專案結構

```
taiwan-stock-ai-analyzer/
├── index.html                  # 主頁 - 盤勢總覽 + 異常預警 + 美股龍頭連動 + 系統通知
├── news.html                   # 新聞頁 - AI 早安主播快報 + 即時財經新聞
├── watchlist.html              # 自選股頁 - 個股管理 + 支撐壓力與籌碼集中度 + 持倉設定與 AI 建議
├── sectors.html                # 族群頁 - AI 類股熱度 + 10 日資金輪動熱力圖 + 企業行事曆
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
```"""

if struct_start in content_lf and struct_end in content_lf:
    idx_start = content_lf.find(struct_start)
    idx_end = content_lf.find(struct_end) + len(struct_end)
    content_lf = content_lf[:idx_start] + new_struct + content_lf[idx_end:]
    print("Successfully replaced Project Structure section!")
else:
    print("Failed to find Project Structure section!")

# 4. Replace the GitHub Actions 排程 section
old_schedule = """## GitHub Actions 排程

| 時間 (UTC+8) | 用途 |
|------|------|
| 07:00 | 晨間快報 + 盤前分析 |
| 10:00 | 盤中更新 |
| 14:30 | 收盤分析 |
| 18:00 | 盤後總結 |

排程僅於週一至週五執行。也可在 GitHub Actions 頁面手動觸發。"""

new_schedule = """## GitHub Actions 排程

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
> - **Failsafe 雙軌備援**：為防範 GitHub Actions 內建 Cron 排程漏發，Cloudflare Worker 設定了 failsafe 觸發器（每 15 分鐘於 `:02, :17, :32, :47` 執行），透過 `repository_dispatch` 發射信號補漏，確保系統 100% 覆蓋。"""

if old_schedule in content_lf:
    content_lf = content_lf.replace(old_schedule, new_schedule)
    print("Successfully replaced GitHub Actions schedule section!")
else:
    print("Failed to find GitHub Actions schedule section!")

# Write back with CRLF if the original file used CRLF
# We can detect by checking if the original had \r\n
if '\r\n' in content:
    final_content = content_lf.replace('\n', '\r\n')
else:
    final_content = content_lf

with open(readme_path, 'w', encoding='utf-8') as f:
    f.write(final_content)

print("README.md update complete!")
