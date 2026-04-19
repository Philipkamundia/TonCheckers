/**
 * tests/unit/services/tournament-round-preview.test.ts
 *
 * TournamentRoundPreviewService — 30s round preview window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TournamentRoundPreviewService } from '../../../apps/backend/src/services/tournament-round-preview.service.js';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    set:      vi.fn(),
    get:      vi.fn(),
    del:      vi.fn(),
    sadd:     vi.fn(),
    srem:     vi.fn(),
    smembers: vi.fn(),
  },
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({ default: mockRedis }));

const T_ID = 'tournament-001';
const MATCHES = [
  { gameId: 'g1', matchId: 'm1', player1Id: 'p1', player2Id: 'p2' },
  { gameId: 'g2', matchId: 'm2', player1Id: 'p3', player2Id: 'p4' },
];

beforeEach(() => vi.resetAllMocks());

describe('TournamentRoundPreviewService.openWindow', () => {
  it('stores meta and adds to active set', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.sadd.mockResolvedValue(1);

    const meta = await TournamentRoundPreviewService.openWindow(T_ID, 1, MATCHES);
    expect(meta.tournamentId).toBe(T_ID);
    expect(meta.round).toBe(1);
    expect(meta.matches).toHaveLength(2);
    expect(meta.expiresAt).toBeGreaterThan(Date.now());
    expect(mockRedis.set).toHaveBeenCalledWith(
      `t:round_preview:meta:${T_ID}`,
      expect.stringContaining(T_ID),
      'PX',
      expect.any(Number),
    );
    expect(mockRedis.sadd).toHaveBeenCalledWith('t:round_preview:active_set', T_ID);
  });
});

describe('TournamentRoundPreviewService.clearWindow', () => {
  it('deletes meta and removes from active set', async () => {
    mockRedis.del.mockResolvedValue(1);
    mockRedis.srem.mockResolvedValue(1);
    await TournamentRoundPreviewService.clearWindow(T_ID);
    expect(mockRedis.del).toHaveBeenCalledWith(`t:round_preview:meta:${T_ID}`);
    expect(mockRedis.srem).toHaveBeenCalledWith('t:round_preview:active_set', T_ID);
  });
});

describe('TournamentRoundPreviewService.getExpiredWindows', () => {
  it('returns empty when no active windows', async () => {
    mockRedis.smembers.mockResolvedValue([]);
    expect(await TournamentRoundPreviewService.getExpiredWindows()).toEqual([]);
  });

  it('returns expired windows with their matches', async () => {
    mockRedis.smembers.mockResolvedValue([T_ID]);
    const meta = { tournamentId: T_ID, round: 1, expiresAt: Date.now() - 1_000, matches: MATCHES };
    mockRedis.get.mockResolvedValue(JSON.stringify(meta));
    const expired = await TournamentRoundPreviewService.getExpiredWindows();
    expect(expired).toHaveLength(1);
    expect(expired[0].matches).toHaveLength(2);
  });

  it('skips non-expired windows', async () => {
    mockRedis.smembers.mockResolvedValue([T_ID]);
    const meta = { tournamentId: T_ID, round: 1, expiresAt: Date.now() + 30_000, matches: MATCHES };
    mockRedis.get.mockResolvedValue(JSON.stringify(meta));
    expect(await TournamentRoundPreviewService.getExpiredWindows()).toHaveLength(0);
  });

  it('cleans up stale entries', async () => {
    mockRedis.smembers.mockResolvedValue([T_ID]);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.srem.mockResolvedValue(1);
    await TournamentRoundPreviewService.getExpiredWindows();
    expect(mockRedis.srem).toHaveBeenCalledWith('t:round_preview:active_set', T_ID);
  });
});
