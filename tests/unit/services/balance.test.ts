/**
 * tests/unit/services/balance.test.ts
 *
 * BalanceService — 100% coverage required.
 * Tests all balance state transitions and ensures no negative balance is possible.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BalanceService } from '../../../apps/backend/src/services/balance.service.js';

// ─── Mock DB pool ─────────────────────────────────────────────────────────────

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockQuery },
}));

beforeEach(() => vi.clearAllMocks());

// ─── getBalance ───────────────────────────────────────────────────────────────

describe('BalanceService.getBalance', () => {
  it('returns balance row when user exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ available: '5.000000000', locked: '2.000000000', total: '7.000000000' }],
    });
    const balance = await BalanceService.getBalance('user-1');
    expect(balance.available).toBe('5.000000000');
    expect(balance.locked).toBe('2.000000000');
    expect(balance.total).toBe('7.000000000');
  });

  it('throws 404 NOT_FOUND when balance record missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(BalanceService.getBalance('ghost-user')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

// ─── creditBalance ────────────────────────────────────────────────────────────

describe('BalanceService.creditBalance', () => {
  it('issues correct UPDATE SQL with amount and userId', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await BalanceService.creditBalance('user-1', '5.5');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('available = available + $1'),
      ['5.5', 'user-1'],
    );
  });

  it('accepts a client object and uses it instead of pool', async () => {
    const mockClient = { query: vi.fn().mockResolvedValueOnce({ rowCount: 1 }) };
    await (BalanceService.creditBalance as Function)('user-1', '5.5', mockClient);
    expect(mockClient.query).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ─── deductBalance ────────────────────────────────────────────────────────────

describe('BalanceService.deductBalance', () => {
  it('successfully deducts when balance sufficient', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // WHERE available >= amount passed
    await expect(BalanceService.deductBalance('user-1', '2.0')).resolves.toBeUndefined();
  });

  it('throws INSUFFICIENT_BALANCE when rowCount=0 (balance too low)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 }); // WHERE clause failed
    await expect(BalanceService.deductBalance('user-1', '999')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INSUFFICIENT_BALANCE',
    });
  });

  it('SQL uses WHERE available >= $1 to prevent negative balance', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await expect(BalanceService.deductBalance('user-1', '5')).rejects.toThrow();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('available >= $1'),
      ['5', 'user-1'],
    );
  });
});

// ─── lockBalance ─────────────────────────────────────────────────────────────

describe('BalanceService.lockBalance', () => {
  it('moves available → locked when balance sufficient', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await expect(BalanceService.lockBalance('user-1', '1.0')).resolves.toBeUndefined();
  });

  it('throws INSUFFICIENT_BALANCE when rowCount=0', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await expect(BalanceService.lockBalance('user-1', '100')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INSUFFICIENT_BALANCE',
    });
  });

  it('sets locked_at on first lock (M-06 compliance)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await BalanceService.lockBalance('user-1', '1');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('locked_at'),
      expect.any(Array),
    );
  });

  it('includes WHERE available >= $1 guard', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await expect(BalanceService.lockBalance('user-1', '1')).rejects.toThrow();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('available >= $1'),
      expect.any(Array),
    );
  });
});

// ─── unlockBalance ───────────────────────────────────────────────────────────

describe('BalanceService.unlockBalance', () => {
  it('moves locked → available', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await expect(BalanceService.unlockBalance('user-1', '1.0')).resolves.toBeUndefined();
  });

  it('clears locked_at when balance fully unlocked (M-06)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await BalanceService.unlockBalance('user-1', '1');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('locked_at'),
      expect.any(Array),
    );
  });

  it('does not throw if rowCount=0 (idempotent unlock)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await expect(BalanceService.unlockBalance('user-1', '1')).resolves.toBeUndefined();
  });
});

// ─── atomicLockBalance ────────────────────────────────────────────────────────

describe('BalanceService.atomicLockBalance', () => {
  it('combines check and lock atomically in ONE query', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await expect(BalanceService.atomicLockBalance('user-1', '5')).resolves.toBeUndefined();
    // Must be exactly 1 query — not two (check then lock)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws INSUFFICIENT_BALANCE on rowCount=0 (C-04: TOCTOU elimination)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await expect(BalanceService.atomicLockBalance('user-1', '99')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INSUFFICIENT_BALANCE',
    });
  });

  it('uses WHERE available >= $1::numeric to prevent race condition', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await expect(BalanceService.atomicLockBalance('user-1', '1')).rejects.toThrow();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/available\s*>=\s*\$1/),
      expect.any(Array),
    );
  });

  // ─── Concurrency / TOCTOU invariant ─────────────────────────────────────
  it('is idempotent — second call fails if balance was fully consumed', async () => {
    // First call succeeds (moves 1 TON from available → locked)
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await BalanceService.atomicLockBalance('user-1', '1');

    // Second call: balance is now 0 available — should fail
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await expect(BalanceService.atomicLockBalance('user-1', '1')).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });
  });
});

// ─── getHistory (pagination) ─────────────────────────────────────────────────

describe('BalanceService.getHistory', () => {
  it('returns paginated transaction history', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { id: 'tx-1', type: 'deposit', status: 'confirmed', amount: '5.0',
          tonTxHash: 'abc', requiresReview: false, createdAt: '2025-01-01' },
      ]})
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const result = await BalanceService.getHistory('user-1', 1, 20);
    expect(result.transactions).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('calculates correct offset for page 2', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 25 }] });

    const result = await BalanceService.getHistory('user-1', 2, 10);
    expect(result.totalPages).toBe(3); // ceil(25/10)
    // Verify the offset in the SQL call
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('OFFSET'),
      ['user-1', 10, 10], // limit=10, offset=(2-1)*10=10
    );
  });

  it('uses default page=1 limit=20 when no args provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await BalanceService.getHistory('user-1');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ['user-1', 20, 0],
    );
  });
});
