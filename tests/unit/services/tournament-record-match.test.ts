/**
 * tests/unit/services/tournament-record-match.test.ts
 *
 * TournamentService.recordMatchResult — bracket advancement, round completion,
 * next round generation, finalization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TournamentService } from '../../../apps/backend/src/services/tournament.service.js';

const { mockQuery, mockConnect, mockClient, mockCreateGame, mockOpenPreviewWindow, mockCreateLobby } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  return {
    mockQuery:           vi.fn(),
    mockConnect:         vi.fn(),
    mockClient,
    mockCreateGame:      vi.fn(),
    mockOpenPreviewWindow: vi.fn(),
    mockCreateLobby:     vi.fn(),
  };
});

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockQuery, connect: mockConnect },
}));
vi.mock('../../../apps/backend/src/services/balance.service.js', () => ({
  BalanceService: { deductBalance: vi.fn(), creditBalance: vi.fn() },
}));
vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../apps/backend/src/services/game.service.js', () => ({
  GameService: { createGame: mockCreateGame },
}));
vi.mock('../../../apps/backend/src/services/game-timer.service.js', () => ({
  GameTimerService: { startTimer: vi.fn() },
}));
vi.mock('../../../apps/backend/src/services/tournament-lobby.service.js', () => ({
  TournamentLobbyService: { createLobby: mockCreateLobby },
}));
vi.mock('../../../apps/backend/src/services/tournament-round-preview.service.js', () => ({
  TournamentRoundPreviewService: { openWindow: mockOpenPreviewWindow },
}));
const T_ID   = 'tournament-001';
const M_ID   = 'match-001';
const WINNER = 'player-winner';
const LOSER  = 'player-loser';

const mockIo = {
  to: vi.fn().mockImplementation(() => ({ emit: vi.fn() })),
} as any;

beforeEach(() => {
  vi.resetAllMocks();
  mockConnect.mockResolvedValue(mockClient);
  mockClient.release.mockReturnValue(undefined);
  mockIo.to.mockImplementation(() => ({ emit: vi.fn() }));
  mockCreateGame.mockResolvedValue({ id: 'new-game-id' });
  mockOpenPreviewWindow.mockResolvedValue({ expiresAt: Date.now() + 30_000 });
  mockCreateLobby.mockResolvedValue({ expiresAt: Date.now() + 10_000 });
});

// ─── recordMatchResult ────────────────────────────────────────────────────────

describe('TournamentService.recordMatchResult', () => {
  it('records winner, advances winner, eliminates loser', async () => {
    // Transaction queries
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN') || sql.includes('COMMIT')) return Promise.resolve({});
      if (sql.includes('UPDATE tournament_matches SET winner_id'))
        return Promise.resolve({ rows: [{ round: 1, match_number: 1 }] });
      return Promise.resolve({ rowCount: 1 });
    });

    // checkRoundComplete: still pending matches → round not complete
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] }); // pending count > 0

    await TournamentService.recordMatchResult(T_ID, M_ID, WINNER, mockIo);

    const txCalls = mockClient.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(txCalls.some(s => s.includes('UPDATE tournament_matches SET winner_id'))).toBe(true);
    expect(txCalls.some(s => s.includes('current_round=current_round+1'))).toBe(true);
    expect(txCalls.some(s => s.includes('is_eliminated=true'))).toBe(true);
  });

  it('rolls back transaction on DB error', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      throw new Error('DB failure');
    });

    await expect(
      TournamentService.recordMatchResult(T_ID, M_ID, WINNER, mockIo),
    ).rejects.toThrow('DB failure');

    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true);
  });
});

// ─── checkRoundComplete → next round ─────────────────────────────────────────

describe('TournamentService — round completion', () => {
  function setupRecordMatch(round: number) {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN') || sql.includes('COMMIT')) return Promise.resolve({});
      if (sql.includes('UPDATE tournament_matches SET winner_id'))
        return Promise.resolve({ rows: [{ round, match_number: 1 }] });
      return Promise.resolve({ rowCount: 1 });
    });
  }

  it('does not generate next round when matches still pending', async () => {
    setupRecordMatch(1);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 2 }] }); // 2 pending
    await TournamentService.recordMatchResult(T_ID, M_ID, WINNER, mockIo);
    // No SELECT winners query should be made
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('generates next round when all matches complete', async () => {
    setupRecordMatch(1);
    // checkRoundComplete queries
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })                             // no pending
      .mockResolvedValueOnce({ rows: [{ winnerId: WINNER }, { winnerId: LOSER }] }) // 2 winners → next round
      .mockResolvedValueOnce({ rowCount: 1 })                                       // UPDATE current_round
      .mockResolvedValueOnce({ rows: [{ name: 'Test Tournament' }] })               // SELECT name
      .mockResolvedValueOnce({ rows: [{ elo: 1200, username: 'W' }] })              // p1 info
      .mockResolvedValueOnce({ rows: [{ elo: 1200, username: 'L' }] })              // p2 info
      .mockResolvedValueOnce({ rows: [{ id: 'new-match-id' }] });                   // INSERT match

    await TournamentService.recordMatchResult(T_ID, M_ID, WINNER, mockIo);
    expect(mockQuery.mock.calls.some((c: unknown[]) => (c[0] as string).includes('SELECT winner_id'))).toBe(true);
  });

  it('finalizes tournament when only 1 winner remains', async () => {
    // Single implementation handles both recordMatchResult tx AND finalizeTournament tx
    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      if (sql.includes('UPDATE tournament_matches SET winner_id'))
        return Promise.resolve({ rows: [{ round: 2, match_number: 1 }] });
      return Promise.resolve({ rowCount: 1 });
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ winnerId: WINNER }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Test', prizePool: '100', creatorId: 'creator-1' }] })
      // finalizeTournament: participants query
      .mockResolvedValueOnce({ rows: [{ userId: WINNER }] })
      // emitUserSync for winner
      .mockResolvedValueOnce({ rows: [{ id: WINNER, username: 'Winner', elo: 1200, walletAddress: null, gamesPlayed: 10, gamesWon: 5, totalWon: '50' }] })
      .mockResolvedValueOnce({ rows: [{ available: '100', locked: '0' }] })
      // LeaderboardService.rebuildAll (4 sort modes)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await TournamentService.recordMatchResult(T_ID, M_ID, WINNER, mockIo);
    // finalizeTournament runs inside a client transaction
    const clientCalls = mockClient.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(clientCalls.some(s => s.includes("status='completed'"))).toBe(true);
  });
});

// ─── resolveBracketWindow ─────────────────────────────────────────────────────

describe('TournamentService.resolveBracketWindow', () => {
  const ALL_PARTICIPANTS = [
    { userId: 'p1', seedElo: 1800 },
    { userId: 'p2', seedElo: 1600 },
    { userId: 'p3', seedElo: 1400 },
    { userId: 'p4', seedElo: 1200 },
  ];

  it('cancels tournament when fewer than 2 players present', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: T_ID, status: 'in_progress', bracketSize: 8 }] })
      // eliminate absent players p2, p3, p4 (3 absent)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      // cancelTournament
      .mockResolvedValueOnce({ rows: [{ entryFee: '1.0', name: 'Test' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    await TournamentService.resolveBracketWindow(T_ID, ['p1'], ALL_PARTICIPANTS, mockIo);
    expect(mockQuery.mock.calls.some((c: unknown[]) => (c[0] as string).includes("status='cancelled'"))).toBe(true);
  });

  it('eliminates absent players and generates bracket for present ones', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: T_ID, status: 'in_progress', bracketSize: 8 }] })
      // eliminate p3 and p4
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      // UPDATE current_round=1
      .mockResolvedValueOnce({ rowCount: 1 })
      // user cache lookups for p1, p2
      .mockResolvedValueOnce({ rows: [{ username: 'P1', elo: 1800 }] })
      .mockResolvedValueOnce({ rows: [{ username: 'P2', elo: 1600 }] })
      // INSERT game match
      .mockResolvedValueOnce({ rows: [{ id: 'match-new' }] })
      // TournamentRoundPreviewService.openWindow (mocked)
      .mockResolvedValueOnce({ rows: [] });

    await TournamentService.resolveBracketWindow(T_ID, ['p1', 'p2'], ALL_PARTICIPANTS, mockIo);

    const eliminateCalls = mockQuery.mock.calls.filter((c: unknown[]) =>
      (c[0] as string).includes('is_eliminated=true'),
    );
    expect(eliminateCalls.length).toBeGreaterThan(0);
  });

  it('does nothing when tournament is not in_progress', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: T_ID, status: 'open', bracketSize: 8 }] });
    await TournamentService.resolveBracketWindow(T_ID, ['p1', 'p2'], ALL_PARTICIPANTS, mockIo);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
