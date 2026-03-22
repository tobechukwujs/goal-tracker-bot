// src/utils/logger.js
// ============================================================
// Lightweight structured logger.
// Prefixes every log with a timestamp and level tag.
// Set DEBUG=true in .env to enable verbose debug logs.
// ============================================================

const levels = {
  info:  { label: 'INFO ', color: '\x1b[36m' },
  warn:  { label: 'WARN ', color: '\x1b[33m' },
  error: { label: 'ERROR', color: '\x1b[31m' },
  debug: { label: 'DEBUG', color: '\x1b[90m' },
};

const RESET    = '\x1b[0m';
// logger.js intentionally reads DEBUG directly — it loads before config to avoid circular deps
const DEBUG_ON = process.env.DEBUG === 'true';

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(level, context, message, meta) {
  if (level === 'debug' && !DEBUG_ON) return;

  const { label, color } = levels[level];
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`${color}[${timestamp()}] ${label}${RESET} [${context}] ${message}${metaStr}`);
}

export const logger = {
  info:  (ctx, msg, meta) => log('info',  ctx, msg, meta),
  warn:  (ctx, msg, meta) => log('warn',  ctx, msg, meta),
  error: (ctx, msg, meta) => log('error', ctx, msg, meta),
  debug: (ctx, msg, meta) => log('debug', ctx, msg, meta),
};

// Convenience: replace default console.error so unhandled errors also get formatted
export function setupGlobalErrorLogging() {
  process.on('unhandledRejection', (reason) => {
    logger.error('Process', 'Unhandled promise rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('Process', 'Uncaught exception', { message: err.message, stack: err.stack });
    process.exit(1);
  });
}