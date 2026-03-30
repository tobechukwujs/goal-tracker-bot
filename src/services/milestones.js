// src/services/milestones.js
// ============================================================
// Detects milestone achievements and sends celebration messages.
// Called after streak updates, task completions, and plan generation.
// ============================================================

import * as db from '../db/index.js';
import { broadcast } from './messenger.js';
import { logger } from '../utils/logger.js';
import Groq from 'groq-sdk';
import { config } from '../config/index.js';

const groq = new Groq({ apiKey: config.groq.apiKey });
const CTX  = 'Milestones';

// ── Milestone Definitions ─────────────────────────────────────

const STREAK_MILESTONES  = [3, 7, 14, 21, 30, 60, 90, 180, 365];
const TASK_MILESTONES    = [10, 25, 50, 100, 200, 500];

// ── AI Celebration Generator ──────────────────────────────────

async function generateCelebration(firstName, milestoneType, value) {
  const prompts = {
    streak: `Write a short (3-4 sentences), energetic celebration message for ${firstName} who just hit a ${value}-day streak on their goal tracker bot. Be genuinely excited, mention the streak number, and encourage them to keep going. End with one emoji.`,
    tasks:  `Write a short (3-4 sentences) celebration message for ${firstName} who just completed their ${value}th task on their goal tracker. Make it feel like a real achievement. End with one emoji.`,
    progress: `Write a short (3-4 sentences) encouraging message for ${firstName} who just logged progress on their goal: "${value}". Acknowledge the specific update and hype them up. End with one emoji.`,
  };

  try {
    const completion = await groq.chat.completions.create({
      model:      config.groq.model,
      max_tokens: 150,
      messages: [
        { role: 'system', content: 'You are an enthusiastic accountability coach. Be genuine, not cheesy.' },
        { role: 'user',   content: prompts[milestoneType] },
      ],
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    logger.error(CTX, 'Failed to generate celebration', { err: err.message });
    // Fallback messages
    const fallbacks = {
      streak:   `🔥 ${value}-day streak, ${firstName}! That's incredible consistency. Keep showing up!`,
      tasks:    `🎯 ${value} tasks completed, ${firstName}! You're building real momentum now!`,
      progress: `💪 Great progress update, ${firstName}! Every step counts towards your goal!`,
    };
    return fallbacks[milestoneType];
  }
}

// ── Milestone Checkers ────────────────────────────────────────

/**
 * Check streak milestones after a streak update.
 */
export async function checkStreakMilestone(userId, firstName, currentStreak, platforms) {
  if (!STREAK_MILESTONES.includes(currentStreak)) return;

  const key      = `streak_${currentStreak}`;
  const isNew    = await db.checkAndSaveMilestone(userId, key);
  if (!isNew) return;

  logger.info(CTX, `Streak milestone: ${currentStreak} days`, { userId });
  const message  = await generateCelebration(firstName, 'streak', currentStreak);
  const fullMsg  = `🏆 *MILESTONE UNLOCKED!*\n\n${message}`;
  await broadcast(platforms, fullMsg);
}

/**
 * Check task completion milestones.
 */
export async function checkTaskMilestone(userId, firstName, platforms) {
  const total = await db.getTotalTasksCompleted(userId);
  const hit   = TASK_MILESTONES.find(m => m === total);
  if (!hit) return;

  const key   = `tasks_${hit}`;
  const isNew = await db.checkAndSaveMilestone(userId, key);
  if (!isNew) return;

  logger.info(CTX, `Task milestone: ${hit} tasks`, { userId });
  const message = await generateCelebration(firstName, 'tasks', hit);
  const fullMsg = `🎯 *MILESTONE UNLOCKED!*\n\n${message}`;
  await broadcast(platforms, fullMsg);
}

/**
 * Check for numeric progress milestone on a specific goal.
 * e.g. user logs "weight: 70kg" and they were targeting 75kg
 */
export async function checkProgressMilestone(userId, firstName, goalId, updateText, platforms) {
  const key   = `goal_${goalId}_progress_${Date.now().toString(36)}`;
  // We celebrate every 5th progress log per goal
  const logs  = await db.getGoalProgressLogs(goalId, 100);
  const count = logs.length;

  if (count > 0 && count % 5 === 0) {
    const milestoneKey = `goal_${goalId}_log_${count}`;
    const isNew        = await db.checkAndSaveMilestone(userId, milestoneKey);
    if (!isNew) return;

    logger.info(CTX, `Progress milestone: ${count} logs for goal ${goalId}`, { userId });
    const message  = await generateCelebration(firstName, 'progress', updateText);
    const fullMsg  = `📈 *PROGRESS MILESTONE!*\n\n${message}`;
    await broadcast(platforms, fullMsg);
  }
}