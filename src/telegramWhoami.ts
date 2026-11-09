import { Bot } from 'grammy';
import { loadConfigOrExit } from './config.js';

/**
 * Shows the user and chat IDs of recent messages sent to your bot, so you can
 * fill TELEGRAM_OWNER_USER_ID and TELEGRAM_CHAT_ID. Send /start to the bot first.
 * Stop the worker before running this (two getUpdates consumers conflict).
 */
const cfg = loadConfigOrExit(['TELEGRAM_BOT_TOKEN']);
const bot = new Bot(cfg.telegramBotToken);
const me = await bot.api.getMe();
console.log(`Bot: @${me.username}`);
const updates = await bot.api.getUpdates({ limit: 20, timeout: 0, allowed_updates: ['message'] });
const seen = new Set<string>();
for (const u of updates) {
  const m = u.message;
  if (!m?.from) continue;
  const key = `${m.from.id}:${m.chat.id}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`user_id=${m.from.id} (@${m.from.username ?? '-'})  chat_id=${m.chat.id}  chat_type=${m.chat.type}`);
}
if (seen.size === 0) console.log(`No messages found. Open https://t.me/${me.username}, send /start, then run this again.`);
else console.log('\nUse the line with chat_type=private and YOUR username: TELEGRAM_OWNER_USER_ID=user_id, TELEGRAM_CHAT_ID=chat_id.');
