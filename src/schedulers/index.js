// src/schedulers/index.js
// ============================================================
// All scheduled jobs (cron).
// Every job runs for ALL users in the database.
// Times are in WAT (Africa/Lagos) — set TZ in your .env.
// ============================================================

import cron from 'node-cron';
import * as db from '../db/index.js';
import * as claude from '../services/claude.js';
import { broadcast } from '../services/messenger.js';
import { logger } from '../utils/logger.js';
import { chunk } from '../utils/helpers.js';
import { config } from '../config/index.js';

const CTX = 'Scheduler';
const TZ  = config.timezone;

// ── Helper: get all users with their platforms ───────────────

async function getAllUsersWithPlatforms() {
  // Returns a grouped map: userId → { user, platforms[] }
  const rows = await db.getAllActiveUsers();
  const map = new Map();

  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, { user: row, platforms: [] });
    }
    map.get(row.id).platforms.push({ platform: row.platform, platform_id: row.platform_id, chat_id: row.chat_id });
  }

  return [...map.values()];
}

// ── Jobs ─────────────────────────────────────────────────────

async function runMorningPlan() {
  logger.info(CTX, '🌅 Running morning plan job...');
  const users = await getAllUsersWithPlatforms();
  const batches = chunk(users, 5); // process 5 users at a time to avoid API rate limits

  for (const batch of batches) {
    await Promise.allSettled(batch.map(async ({ user, platforms }) => {
      try {
        await db.resetStreakIfMissed(user.id);
        const goals = await db.getGoals(user.id);
        if (goals.length === 0) return;

        const streakData = await db.getStreak(user.id);
        const plan = await claude.generateDailyPlan(user.first_name, goals, streakData.current_streak);
        await db.saveDailyPlan(user.id, plan);
        await broadcast(platforms, plan);
        logger.info(CTX, `Morning plan sent`, { userId: user.id });
      } catch (err) {
        logger.error(CTX, `Morning plan failed`, { userId: user.id, err: err.message });
      }
    }));
  }
}

async function runCheckin(timeSlot) {
  logger.info(CTX, `⏰ Running ${timeSlot} check-in`);
  const users = await getAllUsersWithPlatforms();

  for (const { user, platforms } of users) {
    try {
      const plan = await db.getTodayPlan(user.id);
      if (!plan) continue;
      const message = await claude.generateCheckin(user.first_name, timeSlot, plan.content);
      await broadcast(platforms, message);
    } catch (err) {
      logger.error(CTX, `Check-in failed`, { userId: user.id, slot: timeSlot, err: err.message });
    }
  }
}

async function runEveningWrapup() {
  logger.info(CTX, '🌙 Running evening wrap-up');
  const users = await getAllUsersWithPlatforms();

  for (const { user, platforms } of users) {
    try {
      const plan = await db.getTodayPlan(user.id);
      if (!plan) continue;
      const responses = await db.getTodayCheckins(user.id);
      const streakData = await db.getStreak(user.id);
      const wrapup = await claude.generateEveningWrapup(
        user.first_name, plan.content, responses, streakData.current_streak
      );
      await broadcast(platforms, wrapup);
    } catch (err) {
      logger.error(CTX, `Evening wrap-up failed`, { userId: user.id, err: err.message });
    }
  }
}

async function runWeeklySummary() {
  logger.info(CTX, '📊 Running weekly summary');
  const users = await getAllUsersWithPlatforms();

  for (const { user, platforms } of users) {
    try {
      const goals = await db.getGoals(user.id);
      if (goals.length === 0) continue;
      const weekPlans = await db.getWeekPlans(user.id);
      const streakData = await db.getStreak(user.id);
      const summary = await claude.generateWeeklySummary(
        user.first_name, goals, weekPlans, streakData
      );
      await db.saveWeeklySummary(user.id, summary);
      await broadcast(platforms, summary);
      logger.info(CTX, `Weekly summary sent`, { userId: user.id });
    } catch (err) {
      logger.error(CTX, `Weekly summary failed`, { userId: user.id, err: err.message });
    }
  }
}

// ── Register All Cron Jobs ───────────────────────────────────

export function startSchedulers() {
  cron.schedule('0 6 * * *',  runMorningPlan,               { timezone: TZ });
  cron.schedule('0 9 * * *',  () => runCheckin('9am'),       { timezone: TZ });
  cron.schedule('0 12 * * *', () => runCheckin('12pm'),      { timezone: TZ });
  cron.schedule('0 15 * * *', () => runCheckin('3pm'),       { timezone: TZ });
  cron.schedule('0 18 * * *', () => runCheckin('6pm'),       { timezone: TZ });
  cron.schedule('0 21 * * *', runEveningWrapup,              { timezone: TZ });
  cron.schedule('0 20 * * 0', runWeeklySummary,              { timezone: TZ });

  logger.info('Scheduler', 'All 7 cron jobs registered', {
    timezone: TZ,
    jobs: ['6AM plan', '9AM', '12PM', '3PM', '6PM check-ins', '9PM wrap-up', 'Sunday 8PM summary'],
  });
}