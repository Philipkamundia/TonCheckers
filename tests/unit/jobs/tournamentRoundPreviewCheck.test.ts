/**
 * tests/unit/jobs/tournamentRoundPreviewCheck.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRoundPreviewService, mockTournamentService, mockLogger } = vi.hoisted(() => ({
  mockRoundPreviewService: {
    getExpiredWindows: vi.fn(),
    clearWindow: vi.fn(),
  },
  mockTournamentService: {
    activateRoundMatchLobby: vi.fn(),
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/tournament-round-preview.service.js', () => ({
  TournamentRoundPreviewService: mockRoundPreviewService,
}));

vi.mock('../../../apps/backend/src/services/tournament.service.js', () => ({
  TournamentService: mockTournamentService,
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { startTournamentRoundPreviewCheck } from '../../../apps/backend/src/jobs/tournamentRoundPreviewCheck.js';

const mockIo = { to: vi.fn().mockReturnThis(), emit: vi.fn() } as unknown as import('socket.io').Server;

let handle: ReturnType<typeof setInterval>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  if (handle) clearInterval(handle);
  vi.useRealTimers();
});

describe('startTournamentRoundPreviewCheck', () => {
  it('returns a setInterval handle', () => {
    mockRoundPreviewService.getExpiredWindows.mockResolvedValue([]);
    handle = startTournamentRoundPreviewCheck(mockIo);
    expect(handle).toBeDefined();
  });

  it('logs info on start', () => {
    mockRoundPreviewService.getExpiredWindows.mockResolvedValue([]);
    handle = startTournamentRoundPreviewCheck(mockIo);
    expect(mockLogger.info).toHaveBeenCalledWith('Tournament round preview check: every 2s');
  });

  it('does nothing when no expired windows', async () => {
    mockRoundPreviewService.getExpiredWindows.mockResolvedValue([]);
    handle = startTournamentRoundPreviewCheck(mockIo);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockRoundPreviewService.clearWindow).not.toHaveBeenCalled();
    expect(mockTournamentService.activateRoundMatchLobby).not.toHaveBeenCalled();
  });

  it('calls clearWindow and activateRoundMatchLobby for each match', async () => {
    const match1 = { gameId: 'g1', matchId: 'm1', player1Id: 'u1', player2Id: 'u2' };
    const match2 = { gameId: 'g2', matchId: 'm2', player1Id: 'u3', player2Id: 'u4' };
    const preview = {
      tournamentId: 't1',
      round: 2,
      expiresAt: Date.now() - 1000,
      matches: [match1, match2],
    };
    mockRoundPreviewService.getExpiredWindows.mockResolvedValue([preview]);
    mockRoundPreviewService.clearWindow.mockResolvedValue(undefined);
    mockTournamentService.activateRoundMatchLobby.mockResolvedValue(undefined);

    handle = startTournamentRoundPreviewCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockRoundPreviewService.clearWindow).toHaveBeenCalledWith('t1');
    expect(mockTournamentService.activateRoundMatchLobby).toHaveBeenCalledTimes(2);
    expect(mockTournamentService.activateRoundMatchLobby).toHaveBeenCalledWith(
      't1', 2, match1, mockIo,
    );
    expect(mockTournamentService.activateRoundMatchLobby).toHaveBeenCalledWith(
      't1', 2, match2, mockIo,
    );
  });

  it('processes multiple expired previews', async () => {
    const preview1 = {
      tournamentId: 't1', round: 1, expiresAt: Date.now() - 1000,
      matches: [{ gameId: 'g1', matchId: 'm1', player1Id: 'u1', player2Id: 'u2' }],
    };
    const preview2 = {
      tournamentId: 't2', round: 2, expiresAt: Date.now() - 1000,
      matches: [{ gameId: 'g2', matchId: 'm2', player1Id: 'u3', player2Id: 'u4' }],
    };
    mockRoundPreviewService.getExpiredWindows.mockResolvedValue([preview1, preview2]);
    mockRoundPreviewService.clearWindow.mockResolvedValue(undefined);
    mockTournamentService.activateRoundMatchLobby.mockResolvedValue(undefined);

    handle = startTournamentRoundPreviewCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockRoundPreviewService.clearWindow).toHaveBeenCalledTimes(2);
    expect(mockTournamentService.activateRoundMatchLobby).toHaveBeenCalledTimes(2);
  });

  it('logs error per match and continues processing other matches', async () => {
    const match1 = { gameId: 'g1', matchId: 'm1', player1Id: 'u1', player2Id: 'u2' };
    const match2 = { gameId: 'g2', matchId: 'm2', player1Id: 'u3', player2Id: 'u4' };
    const preview = {
      tournamentId: 't1', round: 3, expiresAt: Date.now() - 1000,
      matches: [match1, match2],
    };
    mockRoundPreviewService.getExpiredWindows.mockResolvedValue([preview]);
    mockRoundPreviewService.clearWindow.mockResolvedValue(undefined);
    mockTournamentService.activateRoundMatchLobby
      .mockRejectedValueOnce(new Error('lobby error'))
      .mockResolvedValueOnce(undefined);

    handle = startTournamentRoundPreviewCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Round preview activation failed: tournament=t1 round=3 game=g1: lobby error',
    );
    // Second match still processed
    expect(mockTournamentService.activateRoundMatchLobby).toHaveBeenCalledTimes(2);
  });

  it('logs outer error when getExpiredWindows throws', async () => {
    mockRoundPreviewService.getExpiredWindows.mockRejectedValue(new Error('Redis timeout'));

    handle = startTournamentRoundPreviewCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Tournament round preview check error: Redis timeout',
    );
  });

  it('does not crash on outer error', async () => {
    mockRoundPreviewService.getExpiredWindows.mockRejectedValue(new Error('fail'));
    handle = startTournamentRoundPreviewCheck(mockIo);
    await expect(vi.advanceTimersByTimeAsync(2_000)).resolves.not.toThrow();
  });

  it('fires on 2s interval', async () => {
    mockRoundPreviewService.getExpiredWindows.mockResolvedValue([]);
    handle = startTournamentRoundPreviewCheck(mockIo);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockRoundPreviewService.getExpiredWindows).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockRoundPreviewService.getExpiredWindows).toHaveBeenCalledTimes(2);
  });

  it('handles preview with empty matches array', async () => {
    const preview = {
      tournamentId: 't1', round: 1, expiresAt: Date.now() - 1000, matches: [],
    };
    mockRoundPreviewService.getExpiredWindows.mockResolvedValue([preview]);
    mockRoundPreviewService.clearWindow.mockResolvedValue(undefined);

    handle = startTournamentRoundPreviewCheck(mockIo);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockRoundPreviewService.clearWindow).toHaveBeenCalledWith('t1');
    expect(mockTournamentService.activateRoundMatchLobby).not.toHaveBeenCalled();
  });
});
