# 🎯 Goal Tracker Bot v2

An AI-powered accountability bot for **Telegram** and **WhatsApp** that helps you set goals, stay consistent, and track progress — powered by **Claude AI** (Anthropic).

> Built with Node.js · PostgreSQL (Supabase) · Twilio · Claude AI · Deployed on Render

---

## ✨ What's New in v2

| Feature | v1 (Original) | v2 (This) |
|---|---|---|
| AI Model | Gemini 2.5 Flash | **Claude (Anthropic)** |
| Platforms | Telegram only | **Telegram + WhatsApp** |
| Goal management | Add only | **Add, Edit, Delete, Categorise** |
| Streak tracking | ❌ | **✅ Daily streaks with longest record** |
| Weekly summaries | ❌ | **✅ AI-generated every Sunday** |
| Check-in responses | Not saved | **Saved and used in wrap-up** |
| Code structure | Single file | **Modular, maintainable folders** |

---

## 🗂️ Folder Structure

```
goal-tracker-bot/
│
├── src/
│   ├── index.js                     # Entry point — boots server, platforms, schedulers
│   │
│   ├── config/
│   │   └── index.js                 # All env vars in one place, validated on startup
│   │
│   ├── platforms/                   # One file per messaging platform
│   │   ├── telegram.js              # Telegram command routing (polling)
│   │   └── whatsapp.js              # WhatsApp Twilio webhook handler
│   │
│   ├── services/                    # Core business logic, shared across platforms
│   │   ├── claude.js                # All Claude AI prompts & API calls
│   │   ├── messenger.js             # Unified send function (Telegram + WhatsApp)
│   │   └── commandHandler.js        # Platform-agnostic command logic
│   │
│   ├── schedulers/
│   │   └── index.js                 # All 7 cron jobs (6AM, check-ins, 9PM, Sunday)
│   │
│   ├── db/
│   │   └── index.js                 # DB connection pool + every SQL query
│   │
│   └── utils/
│       ├── logger.js                # Structured timestamped logger (INFO/WARN/ERROR/DEBUG)
│       ├── validate.js              # Input validation for all user commands
│       ├── helpers.js               # withRetry, rateLimited, chunk, formatDate, etc.
│       └── errorMiddleware.js       # Express 404 + global error handler
│
├── scripts/                         # Dev & ops scripts (not part of the running app)
│   ├── seed.js                      # Create test user + goals in DB
│   └── test-plan.js                 # Manually fire AI jobs without waiting for cron
│
├── sql/
│   └── schema.sql                   # Run once in Supabase to create all tables
│
├── docs/
│   ├── ARCHITECTURE.md              # How the pieces fit together
│   ├── DEPLOYMENT.md                # Step-by-step Render deployment guide
│   └── WHATSAPP_SETUP.md            # Twilio + WhatsApp sandbox & production guide
│
├── nodemon.json                     # Dev server config (watches src/, restarts on change)
├── package.json                     # Dependencies + npm scripts
├── .env.example                     # Copy to .env — all required variables listed
├── .gitignore
└── README.md
```

**Design principles behind this structure:**

- **`config/`** — Every `process.env` reference lives here. All other files import from `config/index.js`. Missing vars are caught at startup with a clear error message, not buried in a runtime crash.
- **`platforms/`** — Adding a new platform (Discord, SMS) = create one new file here. Zero changes to business logic.
- **`services/`** — All reusable logic. Command handling, AI calls, and message sending are each in their own file with a single clear responsibility.
- **`schedulers/`** — All cron jobs together. Timing changes happen in one place.
- **`db/`** — Every SQL query in one file. Schema changes don't ripple across the codebase.
- **`utils/`** — Shared helpers with no app-specific knowledge. Portable to any project.
- **`scripts/`** — Developer tooling that runs outside the app. Never imported by `src/`.
- **`sql/`** — Infrastructure as code. Your database schema is version-controlled alongside your app.

---

## 🚀 Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/tobechukwujs/goal-tracker-bot.git
cd goal-tracker-bot
git checkout v2   # or whichever branch you put this on
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in all values. See the table below:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `TELEGRAM_TOKEN` | [@BotFather](https://t.me/BotFather) on Telegram |
| `TWILIO_ACCOUNT_SID` | [console.twilio.com](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | [console.twilio.com](https://console.twilio.com) |
| `TWILIO_WHATSAPP_NUMBER` | Twilio sandbox: `whatsapp:+14155238886` |
| `DATABASE_URL` | Your Supabase project → Settings → Database → Connection string |
| `TZ` | Your timezone, e.g. `Africa/Lagos` |
| `WEBHOOK_BASE_URL` | Your deployed Render URL |

### 3. Set up the database

1. Go to your [Supabase](https://supabase.com) project
2. Open the **SQL Editor**
3. Paste and run the contents of `sql/schema.sql`

### 4. Run locally

```bash
npm run dev     # auto-restarts on changes (uses nodemon)
npm start       # production start
```

---

## 📱 Platform Setup

### Telegram
No extra setup needed — just create a bot via [@BotFather](https://t.me/BotFather) and paste the token in `.env`.

### WhatsApp (Twilio)
See [`docs/WHATSAPP_SETUP.md`](docs/WHATSAPP_SETUP.md) for the full step-by-step guide.

**Short version:**
1. Create a [Twilio account](https://www.twilio.com)
2. Enable the WhatsApp Sandbox in the Twilio Console
3. Deploy this app to Render (see `docs/DEPLOYMENT.md`)
4. Set your webhook URL in Twilio: `https://your-app.onrender.com/webhook/whatsapp`
5. Optionally apply for a WhatsApp Business number for production

---

## 🤖 Bot Commands

### Telegram
| Command | What it does |
|---|---|
| `/start` | Register and get a welcome message |
| `/goals` | List all your active goals |
| `/addgoal <text>` | Add a new goal (Claude auto-categorises it) |
| `/editgoal <id> <text>` | Edit an existing goal |
| `/deletegoal <id>` | Remove a goal |
| `/generate` | Generate today's plan right now |
| `/today` | Show today's plan |
| `/streak` | Show your current streak |
| `/help` | Show all commands |

### WhatsApp
Same commands — just type them without the `/`:
- `start`, `goals`, `addgoal <text>`, `editgoal <id> <text>`, etc.

---

## ⏰ Automated Schedule (WAT)

| Time | What happens |
|---|---|
| 6:00 AM | 🌅 Claude generates your personalised daily plan |
| 9:00 AM | ⏰ Morning check-in |
| 12:00 PM | ⏰ Midday check-in |
| 3:00 PM | ⏰ Afternoon check-in |
| 6:00 PM | ⏰ Evening check-in |
| 9:00 PM | 🌙 End-of-day wrap-up (uses your check-in replies) |
| Sunday 8:00 PM | 📊 Weekly summary — wins, patterns, next-week focus |

---

## 🧠 How Claude AI Is Used

| Prompt | What Claude does |
|---|---|
| Morning plan | Reads your goals → generates 5-7 specific daily tasks |
| Check-ins | Writes a personalised nudge referencing your actual plan |
| Evening wrap-up | Reflects on your check-in responses + streak |
| Weekly summary | Analyses 7 days of plans + streak → insights and suggestions |
| Goal categorisation | Reads a raw goal → assigns category + cleans up the text |

All prompts are in `src/services/claude.js`.

---

## ☁️ Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for full instructions. Quick summary:

1. Push to GitHub (use a **private** repo — your `.env` should never be committed)
2. Create a **Web Service** on [Render](https://render.com)
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `node src/index.js`
5. Add all environment variables from `.env` in the Render dashboard
6. Use [UptimeRobot](https://uptimerobot.com) to ping your URL every 5 minutes (prevents Render free tier sleeping)

---

## 🗄️ Database Schema Overview

| Table | Purpose |
|---|---|
| `users` | One row per person, linked by phone number |
| `user_platforms` | Maps users to Telegram/WhatsApp identities |
| `goals` | Long-term goals (with category, priority, target date) |
| `daily_activities` | AI-generated daily plan per user per day |
| `checkin_responses` | User's replies during check-ins |
| `streaks` | Current + longest streak per user |
| `weekly_summaries` | Stored weekly AI summaries |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 |
| Language | JavaScript (ES Modules) |
| AI | Claude (`claude-sonnet-4-20250514`) via Anthropic SDK |
| Telegram | `node-telegram-bot-api` |
| WhatsApp | Twilio WhatsApp API |
| Database | PostgreSQL via Supabase (`pg` pool) |
| Scheduling | `node-cron` |
| HTTP Server | Express |
| Deployment | Render |

---

## 🤝 Contributing

Pull requests are welcome. For major changes, open an issue first.

## 📄 License

MIT — open source, free for personal use.