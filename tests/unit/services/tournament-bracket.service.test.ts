/**
 * tests/unit/services/tournament-bracket.service.test.ts
 *
 * TournamentBracketService — 30s bracket presence window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TournamentBracketService } from '../../../apps/backend/src/services/tournament-bracket.service.js';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    set:      vi.fn(),
    get:      vi.fn(),
    del:      vi.fn(),
    sadd:     vi.fn(),
    srem:     vi.fn(),
    smembers: vi.fn(),
    exists:   vi.fn(),
  },
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({ default: mockRedis }));

const T_ID = 'tournament-001';
const PARTICIPANTS = [
  { userId: 'p1', seedElo: 1800 },
  { userId: 'p2', seedElo: 1600 },
  { userId: 'p3', seedElo: 1400 },
  { userId: 'p4', seedElo: 1200 },
];

beforeEach(() => vi.resetAllMocks());

describe('TournamentBracketService.openWindow', () => {
  it('stores meta, clears presence, adds to active set', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.sadd.mockResolvedValue(1);

    const meta = await TournamentBracketService.openWindow(T_ID, PARTICIPANTS);
    expect(meta.tournamentId).toBe(T_ID);
    expect(meta.participants).toHaveLength(4);
    expect(meta.expiresAt).toBeGreaterThan(Date.now());
    expect(mockRedis.set).toHaveBeenCalledWith(
      `t:bracket:meta:${T_ID}`,
      expect.stringContaining(T_ID),
      'PX',
      expect.any(Number),
    );
    expect(mockRedis.del).toHaveBeenCalledWith(`t:bracket:present:${T_ID}`);
    expect(mockRedis.sadd).toHaveBeenCalledWith('t:bracket:active_set', T_ID);
  });
});

describe('TournamentBracketService.playerJoined', () => {
  it('returns false when window does not exist', async () => {
    mockRedis.exists.mockResolvedValue(0);
    expect(await TournamentBracketService.playerJoined(T_ID, 'p1')).toBe(false);
  });

  it('adds player to presence set and returns true', async () => {
    mockRedis.exists.mockResolvedValue(1);
    mockRedis.sadd.mockResolvedValue(1);
    expect(await TournamentBracketService.playerJoined(T_ID, 'p1')).toBe(true);
    expect(mockRedis.sadd).toHaveBeenCalledWith(`t:bracket:present:${T_ID}`, 'p1');
  });
});

describe('TournamentBracketService.getPresentPlayers', () => {
  it('returns list of present players', async () => {
    mockRedis.smembers.mockResolvedValue(['p1', 'p2']);
    const players = await TournamentBracketService.getPresentPlayers(T_ID);
    expect(players).toContain('p1');
    expect(players).toContain('p2');
  });
});

describe('TournamentBracketService.clearWindow', () => {
  it('deletes all keys and removes from active set', async () => {
    mockRedis.del.mockResolvedValue(1);
    mockRedis.srem.mockResolvedValue(1);
    await TournamentBracketService.clearWindow(T_ID);
    expect(mockRedis.del).toHaveBeenCalledWith(`t:bracket:meta:${T_ID}`);
    expect(mockRedis.del).toHaveBeenCalledWith(`t:bracket:present:${T_ID}`);
    expect(mockRedis.srem).toHaveBeenCalledWith('t:bracket:active_set', T_ID);
  });
});

describe('TournamentBracketService.getExpiredWindows', () => {
  it('returns empty when no active windows', async () => {
    mockRedis.smembers.mockResolvedValue([]);
    expect(await TournamentBracketService.getExpiredWindows()).toEqual([]);
  });

  it('returns expired windows', async () => {
    mockRedis.smembers.mockResolvedValue([T_ID]);
    const meta = { tournamentId: T_ID, expiresAt: Date.now() - 1_000, participants: PARTICIPANTS };
    mockRedis.get.mockResolvedValue(JSON.stringify(meta));
    const expired = await TournamentBracketService.getExpiredWindows();
    expect(expired).toHaveLength(1);
    expect(expired[0].tournamentId).toBe(T_ID);
  });

  it('skips non-expired windows', async () => {
    mockRedis.smembers.mockResolvedValue([T_ID]);
    const meta = { tournamentId: T_ID, expiresAt: Date.now() + 30_000, participants: PARTICIPANTS };
    mockRedis.get.mockResolvedValue(JSON.stringify(meta));
    expect(await TournamentBracketService.getExpiredWindows()).toHaveLength(0);
  });

  it('cleans up stale entries when meta key is missing', async () => {
    mockRedis.smembers.mockResolvedValue([T_ID]);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.srem.mockResolvedValue(1);
    await TournamentBracketService.getExpiredWindows();
    expect(mockRedis.srem).toHaveBeenCalledWith('t:bracket:active_set', T_ID);
  });
});
