/**
 * tests/unit/jobs/leaderboardRebuild.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLeaderboardService, mockLogger } = vi.hoisted(() => ({
  mockLeaderboardService: { rebuildAll: vi.fn() },
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/leaderboard.service.js', () => ({
  LeaderboardService: mockLeaderboardService,
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { startLeaderboardRebuild } from '../../../apps/backend/src/jobs/leaderboardRebuild.js';

/** Flush microtask queue (Promise.resolve chains) */
const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));

let handle: ReturnType<typeof setInterval>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  if (handle) clearInterval(handle);
  vi.useRealTimers();
});

describe('startLeaderboardRebuild', () => {
  it('calls rebuildAll immediately on start', async () => {
    mockLeaderboardService.rebuildAll.mockResolvedValue(undefined);
    handle = startLeaderboardRebuild();
    // Flush the immediate async call
    await vi.advanceTimersByTimeAsync(0);
    expect(mockLeaderboardService.rebuildAll).toHaveBeenCalledTimes(1);
  });

  it('returns a setInterval handle', () => {
    mockLeaderboardService.rebuildAll.mockResolvedValue(undefined);
    handle = startLeaderboardRebuild();
    expect(handle).toBeDefined();
    // Should be a numeric timer id (or object in Node)
    expect(typeof handle).not.toBe('undefined');
  });

  it('calls rebuildAll again after 1 minute', async () => {
    mockLeaderboardService.rebuildAll.mockResolvedValue(undefined);
    handle = startLeaderboardRebuild();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockLeaderboardService.rebuildAll).toHaveBeenCalledTimes(1);

    // Advance 1 minute
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockLeaderboardService.rebuildAll).toHaveBeenCalledTimes(2);
  });

  it('calls rebuildAll multiple times across multiple intervals', async () => {
    mockLeaderboardService.rebuildAll.mockResolvedValue(undefined);
    handle = startLeaderboardRebuild();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockLeaderboardService.rebuildAll).toHaveBeenCalledTimes(3);
  });

  it('logs error when rebuildAll throws on immediate call', async () => {
    const err = new Error('DB connection failed');
    mockLeaderboardService.rebuildAll.mockRejectedValue(err);
    handle = startLeaderboardRebuild();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Leaderboard rebuild error: DB connection failed',
    );
  });

  it('logs error when rebuildAll throws on interval call', async () => {
    mockLeaderboardService.rebuildAll
      .mockResolvedValueOnce(undefined) // immediate call succeeds
      .mockRejectedValueOnce(new Error('Timeout')); // interval call fails

    handle = startLeaderboardRebuild();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Leaderboard rebuild error: Timeout',
    );
  });

  it('does not throw when rebuildAll rejects — error is caught', async () => {
    mockLeaderboardService.rebuildAll.mockRejectedValue(new Error('fail'));
    expect(() => {
      handle = startLeaderboardRebuild();
    }).not.toThrow();
  });

  it('logs info message on start', () => {
    mockLeaderboardService.rebuildAll.mockResolvedValue(undefined);
    handle = startLeaderboardRebuild();
    expect(mockLogger.info).toHaveBeenCalledWith('Leaderboard rebuild job: every 1 minute');
  });
});
