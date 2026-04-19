/**
 * admin.test.ts — Tests for admin withdrawal approve/reject flows
 *
 * Critical properties verified:
 * - Idempotency: second approve call returns NOT_FOUND (no double-send)
 * - Idempotency: second reject call returns NOT_FOUND (no double-credit)
 * - Approve atomically flips status pending → processing before sending
 * - Reject atomically flips status pending → rejected before crediting
 * - Approve on already-processing tx returns NOT_FOUND
 * - Reject on already-rejected tx returns NOT_FOUND
 * - Reject credits balance back to user
 * - Approve does NOT credit balance (sends on-chain instead)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockQuery, mockClient, mockRedis, mockBalanceService } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  const mockQuery  = vi.fn();
  const mockRedis  = {
    get:         vi.fn().mockResolvedValue(null),
    set:         vi.fn().mockResolvedValue('OK'),
    del:         vi.fn().mockResolvedValue(1),
    incrbyfloat: vi.fn().mockResolvedValue(0),
    expire:      vi.fn().mockResolvedValue(1),
    ttl:         vi.fn().mockResolvedValue(0),
  };
  const mockBalanceService = {
    creditBalance: vi.fn().mockResolvedValue(undefined),
    deductBalance: vi.fn().mockResolvedValue(undefined),
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

// processWithdrawal calls sendTonTransfer which needs HOT_WALLET_MNEMONIC.
// We spy on it after import so the real approve/reject methods remain intact.
// The spy is set up in beforeEach below.

import { WithdrawalService } from '../services/withdrawal.service.js';
import { AppError } from '../middleware/errorHandler.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const TX_ID   = 'dddddddd-0000-0000-0000-000000000004';
const AMOUNT  = '150.000000000';
const DEST    = 'EQDtest_wallet_address_aaaaaaaaaaaaaaaaaaaaaa';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate the atomic UPDATE returning the claimed row (first call wins) */
function setupPendingTx() {
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: TX_ID, user_id: USER_ID, amount: AMOUNT, destination: DEST }],
  });
}

/** Simulate the atomic UPDATE finding nothing (already processed) */
function setupAlreadyProcessed() {
  mockQuery.mockResolvedValueOnce({ rows: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockBalanceService.creditBalance.mockResolvedValue(undefined);
  mockBalanceService.deductBalance.mockResolvedValue(undefined);
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue('OK');
  // Spy on processWithdrawal so it doesn't try to hit the TON network
  vi.spyOn(WithdrawalService, 'processWithdrawal').mockRejectedValue(
    new Error('HOT_WALLET_MNEMONIC not configured'),
  );
});

// ─── approveWithdrawal ────────────────────────────────────────────────────────

describe('approveWithdrawal — idempotency gate', () => {
  it('throws NOT_FOUND when no pending tx matches (already processed)', async () => {
    setupAlreadyProcessed();
    await expect(
      WithdrawalService.approveWithdrawal(TX_ID),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND on second call — atomic UPDATE claims row only once', async () => {
    // First call: row found and claimed
    setupPendingTx();
    // processWithdrawal is mocked to throw (no mnemonic) — that's fine,
    // the important thing is the idempotency gate ran first
    await expect(
      WithdrawalService.approveWithdrawal(TX_ID),
    ).rejects.toThrow(); // throws from processWithdrawal, not from gate

    // Second call: row already flipped to 'processing', UPDATE returns nothing
    setupAlreadyProcessed();
    await expect(
      WithdrawalService.approveWithdrawal(TX_ID),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does NOT call creditBalance — approve sends on-chain, not a refund', async () => {
    setupPendingTx();
    await WithdrawalService.approveWithdrawal(TX_ID).catch(() => {});
    expect(mockBalanceService.creditBalance).not.toHaveBeenCalled();
  });

  it('calls processWithdrawal with correct args after claiming the row', async () => {
    setupPendingTx();
    await WithdrawalService.approveWithdrawal(TX_ID, 'admin note').catch(() => {});
    expect(WithdrawalService.processWithdrawal).toHaveBeenCalledWith(
      TX_ID, USER_ID, DEST, AMOUNT, expect.stringContaining('cooldown'),
    );
  });

  it('passes adminNote into the UPDATE when provided', async () => {
    setupPendingTx();
    await WithdrawalService.approveWithdrawal(TX_ID, 'approved by admin').catch(() => {});
    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[1]).toContain('approved by admin');
  });

  it('passes null adminNote when not provided', async () => {
    setupPendingTx();
    await WithdrawalService.approveWithdrawal(TX_ID).catch(() => {});
    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[1][0]).toBeNull();
  });
});

// ─── rejectWithdrawal ─────────────────────────────────────────────────────────

describe('rejectWithdrawal — idempotency gate', () => {
  it('throws NOT_FOUND when no pending tx matches (already rejected)', async () => {
    setupAlreadyProcessed();
    await expect(
      WithdrawalService.rejectWithdrawal(TX_ID, 'Rejected by admin'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND on second call — atomic UPDATE claims row only once', async () => {
    // First call succeeds
    setupPendingTx();
    await WithdrawalService.rejectWithdrawal(TX_ID, 'Rejected by admin');

    // Second call: row already flipped to 'rejected'
    setupAlreadyProcessed();
    await expect(
      WithdrawalService.rejectWithdrawal(TX_ID, 'Rejected by admin'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('credits balance back to user on successful rejection', async () => {
    setupPendingTx();
    await WithdrawalService.rejectWithdrawal(TX_ID, 'Rejected by admin');
    expect(mockBalanceService.creditBalance).toHaveBeenCalledOnce();
    expect(mockBalanceService.creditBalance).toHaveBeenCalledWith(USER_ID, AMOUNT);
  });

  it('credits the exact amount from the transaction record', async () => {
    const customAmount = '250.000000000';
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TX_ID, user_id: USER_ID, amount: customAmount }],
    });
    await WithdrawalService.rejectWithdrawal(TX_ID, 'too large');
    expect(mockBalanceService.creditBalance).toHaveBeenCalledWith(USER_ID, customAmount);
  });

  it('does NOT call processWithdrawal — reject never sends on-chain', async () => {
    setupPendingTx();
    await WithdrawalService.rejectWithdrawal(TX_ID, 'Rejected by admin');
    expect(WithdrawalService.processWithdrawal).not.toHaveBeenCalled();
  });

  it('stores the rejection reason in admin_note via the UPDATE', async () => {
    setupPendingTx();
    await WithdrawalService.rejectWithdrawal(TX_ID, 'suspicious activity');
    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[1]).toContain('suspicious activity');
  });
});

// ─── Double-spend scenario (the 450 TON bug) ─────────────────────────────────

describe('Double-spend prevention — the 450 TON scenario', () => {
  it('three rapid approve calls only process once — second and third get NOT_FOUND', async () => {
    // First call claims the row
    setupPendingTx();
    // Second and third find nothing
    setupAlreadyProcessed();
    setupAlreadyProcessed();

    const [r1, r2, r3] = await Promise.allSettled([
      WithdrawalService.approveWithdrawal(TX_ID),
      WithdrawalService.approveWithdrawal(TX_ID),
      WithdrawalService.approveWithdrawal(TX_ID),
    ]);

    // First may throw from processWithdrawal (no mnemonic) — that's fine
    // Second and third must throw NOT_FOUND
    expect(r2.status).toBe('rejected');
    expect((r2 as PromiseRejectedResult).reason).toMatchObject({ code: 'NOT_FOUND' });
    expect(r3.status).toBe('rejected');
    expect((r3 as PromiseRejectedResult).reason).toMatchObject({ code: 'NOT_FOUND' });

    // processWithdrawal called at most once
    expect(
      (WithdrawalService.processWithdrawal as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeLessThanOrEqual(1);
  });

  it('three rapid reject calls only credit once — second and third get NOT_FOUND', async () => {
    setupPendingTx();
    setupAlreadyProcessed();
    setupAlreadyProcessed();

    const [r1, r2, r3] = await Promise.allSettled([
      WithdrawalService.rejectWithdrawal(TX_ID, 'Rejected by admin'),
      WithdrawalService.rejectWithdrawal(TX_ID, 'Rejected by admin'),
      WithdrawalService.rejectWithdrawal(TX_ID, 'Rejected by admin'),
    ]);

    expect(r2.status).toBe('rejected');
    expect((r2 as PromiseRejectedResult).reason).toMatchObject({ code: 'NOT_FOUND' });
    expect(r3.status).toBe('rejected');
    expect((r3 as PromiseRejectedResult).reason).toMatchObject({ code: 'NOT_FOUND' });

    // Balance credited exactly once
    expect(mockBalanceService.creditBalance).toHaveBeenCalledOnce();
  });
});
