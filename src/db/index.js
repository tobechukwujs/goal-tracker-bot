// src/db/index.js
// ============================================================
// Database connection pool and all query helpers.
// All raw SQL lives here — no queries scattered in other files.
// ============================================================

import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString:        config.db.connectionString,
  ssl:                     config.db.ssl,
  max:                     config.db.poolMax,
  idleTimeoutMillis:       config.db.idleTimeout,
  connectionTimeoutMillis: config.db.connectionTimeout,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

export const query = (text, params) => pool.query(text, params);

// ── Users ────────────────────────────────────────────────────

export async function upsertUser({ phone, firstName, username, timezone = 'Africa/Lagos' }) {
  const { rows } = await query(
    `INSERT INTO users (phone, first_name, username, timezone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (phone) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           username   = EXCLUDED.username
     RETURNING *`,
    [phone, firstName, username, timezone]
  );
  return rows[0];
}

export async function getUserById(userId) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
}

export async function getAllActiveUsers() {
  const { rows } = await query(`
    SELECT u.*, up.platform, up.platform_id, up.chat_id
    FROM users u
    JOIN user_platforms up ON up.user_id = u.id
  `);
  return rows;
}

export async function updateUserPlatform(userId, platform) {
  await query('UPDATE users SET preferred_platform = $1 WHERE id = $2', [platform, userId]);
}

// ── User Platforms ───────────────────────────────────────────

export async function upsertPlatform({ userId, platform, platformId, chatId }) {
  const { rows } = await query(
    `INSERT INTO user_platforms (user_id, platform, platform_id, chat_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (platform, platform_id) DO UPDATE
       SET chat_id = EXCLUDED.chat_id
     RETURNING *`,
    [userId, platform, platformId, chatId]
  );
  return rows[0];
}

export async function getUserByPlatformId(platform, platformId) {
  const { rows } = await query(
    `SELECT u.*, up.platform, up.platform_id, up.chat_id
     FROM users u
     JOIN user_platforms up ON up.user_id = u.id
     WHERE up.platform = $1 AND up.platform_id = $2`,
    [platform, platformId]
  );
  return rows[0] || null;
}

export async function getUserPlatforms(userId) {
  const { rows } = await query(
    'SELECT * FROM user_platforms WHERE user_id = $1',
    [userId]
  );
  return rows;
}

// ── Goals ────────────────────────────────────────────────────

export async function getGoals(userId) {
  const { rows } = await query(
    `SELECT * FROM goals
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY priority ASC, created_at ASC`,
    [userId]
  );
  return rows;
}

export async function addGoal({ userId, goalText, category = 'general', priority = 1, targetDate }) {
  const { rows } = await query(
    `INSERT INTO goals (user_id, goal_text, category, priority, target_date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, goalText, category, priority, targetDate || null]
  );
  return rows[0];
}

export async function updateGoal(goalId, userId, { goalText, category, priority, targetDate }) {
  const { rows } = await query(
    `UPDATE goals
     SET goal_text   = COALESCE($1, goal_text),
         category    = COALESCE($2, category),
         priority    = COALESCE($3, priority),
         target_date = COALESCE($4, target_date),
         updated_at  = NOW()
     WHERE id = $5 AND user_id = $6
     RETURNING *`,
    [goalText, category, priority, targetDate, goalId, userId]
  );
  return rows[0] || null;
}

export async function deleteGoal(goalId, userId) {
  await query(
    'UPDATE goals SET is_active = FALSE WHERE id = $1 AND user_id = $2',
    [goalId, userId]
  );
}

// ── Daily Activities ─────────────────────────────────────────

export async function saveDailyPlan(userId, content) {
  await query(
    `INSERT INTO daily_activities (user_id, content, activity_date)
     VALUES ($1, $2, CURRENT_DATE)
     ON CONFLICT (user_id, activity_date) DO UPDATE SET content = EXCLUDED.content`,
    [userId, content]
  );
}

export async function getTodayPlan(userId) {
  const { rows } = await query(
    `SELECT * FROM daily_activities
     WHERE user_id = $1 AND activity_date = CURRENT_DATE`,
    [userId]
  );
  return rows[0] || null;
}

export async function getWeekPlans(userId) {
  const { rows } = await query(
    `SELECT * FROM daily_activities
     WHERE user_id = $1
       AND activity_date >= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY activity_date DESC`,
    [userId]
  );
  return rows;
}

// ── Check-in Responses ───────────────────────────────────────

export async function saveCheckinResponse({ userId, checkinTime, responseText, platform }) {
  await query(
    `INSERT INTO checkin_responses (user_id, checkin_time, response_text, response_date, platform)
     VALUES ($1, $2, $3, CURRENT_DATE, $4)`,
    [userId, checkinTime, responseText, platform]
  );
}

export async function getTodayCheckins(userId) {
  const { rows } = await query(
    `SELECT * FROM checkin_responses
     WHERE user_id = $1 AND response_date = CURRENT_DATE`,
    [userId]
  );
  return rows;
}

// ── Streaks ──────────────────────────────────────────────────

export async function getStreak(userId) {
  const { rows } = await query('SELECT * FROM streaks WHERE user_id = $1', [userId]);
  return rows[0] || { current_streak: 0, longest_streak: 0 };
}

export async function updateStreak(userId) {
  const streak = await getStreak(userId);
  const today = new Date().toISOString().split('T')[0];
  const lastActive = streak.last_active_date
    ? new Date(streak.last_active_date).toISOString().split('T')[0]
    : null;

  let newCurrent = 1;
  if (lastActive) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (lastActive === yesterdayStr) {
      newCurrent = (streak.current_streak || 0) + 1;
    } else if (lastActive === today) {
      return streak;
    }
  }

  const newLongest = Math.max(newCurrent, streak.longest_streak || 0);
  const { rows } = await query(
    `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET current_streak   = $2,
           longest_streak   = $3,
           last_active_date = $4,
           updated_at       = NOW()
     RETURNING *`,
    [userId, newCurrent, newLongest, today]
  );
  return rows[0];
}

export async function resetStreakIfMissed(userId) {
  const streak = await getStreak(userId);
  if (!streak.last_active_date) return;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const lastActive = new Date(streak.last_active_date).toISOString().split('T')[0];

  if (lastActive < yesterdayStr) {
    await query(
      `UPDATE streaks SET current_streak = 0, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );
  }
}

// ── Weekly Summaries ─────────────────────────────────────────

export async function saveWeeklySummary(userId, content) {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekEnd = new Date();
  await query(
    `INSERT INTO weekly_summaries (user_id, week_start, week_end, content)
     VALUES ($1, $2, $3, $4)`,
    [userId, weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0], content]
  );
}

// ── Account Linking ──────────────────────────────────────────

export async function createLinkToken(userId) {
  const token = Math.random().toString(36).slice(2, 8).toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await query(
    `INSERT INTO link_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET token = $2, expires_at = $3, created_at = NOW()`,
    [userId, token, expiresAt]
  );
  return token;
}

export async function consumeLinkToken(token) {
  const { rows } = await query(
    `DELETE FROM link_tokens
     WHERE token = $1 AND expires_at > NOW()
     RETURNING user_id`,
    [token.toUpperCase()]
  );
  return rows[0]?.user_id || null;
}

export async function mergeUsers(primaryUserId, secondUserId) {
  await query(`UPDATE user_platforms SET user_id = $1 WHERE user_id = $2`, [primaryUserId, secondUserId]);
  await query(`UPDATE goals SET user_id = $1 WHERE user_id = $2`, [primaryUserId, secondUserId]);

  const primary = await getStreak(primaryUserId);
  const second  = await getStreak(secondUserId);
  const bestStreak  = Math.max(primary.current_streak || 0, second.current_streak || 0);
  const bestLongest = Math.max(primary.longest_streak || 0, second.longest_streak || 0);
  await query(
    `UPDATE streaks SET current_streak = $1, longest_streak = $2 WHERE user_id = $3`,
    [bestStreak, bestLongest, primaryUserId]
  );

  await query(
    `UPDATE daily_activities SET user_id = $1
     WHERE user_id = $2
       AND activity_date NOT IN (
         SELECT activity_date FROM daily_activities WHERE user_id = $1
       )`,
    [primaryUserId, secondUserId]
  );
  await query(`UPDATE checkin_responses SET user_id = $1 WHERE user_id = $2`, [primaryUserId, secondUserId]);

  await query(`DELETE FROM streaks WHERE user_id = $1`, [secondUserId]);
  await query(`DELETE FROM goals WHERE user_id = $1`, [secondUserId]);
  await query(`DELETE FROM daily_activities WHERE user_id = $1`, [secondUserId]);
  await query(`DELETE FROM users WHERE id = $1`, [secondUserId]);
}