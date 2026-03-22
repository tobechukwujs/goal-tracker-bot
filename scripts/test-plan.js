// scripts/test-plan.js
// ============================================================
// Manually triggers the morning plan for the seed test user.
// Useful for testing Claude prompts and DB writes without
// waiting for the 6 AM cron job.
//
// Usage:
//   node scripts/test-plan.js
//   node scripts/test-plan.js --weekly    (test weekly summary)
//   node scripts/test-plan.js --wrapup   (test evening wrap-up)
// ============================================================

import 'dotenv/config';
import * as db from '../src/db/index.js';
import * as claude from '../src/services/claude.js';
import { pool } from '../src/db/index.js';

const args = process.argv.slice(2);
const mode = args[0] || '--plan';

async function run() {
  // Find the seed user (phone starts with +2340000000001)
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE phone = '+2340000000001' LIMIT 1"
  );

  if (rows.length === 0) {
    console.error('❌ Test user not found. Run `node scripts/seed.js` first.');
    process.exit(1);
  }

  const user = rows[0];
  const goals = await db.getGoals(user.id);
  const streakData = await db.getStreak(user.id);

  console.log(`\n👤 Testing for: ${user.first_name} (ID: ${user.id})`);
  console.log(`🎯 Goals loaded: ${goals.length}`);
  console.log(`🔥 Streak: ${streakData.current_streak} days\n`);
  console.log('─'.repeat(60));

  if (mode === '--weekly') {
    console.log('📊 Generating weekly summary...\n');
    const weekPlans = await db.getWeekPlans(user.id);
    const summary = await claude.generateWeeklySummary(user.first_name, goals, weekPlans, streakData);
    console.log(summary);
  } else if (mode === '--wrapup') {
    console.log('🌙 Generating evening wrap-up...\n');
    const plan = await db.getTodayPlan(user.id);
    const responses = await db.getTodayCheckins(user.id);
    if (!plan) {
      console.log('No plan found for today. Run without --wrapup first to generate one.');
    } else {
      const wrapup = await claude.generateEveningWrapup(user.first_name, plan.content, responses, streakData.current_streak);
      console.log(wrapup);
    }
  } else {
    console.log('🌅 Generating morning plan...\n');
    const plan = await claude.generateDailyPlan(user.first_name, goals, streakData.current_streak);
    await db.saveDailyPlan(user.id, plan);
    console.log(plan);
    console.log('\n─'.repeat(60));
    console.log('✅ Plan saved to daily_activities table.');
  }

  await pool.end();
}

run().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});