// server/middleware/errorHandler.js
// Global Express error handler and unhandled rejection catcher

/**
 * Express error-handling middleware.
 * Must be added AFTER all routes.
 * Signature: (err, req, res, next) — 4 args required for Express to recognize it as error handler.
 */
export function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';

  console.error(`[Error] ${req.method} ${req.originalUrl} → ${status}: ${message}`);
  if (status === 500) {
    console.error('[Error] Stack:', err.stack);
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
    console.error('[CRITICAL] Unhandled Promise rejection:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('[CRITICAL] Uncaught exception:', error);
    // Give time for logging, then exit
    setTimeout(() => process.exit(1), 1000);
  });
}
