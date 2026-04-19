/**
 * tests/unit/services/matchmaking.test.ts
 *
 * MatchmakingService — queue logic, ELO matching, stake resolution, locks.
 *
 * Critical invariants:
 *   - Cannot join queue twice (ALREADY_QUEUED)
 *   - Banned users blocked (BANNED)
 *   - ELO range expands ±50 every 30s
 *   - Stake mismatch → lower stake used
 *   - Balance locked atomically on join (C-04)
 *   - Balance unlocked on cancel
 *   - Redis SETNX lock prevents double-pairing
 *   - Orphan refund attempted 3× with backoff on Redis/DB failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchmakingService, type QueueEntry } from '../../../apps/backend/src/services/matchmaking.service.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockRedis, mockDbQuery, mockAtomicLock, mockUnlock } = vi.hoisted(() => ({
  mockRedis: {
    zscore:  vi.fn(),
    zadd:    vi.fn(),
    zrem:    vi.fn(),
    zrange:  vi.fn(),
    hset:    vi.fn(),
    hgetall: vi.fn(),
    del:     vi.fn(),
    set:     vi.fn(),
  },
  mockDbQuery:    vi.fn(),
  mockAtomicLock: vi.fn(),
  mockUnlock:     vi.fn(),
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({
  default: mockRedis,
}));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));

vi.mock('../../../apps/backend/src/services/balance.service.js', () => ({
  BalanceService: {
    atomicLockBalance: mockAtomicLock,
    unlockBalance:     mockUnlock,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers(); // reset for each test
});

// ─── joinQueue ────────────────────────────────────────────────────────────────

describe('MatchmakingService.joinQueue', () => {

  it('successfully joins the queue', async () => {
    mockRedis.zscore.mockResolvedValueOnce(null);          // not already in queue
    mockDbQuery.mockResolvedValueOnce({ rows: [{ elo: 1200, is_banned: false }] }); // user found
    mockAtomicLock.mockResolvedValueOnce(undefined);
    mockRedis.zadd.mockResolvedValueOnce(1);
    mockRedis.hset.mockResolvedValueOnce(1);
    mockDbQuery.mockResolvedValueOnce({ rows: [] });       // INSERT queue

    await expect(MatchmakingService.joinQueue('user-1', '1.0')).resolves.toBeUndefined();
    expect(mockAtomicLock).toHaveBeenCalledWith('user-1', '1.0');
  });

  it('throws STAKE_TOO_LOW for stake below minimum (0.1 TON)', async () => {
    await expect(
      MatchmakingService.joinQueue('user-1', '0.05'),
    ).rejects.toMatchObject({ code: 'STAKE_TOO_LOW' });
    expect(mockAtomicLock).not.toHaveBeenCalled();
  });

  it('throws ALREADY_QUEUED if user is already in Redis queue', async () => {
    mockRedis.zscore.mockResolvedValueOnce('1234567890'); // already in queue
    await expect(
      MatchmakingService.joinQueue('user-1', '1.0'),
    ).rejects.toMatchObject({ code: 'ALREADY_QUEUED' });
  });

  it('throws NOT_FOUND if user does not exist', async () => {
    mockRedis.zscore.mockResolvedValueOnce(null);
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // user not found
    await expect(
      MatchmakingService.joinQueue('ghost', '1.0'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws BANNED for banned user', async () => {
    mockRedis.zscore.mockResolvedValueOnce(null);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ elo: 1200, is_banned: true }] });
    await expect(
      MatchmakingService.joinQueue('user-banned', '1.0'),
    ).rejects.toMatchObject({ code: 'BANNED' });
  });

  it('refunds balance if Redis write fails after lock', async () => {
    mockRedis.zscore.mockResolvedValueOnce(null);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ elo: 1200, is_banned: false }] });
    mockAtomicLock.mockResolvedValueOnce(undefined);
    mockRedis.zadd.mockRejectedValueOnce(new Error('Redis timeout'));
    mockUnlock.mockResolvedValueOnce(undefined);

    await expect(
      MatchmakingService.joinQueue('user-1', '1.0'),
    ).rejects.toThrow('Redis timeout');

    expect(mockUnlock).toHaveBeenCalledWith('user-1', '1.0');
  });

  it('retries refund 3 times before giving up on persistent Redis failure', async () => {
    mockRedis.zscore.mockResolvedValueOnce(null);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ elo: 1200, is_banned: false }] });
    mockAtomicLock.mockResolvedValueOnce(undefined);
    mockRedis.zadd.mockRejectedValueOnce(new Error('Redis down'));
    // All refund attempts fail
    mockUnlock
      .mockRejectedValueOnce(new Error('unlock fail 1'))
      .mockRejectedValueOnce(new Error('unlock fail 2'))
      .mockRejectedValueOnce(new Error('unlock fail 3'));

    await expect(
      MatchmakingService.joinQueue('user-1', '1.0'),
    ).rejects.toThrow('Redis down');

    // All 3 refund attempts were made
    expect(mockUnlock).toHaveBeenCalledTimes(3);
  });
});

// ─── cancelQueue ─────────────────────────────────────────────────────────────

describe('MatchmakingService.cancelQueue', () => {
  it('cancels queue and unlocks balance', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      userId: 'user-1', elo: '1200', stake: '1.0', joinedAt: '1234567890',
    });
    mockRedis.zrem.mockResolvedValueOnce(1);
    mockRedis.del.mockResolvedValueOnce(1);
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockUnlock.mockResolvedValueOnce(undefined);

    await expect(MatchmakingService.cancelQueue('user-1')).resolves.toBeUndefined();
    expect(mockUnlock).toHaveBeenCalledWith('user-1', '1.0');
  });

  it('throws NOT_IN_QUEUE if user has no entry', async () => {
    mockRedis.hgetall.mockResolvedValueOnce(null);
    await expect(
      MatchmakingService.cancelQueue('user-not-in-queue'),
    ).rejects.toMatchObject({ code: 'NOT_IN_QUEUE' });
  });
});

// ─── getEloRange ─────────────────────────────────────────────────────────────

describe('MatchmakingService.getEloRange', () => {
  it('starts at ±100 on join', () => {
    const now = Date.now();
    const entry = { userId: 'u', elo: 1200, stake: '1', joinedAt: now };
    expect(MatchmakingService.getEloRange(entry)).toBe(100);
  });

  it('expands by +50 every 30 seconds (PRD §7)', () => {
    const base = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(base);

    const entry = { userId: 'u', elo: 1200, stake: '1', joinedAt: base };

    // 0 seconds
    expect(MatchmakingService.getEloRange(entry)).toBe(100);

    // 30 seconds elapsed
    vi.setSystemTime(base + 30_000);
    expect(MatchmakingService.getEloRange(entry)).toBe(150);

    // 60 seconds elapsed
    vi.setSystemTime(base + 60_000);
    expect(MatchmakingService.getEloRange(entry)).toBe(200);

    // 5 minutes elapsed
    vi.setSystemTime(base + 300_000);
    expect(MatchmakingService.getEloRange(entry)).toBe(600);

    vi.useRealTimers();
  });

  it('uses floor division — no expansion before 30s boundary', () => {
    const base = Date.now();
    const entry = { userId: 'u', elo: 1200, stake: '1', joinedAt: base };
    // 29.9 seconds — should NOT have expanded yet
    const realNow = Date.now.bind(Date);
    Object.defineProperty(Date, 'now', { value: () => base + 29_999, configurable: true });
    expect(MatchmakingService.getEloRange(entry)).toBe(100);
    Object.defineProperty(Date, 'now', { value: realNow, configurable: true });
  });
});

// ─── findMatch ────────────────────────────────────────────────────────────────

describe('MatchmakingService.findMatch', () => {
  const seeker: QueueEntry = { userId: 'seeker', elo: 1200, stake: '1.0', joinedAt: Date.now() };

  it('returns null when no candidates', () => {
    expect(MatchmakingService.findMatch(seeker, [])).toBeNull();
  });

  it('returns null when all candidates are outside ELO range', () => {
    const candidates: QueueEntry[] = [
      { userId: 'c1', elo: 1400, stake: '1.0', joinedAt: Date.now() }, // +200, outside ±100
    ];
    expect(MatchmakingService.findMatch(seeker, candidates)).toBeNull();
  });

  it('matches within ELO range', () => {
    const candidates: QueueEntry[] = [
      { userId: 'c1', elo: 1250, stake: '1.0', joinedAt: Date.now() }, // within ±100
    ];
    const result = MatchmakingService.findMatch(seeker, candidates);
    expect(result).not.toBeNull();
    expect(result?.match.userId).toBe('c1');
    expect(result?.stakeMismatch).toBe(false);
  });

  it('excludes seeker from candidates', () => {
    const candidates: QueueEntry[] = [seeker]; // seeker with same userId
    expect(MatchmakingService.findMatch(seeker, candidates)).toBeNull();
  });

  it('prefers exact stake match over ELO proximity', () => {
    const candidates: QueueEntry[] = [
      { userId: 'exact-stake',   elo: 1190, stake: '1.0', joinedAt: Date.now() },  // farther ELO, exact stake
      { userId: 'closer-elo',    elo: 1201, stake: '2.0', joinedAt: Date.now() },  // closer ELO, wrong stake
    ];
    const result = MatchmakingService.findMatch(seeker, candidates);
    expect(result?.match.userId).toBe('exact-stake');
    expect(result?.stakeMismatch).toBe(false);
  });

  it('uses lower stake on mismatch (PRD §6)', () => {
    const highStakeSeeker: QueueEntry = { userId: 'seeker', elo: 1200, stake: '5.0', joinedAt: Date.now() };
    const candidates: QueueEntry[] = [
      { userId: 'c1', elo: 1200, stake: '1.0', joinedAt: Date.now() },
    ];
    const result = MatchmakingService.findMatch(highStakeSeeker, candidates);
    expect(result?.stakeMismatch).toBe(true);
    expect(parseFloat(result!.resolvedStake)).toBeCloseTo(1.0, 9); // lower of 5 and 1
  });

  it('picks closest ELO when multiple exact-stake matches available', () => {
    const candidates: QueueEntry[] = [
      { userId: 'c1', elo: 1100, stake: '1.0', joinedAt: Date.now() }, // -100
      { userId: 'c2', elo: 1220, stake: '1.0', joinedAt: Date.now() }, // +20 — closest
      { userId: 'c3', elo: 1290, stake: '1.0', joinedAt: Date.now() }, // +90
    ];
    const result = MatchmakingService.findMatch(seeker, candidates);
    expect(result?.match.userId).toBe('c2');
  });
});

// ─── acquireLock / releaseLock ────────────────────────────────────────────────

describe('MatchmakingService locks', () => {
  it('acquireLock returns true on successful SETNX', async () => {
    mockRedis.set.mockResolvedValueOnce('OK');
    const acquired = await MatchmakingService.acquireLock('user-1');
    expect(acquired).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('mm:lock:user-1'),
      '1',
      'PX',
      10_000,
      'NX',
    );
  });

  it('acquireLock returns false when lock already held', async () => {
    mockRedis.set.mockResolvedValueOnce(null); // Redis SETNX returns null on failure
    const acquired = await MatchmakingService.acquireLock('user-1');
    expect(acquired).toBe(false);
  });

  it('releaseLock calls Redis DEL', async () => {
    mockRedis.del.mockResolvedValueOnce(1);
    await MatchmakingService.releaseLock('user-1');
    expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('mm:lock:user-1'));
  });
});

// ─── getEntry ────────────────────────────────────────────────────────────────

describe('MatchmakingService.getEntry', () => {
  it('returns parsed QueueEntry when Redis has data', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      userId: 'user-42', elo: '1500', stake: '2.5', joinedAt: '1700000000000',
    });
    const entry = await MatchmakingService.getEntry('user-42');
    expect(entry).not.toBeNull();
    expect(entry!.elo).toBe(1500);
    expect(entry!.stake).toBe('2.5');
    expect(entry!.joinedAt).toBe(1700000000000);
  });

  it('returns null when Redis key missing', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({});
    expect(await MatchmakingService.getEntry('nobody')).toBeNull();
  });

  it('returns null when Redis returns null', async () => {
    mockRedis.hgetall.mockResolvedValueOnce(null);
    expect(await MatchmakingService.getEntry('nobody')).toBeNull();
  });
});

// ─── getAllEntries ────────────────────────────────────────────────────────────

describe('MatchmakingService.getAllEntries', () => {
  it('returns all entries present in the Redis sorted set', async () => {
    mockRedis.zrange.mockResolvedValueOnce(['user-1', 'user-2']);
    mockRedis.hgetall
      .mockResolvedValueOnce({ userId: 'user-1', elo: '1200', stake: '1.0', joinedAt: '1000000' })
      .mockResolvedValueOnce({ userId: 'user-2', elo: '1400', stake: '2.0', joinedAt: '2000000' });

    const entries = await MatchmakingService.getAllEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].userId).toBe('user-1');
    expect(entries[1].elo).toBe(1400);
  });

  it('returns empty array when queue is empty', async () => {
    mockRedis.zrange.mockResolvedValueOnce([]);
    const entries = await MatchmakingService.getAllEntries();
    expect(entries).toHaveLength(0);
  });

  it('skips entries whose Redis key disappeared between zrange and hgetall (TOCTOU)', async () => {
    mockRedis.zrange.mockResolvedValueOnce(['user-alive', 'user-ghost']);
    mockRedis.hgetall
      .mockResolvedValueOnce({ userId: 'user-alive', elo: '1200', stake: '1.0', joinedAt: '1000' })
      .mockResolvedValueOnce(null); // ghost entry vanished from Redis

    const entries = await MatchmakingService.getAllEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe('user-alive');
  });
});
