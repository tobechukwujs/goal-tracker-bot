// src/platforms/whatsapp.js
// ============================================================
// WhatsApp via Twilio — webhook-based (not polling).
// Twilio sends incoming messages to POST /webhook/whatsapp.
// All business logic is delegated to commandHandler.js.
// ============================================================

import * as handler from '../services/commandHandler.js';
import * as db from '../db/index.js';
import { sendMessage } from '../services/messenger.js';
import { logger } from '../utils/logger.js';

const CTX = 'WhatsApp';

/**
 * Register the WhatsApp webhook route on an Express app.
 * @param {import('express').Application} app
 */
export function initWhatsApp(app) {
  app.post('/webhook/whatsapp', async (req, res) => {
    // Twilio sends form-encoded body
    const from    = req.body.From;   // e.g. "whatsapp:+2348012345678"
    const body    = (req.body.Body || '').trim();
    const profile = req.body.ProfileName || 'Friend';

    if (!from || !body) {
      return res.status(200).send('<Response></Response>');
    }

    logger.info(CTX, `Incoming message`, { from: from.slice(-6), preview: body.slice(0, 30) });

    try {
      // Route commands (WhatsApp users type commands without the slash too, so we accept both)
      const cmd = body.toLowerCase().replace(/^\//, '');

      if (cmd === 'start' || cmd === 'hi' || cmd === 'hello') {
        await handler.handleStart({
          platform:   'whatsapp',
          platformId: from,
          chatId:     from,
          firstName:  profile,
          username:   null,
        });
      } else if (cmd === 'help') {
        await handler.handleHelp({ platform: 'whatsapp', chatId: from });
      } else if (cmd === 'goals') {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleListGoals({ userId: user.id, platform: 'whatsapp', chatId: from });
      } else if (cmd.startsWith('addgoal ')) {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleAddGoal({ userId: user.id, platform: 'whatsapp', chatId: from, goalText: body.slice(8) });
      } else if (cmd.startsWith('editgoal ')) {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleEditGoal({ userId: user.id, platform: 'whatsapp', chatId: from, args: body.slice(9) });
      } else if (cmd.startsWith('deletegoal ')) {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleDeleteGoal({ userId: user.id, platform: 'whatsapp', chatId: from, args: body.slice(11) });
      } else if (cmd === 'generate') {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleGenerate({ userId: user.id, platform: 'whatsapp', chatId: from, firstName: profile });
      } else if (cmd === 'streak') {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleStreak({ userId: user.id, platform: 'whatsapp', chatId: from });
      } else if (cmd === 'today') {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleToday({ userId: user.id, platform: 'whatsapp', chatId: from });
      } else if (cmd.startsWith('progress ')) {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleProgress({ userId: user.id, platform: 'whatsapp', chatId: from, firstName: profile, args: body.slice(9) });
      } else if (cmd.startsWith('goalstats ')) {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleGoalStats({ userId: user.id, platform: 'whatsapp', chatId: from, args: body.slice(10) });
      } else if (cmd === 'tasks') {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleTasks({ userId: user.id, platform: 'whatsapp', chatId: from });
      } else if (cmd === 'link') {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleLink({ userId: user.id, platform: 'whatsapp', chatId: from });
      } else if (cmd.startsWith('confirm ')) {
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) await handler.handleConfirmLink({ userId: user.id, platform: 'whatsapp', chatId: from, token: body.slice(8) });
      } else {
        // Free-text — check if it's a task number first
        const user = await db.getUserByPlatformId('whatsapp', from);
        if (user) {
          if (/^\d+$/.test(body.trim()) && parseInt(body.trim()) >= 1 && parseInt(body.trim()) <= 9) {
            await handler.handleTickTask({
              userId:     user.id,
              platform:   'whatsapp',
              chatId:     from,
              taskNumber: parseInt(body.trim()),
            });
          } else {
            // Treat as check-in response
            const hour = new Date().getHours();
            let slot = null;
            if (hour >= 9  && hour < 12) slot = '9am';
            if (hour >= 12 && hour < 15) slot = '12pm';
            if (hour >= 15 && hour < 18) slot = '3pm';
            if (hour >= 18 && hour < 21) slot = '6pm';

            if (slot) {
              await db.saveCheckinResponse({ userId: user.id, checkinTime: slot, responseText: body, platform: 'whatsapp' });
              await db.updateStreak(user.id);
              await sendMessage({ platform: 'whatsapp', chatId: from, text: '✅ Response recorded! Keep going 💪' });
            } else {
              await sendMessage({ platform: 'whatsapp', chatId: from, text: 'Type *help* to see available commands.' });
            }
          }
        } else {
          await sendMessage({ platform: 'whatsapp', chatId: from, text: 'Type *start* to register and begin tracking your goals! 🎯' });
        }
      }
    } catch (err) {
      logger.error(CTX, 'Handler error', { err: err.message });
    }

    // Always respond with empty TwiML so Twilio doesn't retry
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  });

  logger.info(CTX, 'Webhook handler registered at POST /webhook/whatsapp');
}