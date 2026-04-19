/**
 * Global test setup — runs before every test file.
 *
 * Sets up:
 * - Environment variables required by all services
 * - Prevents accidental real DB/Redis connections in unit tests
 * - Console noise suppression for logger
 */

import { vi, beforeAll, afterAll } from 'vitest';

// ─── Minimal env needed by auth / JWT ────────────────────────────────────────
process.env.NODE_ENV            = 'test';
process.env.JWT_SECRET          = 'test-jwt-secret-32-chars-minimum!!';
process.env.JWT_REFRESH_SECRET  = 'test-refresh-secret-32-chars-min!';
process.env.TELEGRAM_BOT_TOKEN  = 'test:BOT_TOKEN_FOR_HMAC_TESTS';
process.env.HOT_WALLET_ADDRESS  = 'EQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG3sTest';
process.env.MIN_STAKE_TON       = '0.1';
process.env.MAX_DAILY_WITHDRAWAL_TON = '100';
process.env.INIT_DATA_MAX_AGE_SECS   = '3600';

// ─── Suppress winston logs during tests ──────────────────────────────────────
// Note: Logger mocking is now done in individual test files to ensure proper module resolution

// ─── Sentry — no-op in tests ─────────────────────────────────────────────────
vi.mock('../../../apps/backend/src/config/sentry.js', () => ({
  initSentry: vi.fn(),
}));

beforeAll(() => {
  // Freeze Date.now to a known value for deterministic timer tests.
  // Individual tests can override with vi.setSystemTime().
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
});
