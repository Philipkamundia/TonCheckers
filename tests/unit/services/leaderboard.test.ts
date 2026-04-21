/**
 * tests/unit/services/leaderboard.test.ts
 *
 * LeaderboardService — Redis-cached rankings, 4 sort modes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeaderboardService } from '../../../apps/backend/src/services/leaderboard.service.js';

const { mockQuery, mockRedis } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockRedis: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('../../../apps/backend/src/config/db.js',    () => ({ default: { query: mockQuery } }));
vi.mock('../../../apps/backend/src/config/redis.js', () => ({ default: mockRedis }));

const SAMPLE_ROWS = [
  { userId: 'u1', username: 'Alpha', elo: 1800, totalWon: '10.0', gamesPlayed: 20, gamesWon: 15, winRate: 75 },
  { userId: 'u2', username: 'Beta',  elo: 1600, totalWon: '5.0',  gamesPlayed: 10, gamesWon: 6,  winRate: 60 },
];

beforeEach(() => vi.resetAllMocks());

describe('LeaderboardService.rebuild', () => {
  it('queries DB and caches result in Redis', async () => {
    mockQuery.mockResolvedValue({ rows: SAMPLE_ROWS });
    mockRedis.set.mockResolvedValue('OK');

    const entries = await LeaderboardService.rebuild('elo');
    expect(entries).toHaveLength(2);
    expect(entries[0].rank).toBe(1);
    expect(entries[1].rank).toBe(2);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'leaderboard:elo',
      expect.any(String),
      'EX',
      60,
    );
  });

  it('assigns sequential ranks starting at 1', async () => {
    mockQuery.mockResolvedValue({ rows: SAMPLE_ROWS });
    mockRedis.set.mockResolvedValue('OK');
    const entries = await LeaderboardService.rebuild('elo');
    expect(entries.map(e => e.rank)).toEqual([1, 2]);
  });

  it('works for all 4 sort modes', async () => {
    mockQuery.mockResolvedValue({ rows: SAMPLE_ROWS });
    mockRedis.set.mockResolvedValue('OK');
    for (const sort of ['elo', 'ton_won', 'win_rate', 'games_played'] as const) {
      await LeaderboardService.rebuild(sort);
      expect(mockRedis.set).toHaveBeenCalledWith(`leaderboard:${sort}`, expect.any(String), 'EX', 60);
    }
  });
});

describe('LeaderboardService.getLeaderboard', () => {
  it('serves from cache when available', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(SAMPLE_ROWS.map((r, i) => ({ ...r, rank: i + 1 }))));
    const result = await LeaderboardService.getLeaderboard('elo', 1);
    expect(result.entries).toHaveLength(2);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rebuilds when cache is empty', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockQuery.mockResolvedValue({ rows: SAMPLE_ROWS });
    mockRedis.set.mockResolvedValue('OK');
    const result = await LeaderboardService.getLeaderboard('elo', 1);
    expect(result.entries).toHaveLength(2);
    expect(mockQuery).toHaveBeenCalled();
  });

  it('strips userId from public entries', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(SAMPLE_ROWS.map((r, i) => ({ ...r, rank: i + 1 }))));
    const result = await LeaderboardService.getLeaderboard('elo', 1);
    for (const entry of result.entries) {
      expect(entry).not.toHaveProperty('userId');
    }
  });

  it('paginates correctly', async () => {
    const bigList = Array.from({ length: 60 }, (_, i) => ({
      userId: `u${i}`, username: `User${i}`, elo: 1200 - i,
      totalWon: '0', gamesPlayed: 1, gamesWon: 1, winRate: 100, rank: i + 1,
    }));
    mockRedis.get.mockResolvedValue(JSON.stringify(bigList));
    const page1 = await LeaderboardService.getLeaderboard('elo', 1);
    const page2 = await LeaderboardService.getLeaderboard('elo', 2);
    expect(page1.entries).toHaveLength(50);
    expect(page2.entries).toHaveLength(10);
    expect(page1.totalPages).toBe(2);
    expect(page1.total).toBe(60);
  });

  it('defaults to elo sort for invalid sort param', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify([]));
    const result = await LeaderboardService.getLeaderboard('invalid' as any, 1);
    expect(result).toBeDefined();
  });
});

describe('LeaderboardService.getMyRanks', () => {
  it('returns rank for each sort mode', async () => {
    const entries = SAMPLE_ROWS.map((r, i) => ({ ...r, rank: i + 1 }));
    mockRedis.get.mockResolvedValue(JSON.stringify(entries));
    const ranks = await LeaderboardService.getMyRanks('u1');
    expect(ranks.elo.rank).toBe(1);
    expect(ranks.ton_won.rank).toBe(1);
  });

  it('returns null rank when user not in leaderboard', async () => {
    const entries = SAMPLE_ROWS.map((r, i) => ({ ...r, rank: i + 1 }));
    mockRedis.get.mockResolvedValue(JSON.stringify(entries));
    const ranks = await LeaderboardService.getMyRanks('unknown-user');
    expect(ranks.elo.rank).toBeNull();
  });

  it('returns total count', async () => {
    const entries = SAMPLE_ROWS.map((r, i) => ({ ...r, rank: i + 1 }));
    mockRedis.get.mockResolvedValue(JSON.stringify(entries));
    const ranks = await LeaderboardService.getMyRanks('u1');
    expect(ranks.elo.total).toBe(2);
  });
});

describe('LeaderboardService.rebuildAll', () => {
  it('rebuilds all 4 sort modes', async () => {
    mockQuery.mockResolvedValue({ rows: SAMPLE_ROWS });
    mockRedis.set.mockResolvedValue('OK');
    await LeaderboardService.rebuildAll();
    expect(mockRedis.set).toHaveBeenCalledTimes(4);
  });
});
