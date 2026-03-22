// src/utils/helpers.js
// ============================================================
// General-purpose utility functions.
// ============================================================

/**
 * Retry an async function up to `maxAttempts` times with exponential back-off.
 * Useful for Claude API calls and DB queries on flaky connections.
 *
 * @param {Function} fn           - Async function to retry
 * @param {number}   maxAttempts  - Total attempts (default 3)
 * @param {number}   baseDelayMs  - Initial delay in ms (doubles each retry)
 */
export async function withRetry(fn, maxAttempts = 3, baseDelayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Sleep for `ms` milliseconds.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format a Date object as a human-readable string (e.g. "Monday, 3 June 2025").
 */
export function formatDate(date = new Date()) {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
  });
}

/**
 * Get the ISO date string (YYYY-MM-DD) for today or an offset.
 * @param {number} offsetDays - Negative for past days, positive for future
 */
export function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

/**
 * Truncate a string to `maxLen` characters, adding ellipsis if needed.
 */
export function truncate(str, maxLen = 100) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Chunk an array into groups of `size`.
 * Useful for batching DB operations or API calls.
 */
export function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Simple rate limiter — ensures a minimum gap between calls.
 * Returns a wrapped version of `fn` that enforces `minIntervalMs`.
 */
export function rateLimited(fn, minIntervalMs = 1000) {
  let lastCall = 0;
  return async (...args) => {
    const now = Date.now();
    const wait = minIntervalMs - (now - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn(...args);
  };
}

/**
 * Escape Markdown special characters for Telegram MarkdownV2 mode.
 * (Not needed for parse_mode: 'Markdown' but useful if you upgrade.)
 */
export function escapeMd(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Check if today is Sunday.
 */
export function isSunday() {
  return new Date().getDay() === 0;
}

/**
 * Get the start of the current week (Monday) as ISO string.
 */
export function weekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day); // adjust for Sunday
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}