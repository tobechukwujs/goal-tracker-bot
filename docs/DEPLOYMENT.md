# ☁️ Deployment Guide (Render)

This guide covers deploying the Goal Tracker Bot to Render's free tier.

---

## Why Render?

- Free tier available
- Direct GitHub integration (auto-deploys on push)
- Persistent environment variables
- Logs accessible from the dashboard

---

## Step 1 — Push to GitHub

Make sure your code is in a **private** GitHub repository. Your `.env` file must be in `.gitignore` (it is by default in this project).

```bash
git init
git add .
git commit -m "Initial commit - Goal Tracker Bot v2"
git remote add origin https://github.com/yourusername/goal-tracker-bot.git
git push -u origin main
```

---

## Step 2 — Create a Render Web Service

1. Go to [render.com](https://render.com) and sign up / log in
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account and select your repository
4. Configure the service:

| Setting | Value |
|---|---|
| **Name** | `goal-tracker-bot` (or anything you like) |
| **Region** | Frankfurt or closest to you |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node src/index.js` |
| **Instance Type** | Free |

---

## Step 3 — Add Environment Variables

In Render, go to your service → **Environment** tab → add each variable:

```
ANTHROPIC_API_KEY       = your_key
TELEGRAM_TOKEN          = your_token
TWILIO_ACCOUNT_SID      = your_sid
TWILIO_AUTH_TOKEN       = your_token
TWILIO_WHATSAPP_NUMBER  = whatsapp:+14155238886
DATABASE_URL            = your_supabase_connection_string
TZ                      = Africa/Lagos
PORT                    = 3000
WEBHOOK_BASE_URL        = https://your-app-name.onrender.com
```

---

## Step 4 — Deploy

Click **"Create Web Service"**. Render will:
1. Pull your code from GitHub
2. Run `npm install`
3. Start the app with `node src/index.js`

Watch the **Logs** tab to confirm it boots without errors. You should see:

```
🚀 Goal Tracker Bot v2 is running on port 3000
📱 Telegram: polling active
💬 WhatsApp: webhook at POST /webhook/whatsapp
⏰ Schedulers: all cron jobs active
```

---

## Step 5 — Set the WhatsApp Webhook

Once deployed, copy your Render URL (e.g. `https://goal-tracker-bot.onrender.com`) and set it as the webhook in your Twilio Console:

```
https://goal-tracker-bot.onrender.com/webhook/whatsapp
```

---

## Step 6 — Prevent Sleeping (Free Tier)

Render's free tier **spins down** after 15 minutes of inactivity. This would miss scheduled messages.

**Fix: UptimeRobot**
1. Sign up at [uptimerobot.com](https://uptimerobot.com) (free)
2. Add a new **HTTP(s)** monitor
3. URL: `https://goal-tracker-bot.onrender.com/`
4. Monitoring interval: **every 5 minutes**

This keeps your app awake 24/7.

---

## Auto-Deploy on Push

Any time you push to `main`, Render automatically redeploys. If you want to disable this, go to **Settings → Auto-Deploy → Off**.

---

## Checking Logs

In the Render dashboard → your service → **Logs** tab. All `console.log` and `console.error` output is visible here in real time.

---

## Upgrading from Free Tier

If you get more users, consider upgrading to Render's **Starter ($7/month)** plan which doesn't sleep and has better performance.