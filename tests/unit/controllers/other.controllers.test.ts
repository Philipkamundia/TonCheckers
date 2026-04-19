/**
 * tests/unit/controllers/other.controllers.test.ts
 *
 * leaderboard, matchmaking, tournament, user, wallet, withdrawal controllers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const {
  mockLeaderboard, mockMatchmaking, mockTournament,
  mockUser, mockWallet, mockWithdrawal, mockCancelLobby,
} = vi.hoisted(() => ({
  mockLeaderboard: { getLeaderboard: vi.fn(), getMyRanks: vi.fn() },
  mockMatchmaking: {
    joinQueue: vi.fn(), cancelQueue: vi.fn(), getEntry: vi.fn(), getEloRange: vi.fn(),
  },
  mockTournament: {
    createTournament: vi.fn(), listTournaments: vi.fn(),
    getTournamentDetail: vi.fn(), joinTournament: vi.fn(),
  },
  mockUser:       { getProfile: vi.fn(), getProfileByUsername: vi.fn() },
  mockWallet:     { getBalance: vi.fn(), getHistory: vi.fn(), initDeposit: vi.fn() },
  mockWithdrawal: { requestWithdrawal: vi.fn() },
  mockCancelLobby: vi.fn(),
}));

vi.mock('../../../apps/backend/src/services/leaderboard.service.js', () => ({ LeaderboardService: mockLeaderboard }));
vi.mock('../../../apps/backend/src/services/matchmaking.service.js', () => ({ MatchmakingService: mockMatchmaking }));
vi.mock('../../../apps/backend/src/services/tournament.service.js', () => ({ TournamentService: mockTournament }));
vi.mock('../../../apps/backend/src/services/user.service.js', () => ({ UserService: mockUser }));
vi.mock('../../../apps/backend/src/services/wallet.service.js', () => ({ WalletService: mockWallet }));
vi.mock('../../../apps/backend/src/services/withdrawal.service.js', () => ({ WithdrawalService: mockWithdrawal }));
vi.mock('../../../apps/backend/src/jobs/matchmakingScan.js', () => ({ cancelLobby: mockCancelLobby }));

const { leaderboardController } = await import('../../../apps/backend/src/controllers/leaderboard.controller.js');
const { matchmakingController, makeLobbyController } = await import('../../../apps/backend/src/controllers/matchmaking.controller.js');
const { userController } = await import('../../../apps/backend/src/controllers/user.controller.js');
const { walletController } = await import('../../../apps/backend/src/controllers/wallet.controller.js');
const { withdrawalController } = await import('../../../apps/backend/src/controllers/withdrawal.controller.js');

function makeRes() {
  const res = { json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}
function makeReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, params: {}, query: {}, user: { userId: 'u1', walletAddress: 'EQD' }, ...overrides } as unknown as Request;
}
const next = vi.fn() as NextFunction;

beforeEach(() => vi.clearAllMocks());

// ─── leaderboardController ────────────────────────────────────────────────────

describe('leaderboardController.getLeaderboard', () => {
  it('returns leaderboard with default sort=elo', async () => {
    mockLeaderboard.getLeaderboard.mockResolvedValueOnce({ entries: [], total: 0 });
    const res = makeRes();
    await leaderboardController.getLeaderboard(makeReq(), res, next);
    expect(mockLeaderboard.getLeaderboard).toHaveBeenCalledWith('elo', 1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('passes sort and page from query', async () => {
    mockLeaderboard.getLeaderboard.mockResolvedValueOnce({ entries: [], total: 0 });
    await leaderboardController.getLeaderboard(makeReq({ query: { sort: 'ton_won', page: '3' } }), makeRes(), next);
    expect(mockLeaderboard.getLeaderboard).toHaveBeenCalledWith('ton_won', 3);
  });

  it('clamps page to minimum 1', async () => {
    mockLeaderboard.getLeaderboard.mockResolvedValueOnce({ entries: [], total: 0 });
    await leaderboardController.getLeaderboard(makeReq({ query: { page: '-5' } }), makeRes(), next);
    expect(mockLeaderboard.getLeaderboard).toHaveBeenCalledWith('elo', 1);
  });

  it('calls next on error', async () => {
    mockLeaderboard.getLeaderboard.mockRejectedValueOnce(new Error('Redis error'));
    await leaderboardController.getLeaderboard(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('leaderboardController.getMyRanks', () => {
  it('returns user ranks', async () => {
    mockLeaderboard.getMyRanks.mockResolvedValueOnce({ elo: 5, ton_won: 10 });
    const res = makeRes();
    await leaderboardController.getMyRanks(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, ranks: { elo: 5, ton_won: 10 } });
  });
});

// ─── matchmakingController ────────────────────────────────────────────────────

describe('matchmakingController.join', () => {
  it('joins queue with valid stake', async () => {
    mockMatchmaking.joinQueue.mockResolvedValueOnce(undefined);
    const res = makeRes();
    await matchmakingController.join(makeReq({ body: { stake: '1.5' } }), res, next);
    expect(mockMatchmaking.joinQueue).toHaveBeenCalledWith('u1', '1.5');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('returns 400 for invalid stake format', async () => {
    await matchmakingController.join(makeReq({ body: { stake: 'abc' } }), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('calls next on service error', async () => {
    mockMatchmaking.joinQueue.mockRejectedValueOnce(new Error('BANNED'));
    await matchmakingController.join(makeReq({ body: { stake: '1.0' } }), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('matchmakingController.cancel', () => {
  it('cancels queue', async () => {
    mockMatchmaking.cancelQueue.mockResolvedValueOnce(undefined);
    const res = makeRes();
    await matchmakingController.cancel(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});

describe('matchmakingController.status', () => {
  it('returns inQueue=false when not in queue', async () => {
    mockMatchmaking.getEntry.mockResolvedValueOnce(null);
    const res = makeRes();
    await matchmakingController.status(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, inQueue: false });
  });

  it('returns queue status when in queue', async () => {
    const entry = { userId: 'u1', elo: 1200, stake: '1.0', joinedAt: Date.now() - 30_000 };
    mockMatchmaking.getEntry.mockResolvedValueOnce(entry);
    mockMatchmaking.getEloRange.mockReturnValueOnce(150);
    const res = makeRes();
    await matchmakingController.status(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true, inQueue: true, stake: '1.0', eloRange: 150,
    }));
  });
});

describe('makeLobbyController.cancelLobby', () => {
  it('cancels lobby and returns ok', async () => {
    mockCancelLobby.mockResolvedValueOnce(undefined);
    const mockIo = {} as never;
    const ctrl = makeLobbyController(mockIo);
    const res = makeRes();
    await ctrl.cancelLobby(makeReq({ params: { gameId: 'game-1' } }), res, next);
    expect(mockCancelLobby).toHaveBeenCalledWith(mockIo, 'game-1', 'u1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});

// ─── userController ───────────────────────────────────────────────────────────

describe('userController.getById', () => {
  it('returns user profile', async () => {
    mockUser.getProfile.mockResolvedValueOnce({ id: 'u1', username: 'alice' });
    const res = makeRes();
    await userController.getById(makeReq({ params: { id: 'u1' } }), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, user: { id: 'u1', username: 'alice' } });
  });

  it('calls next on error', async () => {
    mockUser.getProfile.mockRejectedValueOnce(new Error('not found'));
    await userController.getById(makeReq({ params: { id: 'ghost' } }), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('userController.getByUsername', () => {
  it('returns user profile by username', async () => {
    mockUser.getProfileByUsername.mockResolvedValueOnce({ id: 'u1', username: 'alice' });
    const res = makeRes();
    await userController.getByUsername(makeReq({ params: { username: 'alice' } }), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, user: { id: 'u1', username: 'alice' } });
  });
});

// ─── walletController ─────────────────────────────────────────────────────────

describe('walletController.getBalance', () => {
  it('returns balance', async () => {
    mockWallet.getBalance.mockResolvedValueOnce({ available: '5.0', locked: '0' });
    const res = makeRes();
    await walletController.getBalance(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, balance: { available: '5.0', locked: '0' } });
  });
});

describe('walletController.getHistory', () => {
  it('returns history with pagination', async () => {
    mockWallet.getHistory.mockResolvedValueOnce({ transactions: [], total: 0 });
    const res = makeRes();
    await walletController.getHistory(makeReq({ query: { page: '2', limit: '10' } }), res, next);
    expect(mockWallet.getHistory).toHaveBeenCalledWith('u1', 2, 10);
  });

  it('clamps limit to max 50', async () => {
    mockWallet.getHistory.mockResolvedValueOnce({ transactions: [], total: 0 });
    await walletController.getHistory(makeReq({ query: { limit: '999' } }), makeRes(), next);
    expect(mockWallet.getHistory).toHaveBeenCalledWith('u1', 1, 50);
  });

  it('defaults page to 1', async () => {
    mockWallet.getHistory.mockResolvedValueOnce({ transactions: [], total: 0 });
    await walletController.getHistory(makeReq(), makeRes(), next);
    expect(mockWallet.getHistory).toHaveBeenCalledWith('u1', 1, 20);
  });
});

describe('walletController.initDeposit', () => {
  it('returns deposit info with instructions', async () => {
    mockWallet.initDeposit.mockReturnValueOnce({ address: 'EQDhot', memo: 'u1', minimumAmount: 0.5 });
    const res = makeRes();
    await walletController.initDeposit(makeReq(), res, next);
    const call = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.ok).toBe(true);
    expect(call.address).toBe('EQDhot');
    expect(call.instructions).toContain('0.5');
  });
});

// ─── withdrawalController ─────────────────────────────────────────────────────

describe('withdrawalController.requestWithdrawal', () => {
  it('processes valid withdrawal request', async () => {
    mockWithdrawal.requestWithdrawal.mockResolvedValueOnce({
      transactionId: 'tx-1', amount: '5', walletAddress: 'EQDwallet12345678901', requiresReview: false,
    });
    const res = makeRes();
    await withdrawalController.requestWithdrawal(
      makeReq({ body: { amount: '5', destination: 'EQDwallet12345678901' } }), res, next,
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, requiresReview: false }));
  });

  it('returns review message for large withdrawal', async () => {
    mockWithdrawal.requestWithdrawal.mockResolvedValueOnce({
      transactionId: 'tx-2', amount: '200', walletAddress: 'EQDwallet12345678901', requiresReview: true,
    });
    const res = makeRes();
    await withdrawalController.requestWithdrawal(
      makeReq({ body: { amount: '200', destination: 'EQDwallet12345678901' } }), res, next,
    );
    const call = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.message).toContain('admin review');
  });

  it('returns 400 for invalid amount format', async () => {
    await withdrawalController.requestWithdrawal(
      makeReq({ body: { amount: 'abc', destination: 'EQDwallet12345678901' } }), makeRes(), next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('returns 400 for short destination', async () => {
    await withdrawalController.requestWithdrawal(
      makeReq({ body: { amount: '1', destination: 'short' } }), makeRes(), next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('calls next on service error', async () => {
    mockWithdrawal.requestWithdrawal.mockRejectedValueOnce(new Error('INSUFFICIENT_BALANCE'));
    await withdrawalController.requestWithdrawal(
      makeReq({ body: { amount: '1', destination: 'EQDwallet12345678901' } }), makeRes(), next,
    );
    expect(next).toHaveBeenCalled();
  });
});

// ─── tournament controller (via factory) ─────────────────────────────────────

const { makeTournamentController } = await import('../../../apps/backend/src/controllers/tournament.controller.js');

describe('makeTournamentController', () => {
  const mockIo = { emit: vi.fn() } as never;
  const ctrl = makeTournamentController(mockIo);

  it('creates tournament and emits event', async () => {
    mockTournament.createTournament.mockResolvedValueOnce({ id: 't1', name: 'Cup' });
    const res = makeRes();
    await ctrl.create(makeReq({ body: { name: 'Test Cup', bracketSize: 8, entryFee: '1', startsAt: '2027-01-01T00:00:00Z' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(201);
    expect((mockIo as { emit: ReturnType<typeof vi.fn> }).emit).toHaveBeenCalledWith('tournament.updated', expect.any(Object));
  });

  it('returns 400 for invalid bracketSize', async () => {
    await ctrl.create(makeReq({ body: { name: 'Cup', bracketSize: 10, entryFee: '1', startsAt: '2027-01-01T00:00:00Z' } }), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('lists tournaments', async () => {
    mockTournament.listTournaments.mockResolvedValueOnce([{ id: 't1' }]);
    const res = makeRes();
    await ctrl.list(makeReq({ query: { status: 'open' } }), res, next);
    expect(mockTournament.listTournaments).toHaveBeenCalledWith('open');
    expect(res.json).toHaveBeenCalledWith({ ok: true, tournaments: [{ id: 't1' }] });
  });

  it('gets tournament detail', async () => {
    mockTournament.getTournamentDetail.mockResolvedValueOnce({ id: 't1', name: 'Cup' });
    const res = makeRes();
    await ctrl.getOne(makeReq({ params: { id: 't1' } }), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, tournament: { id: 't1', name: 'Cup' } });
  });

  it('joins tournament and emits event', async () => {
    mockTournament.joinTournament.mockResolvedValueOnce({ tournamentId: 't1', userId: 'u1', entryFee: '1' });
    const res = makeRes();
    await ctrl.join(makeReq({ params: { id: 't1' } }), res, next);
    expect((mockIo as { emit: ReturnType<typeof vi.fn> }).emit).toHaveBeenCalledWith('tournament.updated', expect.any(Object));
  });
});
