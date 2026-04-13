/**
 * rateLimit.ts — Express rate limiters
 *
 * H-01: Uses rate-limit-redis store so limits are shared across all Node
 * processes / pods. Without a shared store, each process keeps its own
 * counter and users can bypass limits by load-balancing across processes.
 *
 * rate-limit-redis v4 works with ioredis via a generic sendCommand wrapper.
 */
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import redis from '../config/redis.js';

/** Build a RedisStore that uses the shared ioredis connection */
function makeRedisStore(prefix: string): RedisStore {
  return new RedisStore({
    // rate-limit-redis v4 generic sendCommand for ioredis:
    // ioredis.call() executes arbitrary commands and returns Promise<unknown>
    sendCommand: (command: string, ...args: string[]): Promise<number> =>
      (redis as unknown as {
        call(command: string, ...args: string[]): Promise<unknown>;
      }).call(command, ...args) as Promise<number>,
    prefix,
  });
}

// General API rate limiter — 100 requests per 15 minutes
export const rateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore('rl:general:'),
  message: { ok: false, error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/health',
});

// Stricter limiter for auth endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore('rl:auth:'),
  message: { ok: false, error: 'Too many auth attempts, please try again later.' },
});

// Financial endpoints — very strict
export const financialRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore('rl:financial:'),
  message: { ok: false, error: 'Rate limit exceeded for financial operations.' },
});

// Admin endpoints — 5 attempts per 15 minutes across ALL processes
export const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore('rl:admin:'),
  message: { ok: false, error: 'Too many admin attempts. Try again in 15 minutes.' },
  keyGenerator: (req) => {
    const wallet = req.headers['x-admin-wallet'] as string ?? 'unknown';
    const ip     = ipKeyGenerator(req.ip ?? '');
    return `${ip}:${wallet.slice(-8)}`;
  },
});
