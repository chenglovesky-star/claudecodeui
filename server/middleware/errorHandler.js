// server/middleware/errorHandler.js
// Global Express error handler and unhandled rejection catcher

import { createLogger } from '../config/logger.js';

const log = createLogger('Error');

/**
 * Express error-handling middleware.
 * Must be added AFTER all routes.
 * Signature: (err, req, res, next) — 4 args required for Express to recognize it as error handler.
 */
export function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';

  log.error(`${req.method} ${req.originalUrl} → ${status}: ${message}`);
  if (status === 500) {
    log.error({ stack: err.stack }, 'Stack trace');
  }

  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

/**
 * Catch unhandled promise rejections and uncaught exceptions.
 * Call once at startup.
 */
export function setupGlobalErrorHandlers() {
  process.on('unhandledRejection', (reason, promise) => {
    log.fatal({ reason }, 'Unhandled Promise rejection');
  });

  process.on('uncaughtException', (error) => {
    log.fatal({ err: error }, 'Uncaught exception');
    // Give time for logging, then exit
    setTimeout(() => process.exit(1), 1000);
  });
}
