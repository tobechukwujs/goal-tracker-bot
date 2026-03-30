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
import * as milestones from './milestones.js';
import { parseTasks, formatTasksMessage } from '../utils/helpers.js';

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
  const allGoals = await db.getGoals(userId);
  if (allGoals.length === 0) {
    return sendMessage({
      platform, chatId,
      text: "You have no goals set yet! Add some with `/addgoal` first.",
    });
  }

  await sendMessage({ platform, chatId, text: '⏳ Generating your plan...' });

  // Priority rotation — pick least-recently-featured goals
  const rotatedGoals   = await db.getGoalsForRotation(userId, 6);
  const recentProgress = await db.getAllRecentProgress(userId, 3);
  const streakData     = await db.getStreak(userId);
  const carriedTasks   = await db.getIncompleteTasksFromYesterday(userId);

  const plan = await claude.generateDailyPlan(
    firstName, rotatedGoals, streakData.current_streak, carriedTasks, recentProgress
  );

  await db.saveDailyPlan(userId, plan);
  await db.updateStreak(userId);

  // Mark these goals as featured today
  await db.markGoalsFeatured(rotatedGoals.map(g => g.id));

  // Parse and save individual tasks

  const tasks = parseTasks(plan);
  if (tasks.length > 0) {
    const allTasks = [
      ...carriedTasks.map((t, i) => ({ number: i + 1, text: t.task_text, carriedOver: true })),
      ...tasks.filter(t => !carriedTasks.some(c => c.task_text === t.text))
              .map((t, i) => ({ number: carriedTasks.length + i + 1, text: t.text, carriedOver: false })),
    ];
    await db.saveDailyTasks(userId, allTasks.length > 0 ? allTasks : tasks.map(t => ({ ...t, carriedOver: false })));
  }

  const tickMsg = tasks.length > 0
    ? `\n\n✅ *Tick tasks by replying with a number* (e.g. \`1\`, \`2\`, \`3\`)\n📋 Use \`/tasks\` to see your task list`
    : '';

  await sendMessage({ platform, chatId, text: plan + tickMsg });
  logger.info(CTX, 'Plan generated', { userId, tasks: tasks.length, carried: carriedTasks.length, goals: rotatedGoals.length });
}

// ── Goal Progress Logging ─────────────────────────────────────

export async function handleProgress({ userId, platform, chatId, firstName, args }) {
  const parts  = args?.trim().split(/\s+/);
  const goalId = parseInt(parts?.[0]);
  const update = parts?.slice(1).join(' ');

  if (!goalId || !update || update.length < 3) {
    return sendMessage({
      platform, chatId,
      text: `📝 *Log progress on a goal*\n\nUsage: \`/progress <goalId> <your update>\`\n\nExamples:\n\`/progress 5 Solved 3 LeetCode problems, total now 48\`\n\`/progress 8 Weight now 69.5kg, up from 68kg\`\n\`/progress 10 SpaceShare has 12 users signed up\`\n\nUse \`/goals\` to see your goal IDs.`,
    });
  }

  const goals = await db.getGoals(userId);
  const goal  = goals.find(g => g.id === goalId);
  if (!goal) {
    return sendMessage({ platform, chatId, text: `❌ Goal not found. Use \`/goals\` to see your goal IDs.` });
  }

  const numMatch     = update.match(/\b(\d+\.?\d*)\b/);
  const numericValue = numMatch ? parseFloat(numMatch[1]) : null;

  await db.logGoalProgress({ userId, goalId, updateText: update, numericValue });

  const logs = await db.getGoalProgressLogs(goalId, 3);
  const history = logs.length > 1
    ? `\n\n📜 *Recent updates:*\n${logs.slice(1).map(l => `• ${new Date(l.logged_at).toLocaleDateString('en-GB')} — ${l.update_text}`).join('\n')}`
    : '';

  await sendMessage({
    platform, chatId,
    text: `✅ *Progress logged!*\n\n🎯 *${goal.goal_text}*\n📝 ${update}${history}`,
  });

  // Check for milestone celebration
  const platforms = await db.getUserPlatforms(userId);
  await milestones.checkProgressMilestone(userId, firstName, goalId, update, platforms);
  logger.info(CTX, 'Progress logged', { userId, goalId, numericValue });
}

export async function handleGoalStats({ userId, platform, chatId, args }) {
  const goalId = parseInt(args?.trim());
  if (!goalId) {
    return sendMessage({
      platform, chatId,
      text: `Usage: \`/goalstats <goalId>\`\n\nGet goal IDs with \`/goals\``,
    });
  }

  const goals = await db.getGoals(userId);
  const goal  = goals.find(g => g.id === goalId);
  if (!goal) return sendMessage({ platform, chatId, text: `❌ Goal not found.` });

  const logs = await db.getGoalProgressLogs(goalId, 10);
  if (logs.length === 0) {
    return sendMessage({
      platform, chatId,
      text: `No progress logged yet for:\n*${goal.goal_text}*\n\nStart with:\n\`/progress ${goalId} your update here\``,
    });
  }

  const history = logs.map((l, i) =>
    `${i + 1}. ${new Date(l.logged_at).toLocaleDateString('en-GB')} — ${l.update_text}${l.numeric_value ? ` *(${l.numeric_value})*` : ''}`
  ).join('\n');

  await sendMessage({
    platform, chatId,
    text: `📊 *Progress History*\n🎯 ${goal.goal_text}\n\n${history}`,
  });
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

*Progress Tracking*
\`/progress <id> <update>\` — Log progress on a goal
\`/goalstats <id>\` — View progress history for a goal

*Plans & Tasks*
\`/generate\` — Generate today's plan
\`/today\` — See today's plan
\`/tasks\` — See today's tasks with status
\`/streak\` — See your current streak

*Account*
\`/link\` — Get a code to link Telegram ↔ WhatsApp
\`/confirm <code>\` — Enter link code from other platform

*Other*
\`/help\` — Show this message

📅 *Automatic Schedule (WAT)*
• 6:00 AM — Daily plan (rotates goals)
• 9 AM, 12 PM, 3 PM, 6 PM — Check-ins
• 9:00 PM — Evening wrap-up
• Sunday 8 PM — Weekly summary

💡 *Tips*
• Reply \`1\` \`2\` \`3\` to tick off tasks
• Use \`/progress\` to log real numbers (weight, users, problems)`;

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

// ── Task Ticking ─────────────────────────────────────────────

/**
 * Show today's tasks with completion status.
 */
export async function handleTasks({ userId, platform, chatId }) {

  const tasks = await db.getTodayTasks(userId);

  if (tasks.length === 0) {
    return sendMessage({
      platform, chatId,
      text: "No tasks for today yet. Use `/generate` to create your daily plan!",
    });
  }

  const completed = tasks.filter(t => t.is_completed).length;
  const msg = `📋 *Today's Tasks (${completed}/${tasks.length} done)*\n\n${formatTasksMessage(tasks)}\n\nReply with a number to tick it off (e.g. \`1\`, \`2\`)`;
  await sendMessage({ platform, chatId, text: msg });
}

/**
 * Tick a task as complete when user replies with a number.
 */
export async function handleTickTask({ userId, platform, chatId, taskNumber }) {

  const task = await db.completeTask(userId, taskNumber);

  if (!task) {
    return sendMessage({
      platform, chatId,
      text: `❌ Task ${taskNumber} not found. Use \`/tasks\` to see your task list.`,
    });
  }

  const allTasks = await db.getTodayTasks(userId);
  const completed = allTasks.filter(t => t.is_completed).length;
  const total     = allTasks.length;

  let msg = `✅ *Task ${taskNumber} completed!*\n\n${formatTasksMessage(allTasks)}`;

  if (completed === total) {
    msg += `\n\n🎉 *All tasks done for today! Amazing work!* 🔥`;
    await db.updateStreak(userId);
  } else {
    msg += `\n\n${completed}/${total} tasks done. Keep going!`;
  }

  await sendMessage({ platform, chatId, text: msg });

  // Check for task milestone celebration
  const platforms = await db.getUserPlatforms(userId);
  const user      = await db.getUserById(userId);
  if (user) {
    await milestones.checkTaskMilestone(userId, user.first_name, platforms);
  }

  logger.info(CTX, 'Task ticked', { userId, taskNumber, completed, total });
}

// ── Account Linking ──────────────────────────────────────────

/**
 * Step 1 — User on Platform A runs /link
 * Generates a 6-character token and tells them to enter it on Platform B.
 */
export async function handleLink({ userId, platform, chatId }) {
  const token = await db.createLinkToken(userId);
  const otherPlatform = platform === 'telegram' ? 'WhatsApp' : 'Telegram';

  await sendMessage({
    platform, chatId,
    text: `🔗 *Link Your Accounts*\n\nYour link code is:\n\n*\`${token}\`*\n\nGo to *${otherPlatform}* and send:\n\`/confirm ${token}\`\n\n⏰ This code expires in *10 minutes*.`,
  });
}

/**
 * Step 2 — User on Platform B runs /confirm <token>
 * Merges the two accounts — Platform B's data moves into Platform A's account.
 */
export async function handleConfirmLink({ userId, platform, chatId, token }) {
  if (!token || token.trim().length < 4) {
    return sendMessage({
      platform, chatId,
      text: '❌ Usage: `/confirm ABC123`\n\nGet your code by sending `/link` on your other platform.',
    });
  }

  // Find the primary user who generated the token
  const primaryUserId = await db.consumeLinkToken(token.trim());

  if (!primaryUserId) {
    return sendMessage({
      platform, chatId,
      text: '❌ Invalid or expired code. Go to your other platform and run `/link` again to get a fresh code.',
    });
  }

  if (primaryUserId === userId) {
    return sendMessage({
      platform, chatId,
      text: '❌ You cannot link an account to itself. Run `/link` on your *other* platform (Telegram or WhatsApp).',
    });
  }

  // Merge current user (secondUserId) into primary user
  await db.mergeUsers(primaryUserId, userId);
  logger.info(CTX, 'Accounts merged', { primaryUserId, secondUserId: userId });

  await sendMessage({
    platform, chatId,
    text: `✅ *Accounts linked successfully!*\n\nYour Telegram and WhatsApp are now synced.\n\n• Goals are shared across both platforms\n• Streaks are combined\n• Morning plans will be sent to *both* platforms\n\nYou're all set! 🎉`,
  });
}