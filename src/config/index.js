// src/config/index.js
// ============================================================
// Single source of truth for all environment variables.
// Import this instead of process.env directly anywhere else.
// Validates required vars on startup so you fail fast & clear.
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

const required = [
  'GROQ_API_KEY',
  'TELEGRAM_TOKEN',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
  'DATABASE_URL',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`\n❌ Missing required environment variables:\n   ${missing.join('\n   ')}\n`);
  console.error('Copy .env.example to .env and fill in all values.\n');
  process.exit(1);
}

export const config = {
  // ── App ────────────────────────────────────────────────────
  port:        parseInt(process.env.PORT || '3000', 10),
  nodeEnv:     process.env.NODE_ENV || 'development',
  debug:       process.env.DEBUG === 'true',
  timezone:    process.env.TZ || 'Africa/Lagos',
  webhookBase: process.env.WEBHOOK_BASE_URL || '',

  // ── Groq ───────────────────────────────────────────────────
  groq: {
    apiKey:    process.env.GROQ_API_KEY,
    model:     'llama-3.3-70b-versatile',
    maxTokens: 1024,
  },

  // ── Telegram ───────────────────────────────────────────────
  telegram: {
    token: process.env.TELEGRAM_TOKEN,
  },

  // ── Twilio / WhatsApp ──────────────────────────────────────
  twilio: {
    accountSid:      process.env.TWILIO_ACCOUNT_SID,
    authToken:       process.env.TWILIO_AUTH_TOKEN,
    whatsappNumber:  process.env.TWILIO_WHATSAPP_NUMBER,
  },

  // ── Database ───────────────────────────────────────────────
  db: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    poolMax:         10,
    idleTimeout:     30000,
    connectionTimeout: 5000,
  },
};