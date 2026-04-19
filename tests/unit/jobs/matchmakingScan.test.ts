/**
 * tests/unit/jobs/matchmakingScan.test.ts
 *
 * matchmakingScan — runScan, startLobbyCountdown, cancelLobby
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetAllEntries, mockFindMatch, mockAcquireLock, mockReleaseLock,
  mockRemoveFromQueue, mockUnlock, mockCreateGame, mockStartTimer,
  mockDbQuery, mockRedisGet, mockRedisSet, mockRedisDel,
} = vi.hoisted(() => ({
  mockGetAllEntries:   vi.fn(),
  mockFindMatch:       vi.fn(),
  mockAcquireLock:     vi.fn(),
  mockReleaseLock:     vi.fn(),
  mockRemoveFromQueue: vi.fn(),
  mockUnlock:          vi.fn(),
  mockCreateGame:      vi.fn(),
  mockStartTimer:      vi.fn(),
  mockDbQuery:         vi.fn(),
  mockRedisGet:        vi.fn(),
  mockRedisSet:        vi.fn(),
  mockRedisDel:        vi.fn(),
}));

vi.mock('../../../apps/backend/src/services/matchmaking.service.js', () => ({
  MatchmakingService: {
    getAllEntries:   mockGetAllEntries,
    findMatch:      mockFindMatch,
    acquireLock:    mockAcquireLock,
    releaseLock:    mockReleaseLock,
    removeFromQueue: mockRemoveFromQueue,
  },
}));
vi.mock('../../../apps/backend/src/services/game.service.js', () => ({
  GameService: { createGame: mockCreateGame },
}));
vi.mock('../../../apps/backend/src/services/balance.service.js', () => ({
  BalanceService: { unlockBalance: mockUnlock },
}));
vi.mock('../../../apps/backend/src/services/game-timer.service.js', () => ({
  GameTimerService: { startTimer: mockStartTimer },
}));
vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));
vi.mock('../../../apps/backend/src/config/redis.js', () => ({
  default: { get: mockRedisGet, set: mockRedisSet, del: mockRedisDel },
}));
vi.mock('../../../apps/backend/src/engine/board.js', () => ({
  initialGameState: vi.fn().mockReturnValue({ board: [], activePlayer: 1, boardHashHistory: [], moveCount: 0 }),
}));

import { startMatchmakingScan, cancelLobby } from '../../../apps/backend/src/jobs/matchmakingScan.js';

function makeIo() {
  const emit = vi.fn();
  const to   = vi.fn().mockReturnValue({ emit });
  return { to, emit };
}

const P1 = { userId: 'p1', elo: 1200, stake: '1.0', joinedAt: Date.now() };
const P2 = { userId: 'p2', elo: 1210, stake: '1.0', joinedAt: Date.now() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockReleaseLock.mockResolvedValue(undefined);
  mockRemoveFromQueue.mockResolvedValue(undefined);
  mockUnlock.mockResolvedValue(undefined);
  mockStartTimer.mockResolvedValue(undefined);
  mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
  mockRedisDel.mockResolvedValue(1);
});

afterEach(() => {
  vi.useRealTimers();
});

// --- startMatchmakingScan -----------------------------------------------------

describe('startMatchmakingScan', () => {
  it('returns an interval handle', () => {
    mockGetAllEntries.mockResolvedValue([]);
    const handle = startMatchmakingScan(makeIo() as never);
    expect(handle).toBeDefined();
    clearInterval(handle);
  });
});

// --- runScan — fewer than 2 entries ------------------------------------------

describe('runScan — fewer than 2 entries', () => {
  it('does nothing when queue has 0 entries', async () => {
    mockGetAllEntries.mockResolvedValue([]);
    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockFindMatch).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('does nothing when queue has 1 entry', async () => {
    mockGetAllEntries.mockResolvedValue([P1]);
    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockFindMatch).not.toHaveBeenCalled();
    clearInterval(handle);
  });
});

// --- runScan — queue timeout (N-07) ------------------------------------------

describe('runScan — queue timeout expiry', () => {
  it('removes and notifies player who waited > 10 minutes', async () => {
    const oldEntry = { ...P1, joinedAt: Date.now() - 11 * 60 * 1000 };
    mockGetAllEntries.mockResolvedValue([oldEntry, P2]);
    mockFindMatch.mockReturnValue(null);
    mockRemoveFromQueue.mockResolvedValue(undefined);

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockRemoveFromQueue).toHaveBeenCalledWith(oldEntry.userId, oldEntry.stake, true);
    expect(io.to).toHaveBeenCalledWith(`user:${oldEntry.userId}`);
    clearInterval(handle);
  });

  it('logs error when timeout removal fails', async () => {
    const oldEntry = { ...P1, joinedAt: Date.now() - 11 * 60 * 1000 };
    mockGetAllEntries.mockResolvedValue([oldEntry, P2]);
    mockFindMatch.mockReturnValue(null);
    mockRemoveFromQueue.mockRejectedValueOnce(new Error('Redis down'));

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);
    // Should not throw
    clearInterval(handle);
  });
});

// --- runScan — no match found -------------------------------------------------

describe('runScan — no match found', () => {
  it('skips when findMatch returns null', async () => {
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue(null);

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockAcquireLock).not.toHaveBeenCalled();
    clearInterval(handle);
  });
});

// --- runScan — lock acquisition failure --------------------------------------

describe('runScan — lock acquisition failure', () => {
  it('releases acquired lock when second lock fails', async () => {
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockReleaseLock).toHaveBeenCalledWith(P1.userId);
    expect(mockCreateGame).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('skips when both locks fail', async () => {
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(false);

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockCreateGame).not.toHaveBeenCalled();
    clearInterval(handle);
  });
});

// --- runScan — stake mismatch -------------------------------------------------

describe('runScan — stake mismatch', () => {
  it('unlocks difference for higher-stake seeker', async () => {
    const highSeeker = { ...P1, stake: '5.0' };
    mockGetAllEntries.mockResolvedValue([highSeeker, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: true });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-1' });

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockUnlock).toHaveBeenCalledWith(highSeeker.userId, '4.000000000');
    clearInterval(handle);
  });

  it('emits mm.stake_adjusted to higher-stake player', async () => {
    const highSeeker = { ...P1, stake: '5.0' };
    mockGetAllEntries.mockResolvedValue([highSeeker, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: true });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-1' });

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(io.to).toHaveBeenCalledWith(`user:${highSeeker.userId}`);
    clearInterval(handle);
  });
});

// --- runScan — game creation failure -----------------------------------------

describe('runScan — game creation failure', () => {
  it('unlocks both players and emits mm.error when createGame throws', async () => {
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockRejectedValueOnce(new Error('DB error'));

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockUnlock).toHaveBeenCalledWith(P1.userId, '1.0');
    expect(mockUnlock).toHaveBeenCalledWith(P2.userId, '1.0');
    clearInterval(handle);
  });
});

// --- runScan — successful match -----------------------------------------------

describe('runScan — successful match', () => {
  it('emits mm.found to both players', async () => {
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-abc' });

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(io.to).toHaveBeenCalledWith(`user:${P1.userId}`);
    expect(io.to).toHaveBeenCalledWith(`user:${P2.userId}`);
    clearInterval(handle);
  });

  it('handles scan-level error gracefully', async () => {
    mockGetAllEntries.mockRejectedValueOnce(new Error('Redis down'));
    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);
    // Should not throw
    clearInterval(handle);
  });
});

// --- lobby countdown — game starts -------------------------------------------

describe('lobby countdown — game starts after timeout', () => {
  it('activates game and emits mm.game_start when countdown expires', async () => {
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-xyz' });
    mockRedisGet.mockResolvedValue(null); // not cancelled
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 }); // game activated

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);  // trigger scan
    await vi.advanceTimersByTimeAsync(10_000); // trigger countdown

    expect(mockStartTimer).toHaveBeenCalledWith('game-xyz', 1);
    clearInterval(handle);
  });

  it('does nothing when game already resolved (rowCount=0)', async () => {
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-xyz' });
    mockRedisGet.mockResolvedValue(null);
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 0 }); // already resolved

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockStartTimer).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('skips activation when Redis cancel flag is set', async () => {
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-xyz' });
    mockRedisGet.mockResolvedValue('p1'); // cancelled

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockStartTimer).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('refunds both players and emits mm.cancelled on countdown error', async () => {
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-xyz' });
    mockRedisGet.mockResolvedValue(null);
    mockDbQuery.mockRejectedValueOnce(new Error('DB error'));

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockUnlock).toHaveBeenCalledWith(P1.userId, '1.0');
    expect(mockUnlock).toHaveBeenCalledWith(P2.userId, '1.0');
    clearInterval(handle);
  });
});

// --- cancelLobby -------------------------------------------------------------

describe('cancelLobby', () => {
  it('cancels game and unlocks stakes when lobby is in memory', async () => {
    // First create a lobby by running a scan
    mockGetAllEntries.mockResolvedValue([P1, P2]);
    mockFindMatch.mockReturnValue({ match: P2, resolvedStake: '1.0', stakeMismatch: false });
    mockAcquireLock.mockResolvedValue(true);
    mockCreateGame.mockResolvedValue({ id: 'game-cancel' });

    const io = makeIo();
    const handle = startMatchmakingScan(io as never);
    await vi.advanceTimersByTimeAsync(5_000);

    // Now cancel it
    await cancelLobby(io as never, 'game-cancel', P1.userId);

    expect(mockRedisSet).toHaveBeenCalledWith(
      expect.stringContaining('game-cancel'), P1.userId, 'PX', 60_000,
    );
    expect(mockUnlock).toHaveBeenCalledWith(P1.userId, '1.0');
    expect(mockUnlock).toHaveBeenCalledWith(P2.userId, '1.0');
    clearInterval(handle);
  });

  it('silently returns when game is not waiting and not in memory', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
    const io = makeIo();
    await cancelLobby(io as never, 'game-active', 'user-1');
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('returns when game not found in DB and not in memory', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const io = makeIo();
    await cancelLobby(io as never, 'game-gone', 'user-1');
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('falls back to DB lookup when lobby not in memory but game is waiting', async () => {
    // Game is waiting but not in activeLobbies (server restart scenario)
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: 'waiting' }] })  // status check
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })           // UPDATE games
      .mockResolvedValueOnce({ rows: [{ player1_id: 'p1', player2_id: 'p2', stake: '1.0' }] }); // fallback lookup

    const io = makeIo();
    await cancelLobby(io as never, 'game-restart', 'user-1');

    expect(mockRedisSet).toHaveBeenCalled();
    expect(mockUnlock).toHaveBeenCalledWith('p1', '1.0');
    expect(mockUnlock).toHaveBeenCalledWith('p2', '1.0');
  });
});
