require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { ethers } = require('ethers');
const solanaWeb3 = require('@solana/web3.js');
const bs58 = require('bs58');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("Please set BOT_TOKEN in .env");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

function sendCommand(ctx, command, arg) {
    const baseMessage = ctx.message || (ctx.callbackQuery && ctx.callbackQuery.message) || {};
    const fakeMessage = { ...baseMessage };
    delete fakeMessage.reply_to_message;
    fakeMessage.text = command + (arg ? ' ' + arg : '');
    fakeMessage.entities = [{ offset: 0, length: command.length, type: 'bot_command' }];
    if (ctx.from) fakeMessage.from = ctx.from;

    return bot.handleUpdate({
        update_id: ctx.update.update_id,
        message: fakeMessage
    });
}

bot.use((ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.reply_to_message && ctx.message.reply_to_message.text) {
        let text = ctx.message.text;
        let replyTxt = ctx.message.reply_to_message.text;
        if (replyTxt.includes('Personal Access Token:')) return sendCommand(ctx, '/settoken', text);
    }
    return next();
});

// Simple user store for GitHub PATs
const usersFile = './users.json';
let userStore = {};
if (fs.existsSync(usersFile)) {
    userStore = JSON.parse(fs.readFileSync(usersFile));
}

function saveUserStore() {
    fs.writeFileSync(usersFile, JSON.stringify(userStore, null, 2));
}

function getGithubToken(ctx) {
    const userId = ctx.from.id;
    if (!userStore[userId] || !userStore[userId].githubToken) {
        throw new Error('GitHub PAT is required. Set it using /settoken <your_github_pat>');
    }
    return userStore[userId].githubToken;
}

// Extract keys matching the extension
// Extract secrets and private keys effectively, ignoring pure public addresses
function extractPotentialKeys(text) {
    if (!text) return [];
    let keys = [];
    const addUnique = (type, val) => {
        if (!keys.some(k => k.type === type && k.value === val)) keys.push({ type, value: val });
    };

    // Private Keys formats
    let evmPk = text.match(/\b([a-fA-F0-9]{64})\b/g);
    let evmPrefixPk = text.match(/\b(0x[a-fA-F0-9]{64})\b/g);
    let solBase58 = text.match(/\b([1-9A-HJ-NP-Za-km-z]{87,88})\b/g);
    let solArray = text.match(/\[\s*\d+\s*(?:,\s*\d+\s*){63}\]/g);

    // Mnemonic / Seed phrases (usually 12-24 words) - basic check
    let mnemonics = text.match(/\b(?:[a-z]{3,10}\s+){11,23}[a-z]{3,10}\b/gi);

    if (evmPk) evmPk.forEach(k => addUnique('EVM_PRIVATE_KEY', k));
    if (evmPrefixPk) evmPrefixPk.forEach(k => addUnique('EVM_PRIVATE_KEY', k.replace('0x', '')));
    if (solBase58) solBase58.forEach(k => addUnique('SOL_PRIVATE_KEY', k));
    if (solArray) solArray.forEach(k => addUnique('SOL_PRIVATE_KEY_ARRAY', k));
    if (mnemonics) mnemonics.forEach(k => addUnique('MNEMONIC', k));

    // Special case for Sui/Aptos: in most repos 64 char hex is usually a key rather than addr
    let suiAptosPotential = text.match(/\b(0x[a-fA-F0-9]{64})\b/g);
    if (suiAptosPotential) suiAptosPotential.forEach(k => addUnique('EVM_PRIVATE_KEY', k.replace('0x', '')));

    return keys;
}

// Convert Keys to Addresses
function getEvmAddressFromKey(hexPrivateKey) {
    if (!hexPrivateKey.startsWith('0x')) hexPrivateKey = '0x' + hexPrivateKey;
    try {
        const wallet = new ethers.Wallet(hexPrivateKey);
        return wallet.address;
    } catch (e) { return null; }
}

function getSolAddressFromKey(key) {
    try {
        let uintArray;
        if (key.startsWith('[')) {
            uintArray = new Uint8Array(JSON.parse(key));
        } else {
            // Sometimes bs58 doesn't decode perfectly if length is bad
            uintArray = bs58.decode(key);
        }
        const keypair = solanaWeb3.Keypair.fromSecretKey(uintArray);
        return keypair.publicKey.toString();
    } catch (e) { return null; }
}

// --- BALANCE CHECKERS ---
const evmRpcs = [
    { name: 'Ethereum', url: 'https://cloudflare-eth.com' },
    { name: 'BSC', url: 'https://bsc-dataseed.binance.org' },
    { name: 'Polygon', url: 'https://polygon-rpc.com' },
    { name: 'Arbitrum', url: 'https://arb1.arbitrum.io/rpc' },
    { name: 'Optimism', url: 'https://mainnet.optimism.io' },
    { name: 'Avalanche', url: 'https://api.avax.network/ext/bc/C/rpc' },
    { name: 'Base', url: 'https://mainnet.base.org' },
    { name: 'zkSync', url: 'https://mainnet.era.zksync.io' },
    { name: 'Mantle', url: 'https://rpc.mantle.xyz' },
    { name: 'Linea', url: 'https://rpc.linea.build' },
    { name: 'Scroll', url: 'https://rpc.scroll.io' },
    { name: 'Blast', url: 'https://rpc.blast.io' },
    { name: 'Fantom', url: 'https://rpc.ftm.tools' },
    { name: 'Cronos', url: 'https://evm.cronos.org' },
    { name: 'Celo', url: 'https://forno.celo.org' },
    { name: 'Gnosis', url: 'https://rpc.gnosischain.com' },
    { name: 'Kava', url: 'https://evm.kava.io' },
    { name: 'Moonbeam', url: 'https://rpc.api.moonbeam.network' },
    { name: 'Moonriver', url: 'https://rpc.api.moonriver.moonbeam.network' },
    { name: 'Klaytn', url: 'https://public-en-cypress.klaytn.net' },
    { name: 'Harmony', url: 'https://api.harmony.one' },
    { name: 'Core', url: 'https://rpc.coredao.org' },
    { name: 'Flare', url: 'https://flare-api.flare.network/ext/C/rpc' },
    { name: 'Astar', url: 'https://evm.astar.network' },
    { name: 'Aurora', url: 'https://mainnet.aurora.dev' },
    { name: 'PulseChain', url: 'https://rpc.pulsechain.com' },
    { name: 'Telos', url: 'https://mainnet.telos.net/evm' },
    { name: 'Velas', url: 'https://evmexplorer.velas.com/rpc' }
];

async function getEvmBalance(address) {
    let balances = [];
    let emptyCount = 0;
    for (let rpc of evmRpcs) {
        try {
            let res = await axios.post(rpc.url, { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }, { timeout: 2000 });
            if (res.data && res.data.result) {
                let bal = (parseInt(res.data.result, 16) / 1e18);
                if (bal > 0) {
                    balances.push(`${rpc.name}: ${bal.toFixed(4)}`);
                } else {
                    emptyCount++;
                }
            } else {
                emptyCount++;
            }
        } catch (e) {
            emptyCount++;
        }
    }
    return { balances, emptyCount };
}

async function getSolBalance(address) {
    try {
        let res = await axios.post('https://api.mainnet-beta.solana.com', { jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }, { timeout: 3000 });
        let bal = (res.data.result.value / 1e9).toFixed(4);
        return `${bal} SOL`;
    } catch (e) { return 'Error'; }
}

async function getBtcBalance(address) {
    try {
        let res = await axios.get(`https://blockchain.info/q/addressbalance/${address}`, { timeout: 3000 });
        let bal = (parseInt(res.data) / 1e8).toFixed(6);
        return `${bal} BTC`;
    } catch (e) { return 'Error'; }
}

async function getSuiBalance(address) {
    try {
        let res = await axios.post('https://fullnode.mainnet.sui.io:443', { jsonrpc: "2.0", id: 1, method: "suix_getBalance", params: [address] }, { timeout: 3000 });
        if (res.data.result && res.data.result.totalBalance) {
            let bal = (parseInt(res.data.result.totalBalance) / 1e9);
            return bal > 0 ? `${bal.toFixed(4)} SUI` : null;
        }
    } catch (e) { }
    return null;
}

async function getAptosBalance(address) {
    try {
        let res = await axios.get(`https://fullnode.mainnet.aptoslabs.com/v1/accounts/${address}/resource/0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>`, { timeout: 3000 });
        if (res.data.data && res.data.data.coin && res.data.data.coin.value) {
            let bal = (parseInt(res.data.data.coin.value) / 1e8);
            return bal > 0 ? `${bal.toFixed(4)} APT` : null;
        }
    } catch (e) { }
    return null;
}

async function getDogeBalance(address) {
    try {
        let res = await axios.get(`https://dogechain.info/api/v1/address/balance/${address}`, { timeout: 3000 });
        if (res.data.success && res.data.balance) {
            let bal = parseFloat(res.data.balance);
            return bal > 0 ? `${bal.toFixed(2)} DOGE` : null;
        }
    } catch (e) { }
    return null;
}

async function getTronBalance(address) {
    try {
        let res = await axios.post(`https://api.trongrid.io/wallet/getaccount`, { address: address, visible: true }, { timeout: 3000 });
        if (res.data && res.data.balance) {
            let bal = (res.data.balance / 1e6);
            return bal > 0 ? `${bal.toFixed(2)} TRX` : null;
        }
    } catch (e) { }
    return null;
}

async function getSolBalance(address) {
    try {
        let res = await axios.post('https://api.mainnet-beta.solana.com', { jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }, { timeout: 3000 });
        let bal = (res.data.result.value / 1e9);
        return bal > 0 ? `${bal.toFixed(4)} SOL` : null;
    } catch (e) { return null; }
}

async function getBtcBalance(address) {
    try {
        let res = await axios.get(`https://blockchain.info/q/addressbalance/${address}`, { timeout: 3000 });
        let bal = (parseInt(res.data) / 1e8);
        return bal > 0 ? `${bal.toFixed(6)} BTC` : null;
    } catch (e) { return null; }
}

// Basic GitHub API fetch
async function githubSearchCode(query, token) {
    let headers = {
        'Accept': 'application/vnd.github.v3.text-match+json',
        'Authorization': `token ${token}`
    };
    try {
        let res = await axios.get(`https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=100`, { headers, timeout: 5000 });
        return res.data;
    } catch (error) {
        if (error.response && error.response.data) throw new Error(error.response.data.message || error.message);
        throw error;
    }
}

function parseTarget(repoInput) {
    let r = repoInput.replace('https://github.com/', '');
    let parts = r.split('/').filter(Boolean);
    if (parts.length === 1) return { type: 'user', name: parts[0] };
    if (parts.length >= 2) return { type: 'repo', name: `${parts[0]}/${parts[1]}` };
    return null;
}

function getMenuConfig(userId) {
    const user = userStore[userId] || {};
    const text = `<b>[ GITHUB SECRETS SCANNER TERMINAL ]</b>
<i>Version 1.0.0</i>

<b>AVAILABLE COMMANDS:</b>
<code>/settoken</code> Configure Access Token
<code>/scan</code> Standard regex scan on repo
<code>/scancommits</code> Scan previous 100 commits
<code>/search</code> Targeted string search
<code>/searchglobal</code> Global string search
<code>/amiexposed</code> Check if secret is leaked globally
<code>/globalhunter</code> Hunt for active EVM keys globally

<b>FILTERS:</b>
<code>/toggle_env</code> Only Search in .env files (Toggle)
<code>/toggle_examples</code> Exclude Examples & Readmes (Toggle)
<code>/setyear</code> Set Year for Commits (e.g. /setyear 2024)
<code>/setmonth</code> Set Month for Commits (01-12)`;

    const envState = user.onlyEnvFiles ? 'ON' : 'OFF';
    const exampleState = !(user.excludeExamples === false) ? 'ON' : 'OFF';
    const yearState = user.selectedYear || 'Any';
    const monthState = user.selectedMonth || 'All';

    return {
        text,
        extra: Markup.inlineKeyboard([
            [Markup.button.callback('[ SCAN REPO ]', 'action_scan_repo'), Markup.button.callback('[ SCAN COMMITS ]', 'action_scan_commits')],
            [Markup.button.callback('[ TARGET SEARCH ]', 'action_search'), Markup.button.callback('[ GLOBAL SEARCH ]', 'action_global')],
            [Markup.button.callback('[ AM I EXPOSED? ]', 'action_amiexposed'), Markup.button.callback('[ GLOBAL HUNTER ]', 'action_globalhunter')],
            [Markup.button.callback(`[ ENV ONLY (${envState}) ]`, 'action_toggle_env'), Markup.button.callback(`[ NO EXAMPLES (${exampleState}) ]`, 'action_toggle_examples')],
            [Markup.button.callback(`[ YEAR: ${yearState} ]`, 'action_change_year'), Markup.button.callback(`[ MONTH: ${monthState} ]`, 'action_change_month')],
            [Markup.button.callback('[ CONFIGURE NEW TOKEN ]', 'action_config')],
            [Markup.button.callback('[ HOW TO GET A TOKEN? ]', 'action_help_token')]
        ])
    };
}

async function refreshMenu(ctx, customConfig = null) {
    const userId = ctx.from.id;
    const config = customConfig || getMenuConfig(userId);
    const user = userStore[userId] || {};

    try {
        if (ctx.callbackQuery && ctx.callbackQuery.message.message_id === user.lastMenuId) {
            await ctx.editMessageText(config.text, { parse_mode: 'HTML', ...config.extra });
        } else if (user.lastMenuId) {
            try {
                await ctx.telegram.editMessageText(ctx.chat.id, user.lastMenuId, null, config.text, { parse_mode: 'HTML', ...config.extra });
            } catch (e) {
                const msg = await ctx.reply(config.text, { parse_mode: 'HTML', ...config.extra });
                userStore[userId].lastMenuId = msg.message_id;
            }
        } else {
            const msg = await ctx.reply(config.text, { parse_mode: 'HTML', ...config.extra });
            userStore[userId].lastMenuId = msg.message_id;
        }
        saveUserStore();
    } catch (e) {
        if (!e.message.includes('not modified')) {
            const msg = await ctx.reply(config.text, { parse_mode: 'HTML', ...config.extra });
            userStore[userId].lastMenuId = msg.message_id;
            saveUserStore();
        }
    }
}

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    const hasToken = userStore[userId].githubToken;

    // Clean up old menu if exists
    if (userStore[userId].lastMenuId) {
        try { await ctx.telegram.deleteMessage(ctx.chat.id, userStore[userId].lastMenuId); } catch (e) { }
    }

    if (!hasToken) {
        const msg = await ctx.reply(`<b>[ GITHUB SECRETS SCANNER TERMINAL ]</b>
<i>Version 1.0.0</i>

[!] <b>INITIALIZATION REQUIRED</b>
You must configure a GitHub Personal Access Token first to use the scanning functionalities. 
This is required to bypass API rate limits.`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('[ CONFIGURE GITHUB TOKEN ]', 'action_config')],
                [Markup.button.callback('[ HOW TO GET A TOKEN? ]', 'action_help_token')]
            ])
        });
        userStore[userId].lastMenuId = msg.message_id;
        saveUserStore();
        return;
    }

    const config = getMenuConfig(userId);
    const msg = await ctx.reply(config.text, { parse_mode: 'HTML', ...config.extra });
    userStore[userId].lastMenuId = msg.message_id;
    saveUserStore();
});

bot.action('action_scan_repo', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('Provide the target repository URL or format "user/repo":', Markup.forceReply());
});

bot.action('action_scan_commits', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('Provide the target repository URL or format "user/repo" for commit history scan:', Markup.forceReply());
});

bot.action('action_search', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('Provide the target (user/repo) and query, separated by a space:', Markup.forceReply());
});

bot.action('action_global', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('Provide the query for global search:', Markup.forceReply());
});

bot.action('action_amiexposed', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('Provide the secret/API key you want to check globally:', Markup.forceReply());
});

bot.action('action_globalhunter', async (ctx) => {
    await ctx.answerCbQuery();
    return sendCommand(ctx, '/globalhunter', '');
});

bot.action('action_toggle_env', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    userStore[userId].onlyEnvFiles = !userStore[userId].onlyEnvFiles;
    saveUserStore();
    return refreshMenu(ctx);
});

bot.action('action_toggle_examples', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    let currentState = userStore[userId].excludeExamples === false ? false : true;
    userStore[userId].excludeExamples = !currentState;
    saveUserStore();
    return refreshMenu(ctx);
});

bot.action('action_change_year', async (ctx) => {
    await ctx.answerCbQuery();
    const config = {
        text: '<b>[ SELECT SCAN YEAR ]</b>\nChoose a year or clear the filter:',
        extra: Markup.inlineKeyboard([
            [Markup.button.callback('2026', 'set_year_2026'), Markup.button.callback('2025', 'set_year_2025')],
            [Markup.button.callback('2024', 'set_year_2024'), Markup.button.callback('2023', 'set_year_2023')],
            [Markup.button.callback('2022', 'set_year_2022'), Markup.button.callback('Clear (Any)', 'set_year_any')],
            [Markup.button.callback('« CANCEL', 'action_back_main')]
        ])
    };
    return refreshMenu(ctx, config);
});

bot.action('action_change_month', async (ctx) => {
    await ctx.answerCbQuery();
    const config = {
        text: '<b>[ SELECT SCAN MONTH ]</b>\nChoose a month or clear the filter:',
        extra: Markup.inlineKeyboard([
            [Markup.button.callback('01', 'set_month_01'), Markup.button.callback('02', 'set_month_02'), Markup.button.callback('03', 'set_month_03')],
            [Markup.button.callback('04', 'set_month_04'), Markup.button.callback('05', 'set_month_05'), Markup.button.callback('06', 'set_month_06')],
            [Markup.button.callback('07', 'set_month_07'), Markup.button.callback('08', 'set_month_08'), Markup.button.callback('09', 'set_month_09')],
            [Markup.button.callback('10', 'set_month_10'), Markup.button.callback('11', 'set_month_11'), Markup.button.callback('12', 'set_month_12')],
            [Markup.button.callback('Clear (All)', 'set_month_all'), Markup.button.callback('« CANCEL', 'action_back_main')]
        ])
    };
    return refreshMenu(ctx, config);
});

bot.action(/set_year_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const val = ctx.match[1];
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    userStore[userId].selectedYear = val === 'any' ? null : val;
    saveUserStore();
    return refreshMenu(ctx);
});

bot.action(/set_month_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const val = ctx.match[1];
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    userStore[userId].selectedMonth = val === 'all' ? null : val;
    saveUserStore();
    return refreshMenu(ctx);
});

bot.action('action_back_main', async (ctx) => {
    await ctx.answerCbQuery();
    return refreshMenu(ctx);
});

bot.action('action_config', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('Provide your GitHub Personal Access Token:', Markup.forceReply());
});

bot.action('action_help_token', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply(`<b>[ HOW TO GET A GITHUB TOKEN? ]</b>\n
1. Go to github.com and login.
2. Go to <b>Settings</b> -> <b>Developer settings</b>.
3. Click <b>Personal access tokens</b> -> <b>Tokens (classic)</b>.
4. Click <b>Generate new token (classic)</b>.
5. Set Expiration to "No expiration".
6. If you want to scan Private Repositories, check the <b>"repo"</b> checkbox. If only Public, leave it empty.
7. Click <b>Generate token</b> at the bottom.
8. Copy the string starting with <code>ghp_...</code> and paste it here using the configuration menu!`, { parse_mode: 'HTML' });
});

bot.command('settoken', (ctx) => {
    const token = ctx.message.text.split(' ')[1];
    if (!token) return ctx.reply('Usage: /settoken <your_github_pat>');
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    userStore[userId].githubToken = token;
    saveUserStore();
    ctx.reply('[SUCCESS] GitHub Token saved successfully!');
    return refreshMenu(ctx);
});

bot.command('toggle_env', (ctx) => {
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    userStore[userId].onlyEnvFiles = !userStore[userId].onlyEnvFiles;
    saveUserStore();
    return refreshMenu(ctx);
});

bot.command('toggle_examples', (ctx) => {
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    let currentState = userStore[userId].excludeExamples === false ? false : true;
    userStore[userId].excludeExamples = !currentState;
    saveUserStore();
    return refreshMenu(ctx);
});

bot.command('setyear', (ctx) => {
    const val = ctx.message.text.split(' ')[1];
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    if (!val || val.toLowerCase() === 'any') {
        userStore[userId].selectedYear = null;
        ctx.reply('[SUCCESS] Commit year filter cleared.');
    } else {
        userStore[userId].selectedYear = val;
        ctx.reply(`[SUCCESS] Commit year filter set to: ${val}`);
    }
    saveUserStore();
    return refreshMenu(ctx, 'filters');
});

bot.command('setmonth', (ctx) => {
    const val = ctx.message.text.split(' ')[1];
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    if (!val || val.toLowerCase() === 'all') {
        userStore[userId].selectedMonth = null;
        ctx.reply('[SUCCESS] Commit month filter cleared.');
    } else {
        userStore[userId].selectedMonth = val.padStart(2, '0');
        ctx.reply(`[SUCCESS] Commit month filter set to: ${userStore[userId].selectedMonth}`);
    }
    saveUserStore();
    return refreshMenu(ctx, 'filters');
});

// Auto-detect tokens pasted directly into the chat without /settoken command and without replying 
bot.hears(/^(ghp_[a-zA-Z0-9]+|github_pat_[a-zA-Z0-9_]+)$/, (ctx) => {
    const token = ctx.message.text.trim();
    const userId = ctx.from.id;
    if (!userStore[userId]) userStore[userId] = {};
    userStore[userId].githubToken = token;
    saveUserStore();
    ctx.reply('[SUCCESS] GitHub Token detected and saved successfully! Type /start to access the menu.');
});

// Auto-detect GitHub repository URLs pasted directly without command/reply
bot.hears(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/i, (ctx, next) => {
    if (ctx.message && ctx.message.reply_to_message) return next(); // Let the general router handle replies
    const url = ctx.message.text.trim().split(/\s+/)[0];
    return sendCommand(ctx, '/scan', url);
});

// Cache for storing results in memory to check balances later
const resultsCache = new Map();

bot.command('scan', async (ctx) => {
    const repoInput = ctx.message.text.split(' ')[1];
    if (!repoInput) return ctx.reply('Usage: /scan <repo_url_or_name>');

    let target = parseTarget(repoInput);
    if (!target) return ctx.reply('Invalid repository format.');

    let token;
    try { token = getGithubToken(ctx); } catch (e) { return ctx.reply(e.message); }

    const userId = ctx.from.id;
    const user = userStore[userId] || {};
    const filtersLabel = `
- Env Only: ${user.onlyEnvFiles ? 'ON' : 'OFF'}
- No Examples: ${!(user.excludeExamples === false) ? 'ON' : 'OFF'}`;

    ctx.reply(`[INFO] Initializing scan sequence for ${target.name}
Scope: ${target.type === 'user' ? 'Geniş (User)' : 'Dar (Repo)'}
Filters Active: ${filtersLabel}
Status: Processing...`);

    let searchScope = target.type === 'user' ? `user:${target.name}` : `repo:${target.name}`;

    let queries = [
        `filename:.env ${searchScope}`, `filename:id_rsa ${searchScope}`, `filename:credentials ${searchScope}`,
        `filename:wp-config.php ${searchScope}`, `filename:database.yml ${searchScope}`, `"mongodb+srv://" ${searchScope}`,
        `"postgres://" ${searchScope}`, `"DATABASE_URL=" ${searchScope}`, `"DB_PASSWORD=" ${searchScope}`,
        `"AKIA" ${searchScope}`, `"sk_live_" ${searchScope}`, `"ghp_" ${searchScope}`, `"xoxb-" ${searchScope}`,
        `"xoxp-" ${searchScope}`, `"NPM_TOKEN=" ${searchScope}`, `"DISCORD_BOT_TOKEN=" ${searchScope}`,
        `"BEGIN PRIVATE KEY" ${searchScope}`, `"PRIVATE_KEY=" ${searchScope}`, `"SECRET_KEY=" ${searchScope}`,
        `"_KEY=" ${searchScope}`, `"_SECRET=" ${searchScope}`, `filename:wallet.dat ${searchScope}`,
        `filename:keystore ${searchScope}`, `"mnemonic" ${searchScope}`, `"seed phrase" ${searchScope}`,
        `"xprv" ${searchScope}`, `"ETH_PRIVATE_KEY=" ${searchScope}`, `"SOLANA_PRIVATE_KEY=" ${searchScope}`,
        `"ALCHEMY_API_KEY=" ${searchScope}`
    ];

    if (user.onlyEnvFiles) {
        queries = queries.map(q => {
            if (!q.includes('filename:')) return `${q} filename:.env`;
            return null;
        }).filter(Boolean); // Only keep queries that were modified to be env specific, drop hardcoded other files
        // Always include basic .env search
        queries.push(`filename:.env ${searchScope}`);
    }

    let allItems = [];
    for (let q of queries) {
        try {
            let data = await githubSearchCode(q, token);
            if (data && data.items) allItems = allItems.concat(data.items);
            await new Promise(r => setTimeout(r, 1500)); // Delay
        } catch (e) {
            if (e.message.includes('auth') || e.message.includes('rate limit')) {
                return ctx.reply(`Auth/RateLimit Error: ${e.message}`);
            }
        }
    }

    let uniqueItems = Array.from(new Map(allItems.map(item => [item.sha, item])).values());
    sendResults(ctx, uniqueItems, "common secrets");
});

async function fetchRepoCommits(repo, token, year, month) {
    let headers = { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${token}` };
    let timeQuery = "";
    if (year) {
        let sinceStr = "";
        let untilStr = "";
        if (month) {
            sinceStr = `${year}-${month}-01T00:00:00Z`;
            let lastDay = new Date(year, parseInt(month), 0).getDate();
            untilStr = `${year}-${month}-${lastDay}T23:59:59Z`;
        } else {
            sinceStr = `${year}-01-01T00:00:00Z`;
            untilStr = `${year}-12-31T23:59:59Z`;
        }
        timeQuery = `&since=${sinceStr}&until=${untilStr}`;
    }
    let req = await axios.get(`https://api.github.com/repos/${repo}/commits?per_page=100${timeQuery}`, { headers });
    return req.data;
}

async function fetchCommitDetails(repo, sha, token) {
    let headers = { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${token}` };
    let req = await axios.get(`https://api.github.com/repos/${repo}/commits/${sha}`, { headers });
    return req.data;
}

bot.command('scancommits', async (ctx) => {
    const repoInput = ctx.message.text.split(' ')[1];
    if (!repoInput) return ctx.reply('Usage: /scancommits <repo_url_or_name>');

    let target = parseTarget(repoInput);
    if (!target || target.type === 'user') return ctx.reply('Valid repository format required (e.g. user/repo).');

    let token;
    try { token = getGithubToken(ctx); } catch (e) { return ctx.reply(e.message); }

    const userId = ctx.from.id;
    const user = userStore[userId] || {};
    const year = user.selectedYear || null;
    const month = user.selectedMonth || null;
    const filtersLabel = `
- Env Only: ${user.onlyEnvFiles ? 'ON' : 'OFF'}
- Year: ${year || 'Any'}
- Month: ${month || 'All'}`;

    ctx.reply(`[INFO] Fetching commit data for ${target.name}
Filters Active: ${filtersLabel}
Status: Communicating with GitHub API...`);

    try {
        let commits = await fetchRepoCommits(target.name, token, year, month);
        if (!commits || commits.length === 0) return ctx.reply(`[INFO] No commits found for ${year}/${month}.`);

        let suspiciousFiles = ['.env', 'id_rsa', 'id_ed25519', 'credentials', 'wp-config.php', 'database.yml', 'wallet.dat', 'keystore'];
        let secretRegexes = [
            /AKIA[0-9A-Z]{16}/,
            /BEGIN (RSA )?PRIVATE KEY/,
            /sk_live_[0-9a-zA-Z]{24,}/,
            /ghp_[0-9a-zA-Z]{36}/,
            /xox[bp]-[0-9a-zA-Z\-]+/,
            /mongodb\+srv:\/\//,
            /postgres:\/\/[^:]+:[^@]+@/,
            /PRIVATE_KEY\s*=\s*['"]?[a-zA-Z0-9]{32,}['"]?/,
            /SECRET_KEY\s*=\s*['"]?[a-zA-Z0-9]{32,}['"]?/,
            /[A-Z0-9_]+_KEY\s*=\s*['"]?[a-zA-Z0-9\-\_]{16,}['"]?/,
            /[a-fA-F0-9]{64}/,
            /[1-9A-HJ-NP-Za-km-z]{87,88}/,
            /mnemonic|seed phrase/i
        ];

        let foundItems = [];
        ctx.reply(`[PROCESS] Analyzing patches for ${commits.length} commits...`);

        for (let i = 0; i < commits.length; i++) {
            try {
                let detail = await fetchCommitDetails(target.name, commits[i].sha, token);
                if (detail && detail.files) {
                    for (let file of detail.files) {
                        let filename = file.filename.split('/').pop().toLowerCase();
                        let isSuspicious = suspiciousFiles.includes(filename);
                        let hasTokens = false;
                        if (file.patch) {
                            for (let rx of secretRegexes) {
                                if (rx.test(file.patch)) { hasTokens = true; break; }
                            }
                        }
                        if (isSuspicious || hasTokens) {
                            foundItems.push({
                                name: file.filename + ` (Commit: ${detail.sha.substring(0, 7)})`,
                                html_url: detail.html_url,
                                repository: { full_name: target.name, html_url: `https://github.com/${target.name}` },
                                sha: `${detail.sha}-${file.filename}`,
                                patch: file.patch
                            });
                        }
                    }
                }
                await new Promise(r => setTimeout(r, 200));
            } catch (err) { }
        }
        let uniqueItems = Array.from(new Map(foundItems.map(item => [item.sha, item])).values());
        sendResults(ctx, uniqueItems, "past commits");
    } catch (e) {
        ctx.reply(`Error: ${e.message}`);
    }
});

bot.command('search', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply('Usage: /search <repo_url_or_name> <keyword>');

    const repoInput = parts[1];
    const keyword = parts.slice(2).join(' ');

    let target = parseTarget(repoInput);
    if (!target) return ctx.reply('Invalid repository format.');

    let token;
    try { token = getGithubToken(ctx); } catch (e) { return ctx.reply(e.message); }

    const userId = ctx.from.id;
    if (userStore[userId] && userStore[userId].onlyEnvFiles) {
        keyword += " filename:.env";
    }

    ctx.reply(`[INFO] Executing targeted search in ${target.type}: ${target.name}
Query: "${keyword}"
Status: Processing...`);

    let searchScope = target.type === 'user' ? `user:${target.name}` : `repo:${target.name}`;

    try {
        let data = await githubSearchCode(`${keyword} ${searchScope}`, token);
        sendResults(ctx, data.items, `"${keyword}"`);
    } catch (e) {
        ctx.reply(`Error: ${e.message}`);
    }
});

bot.command('searchglobal', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /searchglobal <keyword>');

    let keyword = parts.slice(1).join(' ');

    let token;
    try { token = getGithubToken(ctx); } catch (e) { return ctx.reply(e.message); }

    const userId = ctx.from.id;
    if (userStore[userId] && userStore[userId].onlyEnvFiles) {
        keyword += " filename:.env";
    }

    ctx.reply(`[INFO] Executing global ecosystem search.
Query: "${keyword}"
Status: Processing...`);

    try {
        let data = await githubSearchCode(`${keyword}`, token);
        sendResults(ctx, data.items, `"${keyword}" globally`);
    } catch (e) {
        ctx.reply(`Error: ${e.message}`);
    }
});

bot.command('amiexposed', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Usage: /amiexposed <secret>');

    let secretStr = parts.slice(1).join(' ').trim();
    if (secretStr.length < 10) return ctx.reply('[ERROR] Secret must be at least 10 characters long to provide meaningful results.');

    let token;
    try { token = getGithubToken(ctx); } catch (e) { return ctx.reply(e.message); }

    const userId = ctx.from.id;
    let exactSearchQuery = `"${secretStr}"`;
    if (userStore[userId] && userStore[userId].onlyEnvFiles) {
        exactSearchQuery += " filename:.env";
    }

    ctx.reply(`[INFO] Evaluating Global Exposure for secret...
Status: Querying GitHub Secure API
Target: Exact string match`);

    try {
        let data = await githubSearchCode(exactSearchQuery, token);
        sendResults(ctx, data.items, `Secret Exposure`);
    } catch (e) {
        ctx.reply(`[ERROR] Am I Exposed: ${e.message}`);
    }
});

bot.command('globalhunter', async (ctx) => {
    let token;
    try { token = getGithubToken(ctx); } catch (e) { return ctx.reply(e.message); }

    ctx.reply(`[INFO] Initializing Global Hunter...
Target: Randomly exposed EVM Private Keys
Status: Fetching bulk results from GitHub Secure API...`);

    let genericTargetQueries = [
        `"PRIVATE_KEY="`,
        `"ETH_PRIVATE_KEY="`,
        `"wallet_private_key"`,
        `"0x" "private"`
    ];

    const userId = ctx.from.id;
    if (userStore[userId] && userStore[userId].onlyEnvFiles) {
        genericTargetQueries = genericTargetQueries.map(q => `${q} filename:.env`);
    }

    let allItems = [];
    let hadAuthError = false;

    try {
        for (let queryStr of genericTargetQueries) {
            try {
                let data = await githubSearchCode(queryStr, token);
                if (data && data.items) {
                    let confirmedLeaks = data.items.filter(item => {
                        let fullSnippet = item.patch || "";
                        if (item.text_matches) fullSnippet += item.text_matches.map(m => m.fragment).join('\n');
                        let keysFound = extractPotentialKeys(fullSnippet);
                        return keysFound.some(k => k.type === 'EVM_PRIVATE_KEY');
                    });
                    allItems = allItems.concat(confirmedLeaks);
                }
                await new Promise(r => setTimeout(r, 1500)); // Respect secondary rate limits
            } catch (e) {
                if (e.message.toLowerCase().includes('requir') || e.message.toLowerCase().includes('auth') || e.message.includes('API rate limit')) {
                    hadAuthError = true;
                    break;
                }
            }
        }

        if (hadAuthError) {
            return ctx.reply(`[ERROR] Global Hunter stopped due to aggressive rate limiting. Please wait a few minutes before hunting again.`);
        }

        let uniqueLeaks = Array.from(new Map(allItems.map(item => [item.sha, item])).values());

        if (uniqueLeaks.length === 0) {
            return ctx.reply(`[INFO] Hunt completed. No valid/unfiltered new EVM keys found globally.`);
        }

        sendResults(ctx, uniqueLeaks, "Global EVM Keys (Verified Format)");
    } catch (e) {
        ctx.reply(`[ERROR] Global Hunter: ${e.message}`);
    }
});

function sendResults(ctx, items, label) {
    if (!items || items.length === 0) {
        return ctx.reply(`[SUCCESS] Scan complete. No exposures found for ${label}.`);
    }

    const userId = ctx.from.id;
    const ignoredRepos = (userStore[userId] && userStore[userId].ignoredRepos) || [];

    let filteredItems = items.filter(item => !ignoredRepos.includes(item.repository.full_name));

    // Automatically apply "Exclude Examples & Readmes" filter logic
    let excludeExamples = userStore[userId] && userStore[userId].excludeExamples !== false; // defaults to true
    if (excludeExamples) {
        filteredItems = filteredItems.filter(item => {
            let name = item.name.toLowerCase();
            let path = (item.path || '').toLowerCase();
            let fullKey = name + " " + path;

            if (fullKey.includes('example') ||
                fullKey.includes('sample') ||
                fullKey.includes('template') ||
                fullKey.includes('readme.md') ||
                fullKey.includes('readme.txt')) {
                return false;
            }
            return true;
        });
    }

    if (filteredItems.length === 0) {
        return ctx.reply(`[SUCCESS] Scan complete. No exposures found for ${label} (Wait, ${items.length} items were ignored/filtered).`);
    }

    let msg = `[ALERT] Scan complete. Found ${filteredItems.length} potential exposures for ${label}:\n\n`;
    let displayed = filteredItems.slice(0, 10); // Show max 10 to avoid TG text limit

    displayed.forEach((item, index) => {
        let fullText = item.patch || "";
        if (item.text_matches) {
            fullText += item.text_matches.map(m => m.fragment).join('\n');
        }
        let foundKeys = extractPotentialKeys(fullText);

        // Cache keys for inline button
        if (foundKeys.length > 0) {
            let runId = Math.random().toString(36).substring(7);
            resultsCache.set(runId, foundKeys);
            item.runId = runId;
        }

        msg += `- File: *${item.name}*\n  Link: [View Source](${item.html_url})\n`;
        if (foundKeys.length > 0) {
            msg += `  Exposures: ${foundKeys.length} item(s) (Types: ${[...new Set(foundKeys.map(k => k.type))].join(', ')})\n`;
        }
        msg += `\n`;
    });

    if (filteredItems.length > 10) msg += `...and ${filteredItems.length - 10} more items hidden.`;

    // Create keyboard for balances if needed
    let buttons = [];
    displayed.forEach((item) => {
        let row = [];
        if (item.runId) {
            row.push(Markup.button.callback(`Check Bal (${item.name.substring(0, 10)})`, `bal_${item.runId}`));
        }
        row.push(Markup.button.callback(`Ignore Repo (${item.repository.name})`, `ignrepo_${item.repository.full_name}`));
        buttons.push(row);
    });

    ctx.replyWithMarkdown(msg, { disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) });
}

bot.action(/bal_(.+)/, async (ctx) => {
    const runId = ctx.match[1];
    const keys = resultsCache.get(runId);
    if (!keys) return ctx.answerCbQuery('Data expired or invalid.', { show_alert: true });

    await ctx.answerCbQuery('Checking assets across all chains...');
    const statusMsg = await ctx.reply('[PROCESS] Scanning 50+ EVM networks and multiple alt-chains...');

    let resultsHtml = '';
    let totalEmptyChains = 0;
    let foundAssets = false;

    for (let k of keys) {
        try {
            if (k.type.includes('EVM')) {
                let addr = getEvmAddressFromKey(k.value);
                if (addr) {
                    let { balances, emptyCount } = await getEvmBalance(addr);
                    totalEmptyChains += emptyCount;
                    if (balances.length > 0) {
                        foundAssets = true;
                        resultsHtml += `[EVM] ${addr.substring(0, 8)}... :\n${balances.join(' | ')}\n\n`;
                    }
                }
            } else if (k.type.includes('SOL')) {
                let addr = getSolAddressFromKey(k.value);
                if (addr) {
                    let bal = await getSolBalance(addr);
                    if (bal) {
                        foundAssets = true;
                        resultsHtml += `[SOL] ${addr.substring(0, 8)}... : ${bal}\n`;
                    } else { totalEmptyChains += 1; }
                }
            } else if (k.type === 'MNEMONIC') {
                // For mnemonics, we can't easily check all chains without a library that handles bip39, 
                // but we can at least flag it as found.
                resultsHtml += `[MNEMONIC] Found potential seed phrase!\n`;
                foundAssets = true;
            }
        } catch (e) {
            console.error(e);
        }
    }

    let finalMsg = foundAssets
        ? `[RESULTS] Assets Found:\n\`\`\`\n${resultsHtml}\`\`\`\n_(Note: Didn't find any assets on ${totalEmptyChains} other networks)_`
        : `[INFO] Scan completed. Didn't find any assets on ${totalEmptyChains} different networks.`;

    ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, finalMsg, { parse_mode: 'Markdown' });
});

bot.action(/ignrepo_(.+)/, async (ctx) => {
    const repoFullName = ctx.match[1];
    const userId = ctx.from.id;

    if (!userStore[userId]) userStore[userId] = {};
    if (!userStore[userId].ignoredRepos) userStore[userId].ignoredRepos = [];

    if (!userStore[userId].ignoredRepos.includes(repoFullName)) {
        userStore[userId].ignoredRepos.push(repoFullName);
        saveUserStore();
    }

    ctx.answerCbQuery(`Repository ${repoFullName} added to ignore list.`, { show_alert: true });
});

bot.launch().then(() => {
    console.log("Bot started successfully!");
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
