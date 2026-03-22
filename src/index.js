// src/index.js
// ============================================================
// Application entry point.
// Boots the Express server, Telegram bot, and cron schedulers.
// ============================================================

import './config/index.js'; // validates all env vars on startup
import express from 'express';
import { initTelegram } from './platforms/telegram.js';
import { initWhatsApp } from './platforms/whatsapp.js';
import { startSchedulers } from './schedulers/index.js';
import { pool } from './db/index.js';
import { logger, setupGlobalErrorLogging } from './utils/logger.js';
import { notFound, errorHandler } from './utils/errorMiddleware.js';
import { config } from './config/index.js';

setupGlobalErrorLogging();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Health Check ─────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Goal Tracker Bot v2', timestamp: new Date().toISOString() });
});

// ── Platform Init ─────────────────────────────────────────────

initTelegram();
initWhatsApp(app);

// ── Error Middleware (must be after routes) ───────────────────

app.use(notFound);
app.use(errorHandler);

// ── Schedulers ────────────────────────────────────────────────

startSchedulers();

// ── Start Server ──────────────────────────────────────────────

const PORT = config.port;
app.listen(PORT, () => {
  logger.info('App', `Goal Tracker Bot v2 running on port ${PORT}`);
  logger.info('App', 'Telegram polling active');
  logger.info('App', 'WhatsApp webhook ready at POST /webhook/whatsapp');
  logger.info('App', 'All schedulers registered');
});

// ── Graceful Shutdown ─────────────────────────────────────────

process.on('SIGTERM', async () => {
  logger.info('App', 'SIGTERM received — shutting down gracefully');
  await pool.end();
  process.exit(0);
});