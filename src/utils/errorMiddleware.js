// src/utils/errorMiddleware.js
// ============================================================
// Express error-handling middleware.
// Add this AFTER all routes in index.js.
// ============================================================

import { logger } from './logger.js';
import { config } from '../config/index.js';

/**
 * 404 handler — catches requests to unknown routes.
 */
export function notFound(req, res, next) {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
}

/**
 * Global Express error handler.
 * Any route that calls next(err) lands here.
 */
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  logger.error('Express', err.message, { stack: err.stack?.slice(0, 300) });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
  });
}