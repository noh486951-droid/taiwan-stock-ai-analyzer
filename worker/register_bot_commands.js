/**
 * 註冊 Discord Bot Slash Commands
 *
 * 用法：
 *   1. 設好環境變數（在 shell 裡 export）：
 *      export DISCORD_BOT_APPLICATION_ID="你的 Application ID"
 *      export DISCORD_BOT_TOKEN="你的 Bot Token"
 *   2. 跑：
 *      node worker/register_bot_commands.js
 *
 * 改 commands 後重跑此檔案即可（Discord 端會更新）
 */

const APP_ID = process.env.DISCORD_BOT_APPLICATION_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !TOKEN) {
    console.error('❌ 缺 DISCORD_BOT_APPLICATION_ID 或 DISCORD_BOT_TOKEN 環境變數');
    process.exit(1);
}

const COMMANDS = [
    {
        name: 'portfolio',
        description: '顯示我的虛擬投資帳戶（持倉、現金、勝率）',
    },
    {
        name: 'quote',
        description: '查個股報價 + AI 判讀（限自選股庫）',
        options: [{
            name: 'symbol',
            description: '股票代碼（例 2330 / 0050 / 1513）',
            type: 3,   // STRING
            required: true,
        }],
    },
    {
        name: 'scout',
        description: '今日 AI 雷達精選 Top 10',
    },
    {
        name: 'macro',
        description: '未來 7 天總經事件（FOMC / CPI / 財報）',
    },
    {
        name: 'sector',
        description: '今日強弱族群排行',
    },
    {
        name: 'consult',
        description: 'AI 持倉諮詢（提示用網頁觸發）',
    },
    {
        name: 'ask',
        description: '自由問 AI（接 Gemini，含市場 context）',
        options: [{
            name: 'question',
            description: '你的問題',
            type: 3,
            required: true,
        }],
    },
];

async function main() {
    const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
    const r = await fetch(url, {
        method: 'PUT',  // PUT 會「全部蓋過去」（清除舊的 + 寫入新的）
        headers: {
            'Authorization': `Bot ${TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(COMMANDS),
    });
    const txt = await r.text();
    if (r.ok) {
        console.log('✅ 註冊成功！');
        console.log(JSON.parse(txt).map(c => `  /${c.name} — ${c.description}`).join('\n'));
    } else {
        console.error(`❌ HTTP ${r.status}: ${txt}`);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
