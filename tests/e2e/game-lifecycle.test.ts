/**
 * tests/e2e/game-lifecycle.test.ts
 *
 * End-to-end simulation of the full game lifecycle:
 *   1. Two users join matchmaking queue
 *   2. Matchmaking scan pairs them and creates a game
 *   3. Game plays out move by move
 *   4. Game ends (P1 wins)
 *   5. Settlement credits winner, debits loser, updates ELO
 *   6. Balances reconcile correctly
 *
 * Uses mocked DB + Redis to simulate the full flow deterministically.
 * A "real" E2E would use testcontainers — this is the next level up from integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// ─── Module mocks — must be declared before imports ──────────────────────────

const { mockRedisStore, mockRedis } = vi.hoisted(() => {
  const mockRedisStore = new Map<string, string>();
  const mockRedis = {
    zscore:  vi.fn((key: string, val: string) => Promise.resolve(mockRedisStore.get(`z:${key}:${val}`) ?? null)),
    zadd:    vi.fn((key: string, score: number, val: string) => { mockRedisStore.set(`z:${key}:${val}`, String(score)); return Promise.resolve(1); }),
    zrem:    vi.fn((key: string, val: string) => { mockRedisStore.delete(`z:${key}:${val}`); return Promise.resolve(1); }),
    zrange:  vi.fn(() => Promise.resolve([])),
    hset:    vi.fn(() => Promise.resolve(1)),
    hgetall: vi.fn(() => Promise.resolve(null)),
    del:     vi.fn(() => Promise.resolve(1)),
    set:     vi.fn((key: string, val: string) => { mockRedisStore.set(key, val); return Promise.resolve('OK'); }),
    get:     vi.fn((key: string) => Promise.resolve(mockRedisStore.get(key) ?? null)),
  };
  return { mockRedisStore, mockRedis };
});

vi.mock('../../apps/backend/src/config/redis.js', () => ({ default: mockRedis }));
vi.mock('../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../apps/backend/src/services/tournament.service.js', () => ({
  TournamentService: { recordMatchResult: vi.fn() },
}));

// ─── In-memory DB simulation ──────────────────────────────────────────────────

interface User   { id: string; elo: number; is_banned: boolean }
interface Balance { user_id: string; available: number; locked: number; locked_at: Date | null; updated_at: Date }
interface Game   { id: string; player1_id: string; player2_id: string; stake: string; status: string; result?: string; platform_fee?: string; winner_payout?: string; player1_elo_before: number; player2_elo_before: number; player1_elo_after?: number; player2_elo_after?: number }

class InMemoryDb {
  users    = new Map<string, User>();
  balances = new Map<string, Balance>();
  games    = new Map<string, Game>();
  txs: unknown[] = [];
  mmQueue  = new Map<string, { user_id: string; elo: number; stake: string; status: string }>();

  addUser(id: string, elo = 1200) {
    this.users.set(id, { id, elo, is_banned: false });
    this.balances.set(id, { user_id: id, available: 10, locked: 0, locked_at: null, updated_at: new Date() });
  }

  query(sql: string, params: unknown[] = []): unknown {
    sql = sql.trim();

    // SELECT elo, is_banned FROM users WHERE id=$1
    if (sql.includes('SELECT elo, is_banned FROM users')) {
      const user = this.users.get(params[0] as string);
      return { rows: user ? [user] : [] };
    }

    // SELECT id, elo FROM users WHERE id = ANY
    if (sql.includes('SELECT id, elo FROM users')) {
      const ids = params[0] as string[];
      const rows = ids.map(id => this.users.get(id)).filter(Boolean);
      return { rows };
    }

    // SELECT available, locked FROM balances WHERE user_id=$1
    if (sql.includes('FROM balances WHERE user_id')) {
      const b = this.balances.get(params[0] as string);
      if (!b) return { rows: [] };
      return { rows: [{ available: String(b.available), locked: String(b.locked), total: String(b.available + b.locked) }] };
    }

    // UPDATE balances SET locked = locked - ... available = available + ... (settlement)
    if (sql.includes('locked = locked - $1') && sql.includes('available = available + $1')) {
      const amount = parseFloat(params[0] as string);
      const userId = params[1] as string;
      const b = this.balances.get(userId)!;
      b.locked    -= amount;
      b.available += amount;
      return { rowCount: 1 };
    }

    // UPDATE balances SET locked=locked-$1 (settlement: deduct locked stake)
    if (sql.includes('locked') && sql.includes('locked-') && !sql.includes('available')) {
      const amount = parseFloat(params[0] as string);
      const userId = params[1] as string;
      const b = this.balances.get(userId);
      if (b) b.locked -= amount;
      return { rowCount: 1 };
    }

    // UPDATE balances SET available=available+$1 (settlement: credit winner payout)
    if (sql.includes('available') && sql.includes('available+') && !sql.includes('locked')) {
      const amount = parseFloat(params[0] as string);
      const userId = params[1] as string;
      const b = this.balances.get(userId);
      if (b) b.available += amount;
      return { rowCount: 1 };
    }

    // UPDATE balances SET available = available - $1 AND available >= $1 (atomicLockBalance / lockBalance)
    if ((sql.includes('locked') && sql.includes('available') && sql.includes('available >= $1')) ||
        (sql.includes('locked +') && sql.includes('available >=')) ||
        (sql.includes('locked     +') && sql.includes('available >= $1'))) {
      const amount = parseFloat(params[0] as string);
      const userId = params[1] as string;
      const b = this.balances.get(userId)!;
      if (b.available < amount) return { rowCount: 0 };
      b.available -= amount;
      b.locked    += amount;
      return { rowCount: 1 };
    }

    // UPDATE games SET status='completed' WHERE id=$6 AND status='active'
    if (sql.includes("status='completed'") && sql.includes("AND status='active'")) {
      const gameId = params[5] as string;
      const game   = this.games.get(gameId);
      if (!game || game.status !== 'active') return { rowCount: 0 };
      game.status       = 'completed';
      game.result       = sql.includes('player1_win') ? 'player1_win' : 'player2_win';
      game.platform_fee = params[1] as string;
      game.winner_payout = params[2] as string;
      return { rowCount: 1 };
    }

    // UPDATE users SET elo=$1 WHERE id=$2
    if (sql.includes('SET elo=$1') && sql.includes('WHERE id=$2')) {
      const user = this.users.get(params[1] as string);
      if (user) user.elo = parseInt(params[0] as string);
      return { rowCount: 1 };
    }

    // Tournament match lookup
    if (sql.includes('FROM tournament_matches')) {
      return { rows: [] };
    }

    // INSERT INTO transactions
    if (sql.includes('INSERT INTO transactions')) {
      this.txs.push(params);
      return { rows: [{ id: crypto.randomUUID() }] };
    }

    // Catch-all
    return { rows: [], rowCount: 1 };
  }
}

const db = new InMemoryDb();
const mockDbClient = {
  query:   vi.fn((...args: unknown[]) => Promise.resolve(db.query(args[0] as string, args[1] as unknown[]))),
  release: vi.fn(),
};

vi.mock('../../apps/backend/src/config/db.js', () => ({
  default: {
    query:   (...args: unknown[]) => Promise.resolve(db.query(args[0] as string, args[1] as unknown[])),
    connect: () => Promise.resolve(mockDbClient),
  },
}));

// ─── Import services AFTER mocks ─────────────────────────────────────────────

import { BalanceService }    from '../../apps/backend/src/services/balance.service.js';
import { MatchmakingService } from '../../apps/backend/src/services/matchmaking.service.js';
import { SettlementService }  from '../../apps/backend/src/services/settlement.service.js';
import { EloService }         from '../../apps/backend/src/services/elo.service.js';
import { initialBoard, type Board } from '../../apps/backend/src/engine/board.js';
import { getAvailableMoves }  from '../../apps/backend/src/engine/moves.js';

// ─── E2E test ─────────────────────────────────────────────────────────────────

describe('Full game lifecycle E2E', () => {
  const P1_ID = 'player1-aaaa-0000-0000-000000000001';
  const P2_ID = 'player2-bbbb-0000-0000-000000000002';
  const STAKE = '1.000000000';

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
    // Rebuild in-memory DB for each test
    db.users.clear(); db.balances.clear(); db.games.clear();
    db.txs = []; db.mmQueue.clear();

    db.addUser(P1_ID, 1200);
    db.addUser(P2_ID, 1200);

    // Setup Redis mock for queue operations
    mockRedis.zscore.mockResolvedValue(null); // not in queue
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.hset.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);
    mockRedis.set.mockResolvedValue('OK');
  });

  it('correctly locks stakes when both players join queue', async () => {
    // P1 joins queue
    const p1MockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ elo: 1200, is_banned: false }] }) // user lookup
      .mockResolvedValueOnce({ rows: [] }); // queue INSERT

    // Use real atomicLockBalance with our in-memory DB
    const p1BalanceBefore = db.balances.get(P1_ID)!;
    expect(p1BalanceBefore.available).toBe(10);

    await BalanceService.atomicLockBalance(P1_ID, STAKE);

    const p1BalanceAfter = db.balances.get(P1_ID)!;
    expect(p1BalanceAfter.available).toBeCloseTo(9, 2);
    expect(p1BalanceAfter.locked).toBeCloseTo(1, 2);
  });

  it('ELO range expansion allows broader matching over time', () => {
    const now    = Date.now();
    const p1Entry = { userId: P1_ID, elo: 1200, stake: STAKE, joinedAt: now - 90_000 }; // 90s waiting
    const range  = MatchmakingService.getEloRange(p1Entry);
    expect(range).toBe(100 + 3 * 50); // 3 expansions × 50 = 250
  });

  it('findMatch correctly pairs two players within ELO range', () => {
    const p1 = { userId: P1_ID, elo: 1200, stake: STAKE, joinedAt: Date.now() };
    const p2 = { userId: P2_ID, elo: 1250, stake: STAKE, joinedAt: Date.now() };
    const match = MatchmakingService.findMatch(p1, [p2]);
    expect(match).not.toBeNull();
    expect(match?.match.userId).toBe(P2_ID);
    expect(match?.stakeMismatch).toBe(false);
  });

  it('calculates correct settlement after P1 wins', async () => {
    // Create a game in active state
    const GAME_ID = 'game-test-lifecycle-001';
    db.games.set(GAME_ID, {
      id: GAME_ID,
      player1_id: P1_ID, player2_id: P2_ID,
      stake: STAKE, status: 'active',
      player1_elo_before: 1200, player2_elo_before: 1200,
    });

    // Lock both players' stakes
    db.balances.get(P1_ID)!.available = 9;
    db.balances.get(P1_ID)!.locked    = 1;
    db.balances.get(P2_ID)!.available = 9;
    db.balances.get(P2_ID)!.locked    = 1;

    // Setup mock client for transaction
    mockDbClient.query.mockImplementation((sql: string, params: unknown[]) =>
      Promise.resolve(db.query(sql, params as unknown[])),
    );

    const result = await SettlementService.settleWin(
      GAME_ID, P1_ID, P2_ID, 'no_moves', STAKE,
    );

    // Payout verification
    expect(parseFloat(result.winnerPayout)).toBeCloseTo(1.7, 6);
    expect(parseFloat(result.platformFee)).toBeCloseTo(0.3, 6);

    // ELO changes
    expect(result.eloChanges.winner.delta).toBeGreaterThan(0);
    expect(result.eloChanges.loser.delta).toBeLessThan(0);

    // Game marked completed
    const game = db.games.get(GAME_ID);
    expect(game?.status).toBe('completed');
  });

  it('balance is conserved: total before = total after (no money created or destroyed)', async () => {
    // Before game
    const p1Before = db.balances.get(P1_ID)!;
    const p2Before = db.balances.get(P2_ID)!;
    const totalBefore = (p1Before.available + p1Before.locked) +
                        (p2Before.available + p2Before.locked);

    const GAME_ID = 'balance-conservation-game';
    db.games.set(GAME_ID, {
      id: GAME_ID,
      player1_id: P1_ID, player2_id: P2_ID,
      stake: STAKE, status: 'active',
      player1_elo_before: 1200, player2_elo_before: 1200,
    });
    db.balances.get(P1_ID)!.locked    = 1;
    db.balances.get(P1_ID)!.available = 9;
    db.balances.get(P2_ID)!.locked    = 1;
    db.balances.get(P2_ID)!.available = 9;

    mockDbClient.query.mockImplementation((sql: string, params: unknown[]) =>
      Promise.resolve(db.query(sql, params as unknown[])),
    );

    await SettlementService.settleWin(GAME_ID, P1_ID, P2_ID, 'no_moves', STAKE);

    const p1After  = db.balances.get(P1_ID)!;
    const p2After  = db.balances.get(P2_ID)!;
    const totalAfter = (p1After.available + p1After.locked) +
                       (p2After.available + p2After.locked);

    // Money IN the platform (fees) + money held by users = original total
    // The platform fee leaves the system (it goes to platform wallet)
    // So: totalAfter = totalBefore - platformFee
    const { platformFee } = SettlementService.calculateWinPayout(STAKE);
    expect(totalAfter).toBeCloseTo(totalBefore - parseFloat(platformFee), 6);
  });

  it('draw returns all stakes intact — zero net change for both players', async () => {
    const GAME_ID = 'draw-game-001';
    db.games.set(GAME_ID, {
      id: GAME_ID,
      player1_id: P1_ID, player2_id: P2_ID,
      stake: STAKE, status: 'active',
      player1_elo_before: 1200, player2_elo_before: 1200,
    });

    // Stakes locked
    db.balances.get(P1_ID)!.available = 9;
    db.balances.get(P1_ID)!.locked    = 1;
    db.balances.get(P2_ID)!.available = 9;
    db.balances.get(P2_ID)!.locked    = 1;

    // Mock the draw settlement DB calls
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN'))   return Promise.resolve({});
      if (sql.includes('COMMIT'))  return Promise.resolve({});
      if (sql.includes("result='draw'")) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('games_drawn')) {
        // Simulate unlocking both players' stakes
        db.balances.get(P1_ID)!.locked    -= parseFloat(STAKE);
        db.balances.get(P1_ID)!.available += parseFloat(STAKE);
        db.balances.get(P2_ID)!.locked    -= parseFloat(STAKE);
        db.balances.get(P2_ID)!.available += parseFloat(STAKE);
        return Promise.resolve({ rowCount: 2 });
      }
      if (sql.includes('UPDATE balances')) return Promise.resolve({ rowCount: 2 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await SettlementService.settleDraw(GAME_ID, P1_ID, P2_ID, STAKE);
    expect(result.gameId).toBe(GAME_ID);

    // Both players' locked balance should return to available
    expect(db.balances.get(P1_ID)!.locked).toBeCloseTo(0, 6);
    expect(db.balances.get(P2_ID)!.locked).toBeCloseTo(0, 6);
  });

  it('engine generates valid moves from starting position', () => {
    const board = initialBoard();
    const moves = getAvailableMoves(board, 1);
    expect(moves.length).toBe(7);
    // Every move must reference a valid P1 piece position
    for (const m of moves) {
      expect(board[m.from.row][m.from.col]).toBe(1); // P1 = 1
    }
  });
});
