/**
 * tests/unit/services/settlement.test.ts
 *
 * SettlementService — Financial logic tests.
 * 100% branch coverage required for all financial calculation paths.
 *
 * Key invariants under test:
 *   - Win payout = (stake × 2) × 0.85  (PRD §12)
 *   - Platform fee = (stake × 2) × 0.15
 *   - Prize pool = payout + fee (lossless)
 *   - Integer BigInt arithmetic — no float precision loss
 *   - Draw returns stakes unchanged — zero fee
 *   - Tournament games (stake=0) skip balance mutations
 *   - Double-settlement guard (idempotency)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettlementService } from '../../../apps/backend/src/services/settlement.service.js';

// ─── Mock heavy dependencies ──────────────────────────────────────────────────

const { mockQuery, mockConnect, mockClient } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  return {
    mockQuery:   vi.fn(),
    mockConnect: vi.fn(),
    mockClient,
  };
});

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockQuery, connect: mockConnect },
}));

// ELO service — use real implementation (it's pure)
// No mock needed — we want to verify real ELO changes are applied.

vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../apps/backend/src/services/tournament.service.js', () => ({
  TournamentService: { recordMatchResult: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../apps/backend/src/services/leaderboard.service.js', () => ({
  LeaderboardService: { rebuildAll: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../apps/backend/src/services/game.service.js', () => ({
  GameService: { createGame: vi.fn().mockResolvedValue({ id: 'replay-game-id' }) },
}));

vi.mock('../../../apps/backend/src/engine/board.js', () => ({
  initialGameState: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../apps/backend/src/services/tournament-round-preview.service.js', () => ({
  TournamentRoundPreviewService: { openWindow: vi.fn().mockResolvedValue({ expiresAt: Date.now() + 30_000 }) },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupClientTransaction(responses: Record<string, unknown>[] = []) {
  mockConnect.mockResolvedValue(mockClient);
  mockClient.query.mockImplementation((sql: string) => {
    if (sql.trim().startsWith('BEGIN'))    return Promise.resolve({});
    if (sql.trim().startsWith('COMMIT'))   return Promise.resolve({});
    if (sql.trim().startsWith('ROLLBACK')) return Promise.resolve({});
    // Return pre-programmed responses in order
    const resp = responses.shift();
    return Promise.resolve(resp ?? { rows: [], rowCount: 0 });
  });
}

// ─── calculateWinPayout ───────────────────────────────────────────────────────

describe('SettlementService.calculateWinPayout', () => {

  it('computes correct payout for 1 TON stake (PRD §12)', () => {
    const result = SettlementService.calculateWinPayout('1');
    // prizePool = 2 TON, fee = 0.3 TON, payout = 1.7 TON
    expect(parseFloat(result.prizePool)).toBeCloseTo(2.0, 6);
    expect(parseFloat(result.platformFee)).toBeCloseTo(0.3, 6);
    expect(parseFloat(result.winnerPayout)).toBeCloseTo(1.7, 6);
  });

  it('prizePool = winnerPayout + platformFee (lossless, no TON leakage)', () => {
    for (const stake of ['0.1', '0.5', '1', '5', '10', '100', '0.000000001']) {
      const { prizePool, platformFee, winnerPayout } = SettlementService.calculateWinPayout(stake);
      const sum = parseFloat(prizePool);
      const parts = parseFloat(winnerPayout) + parseFloat(platformFee);
      expect(sum).toBeCloseTo(parts, 9);
    }
  });

  it('uses integer BigInt arithmetic — no float precision drift at nano scale', () => {
    // 0.3 TON stake is notorious for float imprecision
    const { winnerPayout, platformFee, prizePool } = SettlementService.calculateWinPayout('0.3');
    // Verify each has exactly 9 decimal places (nanoTON precision)
    expect(winnerPayout).toMatch(/^\d+\.\d{9}$/);
    expect(platformFee).toMatch(/^\d+\.\d{9}$/);
    expect(prizePool).toMatch(/^\d+\.\d{9}$/);
    // 0.3 * 2 = 0.6 TON prize pool
    expect(parseFloat(prizePool)).toBeCloseTo(0.6, 9);
    // 15% fee: 0.6 * 0.15 = 0.09 TON
    expect(parseFloat(platformFee)).toBeCloseTo(0.09, 9);
    // Payout: 0.6 - 0.09 = 0.51 TON
    expect(parseFloat(winnerPayout)).toBeCloseTo(0.51, 9);
  });

  it('handles minimum stake (0.1 TON)', () => {
    const { winnerPayout, platformFee } = SettlementService.calculateWinPayout('0.1');
    expect(parseFloat(winnerPayout)).toBeCloseTo(0.17, 9);
    expect(parseFloat(platformFee)).toBeCloseTo(0.03, 9);
  });

  it('handles large stakes without overflow (1000 TON)', () => {
    const { prizePool, platformFee, winnerPayout } = SettlementService.calculateWinPayout('1000');
    expect(parseFloat(prizePool)).toBeCloseTo(2000, 6);
    expect(parseFloat(platformFee)).toBeCloseTo(300, 6);
    expect(parseFloat(winnerPayout)).toBeCloseTo(1700, 6);
  });

  it('satisfies the 85% payout ratio invariant for all stakes', () => {
    for (const stake of ['0.1', '1', '5', '10', '50']) {
      const { prizePool, winnerPayout } = SettlementService.calculateWinPayout(stake);
      const ratio = parseFloat(winnerPayout) / parseFloat(prizePool);
      expect(ratio).toBeCloseTo(0.85, 9);
    }
  });

  it('platform takes exactly 15% of prize pool', () => {
    const { prizePool, platformFee } = SettlementService.calculateWinPayout('5');
    const feeRatio = parseFloat(platformFee) / parseFloat(prizePool);
    expect(feeRatio).toBeCloseTo(0.15, 9);
  });
});

// ─── settleWin ────────────────────────────────────────────────────────────────

describe('SettlementService.settleWin', () => {
  const WINNER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  const LOSER_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';
  const GAME_ID   = 'cccccccc-0000-0000-0000-000000000003';
  const STAKE     = '1.000000000';

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockClient.release.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Happy path ─────────────────────────────────────────────────────────

  it('commits a full win settlement and returns correct SettlementResult shape', async () => {
    // 1st pool.query: fetch both players' ELO
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: WINNER_ID, elo: 1200 },
        { id: LOSER_ID,  elo: 1200 },
      ],
    });

    // client.query sequence inside transaction:
    // BEGIN, UPDATE games (rowCount=1), UPDATE elo×2, UPDATE stats×2, UPDATE balance×4, INSERT tx, UPDATE total_won, COMMIT
    let callCount = 0;
    mockClient.query.mockImplementation((sql: string) => {
      callCount++;
      if (sql.includes('BEGIN'))    return Promise.resolve({});
      if (sql.includes('COMMIT'))   return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      // UPDATE games (the double-settlement guard)
      if (sql.includes('status=\'completed\'') && sql.includes('AND status=\'active\'')) {
        return Promise.resolve({ rowCount: 1 }); // game was active → settles OK
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    // Pool query for tournament match lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no tournament match

    const result = await SettlementService.settleWin(
      GAME_ID, WINNER_ID, LOSER_ID, 'no_moves', STAKE,
    );

    expect(result.gameId).toBe(GAME_ID);
    expect(result.winnerId).toBe(WINNER_ID);
    expect(result.loserId).toBe(LOSER_ID);
    expect(result.alreadySettled).toBeUndefined();
    expect(parseFloat(result.winnerPayout)).toBeCloseTo(1.7, 6);
    expect(parseFloat(result.platformFee)).toBeCloseTo(0.3, 6);

    // ELO changes should be non-zero (real calculation)
    expect(result.eloChanges.winner.delta).toBeGreaterThan(0);
    expect(result.eloChanges.loser.delta).toBeLessThan(0);
  });

  // ─── Double-settlement guard ─────────────────────────────────────────────

  it('returns alreadySettled=true when game is no longer active (idempotency guard)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: WINNER_ID, elo: 1200 },
        { id: LOSER_ID,  elo: 1200 },
      ],
    });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN'))    return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      // Game UPDATE returns rowCount=0 → already settled
      if (sql.includes('AND status=\'active\'')) {
        return Promise.resolve({ rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await SettlementService.settleWin(
      GAME_ID, WINNER_ID, LOSER_ID, 'no_moves', STAKE,
    );

    expect(result.alreadySettled).toBe(true);
    // ELO deltas are 0 when already settled
    expect(result.eloChanges.winner.delta).toBe(0);
    expect(result.eloChanges.loser.delta).toBe(0);
  });

  // ─── Tournament game (stake=0) skips balance mutations ──────────────────

  it('skips balance mutations for tournament games (stake=0)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: WINNER_ID, elo: 1500 },
        { id: LOSER_ID,  elo: 1500 },
      ],
    });

    const clientCalls: string[] = [];
    mockClient.query.mockImplementation((sql: string) => {
      clientCalls.push(sql.trim().slice(0, 60));
      if (sql.includes('BEGIN'))    return Promise.resolve({});
      if (sql.includes('COMMIT'))   return Promise.resolve({});
      if (sql.includes('AND status=\'active\'')) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });

    await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_moves', '0');

    // Verify no balance UPDATE statements were called
    const balanceCalls = clientCalls.filter(s => s.includes('UPDATE balances'));
    expect(balanceCalls).toHaveLength(0);
  });

  // ─── Missing players ─────────────────────────────────────────────────────

  it('throws if winner player row is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: LOSER_ID, elo: 1200 }] }); // only loser
    await expect(
      SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_moves', STAKE),
    ).rejects.toThrow('player not found');
  });

  // ─── DB transaction rollback on error ───────────────────────────────────

  it('rolls back the DB transaction if an update fails mid-transaction', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }],
    });

    let rollbackCalled = false;
    let callNo = 0;
    mockClient.query.mockImplementation((sql: string) => {
      callNo++;
      if (sql.includes('BEGIN'))    return Promise.resolve({});
      if (sql.includes('ROLLBACK')) { rollbackCalled = true; return Promise.resolve({}); }
      if (sql.includes('AND status=\'active\'')) return Promise.resolve({ rowCount: 1 });
      if (callNo === 4) throw new Error('Simulated DB failure mid-transaction');
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(
      SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_moves', STAKE),
    ).rejects.toThrow('Simulated DB failure');

    expect(rollbackCalled).toBe(true);
  });

  // ─── Payout arithmetic — verify the money ───────────────────────────────

  it.each([
    ['0.1',  0.17,  0.03],
    ['0.5',  0.85,  0.15],
    ['1.0',  1.7,   0.3],
    ['5.0',  8.5,   1.5],
    ['10.0', 17.0,  3.0],
  ])('stake=%s → payout≈%f, fee≈%f', (stake, expectedPayout, expectedFee) => {
    const { winnerPayout, platformFee } = SettlementService.calculateWinPayout(stake);
    expect(parseFloat(winnerPayout)).toBeCloseTo(expectedPayout, 6);
    expect(parseFloat(platformFee)).toBeCloseTo(expectedFee, 6);
  });
});

// ─── settleWin — with io (WebSocket sync + tournament advance) ───────────────

describe('SettlementService.settleWin — with io', () => {
  const WINNER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  const LOSER_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';
  const GAME_ID   = 'cccccccc-0000-0000-0000-000000000003';
  const STAKE     = '1.000000000';

  /** Build a minimal mock Socket.io Server that records emit calls. */
  function makeMockIo() {
    const emitCalls: Array<{ room: string; event: string }> = [];
    const mockEmit = vi.fn((event: string) => { emitCalls.push({ room: '', event }); });
    const mockTo   = vi.fn(() => ({ emit: mockEmit }));
    return { io: { to: mockTo } as any, emitCalls, mockTo, mockEmit };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockClient.release.mockReturnValue(undefined);
  });

  it('calls io.to(user:*).emit for winner and loser after settlement', async () => {
    const { io, mockTo } = makeMockIo();

    // 1. Player ELO fetch
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }],
    });

    // 2. DB transaction (BEGIN + UPDATE games + ELO + stats + balances + INSERT tx + total_won + COMMIT)
    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN','COMMIT','ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      if (sql.includes("AND status='active'")) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    // 3. emitUserSync: 2 user queries + 2 balance queries (winner + loser)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WINNER_ID, username: 'w', elo: 1220 }] })  // user winner
      .mockResolvedValueOnce({ rows: [{ available: '1.7', locked: '0', total: '1.7' }] })  // balance winner
      .mockResolvedValueOnce({ rows: [{ id: LOSER_ID, username: 'l', elo: 1180 }] })   // user loser
      .mockResolvedValueOnce({ rows: [{ available: '9.0', locked: '0', total: '9.0' }] })  // balance loser
      // 4. Tournament match lookup (no match)
      .mockResolvedValueOnce({ rows: [] });

    await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_moves', STAKE, io);

    // io.to() must have been called for both users
    expect(mockTo).toHaveBeenCalledWith(`user:${WINNER_ID}`);
    expect(mockTo).toHaveBeenCalledWith(`user:${LOSER_ID}`);
  });
});

// ─── settleDraw ───────────────────────────────────────────────────────────────

describe('SettlementService.settleDraw', () => {
  const P1_ID   = 'aaaaaaaa-0000-0000-0000-000000000011';
  const P2_ID   = 'bbbbbbbb-0000-0000-0000-000000000022';
  const GAME_ID = 'cccccccc-0000-0000-0000-000000000033';
  const STAKE   = '2.000000000';

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockClient.release.mockReturnValue(undefined);
  });

  it('returns both stakes and records draw result', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN'))    return Promise.resolve({});
      if (sql.includes('COMMIT'))   return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      if (sql.includes('result=\'draw\'')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const result = await SettlementService.settleDraw(GAME_ID, P1_ID, P2_ID, STAKE);

    expect(result.gameId).toBe(GAME_ID);
    expect(result.player1Id).toBe(P1_ID);
    expect(result.player2Id).toBe(P2_ID);
    expect(result.stake).toBe(STAKE);
  });

  it('is idempotent — returns early if game already settled', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN'))    return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      if (sql.includes('result=\'draw\'')) return Promise.resolve({ rowCount: 0 }); // already settled
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await SettlementService.settleDraw(GAME_ID, P1_ID, P2_ID, STAKE);
    expect(result.stake).toBe(STAKE); // still returns valid shape
  });

  it('does not modify ELO (draw = no ELO change per PRD §7)', async () => {
    // settleDraw should NOT call any ELO update queries
    const clientSqls: string[] = [];
    mockClient.query.mockImplementation((sql: string) => {
      clientSqls.push(sql);
      if (sql.includes('BEGIN'))    return Promise.resolve({});
      if (sql.includes('COMMIT'))   return Promise.resolve({});
      if (sql.includes('result=\'draw\'')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await SettlementService.settleDraw(GAME_ID, P1_ID, P2_ID, STAKE);

    const eloUpdates = clientSqls.filter(s => s.includes('SET elo='));
    expect(eloUpdates).toHaveLength(0);
  });

  it('rolls back on DB failure', async () => {
    let rollbackCalled = false;
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN'))    return Promise.resolve({});
      if (sql.includes('ROLLBACK')) { rollbackCalled = true; return Promise.resolve({}); }
      if (sql.includes('result=\'draw\'')) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('games_drawn')) throw new Error('DB error');
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(
      SettlementService.settleDraw(GAME_ID, P1_ID, P2_ID, STAKE),
    ).rejects.toThrow('DB error');
    expect(rollbackCalled).toBe(true);
  });

  it('calls io.to(user:*).emit for both players after draw settlement', async () => {
    const mockEmit = vi.fn();
    const mockTo   = vi.fn(() => ({ emit: mockEmit }));
    const mockIo   = { to: mockTo } as any;

    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN','COMMIT','ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      if (sql.includes('result=\'draw\'')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    // emitUserSync: pool.query called twice per player (user row + balance row)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: P1_ID, username: 'p1', elo: 1200 }] })  // user P1
      .mockResolvedValueOnce({ rows: [{ available: '2.0', locked: '0', total: '2.0' }] })  // balance P1
      .mockResolvedValueOnce({ rows: [{ id: P2_ID, username: 'p2', elo: 1200 }] })  // user P2
      .mockResolvedValueOnce({ rows: [{ available: '2.0', locked: '0', total: '2.0' }] }) // balance P2
      // Tournament match lookup for handleTournamentDrawReplay (no match)
      .mockResolvedValueOnce({ rows: [] });

    await SettlementService.settleDraw(GAME_ID, P1_ID, P2_ID, STAKE, mockIo);

    expect(mockTo).toHaveBeenCalledWith(`user:${P1_ID}`);
    expect(mockTo).toHaveBeenCalledWith(`user:${P2_ID}`);
  });
});

// ─── Tournament draw replay (handleTournamentDrawReplay) ──────────────────────

describe('SettlementService.settleDraw — tournament replay', () => {
  const P1_ID   = 'aaaaaaaa-0000-0000-0000-000000000011';
  const P2_ID   = 'bbbbbbbb-0000-0000-0000-000000000022';
  const GAME_ID = 'cccccccc-0000-0000-0000-000000000033';
  const STAKE   = '0.000000000';
  const MATCH_ID = 'mmmmmmmm-0000-0000-0000-000000000001';
  const TOURNAMENT_ID = 'tttttttt-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockClient.release.mockReturnValue(undefined);
  });

  it('creates replay game on first tournament draw (replayCount=0)', async () => {
    const mockEmit = vi.fn();
    const mockTo   = vi.fn(() => ({ emit: mockEmit }));
    const mockIo   = { to: mockTo, emit: vi.fn() } as any;

    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN','COMMIT','ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      if (sql.includes('result=\'draw\'')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: P1_ID, username: 'p1', elo: 1200 }] })  // user P1
      .mockResolvedValueOnce({ rows: [{ available: '0', locked: '0', total: '0' }] })  // balance P1
      .mockResolvedValueOnce({ rows: [{ id: P2_ID, username: 'p2', elo: 1200 }] })  // user P2
      .mockResolvedValueOnce({ rows: [{ available: '0', locked: '0', total: '0' }] }) // balance P2
      // Tournament match found with replayCount=0
      .mockResolvedValueOnce({
        rows: [{
          id: MATCH_ID,
          tournamentId: TOURNAMENT_ID,
          round: 1,
          player1Id: P1_ID,
          player2Id: P2_ID,
          replayCount: 0,
        }],
      })
      // Player ELO lookups for replay
      .mockResolvedValueOnce({ rows: [{ elo: 1200 }] })
      .mockResolvedValueOnce({ rows: [{ elo: 1250 }] });

    // Import and setup GameService mock
    const GameModule = await import('../../../apps/backend/src/services/game.service.js');
    vi.spyOn(GameModule.GameService, 'createGame').mockResolvedValue({ id: 'replay-game-id' } as any);

    // Import and setup TournamentRoundPreviewService mock
    const PreviewModule = await import('../../../apps/backend/src/services/tournament-round-preview.service.js');
    vi.spyOn(PreviewModule.TournamentRoundPreviewService, 'openWindow').mockResolvedValue({ expiresAt: Date.now() + 30_000 } as any);

    await SettlementService.settleDraw(GAME_ID, P1_ID, P2_ID, STAKE, mockIo);

    expect(GameModule.GameService.createGame).toHaveBeenCalled();
    expect(PreviewModule.TournamentRoundPreviewService.openWindow).toHaveBeenCalled();
    expect(mockTo).toHaveBeenCalledWith(`user:${P1_ID}`);
    expect(mockTo).toHaveBeenCalledWith(`user:${P2_ID}`);
  });

  it('forces winner by seed ELO on second tournament draw (replayCount>=1)', async () => {
    const mockEmit = vi.fn();
    const mockTo   = vi.fn(() => ({ emit: mockEmit }));
    const mockIo   = { to: mockTo, emit: vi.fn() } as any;

    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN','COMMIT','ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      if (sql.includes('result=\'draw\'')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: P1_ID, username: 'p1', elo: 1200 }] })
      .mockResolvedValueOnce({ rows: [{ available: '0', locked: '0', total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: P2_ID, username: 'p2', elo: 1200 }] })
      .mockResolvedValueOnce({ rows: [{ available: '0', locked: '0', total: '0' }] })
      // Tournament match found with replayCount=1 (already had one replay)
      .mockResolvedValueOnce({
        rows: [{
          id: MATCH_ID,
          tournamentId: TOURNAMENT_ID,
          round: 1,
          player1Id: P1_ID,
          player2Id: P2_ID,
          replayCount: 1,
        }],
      })
      // Seed ELO lookup for tiebreak
      .mockResolvedValueOnce({
        rows: [
          { userId: P1_ID, seedElo: 1400 },
          { userId: P2_ID, seedElo: 1300 },
        ],
      });

    const { TournamentService } = await import('../../../apps/backend/src/services/tournament.service.js');
    const tSpy = vi.spyOn(TournamentService, 'recordMatchResult').mockResolvedValueOnce(undefined as any);

    await SettlementService.settleDraw(GAME_ID, P1_ID, P2_ID, STAKE, mockIo);

    // P1 has higher seed ELO (1400 > 1300), so P1 should win
    expect(tSpy).toHaveBeenCalledWith(TOURNAMENT_ID, MATCH_ID, P1_ID, mockIo);
    tSpy.mockRestore();
  });
});

// ─── Tournament bracket advance on win ────────────────────────────────────────

describe('SettlementService.settleWin — tournament bracket advance', () => {
  const WINNER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  const LOSER_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';
  const GAME_ID   = 'cccccccc-0000-0000-0000-000000000003';
  const STAKE     = '1.000000000';
  const MATCH_ID  = 'mmmmmmmm-0000-0000-0000-000000000001';
  const TOURNAMENT_ID = 'tttttttt-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockClient.release.mockReturnValue(undefined);
  });

  it('advances tournament bracket when game belongs to a tournament match', async () => {
    const mockEmit = vi.fn();
    const mockTo   = vi.fn(() => ({ emit: mockEmit }));
    const mockIo   = { to: mockTo, emit: vi.fn() } as any;

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }],
    });

    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN','COMMIT','ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      if (sql.includes("AND status='active'")) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WINNER_ID, username: 'w', elo: 1220 }] })
      .mockResolvedValueOnce({ rows: [{ available: '1.7', locked: '0', total: '1.7' }] })
      .mockResolvedValueOnce({ rows: [{ id: LOSER_ID, username: 'l', elo: 1180 }] })
      .mockResolvedValueOnce({ rows: [{ available: '9.0', locked: '0', total: '9.0' }] })
      // Tournament match found
      .mockResolvedValueOnce({
        rows: [{ id: MATCH_ID, tournamentId: TOURNAMENT_ID }],
      });

    const { TournamentService } = await import('../../../apps/backend/src/services/tournament.service.js');
    const tSpy = vi.spyOn(TournamentService, 'recordMatchResult').mockResolvedValueOnce(undefined as any);

    await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_moves', STAKE, mockIo);

    expect(tSpy).toHaveBeenCalledWith(TOURNAMENT_ID, MATCH_ID, WINNER_ID, mockIo);
    tSpy.mockRestore();
  });
});
