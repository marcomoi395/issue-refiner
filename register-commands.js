import fs from 'fs';
import path from 'path';

// Parse .dev.vars
const varsPath = path.resolve('.dev.vars');
if (fs.existsSync(varsPath)) {
  const lines = fs.readFileSync(varsPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const appId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.ALLOWED_GUILD_ID;

if (!appId || !botToken || !guildId) {
  console.error('Lỗi: Thiếu DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN hoặc ALLOWED_GUILD_ID trong .dev.vars');
  process.exit(1);
}

const url = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;
const body = [{
  name: "add-issue",
  description: "Create a GitHub issue from a short note",
  type: 1,
  options: [{
    name: "text",
    description: "Short issue note",
    type: 3,
    required: true,
    max_length: 1500
  }]
}];

console.log(`Đang đăng ký slash command cho guild: ${guildId}...`);
const res = await fetch(url, {
  method: 'PUT',
  headers: {
    'Authorization': `Bot ${botToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(body)
});

if (res.ok) {
  console.log('Đăng ký slash command thành công!', await res.json());
} else {
  console.error('Đăng ký thất bại:', res.status, await res.text());
  process.exit(1);
}
