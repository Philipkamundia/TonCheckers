/**
 * tests/unit/services/game-timer.test.ts
 *
 * GameTimerService — Redis-backed 30s move timers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameTimerService } from '../../../apps/backend/src/services/game-timer.service.js';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    set:     vi.fn(),
    del:     vi.fn(),
    get:     vi.fn(),
    sadd:    vi.fn(),
    srem:    vi.fn(),
    sscan:   vi.fn(),
  },
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({ default: mockRedis }));

beforeEach(() => vi.resetAllMocks());

describe('GameTimerService.startTimer', () => {
  it('sets timer key and adds to active set', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.sadd.mockResolvedValue(1);
    await GameTimerService.startTimer('game-1', 1);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'game:timer:game-1',
      expect.stringMatching(/^\d+:1$/),
      'PX',
      expect.any(Number),
    );
    expect(mockRedis.sadd).toHaveBeenCalledWith('game:active_set', 'game-1');
  });

  it('stores player 2 correctly', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.sadd.mockResolvedValue(1);
    await GameTimerService.startTimer('game-2', 2);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'game:timer:game-2',
      expect.stringMatching(/^\d+:2$/),
      'PX',
      expect.any(Number),
    );
  });
});

describe('GameTimerService.clearTimer', () => {
  it('deletes timer key and removes from active set', async () => {
    mockRedis.del.mockResolvedValue(1);
    mockRedis.srem.mockResolvedValue(1);
    await GameTimerService.clearTimer('game-1');
    expect(mockRedis.del).toHaveBeenCalledWith('game:timer:game-1');
    expect(mockRedis.srem).toHaveBeenCalledWith('game:active_set', 'game-1');
  });
});

describe('GameTimerService.getRemainingMs', () => {
  it('returns null when no timer exists', async () => {
    mockRedis.get.mockResolvedValue(null);
    expect(await GameTimerService.getRemainingMs('game-1')).toBeNull();
  });

  it('returns positive ms when timer has not expired', async () => {
    const future = Date.now() + 15_000;
    mockRedis.get.mockResolvedValue(`${future}:1`);
    const remaining = await GameTimerService.getRemainingMs('game-1');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(15_000);
  });

  it('returns 0 when timer has expired', async () => {
    const past = Date.now() - 5_000;
    mockRedis.get.mockResolvedValue(`${past}:1`);
    expect(await GameTimerService.getRemainingMs('game-1')).toBe(0);
  });
});

describe('GameTimerService.getActivePlayer', () => {
  it('returns null when no timer', async () => {
    mockRedis.get.mockResolvedValue(null);
    expect(await GameTimerService.getActivePlayer('game-1')).toBeNull();
  });

  it('returns player 1', async () => {
    mockRedis.get.mockResolvedValue(`${Date.now() + 10_000}:1`);
    expect(await GameTimerService.getActivePlayer('game-1')).toBe(1);
  });

  it('returns player 2', async () => {
    mockRedis.get.mockResolvedValue(`${Date.now() + 10_000}:2`);
    expect(await GameTimerService.getActivePlayer('game-1')).toBe(2);
  });
});

describe('GameTimerService.getExpiredGames', () => {
  it('returns empty array when no active games', async () => {
    mockRedis.sscan.mockResolvedValue(['0', []]);
    expect(await GameTimerService.getExpiredGames()).toEqual([]);
  });

  it('returns expired game with correct timedOutPlayer', async () => {
    mockRedis.sscan.mockResolvedValue(['0', ['game-expired']]);
    const past = Date.now() - 1_000;
    mockRedis.get.mockResolvedValue(`${past}:2`);
    const result = await GameTimerService.getExpiredGames();
    expect(result).toHaveLength(1);
    expect(result[0].gameId).toBe('game-expired');
    expect(result[0].timedOutPlayer).toBe(2);
  });

  it('skips non-expired games', async () => {
    mockRedis.sscan.mockResolvedValue(['0', ['game-active']]);
    const future = Date.now() + 20_000;
    mockRedis.get.mockResolvedValue(`${future}:1`);
    expect(await GameTimerService.getExpiredGames()).toHaveLength(0);
  });

  it('removes stale set entries when key is missing', async () => {
    mockRedis.sscan.mockResolvedValue(['0', ['game-stale']]);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.srem.mockResolvedValue(1);
    await GameTimerService.getExpiredGames();
    expect(mockRedis.srem).toHaveBeenCalledWith('game:active_set', 'game-stale');
  });

  it('handles multi-page SSCAN cursor correctly', async () => {
    mockRedis.sscan
      .mockResolvedValueOnce(['cursor1', ['game-1']])
      .mockResolvedValueOnce(['0',       ['game-2']]);
    const past = Date.now() - 1_000;
    mockRedis.get.mockResolvedValue(`${past}:1`);
    const result = await GameTimerService.getExpiredGames();
    expect(result).toHaveLength(2);
  });
});
