/**
 * tests/unit/barrel/barrel.test.ts
 *
 * Verifies that barrel export files re-export their key symbols.
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Mocks needed to import barrel files without real connections ─────────────

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({
  default: {
    set: vi.fn(), get: vi.fn(), del: vi.fn(), on: vi.fn(),
    // rate-limit-redis calls .call() for SCRIPT LOAD and EVALSHA
    // It expects a string response for SCRIPT LOAD (the SHA1 hash)
    call: vi.fn().mockImplementation((cmd: string) => {
      if (cmd === 'SCRIPT') return Promise.resolve('abc123sha1hashvalue0000000000000000000000');
      return Promise.resolve('OK');
    }),
    sendCommand: vi.fn().mockResolvedValue('OK'),
  },
  redis: {
    set: vi.fn(), get: vi.fn(), del: vi.fn(), on: vi.fn(),
    call: vi.fn().mockResolvedValue('OK'),
  },
  checkRedisConnection: vi.fn(),
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger:       { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  morganStream: { write: vi.fn() },
  default:      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../apps/backend/src/config/sentry.js', () => ({
  initSentry: vi.fn(),
}));

vi.mock('../../../apps/backend/src/notifications/botService.js', () => ({
  bot: null,
  sendTelegramMessage: vi.fn(),
}));

// ─── engine/index.ts ─────────────────────────────────────────────────────────

describe('engine/index.ts barrel', () => {
  it('re-exports getAvailableMoves', async () => {
    const { getAvailableMoves } = await import('../../../apps/backend/src/engine/index.js');
    expect(typeof getAvailableMoves).toBe('function');
  });

  it('re-exports checkWinCondition', async () => {
    const { checkWinCondition } = await import('../../../apps/backend/src/engine/index.js');
    expect(typeof checkWinCondition).toBe('function');
  });

  it('re-exports applyMoveWithPromotion', async () => {
    const { applyMoveWithPromotion } = await import('../../../apps/backend/src/engine/index.js');
    expect(typeof applyMoveWithPromotion).toBe('function');
  });

  it('re-exports hashBoardState', async () => {
    const { hashBoardState } = await import('../../../apps/backend/src/engine/index.js');
    expect(typeof hashBoardState).toBe('function');
  });

  it('re-exports nextGameState', async () => {
    const { nextGameState } = await import('../../../apps/backend/src/engine/index.js');
    expect(typeof nextGameState).toBe('function');
  });

  it('re-exports initialGameState', async () => {
    const { initialGameState } = await import('../../../apps/backend/src/engine/index.js');
    expect(typeof initialGameState).toBe('function');
  });
});

// ─── services/index.ts ───────────────────────────────────────────────────────

describe('services/index.ts barrel', () => {
  it('re-exports AuthService', async () => {
    const { AuthService } = await import('../../../apps/backend/src/services/index.js');
    expect(AuthService).toBeDefined();
  });

  it('re-exports BalanceService', async () => {
    const { BalanceService } = await import('../../../apps/backend/src/services/index.js');
    expect(BalanceService).toBeDefined();
  });

  it('re-exports GameService', async () => {
    const { GameService } = await import('../../../apps/backend/src/services/index.js');
    expect(GameService).toBeDefined();
  });

  it('re-exports SettlementService', async () => {
    const { SettlementService } = await import('../../../apps/backend/src/services/index.js');
    expect(SettlementService).toBeDefined();
  });

  it('re-exports AiGameService', async () => {
    const { AiGameService } = await import('../../../apps/backend/src/services/index.js');
    expect(AiGameService).toBeDefined();
  });

  it('re-exports GameTimerService', async () => {
    const { GameTimerService } = await import('../../../apps/backend/src/services/index.js');
    expect(GameTimerService).toBeDefined();
  });

  it('re-exports MatchmakingService', async () => {
    const { MatchmakingService } = await import('../../../apps/backend/src/services/index.js');
    expect(MatchmakingService).toBeDefined();
  });

  it('re-exports EloService', async () => {
    const { EloService } = await import('../../../apps/backend/src/services/index.js');
    expect(EloService).toBeDefined();
  });
});

// ─── middleware/index.ts ──────────────────────────────────────────────────────

describe('middleware/index.ts barrel', () => {
  it('re-exports requireAuth', async () => {
    const { requireAuth } = await import('../../../apps/backend/src/middleware/index.js');
    expect(typeof requireAuth).toBe('function');
  });

  it('re-exports AppError', async () => {
    const { AppError } = await import('../../../apps/backend/src/middleware/index.js');
    expect(AppError).toBeDefined();
    const err = new AppError(404, 'Not found', 'NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.code).toBe('NOT_FOUND');
  });

  it('re-exports errorHandler', async () => {
    const { errorHandler } = await import('../../../apps/backend/src/middleware/index.js');
    expect(typeof errorHandler).toBe('function');
  });

  it('re-exports rateLimitMiddleware', async () => {
    const { rateLimitMiddleware } = await import('../../../apps/backend/src/middleware/index.js');
    expect(typeof rateLimitMiddleware).toBe('function');
  });
});
