# v10.3 更新規格書 (2026-04-15)

---

## 需求 1：三大法人籌碼動向 — 金額格式化 + 5 日趨勢圖

### 現狀問題
- 金額顯示為 `55,710,101,810 元`，數字太長不易閱讀
- 只有單日數據，無法看出趨勢

### 改動規格

#### 1-A. 金額人性化格式
```
改前：55,710,101,810 元
改後：557.1 億
改前：-9,125,690,819 元
改後：-91.3 億
改前：-584,601,802 元
改後：-5.8 億
```
**規則：**
- `>= 1 億` → 顯示 `XX.X 億`
- `>= 1 萬` → 顯示 `XX.X 萬`
- 其他 → 原數字

**改動檔案：** `js/app.js` 第 143-159 行
- 新增 `formatTWCurrency(value)` 工具函式
- 在 `renderChipData` 渲染時呼叫

#### 1-B. 5 日法人進出趨勢長條圖
在三大法人區塊下方，新增**近 5 個交易日**的水平長條圖。

**資料來源（累積式，不重複抓 API）：**
- `fetch_all.py` main() 最後，把當日 chips 數據 append 進 `data/chip_history.json`
- 每次只寫入一筆，保留最近 10 天，不需額外 API 呼叫
- 格式：`[{"date":"20260415","外資":55710101810,"投信":-9125690819,"自營商":-5391142367}, ...]`

**前端：純 CSS 長條圖，不需任何外部套件**

**前端設計：**
```
外資  ████████████ +557.1億  ← 紅色長條(買超)
      ██████████   +412.3億
      ████         +98.5億
      ████████████████ -320.1億  ← 綠色長條(賣超)
      ████████     -180.2億
      
投信  ██ +18.2億
      ██████ -91.3億
      ...
```
- 每日一條，共 5 條
- 紅色 = 買超，綠色 = 賣超（台股慣例）
- 左側標籤：日期（04/15、04/14...）
- 右側數字：格式化金額

**改動檔案：**
| 檔案 | 改動 |
|------|------|
| `scripts/fetch_all.py` | 新增 `fetch_chip_history()`，呼叫 TWSE `BFI82U` API 連續 5 日 |
| `js/app.js` | 新增 `renderChipChart()` 用 CSS 長條圖渲染 5 日資料 |
| `css/style.css` | 新增 `.chip-chart-bar` 等樣式 |

---

## 需求 2：AI 快報標題依時段動態切換

### 現狀問題
- 後端 `ai_analyzer.py` 已改好時段邏輯（早安/盤中/午安/晚安）
- 前端 `news.html` 和 `js/news.js` 仍寫死「☀ 晨間 AI 財經快報」和「每日 08:00 更新」

### 改動規格

**後端已傳的新欄位（ai_analyzer.py 上一版已加）：**
```json
{
  "session": "morning" | "midday" | "afternoon" | "evening",
  "show_name": "台股早安" | "台股盤中快訊" | "台股午安" | "台股晚安"
}
```

**前端需改動：**

| 時段 session | 標題 | icon | badge |
|---|---|---|---|
| `morning` | ☀ 台股早安 | ☀ | 盤前 08:00 |
| `midday` | 📊 台股盤中快訊 | 📊 | 盤中 10:00 |
| `afternoon` | 🌤 台股午安 | 🌤 | 收盤 14:30 |
| `evening` | 🌙 台股晚安 | 🌙 | 盤後 18:00 |

**改動檔案：**
| 檔案 | 改動 |
|------|------|
| `news.html` 第 32-33 行 | 把寫死的 `<h2>` 和 `<span>` 改為動態 ID，由 JS 填入 |
| `js/news.js` `renderDigest()` | 讀取 `data.session` 和 `data.show_name`，動態設定標題和 badge |

**具體改法：**
```html
<!-- news.html 改為 -->
<h2 id="digestTitle">載入中...</h2>
<span class="digest-badge" id="digestBadge"></span>
```
```javascript
// js/news.js renderDigest() 開頭加入：
const sessionMap = {
    morning:   { icon: '☀', badge: '盤前 08:00' },
    midday:    { icon: '📊', badge: '盤中 10:00' },
    afternoon: { icon: '🌤', badge: '收盤 14:30' },
    evening:   { icon: '🌙', badge: '盤後 18:00' },
};
const s = sessionMap[data.session] || sessionMap.morning;
document.getElementById('digestTitle').textContent = `${s.icon} ${data.show_name || '台股早安'}`;
document.getElementById('digestBadge').textContent = s.badge;
```

---

## 需求 3：自選股三大法人進出（個股級別）

### 現狀問題
- 目前個股只有「籌碼集中度」（量價推算的代理指標）
- 沒有真正的外資/投信/自營商買賣超數據

### API 調查結果

**TWSE 有完整的個股法人買賣超 API（免費、直接 JSON）：**

| 法人 | API URL | 格式 |
|------|---------|------|
| 外資 | `https://www.twse.com.tw/fund/TWT38U?response=json&date=YYYYMMDD` | JSON |
| 投信 | `https://www.twse.com.tw/fund/TWT44U?response=json&date=YYYYMMDD` | JSON |
| 自營商 | `https://www.twse.com.tw/fund/TWT43U?response=json&date=YYYYMMDD` | JSON |

**回傳格式 (以外資為例)：**
```json
{
  "stat": "OK",
  "date": "20260415",
  "data": [
    ["", "2330", "台積電", "25,000,000", "18,000,000", "7,000,000", "0", "0", "0", "25,000,000", "18,000,000", "7,000,000"],
    // [序號, 代號, 名稱, 外資買, 外資賣, 外資淨買, 陸資買, 陸資賣, 陸資淨買, 合計買, 合計賣, 合計淨買]
  ]
}
```

**不需要額外申請 API Key！** 這是 TWSE 公開資料。

### 改動規格

#### 3-A. 後端抓取（fetch_all.py）

新增 `fetch_stock_institutional(symbols)` 函式：
```python
def fetch_stock_institutional(symbols):
    """抓取自選股的三大法人買賣超（外資 + 投信 + 自營商）"""
    # 1. 透過 Worker 代理呼叫 TWSE API（或直接呼叫 OpenAPI）
    # 2. 抓取當日 + 過去 4 個交易日 = 共 5 日
    # 3. 對每支自選股過濾出數據
    # 回傳格式：
    return {
        "2330.TW": {
            "foreign": {
                "today": 7000000,         # 今日外資淨買(股)
                "5d_total": 35000000,     # 5日累計
                "history": [7000000, 5000000, 8000000, 10000000, 5000000]  # 近5日
            },
            "trust": {
                "today": -2000000,
                "5d_total": -8000000,
                "history": [-2000000, -1000000, -3000000, 0, -2000000]
            },
            "dealer": {
                "today": 1000000,
                "5d_total": 3000000,
                "history": [1000000, 500000, 500000, 0, 1000000]
            },
            "total_today": 6000000,       # 三大法人合計今日
            "total_5d": 30000000          # 三大法人合計5日
        }
    }
```

**呼叫方式（2 種方案擇一）：**
- **方案 A（推薦）：** 直接從 GitHub Actions 呼叫 TWSE API（OpenAPI 全球可存取）
- **方案 B：** 透過 Worker 代理（若直接呼叫被擋）

**RPM 注意：** 3 個 API × 5 天 = 15 次呼叫，每次間隔 3 秒 = 約 45 秒完成

#### 3-B. Worker proxy 新增 targets（若需方案 B）

```javascript
case 'chip-foreign':   // TWT38U
case 'chip-trust':     // TWT44U  
case 'chip-dealer':    // TWT43U
```

#### 3-C. 資料存入 raw_data.json

```json
{
  "watchlist": {
    "2330.TW": {
      "symbol": "2330.TW",
      "price": 1050,
      "institutional": {  // ← 新增
        "foreign": { "today": 7000000, "5d_total": 35000000, "history": [...] },
        "trust": { "today": -2000000, "5d_total": -8000000, "history": [...] },
        "dealer": { "today": 1000000, "5d_total": 3000000, "history": [...] },
        "total_today": 6000000,
        "total_5d": 30000000
      }
    }
  }
}
```

#### 3-D. 前端渲染（watchlist.js）

**Stock Card 卡片上（簡要版）：**
```
🏛 三大法人：+600 張 (5日累計 +3,000 張)
   外資 +500 | 投信 +80 | 自營 +20
```
- 數量單位：**張**（股數 ÷ 1000）
- 顏色：買超紅色、賣超綠色

**Stock Modal 詳細頁（展開版）：**
- 5 日法人進出長條圖（同需求 1 的設計）
- 分外資/投信/自營商三層

#### 3-E. 金額/股數格式化

```javascript
// 股數 → 張數，人性化
function formatShares(shares) {
    const lots = Math.round(shares / 1000);  // 股→張
    if (Math.abs(lots) >= 10000) return `${(lots / 10000).toFixed(1)} 萬張`;
    if (Math.abs(lots) >= 1000)  return `${(lots / 1000).toFixed(1)} 千張`;
    return `${lots} 張`;
}
// 例：35,000,000 股 → "3.5 萬張"
// 例：7,000,000 股 → "7,000 張" → "7 千張"
```

---

## 改動檔案總覽

| 檔案 | 需求 | 改動內容 |
|------|------|---------|
| `scripts/fetch_all.py` | 1-B, 3-A | 新增 `fetch_chip_history(5)` + `fetch_stock_institutional()` |
| `worker/index.js` | 3-B | 新增 `chip-foreign/trust/dealer` targets (optional) |
| `js/app.js` | 1-A, 1-B | 金額格式化 + 5 日法人長條圖 |
| `js/news.js` | 2 | 動態標題/badge 依時段切換 |
| `news.html` | 2 | 標題和 badge 改為動態 ID |
| `js/watchlist.js` | 3-D | 卡片顯示法人買賣超 + Modal 5 日圖 |
| `css/style.css` | 1-B, 3-D | 長條圖 CSS 樣式 |

---

## API 費用 / 限制

| 資源 | 免費額度 | 本專案用量 | 狀態 |
|------|---------|-----------|------|
| TWSE BFI82U (三大法人日報) | 無限制 | 5 次/排程 | ✅ 免費 |
| TWSE TWT38U (外資個股) | 無限制 | 5 次/排程 | ✅ 免費 |
| TWSE TWT44U (投信個股) | 無限制 | 5 次/排程 | ✅ 免費 |
| TWSE TWT43U (自營商個股) | 無限制 | 5 次/排程 | ✅ 免費 |

**不需要新增任何 API Key！所有資料來自 TWSE 公開 API。**

---

## 預估工時

| 項目 | 預估時間 |
|------|---------|
| 需求 1 (金額格式化 + 5 日圖) | ~15 分鐘 |
| 需求 2 (快報標題動態化) | ~5 分鐘 |
| 需求 3 (個股法人進出) | ~25 分鐘 |
| **合計** | **~45 分鐘** |
