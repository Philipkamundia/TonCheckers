import rateLimit from 'express-rate-limit';

// General API rate limiter — 100 requests per 15 minutes
export const rateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/health', // never rate-limit health checks
});

// Stricter limiter for auth endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many auth attempts, please try again later.' },
});

// Financial endpoints — very strict
export const financialRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Rate limit exceeded for financial operations.' },
});

// Admin endpoints — 5 attempts per 15 minutes, locks out brute force
export const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many admin attempts. Try again in 15 minutes.' },
  keyGenerator: (req) => {
    const wallet = req.headers['x-admin-wallet'] as string ?? 'unknown';
    // Normalize IPv6 to avoid ERR_ERL_KEY_GEN_IPV6
    const ip = (req.ip ?? '').replace(/^::ffff:/, '');
    return `${ip}:${wallet.slice(-8)}`;
  },
});
