/**
 * tests/unit/services/withdrawal.test.ts
 *
 * WithdrawalService — Full withdrawal flow tests.
 *
 * Critical invariants:
 *   - Destination locked to registered wallet (no redirect attacks)
 *   - 30-minute cooldown between withdrawals
 *   - Daily limit of 100 TON per UTC day (atomic Redis counter)
 *   - Amounts >= 100 TON queued for admin review
 *   - Balance deducted BEFORE on-chain transfer
 *   - Refund ONLY happens if pre-send failure (transfer not sent)
 *   - Post-send bookkeeping failure never triggers refund (money is already sent)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WithdrawalService } from '../../../apps/backend/src/services/withdrawal.service.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockRedis, mockDbQuery, mockConnect, mockDbClient, mockDeduct, mockCredit } = vi.hoisted(() => {
  const mockDbClient = { query: vi.fn(), release: vi.fn() };
  return {
    mockRedis: {
      get:         vi.fn(),
      set:         vi.fn(),
      del:         vi.fn(),
      incrbyfloat: vi.fn(),
      expire:      vi.fn(),
      ttl:         vi.fn(),
    },
    mockDbQuery:  vi.fn(),
    mockConnect:  vi.fn(),
    mockDbClient,
    mockDeduct:   vi.fn(),
    mockCredit:   vi.fn(),
  };
});

vi.mock('../../../apps/backend/src/config/redis.js', () => ({
  default: mockRedis,
}));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery, connect: mockConnect },
}));

vi.mock('../../../apps/backend/src/services/balance.service.js', () => ({
  BalanceService: {
    deductBalance: mockDeduct,
    creditBalance: mockCredit,
  },
}));

vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));

const WALLET = 'EQDTestWalletAddress0000000000000000000000000000000001';
const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

beforeEach(() => {
  vi.resetAllMocks();
  // Prevent real TON SDK calls — sendTonTransfer is called fire-and-forget
  // so per-test spies on processWithdrawal can miss it on the async path.
  vi.spyOn(WithdrawalService, 'sendTonTransfer').mockResolvedValue('mock-tx-hash');
  mockConnect.mockResolvedValue(mockDbClient);
  mockDbClient.release.mockReturnValue(undefined);
  mockDbClient.query.mockImplementation((sql: string) => {
    if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK'))
      return Promise.resolve({});
    if (sql.includes('INSERT INTO transactions'))
      return Promise.resolve({ rows: [{ id: 'tx-uuid-001' }] });
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe('WithdrawalService — input validation', () => {
  it('rejects negative amount', async () => {
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '-1', WALLET),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects zero amount', async () => {
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '0', WALLET),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects amount below 0.1 TON minimum', async () => {
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '0.05', WALLET),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects NaN amount', async () => {
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, 'abc', WALLET),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});

// ─── Wallet destination lock ─────────────────────────────────────────────────

describe('WithdrawalService — destination wallet enforcement', () => {
  beforeEach(() => {
    // User found with a specific registered wallet
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ wallet_address: WALLET }],
    });
    // No cooldown
    mockRedis.get.mockResolvedValueOnce(null);
    // Daily counter
    mockRedis.incrbyfloat.mockResolvedValueOnce(1);
    mockRedis.expire.mockResolvedValueOnce(1);
  });

  it('throws INVALID_DESTINATION when destination differs from registered wallet', async () => {
    const differentWallet = 'EQDDifferentWalletAddress00000000000000000000000000002';
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '1', differentWallet),
    ).rejects.toMatchObject({ code: 'INVALID_DESTINATION' });
  });

  it('accepts withdrawal to registered wallet (case-insensitive comparison)', async () => {
    // Re-setup because beforeEach consumed the mocks
    vi.resetAllMocks();
    mockConnect.mockResolvedValue(mockDbClient);
    mockDbClient.release.mockReturnValue(undefined);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ wallet_address: WALLET }] });
    mockRedis.get.mockResolvedValueOnce(null);
    mockRedis.incrbyfloat.mockResolvedValueOnce(1.0);
    mockRedis.expire.mockResolvedValueOnce(1);
    mockDeduct.mockResolvedValueOnce(undefined);
    mockDbClient.query.mockImplementation((sql: string) => {
      if (['BEGIN','COMMIT','ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      if (sql.includes('INSERT INTO transactions'))
        return Promise.resolve({ rows: [{ id: 'tx-1' }] });
      return Promise.resolve({ rows: [] });
    });

    // Mock processWithdrawal to prevent actual TON send
    const spy = vi.spyOn(WithdrawalService, 'processWithdrawal').mockResolvedValueOnce(undefined);

    const result = await WithdrawalService.requestWithdrawal(USER_ID, '1.0', WALLET.toLowerCase());
    expect(result.walletAddress).toBeDefined();
    spy.mockRestore();
  });
});

// ─── Cooldown ────────────────────────────────────────────────────────────────

describe('WithdrawalService — cooldown enforcement', () => {
  it('throws COOLDOWN_ACTIVE when cooldown key exists in Redis', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ wallet_address: WALLET }] });
    mockRedis.get.mockResolvedValueOnce('1');    // cooldown active
    mockRedis.ttl.mockResolvedValueOnce(900);    // 15 minutes remaining

    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '1', WALLET),
    ).rejects.toMatchObject({ code: 'COOLDOWN_ACTIVE' });

    expect(mockDeduct).not.toHaveBeenCalled();
  });
});

// ─── Daily limit ─────────────────────────────────────────────────────────────

describe('WithdrawalService — daily limit enforcement', () => {
  it('rejects when cumulative daily withdrawals exceed 100 TON', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ wallet_address: WALLET }] });
    mockRedis.get.mockResolvedValueOnce(null);           // no cooldown
    // Simulates 90 TON already withdrawn today; this request adds 20 TON → total 110 → reject
    mockRedis.incrbyfloat.mockResolvedValueOnce(110.0);  // new total after increment
    mockRedis.expire.mockResolvedValueOnce(1);
    // Rollback decrement
    mockRedis.incrbyfloat.mockResolvedValueOnce(90.0);

    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '20', WALLET),
    ).rejects.toMatchObject({ code: 'DAILY_LIMIT_EXCEEDED' });

    // Verify rollback: second incrbyfloat call subtracts the amount
    expect(mockRedis.incrbyfloat).toHaveBeenCalledTimes(2);
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it('routes withdrawal >= 100 TON to admin review queue', async () => {
    vi.resetAllMocks();
    mockConnect.mockResolvedValue(mockDbClient);
    mockDbClient.release.mockReturnValue(undefined);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ wallet_address: WALLET }] });
    mockRedis.get.mockResolvedValueOnce(null);
    mockRedis.incrbyfloat.mockResolvedValueOnce(100.0); // exactly 100 → requires review
    mockRedis.expire.mockResolvedValueOnce(1);
    mockDeduct.mockResolvedValueOnce(undefined);
    mockDbClient.query.mockImplementation((sql: string) => {
      if (['BEGIN','COMMIT','ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      if (sql.includes('INSERT INTO transactions'))
        return Promise.resolve({ rows: [{ id: 'tx-review-1' }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await WithdrawalService.requestWithdrawal(USER_ID, '100', WALLET);
    expect(result.requiresReview).toBe(true);
  });
});

// ─── Balance deduction ────────────────────────────────────────────────────────

describe('WithdrawalService — balance handling', () => {
  const setupPassingChecks = () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ wallet_address: WALLET }] });
    mockRedis.get.mockResolvedValueOnce(null);
    mockRedis.incrbyfloat.mockResolvedValueOnce(5.0); // under limit
    mockRedis.expire.mockResolvedValueOnce(1);
  };

  it('deducts balance before creating transaction record', async () => {
    setupPassingChecks();
    const callOrder: string[] = [];
    mockDeduct.mockImplementation(() => { callOrder.push('deduct'); return Promise.resolve(); });
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT')) callOrder.push('insert');
      if (['BEGIN','COMMIT','ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      if (sql.includes('INSERT INTO transactions'))
        return Promise.resolve({ rows: [{ id: 'tx-1' }] });
      return Promise.resolve({ rows: [] });
    });

    const spy = vi.spyOn(WithdrawalService, 'processWithdrawal').mockResolvedValueOnce(undefined);
    await WithdrawalService.requestWithdrawal(USER_ID, '5', WALLET);
    expect(callOrder.indexOf('deduct')).toBeLessThan(callOrder.indexOf('insert'));
    spy.mockRestore();
  });

  it('refunds balance if DB fails after deduction', async () => {
    setupPassingChecks();
    mockDeduct.mockResolvedValueOnce(undefined);
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      if (sql.includes('INSERT INTO transactions')) throw new Error('DB write failure');
      return Promise.resolve({});
    });
    mockCredit.mockResolvedValueOnce(undefined);
    mockRedis.incrbyfloat.mockResolvedValueOnce(0); // rollback decrement

    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '5', WALLET),
    ).rejects.toThrow('DB write failure');
    expect(mockCredit).toHaveBeenCalledWith(USER_ID, '5');
  });

  it('throws NOT_FOUND when user record missing', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no user
    await expect(
      WithdrawalService.requestWithdrawal(USER_ID, '1', WALLET),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ─── secsUntilUtcMidnight (internal helper) ──────────────────────────────────

describe('WithdrawalService — secsUntilUtcMidnight', () => {
  it('returns positive seconds remaining in current UTC day', () => {
    // Access private method via cast
    const secs = (WithdrawalService as any).secsUntilUtcMidnight();
    expect(secs).toBeGreaterThan(0);
    expect(secs).toBeLessThanOrEqual(86400);
  });
});
