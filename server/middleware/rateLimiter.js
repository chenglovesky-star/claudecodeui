// server/middleware/rateLimiter.js
// API rate limiting (security)
import rateLimit from 'express-rate-limit';

// Strict limit for auth endpoints (login, register)
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,               // 10 attempts per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' },
});

// General API limit
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 200,              // 200 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' },
});
