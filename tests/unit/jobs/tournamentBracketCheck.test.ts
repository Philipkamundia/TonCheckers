/**
 * tests/unit/jobs/tournamentBracketCheck.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockBracketService, mockTournamentService, mockLogger } = vi.hoisted(() => ({
  mockBracketService: {
    getExpiredWindows: vi.fn(),
    getPresentPlayers: vi.fn(),
    clearWindow: vi.fn(),
  },
  mockTournamentService: {
    resolveBracketWindow: vi.fn(),
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/tournament-bracket.service.js', () => ({
  TournamentBracketService: mockBracketService,
}));

vi.mock('../../../apps/backend/src/services/tournament.service.js', () => ({
  TournamentService: mockTournamentService,
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { startTournamentBracketCheck } from '../../../apps/backend/src/jobs/tournamentBracketCheck.js';

const mockIo = { to: vi.fn().mockReturnThis(), emit: vi.fn() } as unknown as import('socket.io').Server;

let handle: ReturnType<typeof setInterval>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  (mockIo as { to: ReturnType<typeof vi.fn> }).to = vi.fn().mockReturnThis();
  (mockIo as { emit: ReturnType<typeof vi.fn> }).emit = vi.fn();
});

afterEach(() => {
  if (handle) clearInterval(handle);
  vi.useRealTimers();
});

describe('startTournamentBracketCheck', () => {
  it('returns a setInterval handle', () => {
    mockBracketService.getExpiredWindows.mockResolvedValue([]);
    handle = startTournamentBracketCheck(mockIo);
    expect(handle).toBeDefined();
  });

  it('logs info on start', () => {
    mockBracketService.getExpiredWindows.mockResolvedValue([]);
    handle = startTournamentBracketCheck(mockIo);
    expect(mockLogger.info).toHaveBeenCalledWith('Tournament bracket check: every 2s');
  });

  it('does nothing when no expired windows', async () => {
    mockBracketService.getExpiredWindows.mockResolvedValue([]);
    handle = startTournamentBracketCheck(mockIo);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockBracketService.getPresentPlayers).not.toHaveBeenCalled();
    expect(mockBracketService.clearWindow).not.toHaveBeenCalled();
    expect(mockTournamentService.resolveBracketWindow).not.toHaveBeenCalled();
  });

  it('calls getPresentPlayers, clearWindow, and resolveBracketWindow for each expired window', async () => {
    const meta = { participants: [{ userId: 'u1', seedElo: 1200 }, { userId: 'u2', seedElo: 1100 }] };
    mockBracketService.getExpiredWindows.mockResolvedValue([
      { tournamentId: 't1', meta },
    ]);
    mockBracketService.getPresentPlayers.mockResolvedValue(['u1', 'u2']);
    mockBracketService.clearWindow.mockResolvedValue(undefined);
    mockTournamentService.resolveBracketWindow.mockResolvedValue(undefined);

    handle = startTournamentBracketCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockBracketService.getPresentPlayers).toHaveBeenCalledWith('t1');
    expect(mockBracketService.clearWindow).toHaveBeenCalledWith('t1');
    expect(mockTournamentService.resolveBracketWindow).toHaveBeenCalledWith(
      't1', ['u1', 'u2'], meta.participants, mockIo,
    );
  });

  it('processes multiple expired windows', async () => {
    const meta1 = { participants: [{ userId: 'u1', seedElo: 1200 }] };
    const meta2 = { participants: [{ userId: 'u3', seedElo: 1300 }] };
    mockBracketService.getExpiredWindows.mockResolvedValue([
      { tournamentId: 't1', meta: meta1 },
      { tournamentId: 't2', meta: meta2 },
    ]);
    mockBracketService.getPresentPlayers
      .mockResolvedValueOnce(['u1'])
      .mockResolvedValueOnce(['u3']);
    mockBracketService.clearWindow.mockResolvedValue(undefined);
    mockTournamentService.resolveBracketWindow.mockResolvedValue(undefined);

    handle = startTournamentBracketCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockBracketService.getPresentPlayers).toHaveBeenCalledTimes(2);
    expect(mockBracketService.clearWindow).toHaveBeenCalledTimes(2);
    expect(mockTournamentService.resolveBracketWindow).toHaveBeenCalledTimes(2);
  });

  it('logs info with present/total counts', async () => {
    const meta = { participants: [{ userId: 'u1', seedElo: 1200 }, { userId: 'u2', seedElo: 1100 }] };
    mockBracketService.getExpiredWindows.mockResolvedValue([{ tournamentId: 't1', meta }]);
    mockBracketService.getPresentPlayers.mockResolvedValue(['u1']);
    mockBracketService.clearWindow.mockResolvedValue(undefined);
    mockTournamentService.resolveBracketWindow.mockResolvedValue(undefined);

    handle = startTournamentBracketCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Bracket window expired: tournament=t1 present=1/2',
    );
  });

  it('logs error and continues when resolveBracketWindow throws', async () => {
    const meta = { participants: [{ userId: 'u1', seedElo: 1200 }] };
    mockBracketService.getExpiredWindows.mockResolvedValue([
      { tournamentId: 't1', meta },
      { tournamentId: 't2', meta },
    ]);
    mockBracketService.getPresentPlayers.mockResolvedValue(['u1']);
    mockBracketService.clearWindow.mockResolvedValue(undefined);
    mockTournamentService.resolveBracketWindow
      .mockRejectedValueOnce(new Error('bracket error'))
      .mockResolvedValueOnce(undefined);

    handle = startTournamentBracketCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Bracket resolve failed: tournament=t1: bracket error',
    );
    // Second window still processed
    expect(mockTournamentService.resolveBracketWindow).toHaveBeenCalledTimes(2);
  });

  it('logs outer error when getExpiredWindows throws', async () => {
    mockBracketService.getExpiredWindows.mockRejectedValue(new Error('Redis error'));

    handle = startTournamentBracketCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Tournament bracket check error: Redis error',
    );
  });

  it('does not crash when outer error occurs', async () => {
    mockBracketService.getExpiredWindows.mockRejectedValue(new Error('fail'));
    handle = startTournamentBracketCheck(mockIo);
    await expect(vi.advanceTimersByTimeAsync(2_000)).resolves.not.toThrow();
  });

  it('fires on 2s interval', async () => {
    mockBracketService.getExpiredWindows.mockResolvedValue([]);
    handle = startTournamentBracketCheck(mockIo);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockBracketService.getExpiredWindows).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockBracketService.getExpiredWindows).toHaveBeenCalledTimes(2);
  });
});
