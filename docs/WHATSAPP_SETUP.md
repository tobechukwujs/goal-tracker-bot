# 💬 WhatsApp Setup Guide (Twilio)

This guide walks you through connecting your bot to WhatsApp using Twilio's WhatsApp Business API.

---

## Overview

WhatsApp doesn't have an open bot API like Telegram. To send and receive WhatsApp messages programmatically, you use **Twilio** as the middleware — they handle the WhatsApp Business API layer for you.

**Two phases:**
1. **Sandbox** — Test immediately for free with a shared Twilio number (no approval needed)
2. **Production** — Apply for your own WhatsApp Business number (1–3 day approval)

---

## Phase 1: Sandbox Setup (Testing)

### Step 1 — Create a Twilio account

Go to [twilio.com](https://www.twilio.com) and sign up for a free account.

### Step 2 — Get your credentials

In the Twilio Console dashboard, copy:
- **Account SID** → paste as `TWILIO_ACCOUNT_SID` in your `.env`
- **Auth Token** → paste as `TWILIO_AUTH_TOKEN` in your `.env`

### Step 3 — Enable WhatsApp Sandbox

1. In the Twilio Console, go to **Messaging → Try it out → Send a WhatsApp message**
2. You'll see a sandbox number (usually `+1 415 523 8886`)
3. Set `TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886` in your `.env`
4. Follow the on-screen instructions — you'll send a WhatsApp message to the sandbox number with a join code like `join <word>-<word>`

### Step 4 — Set the webhook URL

1. Deploy your app first (see `DEPLOYMENT.md`)
2. In the Twilio Console → Messaging → Settings → WhatsApp Sandbox Settings
3. Set **"When a message comes in"** to:
   ```
   https://your-app.onrender.com/webhook/whatsapp
   ```
   Method: **HTTP POST**

### Step 5 — Test it

Send `start` to the Twilio sandbox WhatsApp number. You should receive a welcome message.

---

## Phase 2: Production (Your own WhatsApp number)

> ⚠️ This requires Meta (Facebook) business verification. It typically takes 1–3 business days.

### Step 1 — Apply for a WhatsApp Business number

1. In the Twilio Console, go to **Messaging → Senders → WhatsApp Senders**
2. Click **"Request Access"**
3. Fill in your business details and submit

### Step 2 — Create Message Templates

WhatsApp requires pre-approved **message templates** for any **outbound** messages your bot initiates (the scheduled messages — morning plan, check-ins, etc.).

Go to **Messaging → Content Template Builder** and create templates for:

| Template Name | Content Example |
|---|---|
| `morning_plan` | `Hello {{1}}! Here is your personalised plan for today: {{2}}` |
| `checkin_reminder` | `Hey {{1}}, quick check-in: {{2}}` |
| `evening_wrapup` | `Good evening {{1}}! Here's your end-of-day wrap-up: {{2}}` |
| `weekly_summary` | `Hi {{1}}! Here's your weekly summary: {{2}}` |

Submit these for Meta approval. This typically takes a few hours to 1 day.

> ℹ️ **Note:** User-initiated messages (replies to your bot) and their responses do NOT require templates — only your outbound scheduled messages do.

### Step 3 — Update your webhook

Once approved, update the webhook URL in your Twilio settings to point to your production app.

---

## Troubleshooting

**Messages not arriving?**
- Check the Twilio Console → Monitor → Logs → Messaging for error details
- Make sure your Render app is running (visit the health check URL: `https://your-app.onrender.com/`)
- Verify your webhook URL is exactly right (no trailing slash issues)

**"Sandbox session expired"?**
- In the sandbox, each user must re-join every 72 hours of inactivity
- This limitation disappears in production

**Template rejected?**
- Make sure your template doesn't sound too promotional
- Keep it purely functional and informational
- Review [Meta's template guidelines](https://developers.facebook.com/docs/whatsapp/message-templates/guidelines)

---

## Cost

- **Sandbox:** Free for testing
- **Production:** Twilio charges per message. Check [twilio.com/whatsapp/pricing](https://www.twilio.com/en-us/whatsapp/pricing)
- At typical usage (7 messages/day per user), costs are very low