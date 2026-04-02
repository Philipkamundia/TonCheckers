/**
 * tournament.test.ts — Tests for TournamentService and BracketService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockQuery, mockClient, mockBalanceService } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  const mockQuery  = vi.fn();
  const mockBalanceService = {
    deductBalance: vi.fn().mockResolvedValue(undefined),
    creditBalance: vi.fn().mockResolvedValue(undefined),
  };
  return { mockQuery, mockClient, mockBalanceService };
});

vi.mock('../config/db.js', () => ({
  default: {
    query:   (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue(mockClient),
  },
}));

vi.mock('../services/balance.service.js', () => ({
  BalanceService: mockBalanceService,
}));

vi.mock('../services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/game.service.js', () => ({
  GameService: { createGame: vi.fn().mockResolvedValue({ id: 'game-id-001' }) },
}));

vi.mock('../services/game-timer.service.js', () => ({
  GameTimerService: { startTimer: vi.fn().mockResolvedValue(undefined) },
}));

import { BracketService } from '../services/bracket.service.js';
import { TournamentService } from '../services/tournament.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CREATOR_ID    = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_ID       = 'bbbbbbbb-0000-0000-0000-000000000002';
const TOURNAMENT_ID = 'cccccccc-0000-0000-0000-000000000003';
const FUTURE_DATE   = new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockBalanceService.deductBalance.mockResolvedValue(undefined);
  mockBalanceService.creditBalance.mockResolvedValue(undefined);
});

// ─── BracketService ───────────────────────────────────────────────────────────

describe('BracketService.generateRound1', () => {
  function makePlayers(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      userId:  `player-${i.toString().padStart(2, '0')}`,
      seedElo: 1200 + i * 10,
    }));
  }

  it('exact bracket: 8 players, 8-bracket → 4 matches, 0 byes', () => {
    const { matches, byePlayers } = BracketService.generateRound1(makePlayers(8), 8);
    expect(byePlayers).toHaveLength(0);
    expect(matches.filter(m => !m.isBye)).toHaveLength(4);
  });

  it('incomplete bracket: 6 players, 8-bracket → 2 byes, 2 R1 matches', () => {
    const { matches, byePlayers } = BracketService.generateRound1(makePlayers(6), 8);
    expect(byePlayers).toHaveLength(2);
    expect(matches.filter(m => m.isBye)).toHaveLength(2);
    expect(matches.filter(m => !m.isBye)).toHaveLength(2);
  });

  it('byes go to highest ELO players', () => {
    const players = makePlayers(6);
    const { byePlayers } = BracketService.generateRound1(players, 8);
    expect(byePlayers).toContain('player-05');
    expect(byePlayers).toContain('player-04');
  });

  it('all players get a match or bye', () => {
    const players = makePlayers(12);
    const { matches, byePlayers } = BracketService.generateRound1(players, 16);
    const allAssigned = new Set([
      ...byePlayers,
      ...matches.flatMap(m => [m.player1Id, m.player2Id].filter(Boolean)),
    ]);
    expect(allAssigned.size).toBe(12);
  });

  it('single player → 1 bye, 0 real matches', () => {
    const { matches, byePlayers } = BracketService.generateRound1(
      [{ userId: 'solo', seedElo: 1200 }], 8,
    );
    expect(byePlayers).toHaveLength(1);
    expect(matches.filter(m => !m.isBye)).toHaveLength(0);
  });
});

describe('BracketService.generateNextRound', () => {
  it('pairs winners correctly', () => {
    const matches = BracketService.generateNextRound(['w1', 'w2', 'w3', 'w4'], 2);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ player1Id: 'w1', player2Id: 'w2', isBye: false });
    expect(matches[1]).toMatchObject({ player1Id: 'w3', player2Id: 'w4', isBye: false });
  });

  it('odd number of winners → last player gets a bye', () => {
    const matches = BracketService.generateNextRound(['w1', 'w2', 'w3'], 2);
    expect(matches).toHaveLength(2);
    expect(matches[1].isBye).toBe(true);
    expect(matches[1].player2Id).toBeNull();
  });
});

describe('BracketService.calculatePrizes', () => {
  it('splits 100 TON: 70/5/25', () => {
    const { winnerPayout, creatorPayout, platformFee } = BracketService.calculatePrizes('100');
    expect(parseFloat(winnerPayout)).toBeCloseTo(70, 6);
    expect(parseFloat(creatorPayout)).toBeCloseTo(5, 6);
    expect(parseFloat(platformFee)).toBeCloseTo(25, 6);
  });

  it('payouts sum to prize pool', () => {
    const { winnerPayout, creatorPayout, platformFee } = BracketService.calculatePrizes('80');
    const sum = parseFloat(winnerPayout) + parseFloat(creatorPayout) + parseFloat(platformFee);
    expect(sum).toBeCloseTo(80, 6);
  });

  it('handles zero prize pool', () => {
    const { winnerPayout, creatorPayout, platformFee } = BracketService.calculatePrizes('0');
    expect(parseFloat(winnerPayout)).toBe(0);
    expect(parseFloat(creatorPayout)).toBe(0);
    expect(parseFloat(platformFee)).toBe(0);
  });
});

// ─── TournamentService.createTournament ──────────────────────────────────────

describe('TournamentService.createTournament — validation', () => {
  it('throws INVALID_BRACKET_SIZE for unsupported size', async () => {
    await expect(
      TournamentService.createTournament(CREATOR_ID, 'Test', 10, '1', FUTURE_DATE),
    ).rejects.toMatchObject({ code: 'INVALID_BRACKET_SIZE' });
  });

  it('accepts valid bracket sizes: 8, 16, 32, 64', async () => {
    for (const size of [8, 16, 32, 64]) {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: TOURNAMENT_ID, name: 'T', bracketSize: size, entryFee: '1', prizePool: '0', status: 'open', startsAt: FUTURE_DATE, createdAt: new Date().toISOString() }],
      });
      const t = await TournamentService.createTournament(CREATOR_ID, 'T', size, '1', FUTURE_DATE);
      expect(t.id).toBe(TOURNAMENT_ID);
    }
  });

  it('throws INVALID_ENTRY_FEE for negative entry fee', async () => {
    await expect(
      TournamentService.createTournament(CREATOR_ID, 'Test', 8, '-1', FUTURE_DATE),
    ).rejects.toMatchObject({ code: 'INVALID_ENTRY_FEE' });
  });

  it('allows zero entry fee (free tournament)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TOURNAMENT_ID, name: 'Free', bracketSize: 8, entryFee: '0', prizePool: '0', status: 'open', startsAt: FUTURE_DATE, createdAt: new Date().toISOString() }],
    });
    const t = await TournamentService.createTournament(CREATOR_ID, 'Free', 8, '0', FUTURE_DATE);
    expect(t).toBeDefined();
  });

  it('throws INVALID_START_TIME for past date', async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    await expect(
      TournamentService.createTournament(CREATOR_ID, 'Test', 8, '1', pastDate),
    ).rejects.toMatchObject({ code: 'INVALID_START_TIME' });
  });

  it('throws INVALID_START_TIME for invalid date string', async () => {
    await expect(
      TournamentService.createTournament(CREATOR_ID, 'Test', 8, '1', 'not-a-date'),
    ).rejects.toMatchObject({ code: 'INVALID_START_TIME' });
  });
});

// ─── TournamentService.joinTournament ────────────────────────────────────────

describe('TournamentService.joinTournament', () => {
  it('throws NOT_FOUND when tournament does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      TournamentService.joinTournament(TOURNAMENT_ID, USER_ID),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws TOURNAMENT_CLOSED when status is not open', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TOURNAMENT_ID, status: 'in_progress', bracket_size: 8, entryFee: '1', prizePool: '0' }],
    });
    await expect(
      TournamentService.joinTournament(TOURNAMENT_ID, USER_ID),
    ).rejects.toMatchObject({ code: 'TOURNAMENT_CLOSED' });
  });

  it('throws ALREADY_REGISTERED when user already joined', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: TOURNAMENT_ID, status: 'open', bracket_size: 8, entryFee: '1', prizePool: '0' }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // already exists
    await expect(
      TournamentService.joinTournament(TOURNAMENT_ID, USER_ID),
    ).rejects.toMatchObject({ code: 'ALREADY_REGISTERED' });
  });

  it('throws TOURNAMENT_FULL and refunds fee when bracket is at capacity', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: TOURNAMENT_ID, status: 'open', bracket_size: 8, entryFee: '1', prizePool: '0' }] })
      .mockResolvedValueOnce({ rows: [] })                    // not already joined
      .mockResolvedValueOnce({ rows: [{ elo: 1200 }] });      // user elo

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (sql === 'ROLLBACK') return Promise.resolve();
      if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ bracket_size: 8, participant_count: 8 }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await expect(
      TournamentService.joinTournament(TOURNAMENT_ID, USER_ID),
    ).rejects.toMatchObject({ code: 'TOURNAMENT_FULL' });

    expect(mockBalanceService.creditBalance).toHaveBeenCalledWith(USER_ID, '1');
  });

  it('deducts entry fee and inserts participant on success', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: TOURNAMENT_ID, status: 'open', bracket_size: 8, entryFee: '2', prizePool: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ elo: 1400 }] });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ bracket_size: 8, participant_count: 3 }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const result = await TournamentService.joinTournament(TOURNAMENT_ID, USER_ID);

    expect(mockBalanceService.deductBalance).toHaveBeenCalledWith(USER_ID, '2');
    expect(result.tournamentId).toBe(TOURNAMENT_ID);
    expect(result.userId).toBe(USER_ID);
    expect(result.entryFee).toBe('2');
  });

  it('does not deduct fee for free tournaments (entryFee=0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: TOURNAMENT_ID, status: 'open', bracket_size: 8, entryFee: '0', prizePool: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ elo: 1200 }] });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ bracket_size: 8, participant_count: 0 }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await TournamentService.joinTournament(TOURNAMENT_ID, USER_ID);

    expect(mockBalanceService.deductBalance).not.toHaveBeenCalled();
  });
});

// ─── TournamentService.cancelTournament ──────────────────────────────────────

describe('TournamentService.cancelTournament', () => {
  it('refunds all participants when entry fee > 0', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ entryFee: '5' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3' }] });

    await TournamentService.cancelTournament(TOURNAMENT_ID, 'test reason');

    expect(mockBalanceService.creditBalance).toHaveBeenCalledTimes(3);
    expect(mockBalanceService.creditBalance).toHaveBeenCalledWith('user-1', '5');
    expect(mockBalanceService.creditBalance).toHaveBeenCalledWith('user-2', '5');
    expect(mockBalanceService.creditBalance).toHaveBeenCalledWith('user-3', '5');
  });

  it('does not call creditBalance for free tournaments', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ entryFee: '0' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ userId: 'user-1' }, { userId: 'user-2' }] });

    await TournamentService.cancelTournament(TOURNAMENT_ID, 'test');

    expect(mockBalanceService.creditBalance).not.toHaveBeenCalled();
  });

  it('handles tournament with no participants gracefully', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ entryFee: '1' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    await TournamentService.cancelTournament(TOURNAMENT_ID, 'empty');

    expect(mockBalanceService.creditBalance).not.toHaveBeenCalled();
  });
});
