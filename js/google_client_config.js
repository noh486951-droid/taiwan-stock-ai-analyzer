// google_client_config.js — Google OAuth Client ID（公開值，可進 git）
//
// 👉 你需要把這裡的字串改成你在 Google Cloud Console 拿到的 Client ID
// 格式：xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
//
// ⚠️ Client ID 是公開的（瀏覽器一定要看到），不是 secret。
//    真正的 secret 是 Client Secret，那個只放在 worker secret 裡（你已經設了）。
//
// 如果你還沒拿到 Client ID，把這行註解掉或留空，Google 登入按鈕就會顯示「未設定」，
// email + 密碼登入仍可用。

window.GOOGLE_OAUTH_CLIENT_ID = '201204042959-dbvcdbt77b21p68busjnd3jolopgmvbk.apps.googleusercontent.com';
