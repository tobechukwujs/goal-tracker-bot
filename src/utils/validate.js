// src/utils/validate.js
// ============================================================
// Input validation for user-submitted data.
// Returns { valid: true } or { valid: false, error: '...' }
// ============================================================

/**
 * Validate goal text submitted by a user.
 */
export function validateGoalText(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, error: 'Goal text is required.' };
  }
  const trimmed = text.trim();
  if (trimmed.length < 5) {
    return { valid: false, error: 'Goal is too short. Please be more specific (at least 5 characters).' };
  }
  if (trimmed.length > 500) {
    return { valid: false, error: 'Goal is too long. Please keep it under 500 characters.' };
  }
  return { valid: true, value: trimmed };
}

/**
 * Validate a goal ID (must be a positive integer).
 */
export function validateGoalId(raw) {
  const id = parseInt(String(raw).trim(), 10);
  if (isNaN(id) || id <= 0) {
    return { valid: false, error: 'Invalid goal ID. Use `/goals` to find the correct ID.' };
  }
  return { valid: true, value: id };
}

/**
 * Validate the args string for /editgoal: "<id> <new text>"
 */
export function validateEditArgs(args) {
  if (!args || typeof args !== 'string') {
    return { valid: false, error: 'Usage: `/editgoal <id> <new goal text>`' };
  }
  const parts = args.trim().split(/\s+/);
  const idResult = validateGoalId(parts[0]);
  if (!idResult.valid) return idResult;

  const newText = parts.slice(1).join(' ');
  const textResult = validateGoalText(newText);
  if (!textResult.valid) return textResult;

  return { valid: true, id: idResult.value, goalText: textResult.value };
}

/**
 * Validate a priority value (1–5).
 */
export function validatePriority(raw) {
  const n = parseInt(String(raw).trim(), 10);
  if (isNaN(n) || n < 1 || n > 5) {
    return { valid: false, error: 'Priority must be a number between 1 (highest) and 5 (lowest).' };
  }
  return { valid: true, value: n };
}

/**
 * Validate a date string (YYYY-MM-DD).
 */
export function validateDate(raw) {
  if (!raw) return { valid: true, value: null }; // optional
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    return { valid: false, error: 'Invalid date. Use YYYY-MM-DD format, e.g. `2025-12-31`.' };
  }
  if (d < new Date()) {
    return { valid: false, error: 'Target date must be in the future.' };
  }
  return { valid: true, value: raw.trim() };
}