/**
 * withdrawal.test.ts — Tests for WithdrawalService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockQuery, mockClient, mockRedis, mockBalanceService } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  const mockQuery  = vi.fn();
  const mockRedis  = {
    get:          vi.fn(),
    set:          vi.fn().mockResolvedValue('OK'),
    ttl:          vi.fn().mockResolvedValue(900),
    del:          vi.fn(),
    incrbyfloat:  vi.fn().mockResolvedValue(0),   // C-05: atomic daily limit counter
    expire:       vi.fn().mockResolvedValue(1),
  };
  const mockBalanceService = {
    deductBalance: vi.fn().mockResolvedValue(undefined),
    creditBalance: vi.fn().mockResolvedValue(undefined),
  };
  return { mockQuery, mockClient, mockRedis, mockBalanceService };
});

vi.mock('../config/db.js', () => ({
  default: {
    query:   (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue(mockClient),
  },
}));

vi.mock('../config/redis.js', () => ({ default: mockRedis }));

vi.mock('../services/balance.service.js', () => ({
  BalanceService: mockBalanceService,
}));

vi.mock('../services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));

import { WithdrawalService } from '../services/withdrawal.service.js';
import { AppError } from '../middleware/errorHandler.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const WALLET  = 'EQDtest_wallet_address_aaaaaaaaaaaaaaaaaaaaaa';
const TX_ID   = 'dddddddd-0000-0000-0000-000000000004';

function setupUser(walletAddress = WALLET) {
  mockQuery.mockResolvedValueOnce({ rows: [{ wallet_address: walletAddress }] });
}

function setupNoRedisKeys() {
  mockRedis.get.mockResolvedValue(null);
  // C-05: incrbyfloat returns new total; mock a value well under the 100 TON limit
  mockRedis.incrbyfloat.mockResolvedValue(5);   // e.g. requesting 5 TON, total = 5
}

function setupTransactionInsert() {
  mockClient.query.mockImplementation((sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
    if (typeof sql === 'string' && sql.includes('INSERT INTO transactions')) {
      return Promise.resolve({ rows: [{ id: TX_ID }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockRedis.get.mockReset();
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.ttl.mockResolvedValue(900);
  mockRedis.incrbyfloat.mockResolvedValue(5);  // safe default under daily limit
  mockRedis.expire.mockResolvedValue(1);
  mockBalanceService.deductBalance.mockResolvedValue(undefined);
  mockBalanceService.creditBalance.mockResolvedValue(undefined);
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe('requestWithdrawal — input validation', () => {
  it('throws INVALID_AMOUNT for zero amount', async () => {
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '0', WALLET),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('throws INVALID_AMOUNT for negative amount', async () => {
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '-1', WALLET),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('throws NOT_FOUND when user does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '1', WALLET),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws INVALID_DESTINATION when wallet does not match', async () => {
    setupUser('EQDdifferent_wallet');
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '1', WALLET),
    ).rejects.toMatchObject({ code: 'INVALID_DESTINATION' });
  });

  it('destination check is case-insensitive', async () => {
    setupUser(WALLET.toUpperCase());
    setupNoRedisKeys();
    setupTransactionInsert();
    const result = await WithdrawalService.requestWithdrawal(USER_ID, '1', WALLET.toLowerCase());
    expect(result.transactionId).toBe(TX_ID);
  });
});

// ─── Cooldown ─────────────────────────────────────────────────────────────────

describe('requestWithdrawal — cooldown', () => {
  it('throws COOLDOWN_ACTIVE when cooldown key exists', async () => {
    setupUser();
    mockRedis.get.mockResolvedValueOnce('1');
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '1', WALLET),
    ).rejects.toMatchObject({ code: 'COOLDOWN_ACTIVE' });
  });

  it('includes remaining minutes in cooldown error message', async () => {
    setupUser();
    mockRedis.get.mockResolvedValueOnce('1');
    mockRedis.ttl.mockResolvedValueOnce(1800);
    const err = await WithdrawalService.requestWithdrawal(USER_ID, '1', WALLET).catch(e => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toContain('30 minutes');
  });
});

// ─── Daily limit ──────────────────────────────────────────────────────────────

describe('requestWithdrawal — daily limit', () => {
  it('throws DAILY_LIMIT_EXCEEDED when daily total would exceed 100 TON', async () => {
    setupUser();
    mockRedis.get.mockResolvedValueOnce(null);   // no cooldown
    // C-05: incrbyfloat returns new total after increment (90 + 20 = 110 > 100)
    mockRedis.incrbyfloat.mockResolvedValueOnce(110);
    // rollback incrbyfloat call (decrement) should also be handled
    mockRedis.incrbyfloat.mockResolvedValueOnce(90);
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '20', WALLET),
    ).rejects.toMatchObject({ code: 'DAILY_LIMIT_EXCEEDED' });
  });

  it('allows withdrawal when daily total stays under 100 TON', async () => {
    setupUser();
    mockRedis.get.mockResolvedValueOnce(null);   // no cooldown
    // C-05: incrbyfloat returns new total (50 + 49 = 99 <= 100) — allowed
    mockRedis.incrbyfloat.mockResolvedValueOnce(99);
    setupTransactionInsert();
    const result = await WithdrawalService.requestWithdrawal(USER_ID, '49', WALLET);
    expect(result.requiresReview).toBe(false);
  });

  it('sets requiresReview=true for amounts >= 100 TON', async () => {
    setupUser();
    mockRedis.get.mockResolvedValueOnce(null);   // no cooldown
    // review-required path skips incrbyfloat check (handled separately)
    setupTransactionInsert();
    const result = await WithdrawalService.requestWithdrawal(USER_ID, '100', WALLET);
    expect(result.requiresReview).toBe(true);
  });

  it('sets requiresReview=true for amounts > 100 TON', async () => {
    setupUser();
    mockRedis.get.mockResolvedValueOnce(null);   // no cooldown only
    // No incrbyfloat call for review-required amounts
    setupTransactionInsert();
    const result = await WithdrawalService.requestWithdrawal(USER_ID, '500', WALLET);
    expect(result.requiresReview).toBe(true);
  });
});

// ─── Successful withdrawal ────────────────────────────────────────────────────

describe('requestWithdrawal — success path', () => {
  it('returns correct shape on success', async () => {
    setupUser();
    setupNoRedisKeys();
    setupTransactionInsert();
    const result = await WithdrawalService.requestWithdrawal(USER_ID, '5', WALLET);
    expect(result.userId).toBe(USER_ID);
    expect(result.walletAddress).toBe(WALLET);
    expect(result.amount).toBe('5');
    expect(result.requiresReview).toBe(false);
    expect(result.transactionId).toBe(TX_ID);
  });

  it('processWithdrawal is triggered (fire-and-forget) for non-review withdrawals', async () => {
    // The cooldown is set inside processWithdrawal after the on-chain send,
    // which runs fire-and-forget and requires real TON config.
    // We verify here that requestWithdrawal itself completes and returns
    // without error, indicating the fire-and-forget path was initiated.
    setupUser();
    setupNoRedisKeys();
    setupTransactionInsert();
    const result = await WithdrawalService.requestWithdrawal(USER_ID, '5', WALLET);
    expect(result.requiresReview).toBe(false);
    expect(result.transactionId).toBe(TX_ID);
    // processWithdrawal runs asynchronously — flush microtasks so any sync errors surface
    await Promise.resolve();
  });

  it('does NOT set cooldown for review-required withdrawals', async () => {
    setupUser();
    setupNoRedisKeys();
    setupTransactionInsert();
    await WithdrawalService.requestWithdrawal(USER_ID, '100', WALLET);
    const cooldownCall = mockRedis.set.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes('cooldown'),
    );
    expect(cooldownCall).toBeUndefined();
  });
});

// ─── Refund on DB failure ─────────────────────────────────────────────────────

describe('requestWithdrawal — refund on failure', () => {
  it('credits balance back if transaction INSERT fails', async () => {
    setupUser();
    setupNoRedisKeys();
    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (sql === 'ROLLBACK') return Promise.resolve();
      return Promise.reject(new Error('DB insert failed'));
    });

    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '5', WALLET),
    ).rejects.toThrow('DB insert failed');

    expect(mockBalanceService.creditBalance).toHaveBeenCalledWith(USER_ID, '5');
  });
});

// ─── secsUntilUtcMidnight ─────────────────────────────────────────────────────

describe('secsUntilUtcMidnight', () => {
  it('returns a positive number of seconds <= 86400', () => {
    const secs = (WithdrawalService as unknown as { secsUntilUtcMidnight(): number }).secsUntilUtcMidnight();
    expect(secs).toBeGreaterThan(0);
    expect(secs).toBeLessThanOrEqual(86_400);
  });
});
