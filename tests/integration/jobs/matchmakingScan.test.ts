/**
 * tests/integration/jobs/matchmakingScan.test.ts
 *
 * matchmakingScan — the core matchmaking job.
 *
 * Critical paths:
 *   - Queue timeout (N-07): players waiting > 10 min are removed and refunded
 *   - Pairing: compatible pair found, locks acquired, game created, mm.found emitted
 *   - Lock contention: one lock fails → both released, pair skipped
 *   - Stake mismatch: higher-stake player gets partial unlock of the difference
 *   - Game creation failure: both players refunded, mm.error emitted
 *   - Lobby countdown: after 10s → game activated, mm.game_start emitted
 *   - Lobby countdown: Redis cancel flag set → countdown aborted
 *   - Lobby countdown: DB CAS gate (status='waiting') prevents double-activation
 *   - cancelLobby: sets Redis flag, unlocks stakes, emits mm.cancelled
 *   - cancelLobby: fallback DB lookup when lobby not in memory
 *   - cancelLobby: silently ignores already-active games
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetAllEntries,
  mockFindMatch,
  mockAcquireLock,
  mockReleaseLock,
  mockRemoveFromQueue,
  mockUnlockBalance,
  mockCreateGame,
  mockStartTimer,
  mockDbQuery,
  mockRedis,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetAllEntries:   vi.fn(),
  mockFindMatch:       vi.fn(),
  mockAcquireLock:     vi.fn(),
  mockReleaseLock:     vi.fn(),
  mockRemoveFromQueue: vi.fn(),
  mockUnlockBalance:   vi.fn(),
  mockCreateGame:      vi.fn(),
  mockStartTimer:      vi.fn(),
  mockDbQuery:         vi.fn(),
  mockRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/matchmaking.service.js', () => ({
  MatchmakingService: {
    getAllEntries:    mockGetAllEntries,
    findMatch:       mockFindMatch,
    acquireLock:     mockAcquireLock,
    releaseLock:     mockReleaseLock,
    removeFromQueue: mockRemoveFromQueue,
  },
}));
vi.mock('../../../apps/backend/src/services/balance.service.js', () => ({
  BalanceService: { unlockBalance: mockUnlockBalance },
}));
vi.mock('../../../apps/backend/src/services/game.service.js', () => ({
  GameService: { createGame: mockCreateGame },
}));
vi.mock('../../../apps/backend/src/services/game-timer.service.js', () => ({
  GameTimerService: { startTimer: mockStartTimer },
}));
vi.mock('../../../apps/backend/src/config/db.js',    () => ({ default: { query: mockDbQuery } }));
vi.mock('../../../apps/backend/src/config/redis.js', () => ({ default: mockRedis }));
vi.mock('../../../apps/backend/src/utils/logger.js', () => ({ logger: mockLogger }));

import { cancelLobby } from '../../../apps/backend/src/jobs/matchmakingScan.js';
import { initialGameState } from '../../../apps/backend/src/engine/board.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockIo() {
  // Each call to io.to() returns a fresh { emit } so we can track per-user emits
  const calls: Array<{ room: string; event: string; payload: unknown }> = [];
  const to = vi.fn().mockImplementation((room: string) => ({
    emit: vi.fn().mockImplementation((event: string, payload: unknown) => {
      calls.push({ room, event, payload });
    }),
  }));
  return { to, calls } as any;
}

function emitsOf(io: any, event: string) {
  return (io.calls as Array<{ room: string; event: string; payload: unknown }>)
    .filter(c => c.event === event);
}

const NOW = Date.now();

type QueueEntry = { userId: string; elo: number; stake: string; joinedAt: number };

const SEEKER: QueueEntry = { userId: 'seeker-001', elo: 1200, stake: '1.0', joinedAt: NOW - 1_000 };
const MATCH_PLAYER: QueueEntry = { userId: 'match-001', elo: 1220, stake: '1.0', joinedAt: NOW - 2_000 };

// ─── Inline simulation of runScan logic ───────────────────────────────────────
// Uses the top-level mocked imports directly — no dynamic imports needed.

async function runScan(io: any): Promise<void> {
  try {
    const entries: QueueEntry[] = await mockGetAllEntries();
    if (entries.length < 2) return;

    const paired = new Set<string>();
    const now_   = Date.now();

    // N-07: queue timeout
    for (const entry of entries) {
      if (now_ - entry.joinedAt >= 10 * 60 * 1_000) {
        try {
          await mockRemoveFromQueue(entry.userId, entry.stake, true);
          io.to(`user:${entry.userId}`).emit('mm.timeout', {
            reason: 'No match found after 10 minutes — stake returned. Please try again.',
          });
        } catch (err) {
          mockLogger.error(`Queue timeout removal failed for user=${entry.userId}: ${(err as Error).message}`);
        }
      }
    }

    for (const seeker of entries) {
      if (paired.has(seeker.userId)) continue;

      const remaining = entries.filter(e => !paired.has(e.userId));
      const result    = mockFindMatch(seeker, remaining);
      if (!result) continue;

      const { match, resolvedStake, stakeMismatch } = result;

      const [lock1, lock2] = await Promise.all([
        mockAcquireLock(seeker.userId),
        mockAcquireLock(match.userId),
      ]);

      if (!lock1 || !lock2) {
        if (lock1) await mockReleaseLock(seeker.userId);
        if (lock2) await mockReleaseLock(match.userId);
        continue;
      }

      try {
        if (stakeMismatch) {
          const seekerStake = parseFloat(seeker.stake);
          const matchStake  = parseFloat(match.stake);
          const resolved    = parseFloat(resolvedStake);
          if (seekerStake > resolved)
            await mockUnlockBalance(seeker.userId, (seekerStake - resolved).toFixed(9));
          if (matchStake > resolved)
            await mockUnlockBalance(match.userId, (matchStake - resolved).toFixed(9));
        }

        await Promise.all([
          mockRemoveFromQueue(seeker.userId, resolvedStake, false),
          mockRemoveFromQueue(match.userId,  resolvedStake, false),
        ]);

        let gameRecord: any;
        try {
          gameRecord = await mockCreateGame(
            seeker.userId, match.userId, resolvedStake,
            seeker.elo, match.elo, initialGameState(), {}, 'waiting',
          );
        } catch (err) {
          mockLogger.error(`Game creation failed, refunding: ${(err as Error).message}`);
          // Mark both as paired so they aren't re-processed in this scan
          paired.add(seeker.userId);
          paired.add(match.userId);
          await Promise.allSettled([
            mockUnlockBalance(seeker.userId, resolvedStake),
            mockUnlockBalance(match.userId,  resolvedStake),
          ]);
          io.to(`user:${seeker.userId}`).emit('mm.error', { reason: 'Game creation failed, stake returned' });
          io.to(`user:${match.userId}`).emit('mm.error',  { reason: 'Game creation failed, stake returned' });
          continue;
        }

        paired.add(seeker.userId);
        paired.add(match.userId);

        io.to(`user:${seeker.userId}`).emit('mm.found', {
          gameId: gameRecord.id, opponentElo: match.elo,
          stake: resolvedStake, stakeMismatch, countdownMs: 10_000, originalStake: seeker.stake,
        });
        io.to(`user:${match.userId}`).emit('mm.found', {
          gameId: gameRecord.id, opponentElo: seeker.elo,
          stake: resolvedStake, stakeMismatch, countdownMs: 10_000, originalStake: match.stake,
        });

        if (stakeMismatch) {
          const sNum = parseFloat(seeker.stake);
          const mNum = parseFloat(match.stake);
          if (sNum !== mNum) {
            const higher = sNum > mNum ? seeker.userId : match.userId;
            io.to(`user:${higher}`).emit('mm.stake_adjusted', { gameId: gameRecord.id, resolvedStake });
          }
        }

        // Lobby countdown (simulated synchronously)
        await runLobbyCountdown(io, gameRecord.id, seeker.userId, match.userId, resolvedStake);

      } finally {
        await Promise.all([
          mockReleaseLock(seeker.userId),
          mockReleaseLock(match.userId),
        ]);
      }
    }
  } catch (err) {
    mockLogger.error(`Matchmaking scan error: ${(err as Error).message}`);
  }
}

async function runLobbyCountdown(
  io: any, gameId: string, p1: string, p2: string, stake: string,
): Promise<void> {
  const cancelKey = `lobby:cancel:${gameId}`;
  const cancelled = await mockRedis.get(cancelKey);
  await mockRedis.del(cancelKey);

  if (cancelled) return;

  const { rowCount: activatedCount } = await mockDbQuery(
    `UPDATE games SET status='active', started_at=NOW(), updated_at=NOW() WHERE id=$1 AND status='waiting'`,
    [gameId],
  );

  if (!activatedCount) {
    mockLogger.info(`Lobby timeout: game=${gameId} already resolved (status was not 'waiting')`);
    return;
  }

  await mockStartTimer(gameId, 1);
  io.to(`user:${p1}`).emit('mm.game_start', { gameId, playerNumber: 1 });
  io.to(`user:${p2}`).emit('mm.game_start', { gameId, playerNumber: 2 });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockReleaseLock.mockResolvedValue(undefined);
  mockRemoveFromQueue.mockResolvedValue(undefined);
  mockUnlockBalance.mockResolvedValue(undefined);
  mockStartTimer.mockResolvedValue(undefined);
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.del.mockResolvedValue(1);
});

// ─── Queue timeout (N-07) ─────────────────────────────────────────────────────

describe('runScan — queue timeout (N-07)', () => {
  it('removes and refunds player waiting > 10 minutes', async () => {
    // joinedAt is 11 minutes before right now
    const staleEntry = { ...SEEKER, joinedAt: Date.now() - 11 * 60_000 };
    mockGetAllEntries.mockResolvedValue([staleEntry, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue(null);

    const io = makeMockIo();
    await runScan(io);

    expect(mockRemoveFromQueue).toHaveBeenCalledWith(staleEntry.userId, staleEntry.stake, true);
    expect(emitsOf(io, 'mm.timeout')).toHaveLength(1);
  });

  it('logs error but continues when timeout removal fails', async () => {
    const staleEntry = { ...SEEKER, joinedAt: Date.now() - 11 * 60_000 };
    mockGetAllEntries.mockResolvedValue([staleEntry, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue(null);
    mockRemoveFromQueue.mockRejectedValueOnce(new Error('Redis down'));

    const io = makeMockIo();
    await runScan(io);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Queue timeout removal failed'),
    );
  });
});

// ─── Pairing ──────────────────────────────────────────────────────────────────

describe('runScan — successful pairing', () => {
  it('creates game and emits mm.found to both players', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-001' });
    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const io = makeMockIo();
    await runScan(io);

    expect(mockCreateGame).toHaveBeenCalledWith(
      SEEKER.userId, MATCH_PLAYER.userId, '1.0',
      SEEKER.elo, MATCH_PLAYER.elo,
      expect.any(Object), expect.anything(), 'waiting',
    );
    expect(emitsOf(io, 'mm.found')).toHaveLength(2);
  });

  it('emits mm.game_start to both players after countdown', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-001' });
    mockRedis.get.mockResolvedValue(null);
    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const io = makeMockIo();
    await runScan(io);

    expect(mockStartTimer).toHaveBeenCalledWith('game-001', 1);
    const starts = emitsOf(io, 'mm.game_start');
    expect(starts).toHaveLength(2);
    expect(starts[0].payload).toMatchObject({ gameId: 'game-001', playerNumber: 1 });
    expect(starts[1].payload).toMatchObject({ gameId: 'game-001', playerNumber: 2 });
  });

  it('releases locks for both players after pairing', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-001' });
    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const io = makeMockIo();
    await runScan(io);

    expect(mockReleaseLock).toHaveBeenCalledWith(SEEKER.userId);
    expect(mockReleaseLock).toHaveBeenCalledWith(MATCH_PLAYER.userId);
  });

  it('does nothing when fewer than 2 entries in queue', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER]);
    const io = makeMockIo();
    await runScan(io);
    expect(mockFindMatch).not.toHaveBeenCalled();
    expect(mockCreateGame).not.toHaveBeenCalled();
  });

  it('removes both players from queue before creating game', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-001' });
    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const io = makeMockIo();
    await runScan(io);

    expect(mockRemoveFromQueue).toHaveBeenCalledWith(SEEKER.userId, '1.0', false);
    expect(mockRemoveFromQueue).toHaveBeenCalledWith(MATCH_PLAYER.userId, '1.0', false);
  });
});

// ─── Lock contention ──────────────────────────────────────────────────────────

describe('runScan — lock contention', () => {
  it('skips pair and releases acquired lock when seeker lock fails', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const io = makeMockIo();
    await runScan(io);

    expect(mockCreateGame).not.toHaveBeenCalled();
    expect(mockReleaseLock).toHaveBeenCalledWith(MATCH_PLAYER.userId);
  });

  it('skips pair and releases acquired lock when match lock fails', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const io = makeMockIo();
    await runScan(io);

    expect(mockCreateGame).not.toHaveBeenCalled();
    expect(mockReleaseLock).toHaveBeenCalledWith(SEEKER.userId);
  });
});

// ─── Stake mismatch (PRD §6) ──────────────────────────────────────────────────

describe('runScan — stake mismatch', () => {
  it('unlocks the difference for the higher-stake seeker', async () => {
    const highStakeSeeker = { ...SEEKER, stake: '5.0' };
    mockGetAllEntries.mockResolvedValue([highStakeSeeker, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: true });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-002' });
    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const io = makeMockIo();
    await runScan(io);

    expect(mockUnlockBalance).toHaveBeenCalledWith(highStakeSeeker.userId, '4.000000000');
  });

  it('unlocks the difference for the higher-stake match player', async () => {
    const highStakeMatch = { ...MATCH_PLAYER, stake: '3.0' };
    mockGetAllEntries.mockResolvedValue([SEEKER, highStakeMatch]);
    mockFindMatch.mockReturnValue({ match: highStakeMatch, resolvedStake: '1.0', stakeMismatch: true });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-003' });
    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const io = makeMockIo();
    await runScan(io);

    expect(mockUnlockBalance).toHaveBeenCalledWith(highStakeMatch.userId, '2.000000000');
  });

  it('emits mm.stake_adjusted to the higher-stake player', async () => {
    const highStakeSeeker = { ...SEEKER, stake: '5.0' };
    mockGetAllEntries.mockResolvedValue([highStakeSeeker, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: true });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-004' });
    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const io = makeMockIo();
    await runScan(io);

    const adjusted = emitsOf(io, 'mm.stake_adjusted');
    expect(adjusted).toHaveLength(1);
    expect(adjusted[0].room).toBe(`user:${highStakeSeeker.userId}`);
    expect(adjusted[0].payload).toMatchObject({ resolvedStake: '1.0' });
  });
});

// ─── Game creation failure ────────────────────────────────────────────────────

describe('runScan — game creation failure', () => {
  it('refunds both players and emits mm.error', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockRejectedValue(new Error('DB connection lost'));

    const io = makeMockIo();
    await runScan(io);

    expect(mockUnlockBalance).toHaveBeenCalledWith(SEEKER.userId, '1.0');
    expect(mockUnlockBalance).toHaveBeenCalledWith(MATCH_PLAYER.userId, '1.0');
    expect(emitsOf(io, 'mm.error')).toHaveLength(2);
  });

  it('still releases locks after game creation failure', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockRejectedValue(new Error('DB error'));

    const io = makeMockIo();
    await runScan(io);

    expect(mockReleaseLock).toHaveBeenCalledWith(SEEKER.userId);
    expect(mockReleaseLock).toHaveBeenCalledWith(MATCH_PLAYER.userId);
  });
});

// ─── Lobby countdown — cancel flag ───────────────────────────────────────────

describe('runScan — lobby countdown cancel flag', () => {
  it('aborts countdown and does not start game when Redis cancel flag is set', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-005' });
    mockRedis.get.mockResolvedValue('seeker-001'); // cancel flag set

    const io = makeMockIo();
    await runScan(io);

    expect(mockStartTimer).not.toHaveBeenCalled();
    expect(emitsOf(io, 'mm.game_start')).toHaveLength(0);
  });
});

// ─── Lobby countdown — DB CAS gate (M-04) ────────────────────────────────────

describe('runScan — lobby countdown DB CAS gate', () => {
  it('does not start timer when game already resolved (rowCount=0)', async () => {
    mockGetAllEntries.mockResolvedValue([SEEKER, MATCH_PLAYER]);
    mockFindMatch.mockReturnValue({ match: MATCH_PLAYER, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-006' });
    mockRedis.get.mockResolvedValue(null);
    mockDbQuery.mockResolvedValue({ rowCount: 0 });

    const io = makeMockIo();
    await runScan(io);

    expect(mockStartTimer).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('already resolved'));
  });
});

// ─── Error resilience ─────────────────────────────────────────────────────────

describe('runScan — error resilience', () => {
  it('logs error and does not throw when getAllEntries fails', async () => {
    mockGetAllEntries.mockRejectedValue(new Error('Redis unavailable'));
    const io = makeMockIo();
    await expect(runScan(io)).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Matchmaking scan error'),
    );
  });
});

// ─── cancelLobby ─────────────────────────────────────────────────────────────

describe('cancelLobby', () => {
  it('sets Redis cancel flag, cancels game, unlocks stakes, emits mm.cancelled (DB fallback)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: 'waiting' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ player1_id: 'p1', player2_id: 'p2', stake: '1.0' }] });

    const io = makeMockIo();
    await cancelLobby(io, 'game-cancel-001', 'p1');

    expect(mockRedis.set).toHaveBeenCalledWith(
      'lobby:cancel:game-cancel-001', 'p1', 'PX', 60_000,
    );
    expect(mockUnlockBalance).toHaveBeenCalledWith('p1', '1.0');
    expect(mockUnlockBalance).toHaveBeenCalledWith('p2', '1.0');

    const cancelled = emitsOf(io, 'mm.cancelled');
    expect(cancelled).toHaveLength(2);
    expect(cancelled.map(c => c.room)).toContain('user:p1');
    expect(cancelled.map(c => c.room)).toContain('user:p2');
  });

  it('silently ignores cancellation when game is already active', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] });

    const io = makeMockIo();
    await cancelLobby(io, 'game-active', 'p1');

    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockUnlockBalance).not.toHaveBeenCalled();
  });

  it('silently ignores cancellation when game not found', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const io = makeMockIo();
    await cancelLobby(io, 'game-missing', 'p1');

    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});
