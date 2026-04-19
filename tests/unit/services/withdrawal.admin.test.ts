/**
 * tests/unit/services/withdrawal.admin.test.ts
 *
 * WithdrawalService — processWithdrawal, approveWithdrawal, rejectWithdrawal,
 * getPendingReviewWithdrawals — the paths not covered by the main test file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WithdrawalService } from '../../../apps/backend/src/services/withdrawal.service.js';

const { mockRedis, mockDbQuery, mockCredit, mockNotify } = vi.hoisted(() => ({
  mockRedis: {
    get: vi.fn(), set: vi.fn(), del: vi.fn(),
    incrbyfloat: vi.fn(), expire: vi.fn(), ttl: vi.fn(),
  },
  mockDbQuery: vi.fn(),
  mockCredit:  vi.fn(),
  mockNotify:  vi.fn(),
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({ default: mockRedis }));
vi.mock('../../../apps/backend/src/config/db.js',    () => ({ default: { query: mockDbQuery, connect: vi.fn() } }));
vi.mock('../../../apps/backend/src/services/balance.service.js', () => ({
  BalanceService: { deductBalance: vi.fn(), creditBalance: mockCredit },
}));
vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: mockNotify },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockNotify.mockResolvedValue(undefined);
  mockCredit.mockResolvedValue(undefined);
});

// ─── processWithdrawal ────────────────────────────────────────────────────────

describe('WithdrawalService.processWithdrawal', () => {
  it('updates status to confirmed and notifies on successful send', async () => {
    vi.spyOn(WithdrawalService, 'sendTonTransfer').mockResolvedValueOnce('real-hash-abc');
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockRedis.set.mockResolvedValue('OK');

    await WithdrawalService.processWithdrawal('tx-1', 'user-1', 'EQDdest', '5', 'withdrawal:cooldown:user-1');

    // Should have updated status to confirmed
    const confirmCall = mockDbQuery.mock.calls.find(c => c[0].includes("status='confirmed'"));
    expect(confirmCall).toBeDefined();
    expect(mockNotify).toHaveBeenCalledWith('user-1', 'withdrawal_processed', expect.any(Object));
  });

  it('stores pending hash when sendTonTransfer returns pending: prefix', async () => {
    vi.spyOn(WithdrawalService, 'sendTonTransfer').mockResolvedValueOnce('pending:EQDhot:seq42:1234567890');
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockRedis.set.mockResolvedValue('OK');

    await WithdrawalService.processWithdrawal('tx-1', 'user-1', 'EQDdest', '5');

    // Should update with the pending hash (not set confirmed)
    const pendingCall = mockDbQuery.mock.calls.find(c =>
      c[0].includes('ton_tx_hash') && !c[0].includes("status='confirmed'")
    );
    expect(pendingCall).toBeDefined();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('refunds balance and marks failed when sendTonTransfer throws', async () => {
    vi.spyOn(WithdrawalService, 'sendTonTransfer').mockRejectedValueOnce(new Error('Network error'));
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockRedis.del.mockResolvedValue(1);
    mockRedis.set.mockResolvedValue('OK');

    await expect(
      WithdrawalService.processWithdrawal('tx-1', 'user-1', 'EQDdest', '5', 'withdrawal:cooldown:user-1'),
    ).rejects.toThrow('Network error');

    expect(mockCredit).toHaveBeenCalledWith('user-1', '5');
    const failedCall = mockDbQuery.mock.calls.find(c => c[0].includes("status='failed'"));
    expect(failedCall).toBeDefined();
  });

  it('does not refund when post-send bookkeeping fails (money already sent)', async () => {
    vi.spyOn(WithdrawalService, 'sendTonTransfer').mockResolvedValueOnce('real-hash-abc');
    // First DB call (confirmed update) throws
    mockDbQuery.mockRejectedValueOnce(new Error('Post-send DB error'));
    mockRedis.set.mockResolvedValue('OK');

    // Should NOT throw and should NOT refund
    await expect(
      WithdrawalService.processWithdrawal('tx-1', 'user-1', 'EQDdest', '5'),
    ).resolves.toBeUndefined();

    expect(mockCredit).not.toHaveBeenCalled();
  });
});

// ─── approveWithdrawal ────────────────────────────────────────────────────────

describe('WithdrawalService.approveWithdrawal', () => {
  it('claims the transaction and calls processWithdrawal', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'tx-1', user_id: 'user-1', amount: '150', destination: 'EQDdest' }],
    });
    const spy = vi.spyOn(WithdrawalService, 'processWithdrawal').mockResolvedValueOnce(undefined);

    await WithdrawalService.approveWithdrawal('tx-1', 'approved by admin');
    expect(spy).toHaveBeenCalledWith('tx-1', 'user-1', 'EQDdest', '150', expect.stringContaining('user-1'));
    spy.mockRestore();
  });

  it('throws NOT_FOUND when transaction not found or already processed', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(WithdrawalService.approveWithdrawal('tx-gone')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ─── rejectWithdrawal ─────────────────────────────────────────────────────────

describe('WithdrawalService.rejectWithdrawal', () => {
  it('credits balance back to user on rejection', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'tx-1', user_id: 'user-1', amount: '150' }],
    });

    await WithdrawalService.rejectWithdrawal('tx-1', 'too large');
    expect(mockCredit).toHaveBeenCalledWith('user-1', '150');
  });

  it('throws NOT_FOUND when transaction not found or already processed', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(WithdrawalService.rejectWithdrawal('tx-gone', 'reason')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ─── getPendingReviewWithdrawals ──────────────────────────────────────────────

describe('WithdrawalService.getPendingReviewWithdrawals', () => {
  it('returns list of pending review withdrawals', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'tx-1', amount: '150' }] });
    const result = await WithdrawalService.getPendingReviewWithdrawals();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'tx-1' });
  });

  it('returns empty array when none pending', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const result = await WithdrawalService.getPendingReviewWithdrawals();
    expect(result).toHaveLength(0);
  });
});
