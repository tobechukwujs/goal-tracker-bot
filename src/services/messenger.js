// src/services/messenger.js
// ============================================================
// Unified message sending layer.
// Call sendMessage() and it routes to the right platform.
// ============================================================

import TelegramBot from 'node-telegram-bot-api';
import twilio from 'twilio';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// ── Client Initialisation ─────────────────────────────────────

let telegramBot = null;
let twilioClient = null;

export function getTelegramBot() {
  if (!telegramBot) {
    telegramBot = new TelegramBot(config.telegram.token, { polling: true });
  }
  return telegramBot;
}

export function getTwilioClient() {
  if (!twilioClient) {
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return twilioClient;
}

// ── Core Send Function ────────────────────────────────────────

/**
 * Send a message to a user on their platform.
 * @param {object} params
 * @param {string} params.platform   - 'telegram' | 'whatsapp'
 * @param {string} params.chatId     - Telegram chat_id OR WhatsApp number (e.g. whatsapp:+234...)
 * @param {string} params.text       - Message text
 */
export async function sendMessage({ platform, chatId, text }) {
  try {
    if (platform === 'telegram') {
      await getTelegramBot().sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } else if (platform === 'whatsapp') {
      await getTwilioClient().messages.create({
        from: config.twilio.whatsappNumber,
        to:   chatId,
        body: text,
      });
    }
    logger.info('Messenger', `Sent via ${platform}`, { to: chatId.slice(-6) });
  } catch (err) {
    logger.error('Messenger', `Failed to send via ${platform}`, { to: chatId.slice(-6), err: err.message });
    // Don't rethrow — a failed message shouldn't crash the scheduler
  }
}

/**
 * Broadcast a message to all of a user's connected platforms.
 * @param {Array}  platforms - rows from user_platforms table
 * @param {string} text
 */
export async function broadcast(platforms, text) {
  const sends = platforms.map((p) =>
    sendMessage({ platform: p.platform, chatId: p.chat_id || p.platform_id, text })
  );
  await Promise.allSettled(sends);
}