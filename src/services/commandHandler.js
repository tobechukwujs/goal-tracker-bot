// src/services/commandHandler.js
// ============================================================
// All bot command logic lives here — platform-agnostic.
// Both Telegram and WhatsApp handlers call these functions.
// ============================================================

import * as db from '../db/index.js';
import * as claude from './claude.js';
import { sendMessage } from './messenger.js';
import { validateGoalText, validateGoalId, validateEditArgs } from '../utils/validate.js';
import { logger } from '../utils/logger.js';

const CTX = 'CommandHandler';

// ── Registration ──────────────────────────────────────────────

export async function handleStart({ platform, platformId, chatId, firstName, username }) {
  // Upsert user (phone = platformId for WhatsApp, chat_id for Telegram)
  const phone = platform === 'whatsapp' ? platformId.replace('whatsapp:', '') : platformId;
  const user = await db.upsertUser({ phone, firstName, username });
  await db.upsertPlatform({ userId: user.id, platform, platformId, chatId });

  const welcome = `👋 *Welcome, ${firstName}!*

I'm your personal Goal Tracker Bot, powered by Claude AI.

Here's what I can do:
• 🌅 Send you a personalised daily plan every morning at *6 AM*
• ⏰ Check in with you throughout the day
• 🔥 Track your streaks
• 📊 Send a weekly summary every Sunday

*To get started, add your first goal:*
Type \`/addgoal\` followed by your goal.

Example: \`/addgoal Learn Spanish to conversational level by December\`

Type \`/help\` to see all commands.`;

  await sendMessage({ platform, chatId: chatId || platformId, text: welcome });
  return user;
}

// ── Goals ────────────────────────────────────────────────────

export async function handleListGoals({ userId, platform, chatId }) {
  const goals = await db.getGoals(userId);

  if (goals.length === 0) {
    return sendMessage({
      platform, chatId,
      text: "You don't have any active goals yet.\n\nAdd one with `/addgoal Your goal here`",
    });
  }

  const list = goals
    .map((g, i) =>
      `*${i + 1}. ${g.goal_text}*\n   📁 ${g.category} | ⭐ Priority ${g.priority}${g.target_date ? ` | 📅 ${g.target_date}` : ''}\n   ID: \`${g.id}\``
    )
    .join('\n\n');

  await sendMessage({ platform, chatId, text: `🎯 *Your Goals:*\n\n${list}` });
}

export async function handleAddGoal({ userId, platform, chatId, goalText }) {
  const validation = validateGoalText(goalText);
  if (!validation.valid) {
    return sendMessage({ platform, chatId, text: `❌ ${validation.error}\n\nExample: \`/addgoal Run a 5K by September\`` });
  }

  const { category, cleaned_goal } = await claude.categoriseGoal(validation.value);
  const goal = await db.addGoal({ userId, goalText: cleaned_goal, category });
  logger.info(CTX, 'Goal added', { userId, goalId: goal.id, category });

  await sendMessage({
    platform, chatId,
    text: `✅ *Goal added!*\n\n📝 ${goal.goal_text}\n📁 Category: ${goal.category}\n\nUse \`/goals\` to see all your goals.`,
  });
}

export async function handleEditGoal({ userId, platform, chatId, args }) {
  const validation = validateEditArgs(args);
  if (!validation.valid) {
    return sendMessage({ platform, chatId, text: `❌ ${validation.error}` });
  }

  const updated = await db.updateGoal(validation.id, userId, { goalText: validation.goalText });
  if (!updated) {
    return sendMessage({ platform, chatId, text: "❌ Goal not found. Check the ID with `/goals`" });
  }
  logger.info(CTX, 'Goal updated', { userId, goalId: validation.id });
  await sendMessage({ platform, chatId, text: `✅ Goal updated!\n\n📝 ${updated.goal_text}` });
}

export async function handleDeleteGoal({ userId, platform, chatId, args }) {
  const validation = validateGoalId(args);
  if (!validation.valid) {
    return sendMessage({ platform, chatId, text: `❌ ${validation.error}` });
  }

  await db.deleteGoal(validation.value, userId);
  logger.info(CTX, 'Goal deleted', { userId, goalId: validation.value });
  await sendMessage({ platform, chatId, text: '🗑️ Goal removed. Use `/goals` to see your remaining goals.' });
}

// ── Manual Plan Generation ───────────────────────────────────

export async function handleGenerate({ userId, platform, chatId, firstName }) {
  const goals = await db.getGoals(userId);
  if (goals.length === 0) {
    return sendMessage({
      platform, chatId,
      text: "You have no goals set yet! Add some with `/addgoal` first.",
    });
  }

  await sendMessage({ platform, chatId, text: '⏳ Generating your plan with Claude AI...' });

  const streakData = await db.getStreak(userId);
  const plan = await claude.generateDailyPlan(firstName, goals, streakData.current_streak);
  await db.saveDailyPlan(userId, plan);
  await db.updateStreak(userId);

  await sendMessage({ platform, chatId, text: plan });
}

// ── Streak ───────────────────────────────────────────────────

export async function handleStreak({ userId, platform, chatId }) {
  const streak = await db.getStreak(userId);
  const fire = streak.current_streak >= 7 ? '🔥🔥' : streak.current_streak >= 3 ? '🔥' : '⚡';

  await sendMessage({
    platform, chatId,
    text: `${fire} *Your Streak*\n\nCurrent: *${streak.current_streak} days*\nBest ever: *${streak.longest_streak} days*\n\nKeep showing up every day to grow your streak!`,
  });
}

// ── Help ─────────────────────────────────────────────────────

export async function handleHelp({ platform, chatId }) {
  const help = `📖 *Goal Tracker Bot — Commands*

*Goals*
\`/goals\` — View all your goals
\`/addgoal <text>\` — Add a new goal
\`/editgoal <id> <text>\` — Edit a goal
\`/deletegoal <id>\` — Remove a goal

*Plans & Progress*
\`/generate\` — Generate today's plan now
\`/streak\` — See your current streak
\`/today\` — See today's plan

*Other*
\`/help\` — Show this message

📅 *Automatic Schedule (WAT)*
• 6:00 AM — Daily plan
• 9 AM, 12 PM, 3 PM, 6 PM — Check-ins
• 9:00 PM — Evening wrap-up
• Sunday 8 PM — Weekly summary`;

  await sendMessage({ platform, chatId, text: help });
}

export async function handleToday({ userId, platform, chatId }) {
  const plan = await db.getTodayPlan(userId);
  if (!plan) {
    return sendMessage({
      platform, chatId,
      text: "No plan generated yet today. Use `/generate` to create one now!",
    });
  }
  await sendMessage({ platform, chatId, text: plan.content });
}