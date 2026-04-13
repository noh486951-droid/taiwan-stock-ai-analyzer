/**
 * 台股中文名稱對照表 + 搜尋工具
 * 支援：代碼搜尋、中文名稱搜尋、產業搜尋
 */

const TW_STOCK_MAP = {
    // 半導體
    '2330.TW': '台積電', '2303.TW': '聯電', '2454.TW': '聯發科',
    '3034.TW': '聯詠', '2379.TW': '瑞昱', '3443.TW': '創意',
    '5347.TW': '世界先進', '3529.TW': '力旺', '6488.TW': '環球晶',
    '3661.TW': '世芯-KY', '2344.TW': '華邦電', '2408.TW': '南亞科',
    '6415.TW': '矽力-KY', '6547.TWO': '高端疫苗',
    // 電子代工 / 組裝
    '2317.TW': '鴻海', '4938.TW': '和碩', '2356.TW': '英業達',
    '3231.TW': '緯創', '2301.TW': '光寶科', '2354.TW': '鴻準', '2485.TW': '兆赫',
    // 電腦周邊
    '2357.TW': '華碩', '2382.TW': '廣達', '2353.TW': '宏碁',
    '2376.TW': '技嘉', '2377.TW': '微星', '3008.TW': '大立光',
    '8069.TW': '元太',
    // 網通 / IC設計
    '2345.TW': '智邦', '3037.TW': '欣興', '2327.TW': '國巨',
    '6669.TW': '緯穎', '2395.TW': '研華',
    // 封測 / 記憶體
    '3711.TW': '日月光投控', '3481.TW': '群創', '2409.TW': '友達',
    // 電子零組件
    '2308.TW': '台達電', '2474.TW': '可成',
    // 金融
    '2881.TW': '富邦金', '2882.TW': '國泰金', '2886.TW': '兆豐金',
    '2891.TW': '中信金', '2892.TW': '第一金', '5880.TW': '合庫金',
    '2884.TW': '玉山金', '2885.TW': '元大金', '2880.TW': '華南金',
    '2883.TW': '開發金', '2890.TW': '永豐金', '2887.TW': '台新金',
    '2801.TW': '彰銀', '5871.TW': '中租-KY',
    // 傳產 / 塑化
    '1301.TW': '台塑', '1303.TW': '南亞', '1326.TW': '台化',
    '6505.TW': '台塑化', '2002.TW': '中鋼', '2105.TW': '正新',
    // 航運
    '2603.TW': '長榮', '2609.TW': '陽明', '2615.TW': '萬海',
    // 電信
    '2412.TW': '中華電', '4904.TW': '遠傳', '3045.TW': '台灣大',
    // 食品 / 零售
    '1216.TW': '統一', '2912.TW': '統一超',
    // 其他
    '2207.TW': '和泰車', '9910.TW': '豐泰', '2049.TW': '上銀',
    '2347.TW': '聯強', '6446.TW': '藥華藥',
};

/**
 * 根據輸入查找股票代碼
 * 支援：代碼 (2330)、完整代碼 (2330.TW)、中文名稱 (台積電)
 * @returns {string|null} 完整股票代碼或 null
 */
function searchStock(query) {
    if (!query) return null;
    query = query.trim();

    // 1. 完整代碼 (2330.TW)
    const upper = query.toUpperCase();
    if (TW_STOCK_MAP[upper]) return upper;

    // 2. 純數字代碼 → 自動補 .TW
    if (/^\d{4}$/.test(query)) {
        const sym = query + '.TW';
        if (TW_STOCK_MAP[sym]) return sym;
        // 也試 .TWO (上櫃)
        const symOTC = query + '.TWO';
        if (TW_STOCK_MAP[symOTC]) return symOTC;
        return sym; // 預設上市
    }

    // 3. 中文名稱搜尋（精確）
    for (const [code, name] of Object.entries(TW_STOCK_MAP)) {
        if (name === query) return code;
    }

    // 4. 中文名稱搜尋（模糊）
    for (const [code, name] of Object.entries(TW_STOCK_MAP)) {
        if (name.includes(query) || query.includes(name)) return code;
    }

    // 5. 找不到 → 當作代碼處理
    if (/^\d{4}$/.test(query)) return query + '.TW';
    return upper;
}

/**
 * 取得中文名稱，優先從映射表，其次從資料
 */
function getChineseName(symbol, dataName) {
    return TW_STOCK_MAP[symbol] || dataName || symbol;
}

/**
 * 搜尋建議（輸入時下拉）
 */
function getSearchSuggestions(query) {
    if (!query || query.length < 1) return [];
    query = query.trim().toLowerCase();
    const results = [];

    for (const [code, name] of Object.entries(TW_STOCK_MAP)) {
        const codeNum = code.replace('.TW', '').replace('.TWO', '').toLowerCase();
        if (codeNum.includes(query) || name.toLowerCase().includes(query)) {
            results.push({ code, name });
        }
        if (results.length >= 8) break;
    }
    return results;
}
