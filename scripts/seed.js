// scripts/seed.js
// ============================================================
// Development seed script — creates a test user and sample goals
// so you can test scheduler jobs without a real Telegram/WhatsApp user.
//
// Usage:
//   node scripts/seed.js
//
// Run AFTER setting up your .env and running sql/schema.sql
// ============================================================

import 'dotenv/config';
import { pool } from '../src/db/index.js';
import * as db from '../src/db/index.js';

async function seed() {
  console.log('🌱 Seeding database with test data...\n');

  // 1. Create a test user
  const user = await db.upsertUser({
    phone:     '+2340000000001',
    firstName: 'Test',
    username:  'testuser',
    timezone:  'Africa/Lagos',
  });
  console.log(`✅ User created: ID ${user.id} (${user.first_name})`);

  // 2. Link to a fake Telegram platform (chat_id = 99999)
  await db.upsertPlatform({
    userId:     user.id,
    platform:   'telegram',
    platformId: '99999',
    chatId:     '99999',
  });
  console.log(`✅ Telegram platform linked`);

  // 3. Add sample goals
  const goals = [
    { goalText: 'Run a 5K in under 30 minutes by December 2025', category: 'health',  priority: 1 },
    { goalText: 'Complete a Node.js backend course and build 2 projects', category: 'career', priority: 2 },
    { goalText: 'Save ₦500,000 emergency fund by end of year', category: 'finance', priority: 1 },
  ];

  for (const g of goals) {
    const goal = await db.addGoal({ userId: user.id, ...g });
    console.log(`✅ Goal added: [${goal.category}] ${goal.goal_text}`);
  }

  // 4. Initialise streak
  await db.updateStreak(user.id);
  console.log(`✅ Streak initialised`);

  console.log('\n🎉 Seed complete! Test user is ready.');
  console.log(`   User ID: ${user.id}`);
  console.log('   To test the morning plan manually, run: node scripts/test-plan.js');

  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});