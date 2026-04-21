/**
 * settlement.test.ts — Tests for SettlementService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (must be before vi.mock calls) ─────────────────────────────

const {
  mockQuery,
  mockClient,
  mockTournamentService,
  mockLeaderboardService,
  mockGameService,
  mockTournamentRoundPreviewService,
} = vi.hoisted(() => {
  const mockClient = {
    query:   vi.fn(),
    release: vi.fn(),
  };
  const mockQuery = vi.fn();
  const mockTournamentService = {
    recordMatchResult: vi.fn().mockResolvedValue(undefined),
  };
  const mockLeaderboardService = {
    rebuildAll: vi.fn().mockResolvedValue(undefined),
  };
  const mockGameService = {
    createGame: vi.fn().mockResolvedValue({ id: 'replay-game-001' }),
  };
  const mockTournamentRoundPreviewService = {
    openWindow: vi.fn().mockResolvedValue({
      tournamentId: 't-1',
      round: 1,
      expiresAt: Date.now() + 30_000,
      matches: [],
    }),
  };
  return {
    mockQuery,
    mockClient,
    mockTournamentService,
    mockLeaderboardService,
    mockGameService,
    mockTournamentRoundPreviewService,
  };
});

vi.mock('../config/db.js', () => ({
  default: {
    query:   (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue(mockClient),
  },
}));

vi.mock('../services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/tournament.service.js', () => ({
  TournamentService: mockTournamentService,
}));

vi.mock('../services/leaderboard.service.js', () => ({
  LeaderboardService: mockLeaderboardService,
}));

vi.mock('../services/game.service.js', () => ({
  GameService: mockGameService,
}));

vi.mock('../services/tournament-round-preview.service.js', () => ({
  TournamentRoundPreviewService: mockTournamentRoundPreviewService,
}));

import { SettlementService } from '../services/settlement.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WINNER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const LOSER_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';
const GAME_ID   = 'cccccccc-0000-0000-0000-000000000003';

function setupSuccessfulTransaction(rowCount = 1) {
  mockClient.query.mockImplementation((sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve();
    if (typeof sql === 'string' && sql.includes('UPDATE games')) return Promise.resolve({ rowCount });
    return Promise.resolve({ rowCount: 1, rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockTournamentService.recordMatchResult.mockReset();
  mockLeaderboardService.rebuildAll.mockReset();
  mockGameService.createGame.mockReset();
  mockTournamentRoundPreviewService.openWindow.mockReset();
  mockTournamentService.recordMatchResult.mockResolvedValue(undefined);
  mockLeaderboardService.rebuildAll.mockResolvedValue(undefined);
  mockGameService.createGame.mockResolvedValue({ id: 'replay-game-001' });
  mockTournamentRoundPreviewService.openWindow.mockResolvedValue({
    tournamentId: 't-1',
    round: 1,
    expiresAt: Date.now() + 30_000,
    matches: [],
  });
  // Default fallback for any unexpected pool.query calls (e.g. tournament_matches lookup)
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ─── calculateWinPayout ───────────────────────────────────────────────────────

describe('calculateWinPayout (PRD §12)', () => {
  it('0 TON stake → 0 payout, 0 fee', () => {
    const r = SettlementService.calculateWinPayout('0');
    expect(r.winnerPayout).toBe('0.000000000');
    expect(r.platformFee).toBe('0.000000000');
    expect(r.prizePool).toBe('0.000000000');
  });

  it('1 TON stake → 1.70 payout, 0.30 fee', () => {
    const r = SettlementService.calculateWinPayout('1');
    expect(parseFloat(r.winnerPayout)).toBeCloseTo(1.70, 9);
    expect(parseFloat(r.platformFee)).toBeCloseTo(0.30, 9);
    expect(parseFloat(r.prizePool)).toBeCloseTo(2.00, 9);
  });

  it('10 TON stake → 17.00 payout, 3.00 fee', () => {
    const r = SettlementService.calculateWinPayout('10');
    expect(parseFloat(r.winnerPayout)).toBeCloseTo(17.00, 9);
    expect(parseFloat(r.platformFee)).toBeCloseTo(3.00, 9);
  });

  it('payout + fee = prizePool for all common stakes', () => {
    for (const stake of ['0.1', '0.5', '1', '2', '5', '10', '50']) {
      const r = SettlementService.calculateWinPayout(stake);
      const sum = parseFloat(r.winnerPayout) + parseFloat(r.platformFee);
      expect(sum).toBeCloseTo(parseFloat(r.prizePool), 6);
    }
  });
});

// ─── settleWin ────────────────────────────────────────────────────────────────

describe('settleWin', () => {
  it('throws if winner or loser not found in DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1'),
    ).rejects.toThrow('player not found');
  });

  it('returns early with zero deltas if game already settled (rowCount=0)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }],
    });
    setupSuccessfulTransaction(0);

    const result = await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1');

    expect(result.eloChanges.winner.delta).toBe(0);
    expect(result.eloChanges.loser.delta).toBe(0);
    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).not.toContain('COMMIT');
    expect(calls).toContain('ROLLBACK');
  });

  it('applies correct ELO changes for equal-rated players', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }] })
      .mockResolvedValueOnce({ rows: [] }); // tournament_matches lookup
    setupSuccessfulTransaction(1);

    const result = await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1');

    expect(result.eloChanges.winner.delta).toBe(20);
    expect(result.eloChanges.loser.delta).toBe(-20);
    expect(result.eloChanges.winner.after).toBe(1220);
    expect(result.eloChanges.loser.after).toBe(1180);
  });

  it('skips balance operations for tournament games (stake=0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }] })
      .mockResolvedValueOnce({ rows: [] }); // tournament_matches
    setupSuccessfulTransaction(1);

    await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '0');

    const balanceQueries = mockClient.query.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((q: string) => q.includes('balances'));
    expect(balanceQueries).toHaveLength(0);
  });

  it('does touch balances for real-money games (stake>0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }] })
      .mockResolvedValueOnce({ rows: [] });
    setupSuccessfulTransaction(1);

    await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1');

    const balanceQueries = mockClient.query.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((q: string) => q.includes('balances'));
    expect(balanceQueries.length).toBeGreaterThan(0);
  });

  it('releases DB client even when an error is thrown mid-transaction', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }] });
    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (sql === 'ROLLBACK') return Promise.resolve();
      return Promise.reject(new Error('DB error'));
    });

    await expect(
      SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1'),
    ).rejects.toThrow('DB error');

    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});

// ─── settleDraw ───────────────────────────────────────────────────────────────

describe('settleDraw', () => {
  const P1 = WINNER_ID;
  const P2 = LOSER_ID;

  it('returns early if game already settled (rowCount=0)', async () => {
    setupSuccessfulTransaction(0);
    const result = await SettlementService.settleDraw(GAME_ID, P1, P2, '1');
    expect(result.stake).toBe('1');
    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).not.toContain('COMMIT');
  });

  it('unlocks stakes for both players on draw', async () => {
    setupSuccessfulTransaction(1);
    await SettlementService.settleDraw(GAME_ID, P1, P2, '2');

    const balanceQueries = mockClient.query.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((q: string) => q.includes('balances'));
    expect(balanceQueries.length).toBeGreaterThan(0);
    expect(balanceQueries.some(q => q.includes('locked') && q.includes('available'))).toBe(true);
  });

  it('releases DB client on error', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (sql === 'ROLLBACK') return Promise.resolve();
      return Promise.reject(new Error('DB error'));
    });

    await expect(
      SettlementService.settleDraw(GAME_ID, P1, P2, '1'),
    ).rejects.toThrow('DB error');

    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('tournament draw #1 creates replay and emits round preview', async () => {
    setupSuccessfulTransaction(1);
    const ioEmit = vi.fn();
    const roomEmit = vi.fn();
    const io = {
      emit: ioEmit,
      to: vi.fn(() => ({ emit: roomEmit })),
    } as any;

    mockQuery
      // user sync player1
      .mockResolvedValueOnce({ rows: [{ id: P1, username: 'p1', elo: 1200, walletAddress: 'w1', gamesPlayed: 1, gamesWon: 1, gamesLost: 0, gamesDrawn: 0, totalWon: '1' }] })
      .mockResolvedValueOnce({ rows: [{ available: '1', locked: '0', total: '1' }] })
      // user sync player2
      .mockResolvedValueOnce({ rows: [{ id: P2, username: 'p2', elo: 1200, walletAddress: 'w2', gamesPlayed: 1, gamesWon: 0, gamesLost: 1, gamesDrawn: 0, totalWon: '0' }] })
      .mockResolvedValueOnce({ rows: [{ available: '1', locked: '0', total: '1' }] })
      // tournament match lookup
      .mockResolvedValueOnce({
        rows: [{
          id: 'match-1',
          tournamentId: 't-1',
          round: 2,
          player1Id: P1,
          player2Id: P2,
          replayCount: 0,
        }],
      })
      // users elo for replay game creation
      .mockResolvedValueOnce({ rows: [{ elo: 1210 }] })
      .mockResolvedValueOnce({ rows: [{ elo: 1190 }] })
      // update tournament_matches with replay game
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await SettlementService.settleDraw(GAME_ID, P1, P2, '0', io);

    expect(mockGameService.createGame).toHaveBeenCalledOnce();
    expect(mockTournamentRoundPreviewService.openWindow).toHaveBeenCalledOnce();
    expect(mockTournamentService.recordMatchResult).not.toHaveBeenCalled();
    expect(ioEmit).toHaveBeenCalledWith('leaderboard.updated', expect.any(Object));
    expect(roomEmit).toHaveBeenCalledWith('tournament.round_preview', expect.objectContaining({ tournamentId: 't-1', round: 2 }));
  });

  it('tournament draw #2 forces winner by higher seed elo', async () => {
    setupSuccessfulTransaction(1);
    const io = {
      emit: vi.fn(),
      to: vi.fn(() => ({ emit: vi.fn() })),
    } as any;

    mockQuery
      // user sync player1
      .mockResolvedValueOnce({ rows: [{ id: P1, username: 'p1', elo: 1200, walletAddress: 'w1', gamesPlayed: 1, gamesWon: 1, gamesLost: 0, gamesDrawn: 0, totalWon: '1' }] })
      .mockResolvedValueOnce({ rows: [{ available: '1', locked: '0', total: '1' }] })
      // user sync player2
      .mockResolvedValueOnce({ rows: [{ id: P2, username: 'p2', elo: 1200, walletAddress: 'w2', gamesPlayed: 1, gamesWon: 0, gamesLost: 1, gamesDrawn: 0, totalWon: '0' }] })
      .mockResolvedValueOnce({ rows: [{ available: '1', locked: '0', total: '1' }] })
      // tournament match lookup
      .mockResolvedValueOnce({
        rows: [{
          id: 'match-2',
          tournamentId: 't-2',
          round: 3,
          player1Id: P1,
          player2Id: P2,
          replayCount: 1,
        }],
      })
      // seeds lookup
      .mockResolvedValueOnce({
        rows: [
          { userId: P1, seedElo: 1400 },
          { userId: P2, seedElo: 1300 },
        ],
      });

    await SettlementService.settleDraw(GAME_ID, P1, P2, '0', io);

    expect(mockGameService.createGame).not.toHaveBeenCalled();
    expect(mockTournamentRoundPreviewService.openWindow).not.toHaveBeenCalled();
    expect(mockTournamentService.recordMatchResult).toHaveBeenCalledWith('t-2', 'match-2', P1, io);
  });
});
