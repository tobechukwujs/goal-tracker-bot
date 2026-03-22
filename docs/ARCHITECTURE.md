# 🏗️ Architecture Overview

How Goal Tracker Bot v2 is structured and why.

---

## High-Level Flow

```
User sends message
       │
       ▼
┌──────────────────────────────────────────┐
│           Platform Layer                 │
│  telegram.js          whatsapp.js        │
│  (polling)            (webhook)          │
└──────────────┬───────────────────────────┘
               │ calls
               ▼
┌──────────────────────────────────────────┐
│         commandHandler.js                │
│  Platform-agnostic logic.                │
│  Calls DB + Claude, then sends reply.    │
└──────┬─────────────────┬─────────────────┘
       │                 │
       ▼                 ▼
┌────────────┐    ┌────────────────┐
│  db/       │    │  claude.js     │
│  index.js  │    │                │
│            │    │  Anthropic API │
│  Supabase  │    │  prompts       │
│  PostgreSQL│    └────────────────┘
└────────────┘
       ▲
       │ also used by
┌──────────────────────────────────────────┐
│           schedulers/index.js            │
│  Cron jobs — run for ALL users           │
│  6AM plan · check-ins · 9PM · Sunday     │
└──────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. Platform-agnostic command handler
All command logic lives in `commandHandler.js`. The Telegram and WhatsApp files only handle the platform-specific routing (parsing incoming messages, extracting the user identity) and then call the same handler functions.

**Why?** Adding a new platform (e.g. Discord, SMS) means creating one new file in `platforms/` and calling the existing handlers. Zero business logic needs to change.

### 2. Unified messenger.js
`sendMessage({ platform, chatId, text })` is the single function for sending any message on any platform.

**Why?** The scheduler and command handler never need to know which platform a user is on. They just call `broadcast(platforms, text)` and the messenger handles routing.

### 3. All SQL in db/index.js
No raw SQL queries exist anywhere else in the codebase.

**Why?** If the DB schema changes (e.g. renaming a column), there's exactly one file to update.

### 4. Claude service separation
All AI prompt construction and Anthropic API calls are isolated in `claude.js`.

**Why?** Prompts are the "product" of an AI app. Keeping them in one place makes them easy to iterate, A/B test, or swap for a different model.

---

## Data Flow: Morning Plan (6 AM Cron)

```
node-cron triggers runMorningPlan()
  │
  ├─ db.getAllActiveUsers()          → get all users + their platforms
  │
  └─ for each user:
      ├─ db.resetStreakIfMissed()    → check if streak should be reset
      ├─ db.getGoals(userId)         → fetch their active goals
      ├─ db.getStreak(userId)        → fetch current streak count
      ├─ claude.generateDailyPlan()  → AI generates plan text
      ├─ db.saveDailyPlan()          → store in daily_activities
      └─ broadcast(platforms, plan)  → send to Telegram + WhatsApp
```

---

## Data Flow: User Sends /addgoal

```
User: "/addgoal Run a 5K by September"
  │
  ├─ [Telegram] telegram.js catches onText(/\/addgoal (.+)/)
  │     OR
  │   [WhatsApp] whatsapp.js receives POST /webhook/whatsapp
  │
  ├─ db.getUserByPlatformId()        → find user in DB
  │
  └─ commandHandler.handleAddGoal()
      ├─ claude.categoriseGoal()     → "health", "Run a 5K by September"
      ├─ db.addGoal()                → save to goals table
      └─ sendMessage()               → confirm to user
```

---

## Shared User Identity (Cross-Platform)

Users are stored once in the `users` table. Their Telegram and WhatsApp accounts are linked via `user_platforms`.

```
users
  id: 42
  phone: "+2348012345678"
  first_name: "Tobechukwu"

user_platforms
  user_id: 42  platform: "telegram"   platform_id: "123456789"
  user_id: 42  platform: "whatsapp"   platform_id: "whatsapp:+2348012345678"
```

The scheduler calls `db.getAllActiveUsers()` which joins these tables, then `broadcast()` sends to both platforms simultaneously.

---

## Environment Variables

| Variable | Used in |
|---|---|
| `ANTHROPIC_API_KEY` | `src/services/claude.js` |
| `TELEGRAM_TOKEN` | `src/services/messenger.js` |
| `TWILIO_*` | `src/services/messenger.js` |
| `DATABASE_URL` | `src/db/index.js` |
| `TZ` | `src/schedulers/index.js` |
| `PORT` | `src/index.js` |