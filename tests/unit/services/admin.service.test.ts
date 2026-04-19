/**
 * tests/unit/services/admin.service.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminService } from '../../../apps/backend/src/services/admin.service.js';

const { mockDbQuery, mockApprove, mockReject, mockGetPending } = vi.hoisted(() => ({
  mockDbQuery:    vi.fn(),
  mockApprove:    vi.fn(),
  mockReject:     vi.fn(),
  mockGetPending: vi.fn(),
}));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));

vi.mock('../../../apps/backend/src/services/withdrawal.service.js', () => ({
  WithdrawalService: {
    approveWithdrawal:            mockApprove,
    rejectWithdrawal:             mockReject,
    getPendingReviewWithdrawals:  mockGetPending,
  },
}));

beforeEach(() => vi.clearAllMocks());

// ─── logAdminAction ───────────────────────────────────────────────────────────

describe('AdminService.logAdminAction', () => {
  it('inserts audit log row', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await AdminService.logAdminAction('EQDadmin', 'ban_user', 'u1', { reason: 'spam' });
    expect(mockDbQuery).toHaveBeenCalledOnce();
    expect(mockDbQuery.mock.calls[0][0]).toContain('admin_audit_log');
  });

  it('does not throw when DB insert fails (swallows error)', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('DB down'));
    await expect(AdminService.logAdminAction('EQDadmin', 'test')).resolves.toBeUndefined();
  });

  it('works without optional targetUserId and metadata', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(AdminService.logAdminAction('EQDadmin', 'view_dashboard')).resolves.toBeUndefined();
  });
});

// ─── Withdrawal delegation ────────────────────────────────────────────────────

describe('AdminService withdrawal delegation', () => {
  it('getPendingWithdrawals delegates to WithdrawalService', async () => {
    mockGetPending.mockResolvedValueOnce([{ id: 'tx1' }]);
    const result = await AdminService.getPendingWithdrawals();
    expect(result).toEqual([{ id: 'tx1' }]);
  });

  it('approveWithdrawal delegates to WithdrawalService', async () => {
    mockApprove.mockResolvedValueOnce(undefined);
    await AdminService.approveWithdrawal('tx1', 'looks good');
    expect(mockApprove).toHaveBeenCalledWith('tx1', 'looks good');
  });

  it('rejectWithdrawal delegates to WithdrawalService', async () => {
    mockReject.mockResolvedValueOnce(undefined);
    await AdminService.rejectWithdrawal('tx1', 'suspicious');
    expect(mockReject).toHaveBeenCalledWith('tx1', 'suspicious');
  });
});

// ─── getTreasuryHealth ────────────────────────────────────────────────────────

describe('AdminService.getTreasuryHealth', () => {
  it('returns treasury health with correct shape', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ total_available: 100, total_locked: 20, total_obligations: 120 }] })
      .mockResolvedValueOnce({ rows: [{ total_fees: 5 }] })
      .mockResolvedValueOnce({ rows: [{ total_fees: 2 }] });

    const health = await AdminService.getTreasuryHealth();
    expect(health.totalObligations).toBe(120);
    expect(health.totalAvailable).toBe(100);
    expect(health.platformFeesEarned).toBe('7.000000000');
    expect(health.hotWalletBalance).toBeNull();
  });
});

// ─── listUsers ────────────────────────────────────────────────────────────────

describe('AdminService.listUsers', () => {
  it('returns paginated users without search', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'alice' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const result = await AdminService.listUsers(1, 50);
    expect(result.users).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('applies search filter when provided', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    const result = await AdminService.listUsers(1, 50, 'alice');
    expect(result.users).toHaveLength(0);
    // Verify search param was passed
    expect(mockDbQuery.mock.calls[0][1]).toContain('%alice%');
  });
});

// ─── banUser / unbanUser ──────────────────────────────────────────────────────

describe('AdminService.banUser / unbanUser', () => {
  it('banUser issues UPDATE query', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await AdminService.banUser('u1', 'cheating');
    expect(mockDbQuery.mock.calls[0][0]).toContain('is_banned=true');
  });

  it('unbanUser issues UPDATE query', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await AdminService.unbanUser('u1');
    expect(mockDbQuery.mock.calls[0][0]).toContain('is_banned=false');
  });
});

// ─── getGameLog ───────────────────────────────────────────────────────────────

describe('AdminService.getGameLog', () => {
  it('returns paginated game log', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'g1' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const result = await AdminService.getGameLog(1, 50);
    expect(result.games).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

// ─── getSummary ───────────────────────────────────────────────────────────────

describe('AdminService.getSummary', () => {
  it('returns summary stats', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ total_users: 100, active_games: 5, queue_size: 3, open_tournaments: 1, pending_withdrawals: 2, new_users_today: 10 }] });
    const stats = await AdminService.getSummary();
    expect(stats.total_users).toBe(100);
  });
});

// ─── getFeeBreakdown ──────────────────────────────────────────────────────────

describe('AdminService.getFeeBreakdown', () => {
  it('returns fee breakdown with correct totals', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ date: '2024-01-01', games: 10, fees: 1.5 }] })
      .mockResolvedValueOnce({ rows: [{ total_games: 100, total_pvp_fees: 15 }] })
      .mockResolvedValueOnce({ rows: [{ total_tournaments: 5, total_tournament_fees: 3 }] });

    const result = await AdminService.getFeeBreakdown();
    expect(result.totalGames).toBe(100);
    expect(result.totalFees).toBe('18.000000000');
  });
});

// ─── getTournamentOverview ────────────────────────────────────────────────────

describe('AdminService.getTournamentOverview', () => {
  it('returns tournament list', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 't1', name: 'Cup' }] });
    const result = await AdminService.getTournamentOverview();
    expect(result).toHaveLength(1);
  });
});

// ─── getCrashLog ──────────────────────────────────────────────────────────────

describe('AdminService.getCrashLog', () => {
  it('returns paginated crash log', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const result = await AdminService.getCrashLog();
    expect(result.crashes).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});
