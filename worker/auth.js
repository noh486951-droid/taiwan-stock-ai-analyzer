/**
 * worker/auth.js — v12 帳號系統 (Stage 1)
 *
 * 提供：
 *   - PBKDF2-SHA256 密碼 hash / verify
 *   - HS256 JWT 簽章 / 驗證
 *   - Google ID token 驗證
 *   - 註冊 / 登入 / 刷新 / 登出 / 我 / 修改 / 刪除帳號
 *   - 從舊暱稱遷移到新帳號
 *
 * KV schema：
 *   user:{user_id}            → profile
 *   user_email:{email_lower}  → { user_id }   (反查)
 *   user_google:{google_sub}  → { user_id }   (反查)
 *   session:{jti}             → { user_id, exp }  (refresh token 撤銷追蹤)
 *
 * 必設 secrets：
 *   JWT_SECRET             — 64-byte hex 字串（openssl rand -hex 32）
 *   GOOGLE_OAUTH_CLIENT_ID — Google Cloud Console 拿到的 Client ID
 */

// ============================================================
// PBKDF2-SHA256 密碼 hashing
// ============================================================

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH_LEN = 32;    // bytes = 256 bits
const PBKDF2_SALT_LEN = 16;    // bytes

function _bufToHex(buf) {
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
function _hexToBuf(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0) throw new Error('bad hex');
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) {
        arr[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return arr.buffer;
}
function _b64urlEncode(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
}

export async function hashPassword(password) {
    if (!password || typeof password !== 'string') throw new Error('password required');
    const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_LEN));
    const enc = new TextEncoder().encode(password);
    const key = await crypto.subtle.importKey('raw', enc, { name: 'PBKDF2' }, false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        key,
        PBKDF2_HASH_LEN * 8,
    );
    return {
        salt: _bufToHex(salt),
        hash: _bufToHex(derived),
        iterations: PBKDF2_ITERATIONS,
    };
}

export async function verifyPassword(password, stored) {
    if (!stored || !stored.salt || !stored.hash) return false;
    const enc = new TextEncoder().encode(password);
    const key = await crypto.subtle.importKey('raw', enc, { name: 'PBKDF2' }, false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: new Uint8Array(_hexToBuf(stored.salt)),
            iterations: stored.iterations || PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        key,
        PBKDF2_HASH_LEN * 8,
    );
    // 常數時間比對
    const a = new Uint8Array(derived);
    const b = new Uint8Array(_hexToBuf(stored.hash));
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

// ============================================================
// JWT HS256
// ============================================================

const ACCESS_TTL_SEC = 3600;          // 1 hour
const REFRESH_TTL_SEC = 30 * 86400;   // 30 days

async function _hmacSign(secret, data) {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return _b64urlEncode(sig);
}

async function _hmacVerify(secret, data, signature) {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['verify'],
    );
    return crypto.subtle.verify('HMAC', key, _b64urlDecode(signature), new TextEncoder().encode(data));
}

export async function signJwt(payload, secret, ttlSec = ACCESS_TTL_SEC) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const body = { ...payload, iat: now, exp: now + ttlSec };
    const hB = _b64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
    const bB = _b64urlEncode(new TextEncoder().encode(JSON.stringify(body)));
    const data = `${hB}.${bB}`;
    const sig = await _hmacSign(secret, data);
    return `${data}.${sig}`;
}

export async function verifyJwt(token, secret) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB, bB, sig] = parts;
    const ok = await _hmacVerify(secret, `${hB}.${bB}`, sig);
    if (!ok) return null;
    try {
        const body = JSON.parse(new TextDecoder().decode(_b64urlDecode(bB)));
        const now = Math.floor(Date.now() / 1000);
        if (body.exp && body.exp < now) return null;
        return body;
    } catch {
        return null;
    }
}

// ============================================================
// 工具
// ============================================================

function _uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // fallback
    const a = crypto.getRandomValues(new Uint8Array(16));
    a[6] = (a[6] & 0x0f) | 0x40;
    a[8] = (a[8] & 0x3f) | 0x80;
    return _bufToHex(a).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

function _jsonResp(obj, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
    });
}

function _err(msg, status = 400, code = null) {
    return _jsonResp({ error: msg, code }, status);
}

function _normalizeEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
    return e;
}

function _validatePassword(pw) {
    if (!pw || typeof pw !== 'string') return '密碼必填';
    if (pw.length < 8) return '密碼至少 8 字元';
    if (pw.length > 200) return '密碼過長';
    return null;
}

function _validateDisplayName(name) {
    if (!name || typeof name !== 'string') return '顯示名稱必填';
    const t = name.trim();
    if (t.length < 1 || t.length > 30) return '顯示名稱 1-30 字';
    return null;
}

async function _ipRateLimit(ip, prefix, kv, maxPerMinute = 5) {
    // 簡易 KV-based rate limit；不需精準，60s 內滾動
    if (!kv) return true;
    const key = `rl:${prefix}:${ip}`;
    try {
        const val = await kv.get(key, 'json') || { count: 0, start: Date.now() };
        const now = Date.now();
        if (now - val.start > 60000) {
            await kv.put(key, JSON.stringify({ count: 1, start: now }), { expirationTtl: 120 });
            return true;
        }
        val.count++;
        await kv.put(key, JSON.stringify(val), { expirationTtl: 120 });
        return val.count <= maxPerMinute;
    } catch {
        return true;
    }
}

// ============================================================
// 註冊
// ============================================================

export async function handleRegister(req, env) {
    if (!env.JWT_SECRET) return _err('server not configured (no JWT_SECRET)', 500);
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (!await _ipRateLimit(ip, 'reg', env.WATCHLIST_KV, 3)) {
        return _err('rate_limited', 429);
    }
    let body;
    try { body = await req.json(); } catch { return _err('invalid_json', 400); }

    const email = _normalizeEmail(body.email);
    if (!email) return _err('email 格式錯誤', 400);
    const pwErr = _validatePassword(body.password);
    if (pwErr) return _err(pwErr, 400);
    const nameErr = _validateDisplayName(body.display_name);
    if (nameErr) return _err(nameErr, 400);

    // email 重複檢查
    const exist = await env.WATCHLIST_KV.get(`user_email:${email}`, 'json');
    if (exist) return _err('此 email 已註冊', 409, 'EMAIL_EXISTS');

    const userId = _uuid();
    const pwData = await hashPassword(body.password);
    const now = new Date().toISOString();
    const profile = {
        user_id: userId,
        email: body.email.trim(),
        email_lower: email,
        password_hash: pwData.hash,
        password_salt: pwData.salt,
        password_iterations: pwData.iterations,
        google_sub: null,
        display_name: body.display_name.trim(),
        created_at: now,
        updated_at: now,
        email_verified: false,
    };
    await env.WATCHLIST_KV.put(`user:${userId}`, JSON.stringify(profile));
    await env.WATCHLIST_KV.put(`user_email:${email}`, JSON.stringify({ user_id: userId }));

    const tokens = await _issueTokens(env, userId, profile, req);
    return _jsonResp({ ok: true, user: _publicUser(profile), ...tokens });
}

// ============================================================
// 登入
// ============================================================

export async function handleLogin(req, env) {
    if (!env.JWT_SECRET) return _err('server not configured', 500);
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (!await _ipRateLimit(ip, 'login', env.WATCHLIST_KV, 5)) {
        return _err('rate_limited', 429);
    }
    let body;
    try { body = await req.json(); } catch { return _err('invalid_json', 400); }
    const email = _normalizeEmail(body.email);
    if (!email || !body.password) return _err('email/password 必填', 400);

    const idx = await env.WATCHLIST_KV.get(`user_email:${email}`, 'json');
    if (!idx || !idx.user_id) return _err('email 或密碼錯誤', 401);
    const profile = await env.WATCHLIST_KV.get(`user:${idx.user_id}`, 'json');
    if (!profile) return _err('email 或密碼錯誤', 401);
    if (!profile.password_hash) {
        return _err('此帳號用 Google 登入，請改用 Google 登入', 401, 'USE_GOOGLE');
    }
    const ok = await verifyPassword(body.password, {
        salt: profile.password_salt,
        hash: profile.password_hash,
        iterations: profile.password_iterations,
    });
    if (!ok) return _err('email 或密碼錯誤', 401);

    const tokens = await _issueTokens(env, profile.user_id, profile, req);
    return _jsonResp({ ok: true, user: _publicUser(profile), ...tokens });
}

// ============================================================
// Google OAuth
// ============================================================

async function _verifyGoogleIdToken(idToken, expectedAud) {
    // 不解 JWT 自己驗（Google rotate JWK 麻煩），改打 tokeninfo
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const info = await r.json();
    if (!info || !info.sub) return null;
    if (expectedAud && info.aud !== expectedAud) return null;
    if (info.exp && parseInt(info.exp) < Math.floor(Date.now() / 1000)) return null;
    return info;
}

export async function handleGoogleLogin(req, env) {
    if (!env.JWT_SECRET) return _err('server not configured', 500);
    if (!env.GOOGLE_OAUTH_CLIENT_ID) return _err('Google OAuth not configured', 500);
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (!await _ipRateLimit(ip, 'goog', env.WATCHLIST_KV, 10)) {
        return _err('rate_limited', 429);
    }
    let body;
    try { body = await req.json(); } catch { return _err('invalid_json', 400); }
    if (!body.id_token) return _err('id_token 必填', 400);

    const info = await _verifyGoogleIdToken(body.id_token, env.GOOGLE_OAUTH_CLIENT_ID);
    if (!info) return _err('Google token 驗證失敗', 401);

    // 1. 先找有沒有 google_sub 對應
    let userId = null;
    const gIdx = await env.WATCHLIST_KV.get(`user_google:${info.sub}`, 'json');
    if (gIdx && gIdx.user_id) userId = gIdx.user_id;

    // 2. 沒有 → 看 email 有沒有現成帳號（同 email 自動 link）
    if (!userId && info.email) {
        const emailLower = info.email.toLowerCase();
        const eIdx = await env.WATCHLIST_KV.get(`user_email:${emailLower}`, 'json');
        if (eIdx && eIdx.user_id) {
            userId = eIdx.user_id;
            const prof = await env.WATCHLIST_KV.get(`user:${userId}`, 'json');
            if (prof) {
                prof.google_sub = info.sub;
                prof.email_verified = true;
                prof.updated_at = new Date().toISOString();
                await env.WATCHLIST_KV.put(`user:${userId}`, JSON.stringify(prof));
                await env.WATCHLIST_KV.put(`user_google:${info.sub}`, JSON.stringify({ user_id: userId }));
            }
        }
    }

    // 3. 都沒有 → 自動建立新帳號
    let profile;
    if (!userId) {
        userId = _uuid();
        const now = new Date().toISOString();
        profile = {
            user_id: userId,
            email: info.email || '',
            email_lower: (info.email || '').toLowerCase(),
            password_hash: null,    // Google-only
            password_salt: null,
            password_iterations: null,
            google_sub: info.sub,
            display_name: info.name || (info.email || '').split('@')[0] || 'user',
            created_at: now,
            updated_at: now,
            email_verified: true,   // Google 已驗證
        };
        await env.WATCHLIST_KV.put(`user:${userId}`, JSON.stringify(profile));
        if (info.email) {
            await env.WATCHLIST_KV.put(`user_email:${info.email.toLowerCase()}`, JSON.stringify({ user_id: userId }));
        }
        await env.WATCHLIST_KV.put(`user_google:${info.sub}`, JSON.stringify({ user_id: userId }));
    } else {
        profile = await env.WATCHLIST_KV.get(`user:${userId}`, 'json');
    }

    const tokens = await _issueTokens(env, userId, profile, req);
    return _jsonResp({ ok: true, user: _publicUser(profile), ...tokens });
}

// ============================================================
// Refresh token / Logout
// ============================================================

export async function handleRefresh(req, env) {
    if (!env.JWT_SECRET) return _err('server not configured', 500);
    let body;
    try { body = await req.json(); } catch { return _err('invalid_json', 400); }
    const rt = body.refresh_token;
    if (!rt) return _err('refresh_token 必填', 400);

    const payload = await verifyJwt(rt, env.JWT_SECRET);
    if (!payload || !payload.jti || !payload.sub) return _err('refresh token 無效', 401);

    // 檢查 session 還在不在 KV
    const sess = await env.WATCHLIST_KV.get(`session:${payload.jti}`, 'json');
    if (!sess || sess.user_id !== payload.sub) return _err('session 已撤銷', 401, 'REVOKED');

    const profile = await env.WATCHLIST_KV.get(`user:${payload.sub}`, 'json');
    if (!profile) return _err('使用者不存在', 401);

    // 簽新 access token（不換 refresh token，沿用至過期）
    const accessToken = await signJwt({
        sub: payload.sub,
        email: profile.email,
        name: profile.display_name,
    }, env.JWT_SECRET, ACCESS_TTL_SEC);

    return _jsonResp({ ok: true, access_token: accessToken, user: _publicUser(profile) });
}

export async function handleLogout(req, env) {
    let body;
    try { body = await req.json(); } catch { body = {}; }
    if (body.refresh_token) {
        try {
            const payload = await verifyJwt(body.refresh_token, env.JWT_SECRET || 'x');
            if (payload && payload.jti) {
                await env.WATCHLIST_KV.delete(`session:${payload.jti}`);
            }
        } catch {}
    }
    return _jsonResp({ ok: true });
}

// ============================================================
// /api/me — 需驗 access token
// ============================================================

export async function requireAuth(req, env) {
    const h = req.headers.get('Authorization') || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return { error: _err('missing bearer token', 401, 'NO_AUTH') };
    const payload = await verifyJwt(m[1], env.JWT_SECRET || '');
    if (!payload || !payload.sub) return { error: _err('token 無效或已過期', 401, 'INVALID_TOKEN') };
    const profile = await env.WATCHLIST_KV.get(`user:${payload.sub}`, 'json');
    if (!profile) return { error: _err('使用者不存在', 401, 'USER_GONE') };
    return { payload, profile };
}

export async function handleMe(req, env) {
    const { error, profile } = await requireAuth(req, env);
    if (error) return error;
    return _jsonResp({ ok: true, user: _publicUser(profile) });
}

export async function handleUpdateMe(req, env) {
    const { error, profile } = await requireAuth(req, env);
    if (error) return error;
    let body;
    try { body = await req.json(); } catch { return _err('invalid_json', 400); }

    let dirty = false;
    if (body.display_name !== undefined) {
        const nameErr = _validateDisplayName(body.display_name);
        if (nameErr) return _err(nameErr, 400);
        profile.display_name = body.display_name.trim();
        dirty = true;
    }
    // v12.4.7：可綁定舊暱稱（讓多裝置登入後自動接通舊資料）
    if (body.bound_nickname !== undefined) {
        const bn = String(body.bound_nickname || '').trim();
        if (bn.length > 50) return _err('bound_nickname 過長', 400);
        profile.bound_nickname = bn;
        dirty = true;
    }
    if (body.new_password) {
        const pwErr = _validatePassword(body.new_password);
        if (pwErr) return _err(pwErr, 400);
        // 需要舊密碼驗證（Google-only 帳號可省略，相當於設密碼）
        if (profile.password_hash) {
            if (!body.current_password) return _err('需要 current_password', 400);
            const ok = await verifyPassword(body.current_password, {
                salt: profile.password_salt,
                hash: profile.password_hash,
                iterations: profile.password_iterations,
            });
            if (!ok) return _err('舊密碼錯誤', 401);
        }
        const pwData = await hashPassword(body.new_password);
        profile.password_hash = pwData.hash;
        profile.password_salt = pwData.salt;
        profile.password_iterations = pwData.iterations;
        dirty = true;
    }
    if (dirty) {
        profile.updated_at = new Date().toISOString();
        await env.WATCHLIST_KV.put(`user:${profile.user_id}`, JSON.stringify(profile));
    }
    return _jsonResp({ ok: true, user: _publicUser(profile) });
}

export async function handleDeleteMe(req, env) {
    const { error, profile } = await requireAuth(req, env);
    if (error) return error;
    // 刪除全部資料
    const uid = profile.user_id;
    await env.WATCHLIST_KV.delete(`user:${uid}`);
    if (profile.email_lower) await env.WATCHLIST_KV.delete(`user_email:${profile.email_lower}`);
    if (profile.google_sub) await env.WATCHLIST_KV.delete(`user_google:${profile.google_sub}`);
    await env.WATCHLIST_KV.delete(`watchlist_v2:${uid}`);
    await env.WATCHLIST_KV.delete(`paper_trade_v2:${uid}`);
    return _jsonResp({ ok: true, deleted: true });
}

// ============================================================
// 從舊暱稱遷移
// ============================================================

export async function handleMigrate(req, env) {
    const { error, profile } = await requireAuth(req, env);
    if (error) return error;
    let body;
    try { body = await req.json(); } catch { return _err('invalid_json', 400); }
    const oldNickname = (body.old_nickname || '').trim();
    const editPassword = body.edit_password || '';
    if (!oldNickname) return _err('old_nickname 必填', 400);

    const oldKey = `watchlist:${oldNickname}`;
    const old = await env.WATCHLIST_KV.get(oldKey, 'json');
    if (!old) return _err('找不到舊暱稱資料', 404, 'OLD_NOT_FOUND');

    // 如果舊資料設了共享密碼，要驗證
    if (old.edit_password_hash) {
        // 舊系統用簡單 SHA-256（看 worker/index.js 的 sha256 函式）
        const hashed = await _sha256Hex(editPassword);
        if (hashed !== old.edit_password_hash) {
            return _err('共享密碼錯誤', 401, 'WRONG_OLD_PW');
        }
    }

    // 把舊資料的欄位搬到新 watchlist_v2
    const newKey = `watchlist_v2:${profile.user_id}`;
    const newPayload = {
        groups: old.groups || [],
        watchlists: old.watchlists || {},
        news_tracking: old.news_tracking || [],
        positions: old.positions || {},
        trade_log: old.trade_log || [],
        leaderboard_opt_in: !!old.leaderboard_opt_in,
        migrated_from: oldNickname,
        migrated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    await env.WATCHLIST_KV.put(newKey, JSON.stringify(newPayload));

    return _jsonResp({
        ok: true,
        migrated_from: oldNickname,
        stocks: Object.values(old.watchlists || {}).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0),
        trades: (old.trade_log || []).length,
    });
}

async function _sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return _bufToHex(hash);
}

// ============================================================
// 共用
// ============================================================

async function _issueTokens(env, userId, profile, req) {
    const jti = _uuid();
    const accessToken = await signJwt({
        sub: userId,
        email: profile.email,
        name: profile.display_name,
    }, env.JWT_SECRET, ACCESS_TTL_SEC);
    const refreshToken = await signJwt({
        sub: userId,
        jti,
    }, env.JWT_SECRET, REFRESH_TTL_SEC);

    // session 寫進 KV 供 revoke
    const ua = req.headers.get('User-Agent') || '';
    const uaHash = (await _sha256Hex(ua)).slice(0, 16);
    await env.WATCHLIST_KV.put(`session:${jti}`, JSON.stringify({
        user_id: userId,
        ua_hash: uaHash,
        created_at: new Date().toISOString(),
        exp: Math.floor(Date.now() / 1000) + REFRESH_TTL_SEC,
    }), { expirationTtl: REFRESH_TTL_SEC + 60 });

    return {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TTL_SEC,
    };
}

function _publicUser(profile) {
    return {
        user_id: profile.user_id,
        email: profile.email,
        display_name: profile.display_name,
        email_verified: !!profile.email_verified,
        has_password: !!profile.password_hash,
        has_google: !!profile.google_sub,
        created_at: profile.created_at,
        // v12.4.7：綁定的舊暱稱（給前端自動接通 watchlist:{nickname} 用）
        bound_nickname: profile.bound_nickname || '',
    };
}
