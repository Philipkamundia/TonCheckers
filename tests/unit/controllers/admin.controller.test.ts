/**
 * tests/unit/controllers/admin.controller.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const { mockAdminService, mockGenerateChallenge, mockDbQuery, mockRunReconciliation, mockRunWithdrawalRecovery } = vi.hoisted(() => ({
  mockAdminService: {
    getSummary:             vi.fn(),
    getPendingWithdrawals:  vi.fn(),
    approveWithdrawal:      vi.fn(),
    rejectWithdrawal:       vi.fn(),
    getTreasuryHealth:      vi.fn(),
    listUsers:              vi.fn(),
    banUser:                vi.fn(),
    unbanUser:              vi.fn(),
    getGameLog:             vi.fn(),
    getTournamentOverview:  vi.fn(),
    getFeeBreakdown:        vi.fn(),
    getCrashLog:            vi.fn(),
  },
  mockGenerateChallenge: vi.fn(),
  mockDbQuery:           vi.fn(),
  mockRunReconciliation:     vi.fn(),
  mockRunWithdrawalRecovery: vi.fn(),
}));

vi.mock('../../../apps/backend/src/services/admin.service.js', () => ({ AdminService: mockAdminService }));
vi.mock('../../../apps/backend/src/middleware/requireAdmin.js', () => ({ generateAdminChallenge: mockGenerateChallenge }));
vi.mock('../../../apps/backend/src/config/db.js', () => ({ default: { query: mockDbQuery } }));
vi.mock('../../../apps/backend/src/jobs/balanceReconciliation.js', () => ({ runReconciliation: mockRunReconciliation }));
vi.mock('../../../apps/backend/src/jobs/withdrawalRecovery.js', () => ({ runWithdrawalRecovery: mockRunWithdrawalRecovery }));

const { adminController } = await import('../../../apps/backend/src/controllers/admin.controller.js');

function makeRes() {
  const res = { json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() } as unknown as Response;
  return res;
}
function makeReq(overrides: Partial<Request> = {}): Request {
  return { params: {}, query: {}, body: {}, user: { userId: 'admin-1', walletAddress: 'EQD' }, ...overrides } as unknown as Request;
}
const next = vi.fn() as NextFunction;

beforeEach(() => { vi.clearAllMocks(); });

describe('adminController.getChallenge', () => {
  it('returns a challenge string', async () => {
    mockGenerateChallenge.mockReturnValueOnce('checkton-admin:1234567890');
    const res = makeRes();
    await adminController.getChallenge(makeReq(), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, challenge: 'checkton-admin:1234567890' });
  });
});

describe('adminController.getSummary', () => {
  it('returns summary data', async () => {
    mockAdminService.getSummary.mockResolvedValueOnce({ total_users: 100 });
    const res = makeRes();
    await adminController.getSummary(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, summary: { total_users: 100 } });
  });

  it('calls next on error', async () => {
    mockAdminService.getSummary.mockRejectedValueOnce(new Error('DB error'));
    await adminController.getSummary(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('adminController.getPendingWithdrawals', () => {
  it('returns pending withdrawals', async () => {
    mockAdminService.getPendingWithdrawals.mockResolvedValueOnce([{ id: 'tx1' }]);
    const res = makeRes();
    await adminController.getPendingWithdrawals(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, withdrawals: [{ id: 'tx1' }] });
  });
});

describe('adminController.approveWithdrawal', () => {
  it('approves withdrawal and returns ok', async () => {
    mockAdminService.approveWithdrawal.mockResolvedValueOnce(undefined);
    const res = makeRes();
    await adminController.approveWithdrawal(makeReq({ params: { id: 'tx1' }, body: { note: 'ok' } }), res, next);
    expect(mockAdminService.approveWithdrawal).toHaveBeenCalledWith('tx1', 'ok');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('calls next on error', async () => {
    mockAdminService.approveWithdrawal.mockRejectedValueOnce(new Error('not found'));
    await adminController.approveWithdrawal(makeReq({ params: { id: 'tx1' } }), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('adminController.rejectWithdrawal', () => {
  it('rejects withdrawal with reason', async () => {
    mockAdminService.rejectWithdrawal.mockResolvedValueOnce(undefined);
    const res = makeRes();
    await adminController.rejectWithdrawal(makeReq({ params: { id: 'tx1' }, body: { reason: 'suspicious' } }), res, next);
    expect(mockAdminService.rejectWithdrawal).toHaveBeenCalledWith('tx1', 'suspicious');
  });

  it('uses default reason when none provided', async () => {
    mockAdminService.rejectWithdrawal.mockResolvedValueOnce(undefined);
    await adminController.rejectWithdrawal(makeReq({ params: { id: 'tx1' }, body: {} }), makeRes(), next);
    expect(mockAdminService.rejectWithdrawal).toHaveBeenCalledWith('tx1', 'Rejected by admin');
  });
});

describe('adminController.getTreasury', () => {
  it('returns treasury health', async () => {
    mockAdminService.getTreasuryHealth.mockResolvedValueOnce({ totalObligations: 100 });
    const res = makeRes();
    await adminController.getTreasury(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, treasury: { totalObligations: 100 } });
  });
});

describe('adminController.getUsers', () => {
  it('returns paginated users', async () => {
    mockAdminService.listUsers.mockResolvedValueOnce({ users: [], total: 0, page: 1, totalPages: 0 });
    const res = makeRes();
    await adminController.getUsers(makeReq({ query: { page: '2', search: 'alice' } }), res, next);
    expect(mockAdminService.listUsers).toHaveBeenCalledWith(2, 50, 'alice');
  });

  it('defaults to page 1 with no query params', async () => {
    mockAdminService.listUsers.mockResolvedValueOnce({ users: [], total: 0, page: 1, totalPages: 0 });
    await adminController.getUsers(makeReq(), makeRes(), next);
    expect(mockAdminService.listUsers).toHaveBeenCalledWith(1, 50, undefined);
  });
});

describe('adminController.banUser / unbanUser', () => {
  it('bans user with reason', async () => {
    mockAdminService.banUser.mockResolvedValueOnce(undefined);
    const res = makeRes();
    await adminController.banUser(makeReq({ params: { id: 'u1' }, body: { reason: 'cheating' } }), res, next);
    expect(mockAdminService.banUser).toHaveBeenCalledWith('u1', 'cheating');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('uses default reason when none provided', async () => {
    mockAdminService.banUser.mockResolvedValueOnce(undefined);
    await adminController.banUser(makeReq({ params: { id: 'u1' }, body: {} }), makeRes(), next);
    expect(mockAdminService.banUser).toHaveBeenCalledWith('u1', 'Admin action');
  });

  it('unbans user', async () => {
    mockAdminService.unbanUser.mockResolvedValueOnce(undefined);
    const res = makeRes();
    await adminController.unbanUser(makeReq({ params: { id: 'u1' } }), res, next);
    expect(mockAdminService.unbanUser).toHaveBeenCalledWith('u1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});

describe('adminController.getGameLog', () => {
  it('returns game log with pagination', async () => {
    mockAdminService.getGameLog.mockResolvedValueOnce({ games: [], total: 0, page: 1, totalPages: 0 });
    const res = makeRes();
    await adminController.getGameLog(makeReq({ query: { page: '3' } }), res, next);
    expect(mockAdminService.getGameLog).toHaveBeenCalledWith(3);
  });
});

describe('adminController.getTournaments', () => {
  it('returns tournament overview', async () => {
    mockAdminService.getTournamentOverview.mockResolvedValueOnce([{ id: 't1' }]);
    const res = makeRes();
    await adminController.getTournaments(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, tournaments: [{ id: 't1' }] });
  });
});

describe('adminController.getFees', () => {
  it('returns fee breakdown', async () => {
    mockAdminService.getFeeBreakdown.mockResolvedValueOnce({ totalFees: '5.0' });
    const res = makeRes();
    await adminController.getFees(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, fees: { totalFees: '5.0' } });
  });
});

describe('adminController.getCrashLog', () => {
  it('returns crash log', async () => {
    mockAdminService.getCrashLog.mockResolvedValueOnce({ crashes: [], total: 0, page: 1, totalPages: 0 });
    const res = makeRes();
    await adminController.getCrashLog(makeReq({ query: { page: '1' } }), res, next);
    expect(mockAdminService.getCrashLog).toHaveBeenCalledWith(1);
  });
});

describe('adminController.getReconciliationHistory', () => {
  it('returns reconciliation snapshots', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
    const res = makeRes();
    await adminController.getReconciliationHistory(makeReq({ query: { limit: '10' } }), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, snapshots: [{ id: 'r1' }] });
  });

  it('caps limit at 100', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await adminController.getReconciliationHistory(makeReq({ query: { limit: '999' } }), makeRes(), next);
    expect(mockDbQuery.mock.calls[0][1]).toEqual([100]);
  });
});

describe('adminController.triggerReconciliation', () => {
  it('triggers reconciliation fire-and-forget', async () => {
    mockRunReconciliation.mockResolvedValueOnce(undefined);
    const res = makeRes();
    await adminController.triggerReconciliation(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});

describe('adminController.triggerWithdrawalRecovery', () => {
  it('triggers withdrawal recovery fire-and-forget', async () => {
    mockRunWithdrawalRecovery.mockResolvedValueOnce(undefined);
    const res = makeRes();
    await adminController.triggerWithdrawalRecovery(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});
