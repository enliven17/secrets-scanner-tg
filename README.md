# Telegram GitHub Secrets Scanner Bot

This is the Telegram Bot version of the Chrome extension that scans GitHub repositories for exposed `.env` files, credentials, and API keys.

## Features
- **Regex & Pattern Search**: Same robust pattern scanning logic as the Chrome extension.
- **Commit History Scanning**: Scans through the past 100 commits for any suspicious files or secrets.
- **Crypto Balance Checks**: Just like the Chrome extension, checks for derived EVM, Solana, and BTC addresses balances.
- **User GitHub Tokens**: You link your personal GitHub PAT to bypass limits.

## Installation

1. Copy `.env.example` to `.env` and configure your Telegram bot token:
   \`\`\`bash
   cp .env.example .env
   \`\`\`
2. Grab your bot token from [@BotFather](https://t.me/BotFather) on Telegram and put it in `.env` as \`BOT_TOKEN=...\`.
3. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`
   ```
4. Run the bot:
   ```bash
   node index.js
   ```

## Telegram Commands
- `/settoken <your_github_pat>` - Stores your token to allow rate bypass.
- `/scan <repo_url>` - Scans current code in the repo.
- `/scancommits <repo_url>` - Scans past 100 commits in the repo.
- `/search <repo_url> <keyword>` - Search a specific repository for a custom keyword.
- `/searchglobal <keyword>` - Globally search GitHub for a keyword.
