// src/platforms/telegram.js
// ============================================================
// Telegram bot setup and command routing.
// All business logic is delegated to commandHandler.js.
// ============================================================

import { getTelegramBot } from '../services/messenger.js';
import * as handler from '../services/commandHandler.js';
import * as db from '../db/index.js';
import { logger } from '../utils/logger.js';

const CTX = 'Telegram';

export function initTelegram() {
  const bot = getTelegramBot();
  logger.info(CTX, 'Bot polling started');

  // ── /start ────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const chatId = String(msg.chat.id);
    await handler.handleStart({
      platform:   'telegram',
      platformId: chatId,
      chatId,
      firstName:  msg.from.first_name || 'Friend',
      username:   msg.from.username || null,
    });
  });

  // ── /help ─────────────────────────────────────────────────
  bot.onText(/\/help/, async (msg) => {
    await handler.handleHelp({ platform: 'telegram', chatId: String(msg.chat.id) });
  });

  // ── /goals ────────────────────────────────────────────────
  bot.onText(/\/goals/, async (msg) => {
    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;
    await handler.handleListGoals({ userId: user.id, platform: 'telegram', chatId: String(msg.chat.id) });
  });

  // ── /addgoal ──────────────────────────────────────────────
  bot.onText(/\/addgoal (.+)/, async (msg, match) => {
    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;
    await handler.handleAddGoal({
      userId:   user.id,
      platform: 'telegram',
      chatId:   String(msg.chat.id),
      goalText: match[1],
    });
  });

  // ── /editgoal ─────────────────────────────────────────────
  bot.onText(/\/editgoal (.+)/, async (msg, match) => {
    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;
    await handler.handleEditGoal({
      userId:   user.id,
      platform: 'telegram',
      chatId:   String(msg.chat.id),
      args:     match[1],
    });
  });

  // ── /deletegoal ───────────────────────────────────────────
  bot.onText(/\/deletegoal (.+)/, async (msg, match) => {
    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;
    await handler.handleDeleteGoal({
      userId:   user.id,
      platform: 'telegram',
      chatId:   String(msg.chat.id),
      args:     match[1],
    });
  });

  // ── /generate ─────────────────────────────────────────────
  bot.onText(/\/generate/, async (msg) => {
    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;
    await handler.handleGenerate({
      userId:    user.id,
      platform:  'telegram',
      chatId:    String(msg.chat.id),
      firstName: msg.from.first_name || 'Friend',
    });
  });

  // ── /streak ───────────────────────────────────────────────
  bot.onText(/\/streak/, async (msg) => {
    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;
    await handler.handleStreak({ userId: user.id, platform: 'telegram', chatId: String(msg.chat.id) });
  });

  // ── /today ────────────────────────────────────────────────
  bot.onText(/\/today/, async (msg) => {
    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;
    await handler.handleToday({ userId: user.id, platform: 'telegram', chatId: String(msg.chat.id) });
  });

  // ── /link ─────────────────────────────────────────────────
  bot.onText(/\/link/, async (msg) => {
    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;
    await handler.handleLink({ userId: user.id, platform: 'telegram', chatId: String(msg.chat.id) });
  });

  // ── /confirm ──────────────────────────────────────────────
  bot.onText(/\/confirm (.+)/, async (msg, match) => {
    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;
    await handler.handleConfirmLink({
      userId:   user.id,
      platform: 'telegram',
      chatId:   String(msg.chat.id),
      token:    match[1],
    });
  });

  // ── Free-text (check-in responses) ───────────────────────
  bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;

    const user = await db.getUserByPlatformId('telegram', String(msg.chat.id));
    if (!user) return;

    const hour = new Date().getHours();
    let slot = null;
    if (hour >= 9  && hour < 12) slot = '9am';
    if (hour >= 12 && hour < 15) slot = '12pm';
    if (hour >= 15 && hour < 18) slot = '3pm';
    if (hour >= 18 && hour < 21) slot = '6pm';

    if (slot) {
      await db.saveCheckinResponse({
        userId:       user.id,
        checkinTime:  slot,
        responseText: msg.text,
        platform:     'telegram',
      });
      await db.updateStreak(user.id);
    }
  });

  // ── Error handler ─────────────────────────────────────────
  bot.on('polling_error', (err) => {
    logger.error(CTX, 'Polling error', { message: err.message });
  });
}