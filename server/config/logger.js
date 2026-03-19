// server/config/logger.js
// Structured logging with pino (replaces console.log)
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

/**
 * Create a child logger with a module prefix.
 * Usage: const log = createLogger('Transport');
 *        log.info('heartbeat started');
 * Output: [HH:MM:ss] INFO (Transport): heartbeat started
 */
export function createLogger(module) {
  return logger.child({ module });
}

export default logger;
