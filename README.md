# Issue Refiner

Discord Bot build on Cloudflare Workers. Refine draft note, suggest titles, clean description, auto-label, format into GitHub Issue using OpenAI API.

## About
- **Engine**: Cloudflare Workers
- **AI Core**: OpenAI API (default `gpt-5.4-nano`)
- **Key Flow**: `/add-issue` -> AI Refine -> UI Confirm -> Create Issue on GitHub.
- **KV Store**: Save draft before confirm.

## Setup

1. **Install:**
   ```bash
   npm install
   ```

2. **Config (.dev.vars for local):**
   ```ini
   DISCORD_APPLICATION_ID=<app_id>
   DISCORD_PUBLIC_KEY=<public_key>
   DISCORD_BOT_TOKEN=<bot_token>
   GITHUB_TOKEN=<github_token>
   OPENAI_API_KEY=<openai_key>
   ALLOWED_GUILD_ID=<guild_id>
   ```

3. **Register commands:**
   ```bash
   npm run register-commands
   ```

4. **Run:**
   ```bash
   npm run dev
   ```
