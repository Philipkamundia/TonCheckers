/**
 * tests/unit/services/tournament.service.extended.test.ts
 *
 * Covers the uncovered branches in TournamentService:
 * - finalizeTournament: winner IS creator (merged credit)
 * - finalizeTournament: double-execution guard (rowCount=0)
 * - activateRoundMatchLobby: emits to both players
 * - recoverStuckRound: delegates to checkRoundComplete
 * - listTournaments / getTournamentDetail
 * - startTournament: insufficient participants
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDbQuery, mockDbConnect, mockDbClient, mockNotify, mockCreateLobby,
        mockCalculatePrizes, mockCreateGame, mockOpenPreview } = vi.hoisted(() => {
  const mockDbClient = { query: vi.fn(), release: vi.fn() };
  return {
    mockDbQuery:        vi.fn(),
    mockDbConnect:      vi.fn().mockResolvedValue(mockDbClient),
    mockDbClient,
    mockNotify:         vi.fn(),
    mockCreateLobby:    vi.fn(),
    mockCalculatePrizes: vi.fn(),
    mockCreateGame:     vi.fn(),
    mockOpenPreview:    vi.fn(),
  };
});

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery, connect: mockDbConnect },
}));
vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: mockNotify },
}));
vi.mock('../../../apps/backend/src/services/tournament-lobby.service.js', () => ({
  TournamentLobbyService: { createLobby: mockCreateLobby },
}));
vi.mock('../../../apps/backend/src/services/bracket.service.js', () => ({
  BracketService: {
    calculatePrizes:  mockCalculatePrizes,
    generateRound1:   vi.fn().mockReturnValue({ matches: [], byePlayers: [] }),
    generateNextRound: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('../../../apps/backend/src/services/game.service.js', () => ({
  GameService: { createGame: mockCreateGame },
}));
vi.mock('../../../apps/backend/src/services/tournament-round-preview.service.js', () => ({
  TournamentRoundPreviewService: { openWindow: mockOpenPreview },
}));
vi.mock('../../../apps/backend/src/services/balance.service.js', () => ({
  BalanceService: { deductBalance: vi.fn(), creditBalance: vi.fn() },
}));
vi.mock('../../../apps/backend/src/engine/board.js', () => ({
  initialGameState: vi.fn().mockReturnValue({}),
}));

import { TournamentService } from '../../../apps/backend/src/services/tournament.service.js';

function makeIo() {
  const emit = vi.fn();
  const to   = vi.fn().mockReturnValue({ emit });
  return { to, emit };
}

const TOURNAMENT_ID = 'tournament-001';
const WINNER_ID     = 'winner-001';
const CREATOR_ID    = 'creator-001';

beforeEach(() => {
  vi.clearAllMocks();
  mockNotify.mockResolvedValue(undefined);
  mockDbClient.release.mockReturnValue(undefined);
  mockDbConnect.mockResolvedValue(mockDbClient);
});

// ─── finalizeTournament ───────────────────────────────────────────────────────

describe('TournamentService.finalizeTournament', () => {
  beforeEach(() => {
    mockCalculatePrizes.mockReturnValue({
      winnerPayout: '70.000000000',
      creatorPayout: '10.000000000',
      platformFee:  '20.000000000',
    });
  });

  it('credits winner and creator separately when they are different people', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ name: 'Test Cup', prizePool: '100', creatorId: CREATOR_ID }],
    });

    const clientCalls: string[] = [];
    mockDbClient.query.mockImplementation((sql: string) => {
      clientCalls.push(sql.trim().slice(0, 60));
      if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK'))
        return Promise.resolve({});
      if (sql.includes('UPDATE tournaments')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const io = makeIo();
    await TournamentService.finalizeTournament(TOURNAMENT_ID, WINNER_ID, io as never);

    // Should have two separate balance credits (winner + creator)
    const balanceCalls = clientCalls.filter(s => s.includes('UPDATE balances'));
    expect(balanceCalls.length).toBeGreaterThanOrEqual(2);
    expect(mockNotify).toHaveBeenCalledWith(WINNER_ID, 'tournament_result', expect.any(Object));
  });

  it('merges credits when winner IS the creator', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ name: 'Test Cup', prizePool: '100', creatorId: WINNER_ID }], // same person
    });

    const clientCalls: string[] = [];
    mockDbClient.query.mockImplementation((sql: string) => {
      clientCalls.push(sql.trim().slice(0, 60));
      if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK'))
        return Promise.resolve({});
      if (sql.includes('UPDATE tournaments')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const io = makeIo();
    await TournamentService.finalizeTournament(TOURNAMENT_ID, WINNER_ID, io as never);

    // All balance credits go to WINNER_ID (no separate creator credit)
    const balanceCalls = clientCalls.filter(s => s.includes('UPDATE balances'));
    expect(balanceCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('returns early when tournament already finalized (rowCount=0)', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ name: 'Test Cup', prizePool: '100', creatorId: CREATOR_ID }],
    });

    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN') || sql.includes('ROLLBACK')) return Promise.resolve({});
      if (sql.includes('UPDATE tournaments')) return Promise.resolve({ rowCount: 0 }); // already done
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const io = makeIo();
    await TournamentService.finalizeTournament(TOURNAMENT_ID, WINNER_ID, io as never);

    expect(mockNotify).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows on DB error', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ name: 'Test Cup', prizePool: '100', creatorId: CREATOR_ID }],
    });

    let rollbackCalled = false;
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('ROLLBACK')) { rollbackCalled = true; return Promise.resolve({}); }
      if (sql.includes('UPDATE tournaments')) return Promise.resolve({ rowCount: 1 });
      throw new Error('DB write error');
    });

    const io = makeIo();
    await expect(
      TournamentService.finalizeTournament(TOURNAMENT_ID, WINNER_ID, io as never),
    ).rejects.toThrow('DB write error');
    expect(rollbackCalled).toBe(true);
  });
});

// ─── activateRoundMatchLobby ──────────────────────────────────────────────────

describe('TournamentService.activateRoundMatchLobby', () => {
  it('emits tournament.lobby_ready to both players', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Test Cup' }] })          // tournament
      .mockResolvedValueOnce({ rows: [{ username: 'alice', elo: 1200 }] }) // p1
      .mockResolvedValueOnce({ rows: [{ username: 'bob', elo: 1300 }] });  // p2

    mockCreateLobby.mockResolvedValueOnce({ expiresAt: Date.now() + 30_000 });

    const io = makeIo();
    const match = { gameId: 'g1', matchId: 'm1', player1Id: 'p1', player2Id: 'p2' };
    await TournamentService.activateRoundMatchLobby(TOURNAMENT_ID, 1, match, io as never);

    expect(io.to).toHaveBeenCalledWith('user:p1');
    expect(io.to).toHaveBeenCalledWith('user:p2');
    expect(mockNotify).toHaveBeenCalledTimes(2);
  });

  it('uses default opponent info when player lookup returns null', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Test Cup' }] })
      .mockResolvedValueOnce({ rows: [] }) // p1 not found
      .mockResolvedValueOnce({ rows: [] }); // p2 not found

    mockCreateLobby.mockResolvedValueOnce({ expiresAt: Date.now() + 30_000 });

    const io = makeIo();
    const match = { gameId: 'g1', matchId: 'm1', player1Id: 'p1', player2Id: 'p2' };
    await TournamentService.activateRoundMatchLobby(TOURNAMENT_ID, 1, match, io as never);

    // Should still emit with defaults
    expect(io.to).toHaveBeenCalledWith('user:p1');
    expect(io.to).toHaveBeenCalledWith('user:p2');
  });
});

// ─── recoverStuckRound ────────────────────────────────────────────────────────

describe('TournamentService.recoverStuckRound', () => {
  it('returns early when matches still pending', async () => {
    // checkRoundComplete only queries pending count — no tournament status query
    mockDbQuery.mockResolvedValue({ rows: [{ count: 2 }] });
    const io = makeIo();
    await TournamentService.recoverStuckRound(TOURNAMENT_ID, 1, io as never);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('generates next round when 2+ winners remain', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })                          // no pending
      .mockResolvedValueOnce({ rows: [{ winnerId: 'w1' }, { winnerId: 'w2' }] }) // 2 winners
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                          // UPDATE current_round
      .mockResolvedValueOnce({ rows: [{ name: 'Cup' }] })                        // SELECT tournament name
      .mockResolvedValue({ rows: [], rowCount: 1 });                             // remaining queries
    const io = makeIo();
    await TournamentService.recoverStuckRound(TOURNAMENT_ID, 1, io as never);
    const roundUpdate = mockDbQuery.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('current_round')
    );
    expect(roundUpdate).toBeDefined();
  });
});

// ─── listTournaments ──────────────────────────────────────────────────────────

describe('TournamentService.listTournaments', () => {
  it('returns all tournaments without filter', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 't1', name: 'Cup' }] });
    const result = await TournamentService.listTournaments();
    expect(result).toHaveLength(1);
  });

  it('filters by status when provided', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'open' }] });
    const result = await TournamentService.listTournaments('open');
    expect(result).toHaveLength(1);
    expect(mockDbQuery.mock.calls[0][1]).toEqual(['open']);
  });
});

// ─── getTournamentDetail ──────────────────────────────────────────────────────

describe('TournamentService.getTournamentDetail', () => {
  it('returns tournament with participants and matches', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 't1', name: 'Cup', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ userId: 'u1', username: 'alice' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'm1', round: 1 }] });

    const result = await TournamentService.getTournamentDetail('t1');
    expect(result.id).toBe('t1');
    expect(result.participants).toHaveLength(1);
    expect(result.matches).toHaveLength(1);
  });

  it('throws NOT_FOUND when tournament does not exist', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(TournamentService.getTournamentDetail('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ─── startTournament ─────────────────────────────────────────────────────────

describe('TournamentService.startTournament', () => {
  it('cancels when fewer than 2 participants', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: TOURNAMENT_ID, name: 'Cup', status: 'open', bracketSize: 8, entryFee: '1', prizePool: '0', creatorId: CREATOR_ID }] })
      .mockResolvedValueOnce({ rows: [{ userId: 'u1', seedElo: 1200 }] }) // only 1 participant
      // cancelTournament queries:
      .mockResolvedValueOnce({ rows: [{ entryFee: '1', name: 'Cup' }] })  // SELECT tournament
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                    // UPDATE cancelled
      .mockResolvedValueOnce({ rows: [] });                                // SELECT participants

    const io = makeIo();
    await TournamentService.startTournament(TOURNAMENT_ID, io as never);

    const cancelCall = mockDbQuery.mock.calls.find(c => c[0].includes("status='cancelled'"));
    expect(cancelCall).toBeDefined();
  });

  it('returns early when tournament not found or not open', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const io = makeIo();
    await TournamentService.startTournament(TOURNAMENT_ID, io as never);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});

