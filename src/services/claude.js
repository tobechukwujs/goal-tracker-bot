// src/services/claude.js
// ============================================================
// All Groq AI interactions live here.
// Uses Llama 3 via Groq's ultra-fast free API.
// ============================================================

import Groq from 'groq-sdk';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/helpers.js';

const groq = new Groq({ apiKey: config.groq.apiKey });
const CTX  = 'Groq';

/**
 * Core function — send a prompt, get back plain text.
 * Retries up to 3 times on transient errors.
 */
async function ask(systemPrompt, userMessage) {
  return withRetry(async () => {
    logger.debug(CTX, 'Sending prompt', { chars: userMessage.length });

    const completion = await groq.chat.completions.create({
      model:      config.groq.model,
      max_tokens: config.groq.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    });

    const text = completion.choices[0].message.content.trim();
    logger.debug(CTX, 'Response received', { chars: text.length });
    return text;
  }, 3, 1000);
}

// ── Public Functions ─────────────────────────────────────────

export async function generateDailyPlan(firstName, goals, streak, carriedTasks = [], recentProgress = []) {
  const goalList = goals
    .map((g, i) => `${i + 1}. [${g.category}] ${g.goal_text}${g.target_date ? ` (target: ${g.target_date})` : ''}`)
    .join('\n');
  const streakMsg = streak > 0 ? `They are currently on a 🔥 ${streak}-day streak.` : '';

  const carriedSection = carriedTasks.length > 0
    ? `\n⚠️ These tasks were NOT completed yesterday — include them in today's plan:\n${carriedTasks.map((t, i) => `${i + 1}. ${t.task_text}`).join('\n')}\n`
    : '';

  const progressSection = recentProgress.length > 0
    ? `\nRecent progress updates from the user:\n${recentProgress.map(p => `- [${p.category}] ${p.goal_text}: "${p.update_text}"`).join('\n')}\n`
    : '';

  const system = `You are an encouraging, no-nonsense personal accountability coach.
You generate concise, actionable daily plans. Use emojis sparingly but effectively.
Keep the total response under 350 words. Format with clear sections.
IMPORTANT: Number every task clearly as 1. 2. 3. etc on its own line.`;

  const user = `Generate a daily action plan for ${firstName}.
${streakMsg}
${carriedSection}
${progressSection}
Their goals for today (already rotated for variety):
${goalList}

Create a realistic daily to-do list for TODAY (5-7 tasks).
${carriedTasks.length > 0 ? 'List carried-over tasks first, then add new ones.' : ''}
${recentProgress.length > 0 ? 'Reference their recent progress where relevant to keep tasks specific.' : ''}
Structure the response as:
1. A short motivational opener (1 sentence)
2. Today's Action Plan — number each task: 1. task, 2. task etc.
3. One focus tip for the day`;

  return ask(system, user);
}

export async function generateCheckin(firstName, timeSlot, todayPlan) {
  const timeLabels = {
    '9am':  'morning (they just started the day)',
    '12pm': 'midday (half the day is done)',
    '3pm':  'afternoon (energy may be dipping)',
    '6pm':  'evening (wrapping up work)',
  };

  const system = `You are a supportive accountability coach sending a quick check-in message.
Be warm but brief — 2-4 sentences max. Ask one specific question about their progress.`;

  const user = `Send a ${timeLabels[timeSlot]} check-in to ${firstName}.
Their plan for today was:
${todayPlan}

Ask how they're doing with a specific task from their plan. Be encouraging.`;

  return ask(system, user);
}

export async function generateEveningWrapup(firstName, todayPlan, responses, streak) {
  const responseLog = responses.length > 0
    ? responses.map(r => `- ${r.checkin_time}: "${r.response_text}"`).join('\n')
    : 'No check-in responses recorded today.';

  const system = `You are a reflective accountability coach doing an end-of-day wrap-up.
Be warm, honest, and forward-looking. Max 200 words.`;

  const user = `Do an end-of-day wrap-up for ${firstName}.
Current streak: ${streak} days 🔥

Today's plan was:
${todayPlan}

Their check-in responses today:
${responseLog}

Write a wrap-up that:
1. Acknowledges their effort today (honest, not just flattery)
2. Notes one win and one thing to improve
3. Briefly previews tomorrow's mindset
4. Ends with their streak status`;

  return ask(system, user);
}

export async function generateWeeklySummary(firstName, goals, weekPlans, streakData) {
  const goalList = goals.map(g => `- ${g.goal_text}`).join('\n');
  const planDays = weekPlans.map(p => `${p.activity_date}: ${p.content?.slice(0, 100)}...`).join('\n');

  const system = `You are an insightful weekly review coach.
Generate a structured, honest weekly summary. Max 350 words. Use clear sections.`;

  const user = `Generate a weekly summary for ${firstName}.

Goals they're working on:
${goalList}

This week's daily plans (${weekPlans.length}/7 days active):
${planDays}

Streak stats: Current ${streakData.current_streak} days | Best ever ${streakData.longest_streak} days

Structure the summary as:
🏆 Week in Review — [date range]
✅ Wins this week
📈 Progress on goals
🔍 Patterns noticed
🎯 Focus for next week
🔥 Streak: [current] days (Best: [longest])`;

  return ask(system, user);
}

export async function categoriseGoal(rawGoalText) {
  const system = `You are a goal categorisation assistant.
Respond with ONLY a JSON object, no markdown, no backticks.`;

  const user = `Categorise this goal: "${rawGoalText}"
Return JSON: { "category": "<one of: health, career, finance, education, relationships, personal, general>", "cleaned_goal": "<rewritten clearly and specifically>" }`;

  const raw = await ask(system, user);
  try {
    return JSON.parse(raw);
  } catch {
    return { category: 'general', cleaned_goal: rawGoalText };
  }
}