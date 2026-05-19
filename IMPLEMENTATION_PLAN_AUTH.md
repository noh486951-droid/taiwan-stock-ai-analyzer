# v12 帳號註冊登入系統 — 實作方案

> 目標：把目前「暱稱同步」的非正式機制升級成正規的 Email + Google OAuth 帳號系統。
> 預計影響：~600-900 行 code、5-6 個 commit、2-3 天工程量。
> 風險：高（碰到核心架構），需要謹慎 rollout。

## 0. 現況 vs 目標

### 現況（v11.x）
- KV key: `watchlist:{uid}`，uid 就是使用者輸入的暱稱（例「明芳」）
- 沒有密碼也沒有 session — 暱稱就是身份證
- 「共享密碼」(`edit_password_hash`) 是後加的，只擋編輯不擋讀取
- 任何人輸入「明芳」就能看到明芳的自選股
- ai_bot 是個特殊 uid，paper_trade 用

### v12 目標
- 每個使用者 = `{ email, password_hash OR google_sub, display_name, uid }`
- 登入後拿到 JWT（HS256 簽章），瀏覽器存 cookie + localStorage
- 所有 API call 帶 JWT，後端驗證
- 同一個 email 可同時用密碼或 Google OAuth 登入
- 舊 KV 結構保留作備份，新資料寫到新 schema

---

## 1. KV Schema 變更

### 既有（保留）
```
watchlist:{nickname}  → 舊資料，read-only mode 提供備份匯出
ai_bot_portfolio.json → 不動
```

### 新增
```
user:{user_id}         → { email, email_lower, password_hash, password_salt,
                           google_sub, display_name, created_at, updated_at,
                           email_verified }
user_email:{email_lower} → { user_id }   (反查索引)
user_google:{google_sub} → { user_id }   (反查索引)

watchlist_v2:{user_id} → { groups, watchlists, news_tracking, positions,
                           trade_log, leaderboard_opt_in, updated_at }
paper_trade_v2:{user_id} → ...
session:{token_jti}    → { user_id, exp, created_at, user_agent_hash } (用來
                           support revocation；JWT 沒 jti 索引就直接信任 exp)
```

- `user_id` 用 UUID v4（不暴露給 URL，純內部）
- `email_lower` = email.toLowerCase() 用於反查（避免大小寫問題）
- `password_hash` 用 PBKDF2-SHA256（Web Crypto API 原生支援，CF Worker 可用）
  - 100,000 iterations
  - 16-byte random salt per user
  - 32-byte derived key
- `google_sub` = Google 給的 stable user ID（從 ID token decode）

---

## 2. API 路由設計

### 公開端點（不需 JWT）
```
POST /api/auth/register        → email + password 註冊
POST /api/auth/login           → email + password 登入
POST /api/auth/google          → Google ID token 換 JWT（OAuth one-tap）
POST /api/auth/forgot-password → 寄 magic link（v12.1 加，先不做）
POST /api/auth/refresh         → 用 refresh token 換新 access token
```

### 需要 JWT 的端點
```
GET  /api/me                   → 拿目前使用者資訊
POST /api/me/update            → 更新 display_name 等
DELETE /api/me                 → 刪除帳號 + 所有資料

GET  /api/watchlist            → 改吃 watchlist_v2:{user_id}
POST /api/watchlist
... (其他 paper_trade / leaderboard 同步路由)
```

### 過渡期端點
```
POST /api/auth/migrate         → 用「舊暱稱 + 暱稱共享密碼」匯入到新帳號
                                 （只在註冊後 30 天內可用）
GET  /api/admin/export-all     → admin 匯出所有舊用戶資料給通知（一次性）
```

---

## 3. JWT 設計

### Access Token
- 有效期：1 hour
- payload: `{ sub: user_id, email, name, iat, exp }`
- 簽章：HS256（CF Worker secret `JWT_SECRET`，64-byte 隨機字串）
- 存在前端 localStorage `tw_jwt_access`

### Refresh Token
- 有效期：30 days
- payload: `{ sub: user_id, jti: random, iat, exp }`
- 存在 KV `session:{jti}` 才認可（支援 logout 撤銷）
- 存在 cookie httpOnly + secure + sameSite=lax

### 流程
```
登入 → 回 { access_token, refresh_token, user }
         ↓
       access_token 過期前：每次 API call 帶 Authorization: Bearer <token>
         ↓
       access_token 過期：用 refresh_token 打 /api/auth/refresh
         ↓
       refresh_token 也過期 → 強制重新登入
```

---

## 4. 前端 UI 改動

### 新增頁面
```
auth.html        → 登入 / 註冊 切換式表單
                   - email + password
                   - "用 Google 登入" 按鈕（Google Identity Services SDK）
                   - "從舊暱稱匯入" 連結
account.html     → 帳號設定（修改 display_name、密碼、刪除帳號）
migrate.html     → 舊用戶輸入舊暱稱 + 共享密碼 → 一鍵匯入
```

### 既有頁面修改
```
所有頁面：
  - 改 sidebar 加「👤 登入 / 我的帳號」入口
  - 加 JWT 攔截器（fetch wrapper 自動帶 Authorization header）
  - 401 自動跳 auth.html

watchlist.html / paper_trade.html / leaderboard.html：
  - 移除「請輸入暱稱」UI，改成「請先登入」+ 導 auth.html
  - 同步 API call 改帶 JWT 而非 uid+token
```

### JS 模組
```
js/auth.js       → 新增。封裝 login / register / logout / refresh / getUserInfo
js/api_client.js → 新增。統一 fetch wrapper（自動帶 JWT、自動 refresh）
js/watchlist.js  → 改用 api_client 而非直接 fetch
... 同上其他
```

---

## 5. Google OAuth 設定

### 一次性設定（你要做的）
1. 開 https://console.cloud.google.com/
2. 建立專案 `taiwan-stock-ai`
3. 啟用 **Google+ API** 或 **Google Identity Services**
4. 建立 OAuth 2.0 Client ID（Web application）：
   - **Authorized JavaScript origins**: `https://noh486951-droid.github.io`
   - **Authorized redirect URIs**: 不用（用 popup mode）
5. 拿到 Client ID（格式：`xxxxx.apps.googleusercontent.com`）
6. 寫進 `worker/wrangler.toml` 註解，並 deploy 時當 secret：
   ```
   GOOGLE_OAUTH_CLIENT_ID=xxxxx.apps.googleusercontent.com
   ```

### Worker 驗證流程
1. 前端用 Google Identity Services 拿到 `id_token`（JWT）
2. POST 到 `/api/auth/google` 帶 `{ id_token }`
3. Worker fetch `https://oauth2.googleapis.com/tokeninfo?id_token=...` 驗證
4. 回應的 `sub` (Google user ID) + `email` + `name` 拿來建立 / 查找使用者
5. 簽出我們自己的 JWT 回給前端

---

## 6. 安全考量

### 一定要做
- ✅ 密碼用 PBKDF2-SHA256 hash（不存明文，不用 MD5/SHA1）
- ✅ HTTPS only（CF Workers + GH Pages 都是）
- ✅ Rate limit /api/auth/login（5 次/分鐘/IP，已有 helper）
- ✅ JWT secret 用 ≥ 32 byte 隨機（`openssl rand -hex 32`）
- ✅ refresh token 必須在 KV 才認可（防止 token 被偷後永久使用）
- ✅ 密碼最少 8 字元
- ✅ Google id_token 必須驗 audience = 我們的 Client ID
- ✅ logout 把 session:{jti} 刪掉

### 暫時跳過（v12.1 再加）
- 🟡 Email 驗證（寄信）— 需要 email service，先讓使用者 OAuth
- 🟡 2FA — 對普通使用者太重
- 🟡 密碼複雜度檢查 — 8 字元已夠，剩下用 zxcvbn 太重

---

## 7. Rollout 計畫

### Stage 1：後端準備（不影響現有用戶）
1. 加新 KV schema (user:*, watchlist_v2:*)
2. 加 /api/auth/* 端點
3. 加 JWT 簽發/驗證 helper
4. **舊端點維持不變**

### Stage 2：前端準備（雙模式並存）
1. 新增 auth.html / account.html / migrate.html
2. js/auth.js / js/api_client.js
3. 既有頁面：**沒登入時走舊暱稱模式，登入後走新 JWT 模式**
4. 用 banner 通知舊用戶：「本服務將於 N 日後停止暱稱模式，請註冊帳號」

### Stage 3：強制遷移（你決定 N=多少天）
1. 用 export-all 工具產生所有舊用戶的備份 .txt（已有）
2. 透過 Discord / 主頁 banner 通知舊用戶
3. 給 30 天遷移期
4. 30 天後關閉舊暱稱寫入（讀取還可以查 1 個月供舊用戶手動匯入）
5. 60 天後完全關閉舊端點

### Stage 4：清理
- 刪除舊 KV (watchlist:*)
- 移除舊端點 code
- 文件更新

---

## 8. 預估工作量

| 階段 | 內容 | 工時 |
|---|---|---|
| Stage 1 後端 | KV schema + 註冊/登入/Google OAuth/JWT | 6-8h |
| Stage 2 前端 | auth.html + js/auth.js + 既有頁面整合 | 6-8h |
| Stage 3 遷移工具 | migrate.html + Discord 通知 + banner | 2-3h |
| 測試 | 各路徑 e2e（註冊、登入、OAuth、忘記密碼跳過、過期 refresh）| 3-4h |
| 文件 + commit | README 更新、CHANGELOG、wrangler 註解 | 1-2h |

**總計：18-25 小時，分 2-3 天**

---

## 9. 你現在要做的事

1. **看完這份方案**，把不同意 / 不確定的點圈起來
2. **決定 Stage 3 的遷移期長度**（建議 30-60 天）
3. **準備 Google OAuth Client ID**（5 分鐘的事）
4. **告訴我可以開動了，從 Stage 1 開始**

---

## 10. 開放問題

- ❓ 要不要支援匿名訪客（不登入也能用某些功能，例如看市場雷達）？
- ❓ 要不要支援多帳號切換（同瀏覽器多 session）？
- ❓ 排行榜的 nickname 顯示要用 email 還是 display_name？
- ❓ 老用戶匯入時，「明芳」這個 display_name 要 reserve 嗎，避免別人搶註？

這些可以暫緩到方案被通過之後再決定。
