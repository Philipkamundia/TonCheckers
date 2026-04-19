/**
 * tests/unit/jobs/tournamentLobbyCheck.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLobbyService, mockTournamentService, mockGameService, mockGameTimerService, mockLogger } = vi.hoisted(() => ({
  mockLobbyService: {
    getExpiredLobbies: vi.fn(),
    getJoinedPlayers: vi.fn(),
    clearLobby: vi.fn(),
  },
  mockTournamentService: {
    recordMatchResult: vi.fn(),
  },
  mockGameService: {
    activateGame: vi.fn(),
  },
  mockGameTimerService: {
    startTimer: vi.fn(),
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/tournament-lobby.service.js', () => ({
  TournamentLobbyService: mockLobbyService,
}));

vi.mock('../../../apps/backend/src/services/tournament.service.js', () => ({
  TournamentService: mockTournamentService,
}));

vi.mock('../../../apps/backend/src/services/game.service.js', () => ({
  GameService: mockGameService,
}));

vi.mock('../../../apps/backend/src/services/game-timer.service.js', () => ({
  GameTimerService: mockGameTimerService,
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { startTournamentLobbyCheck } from '../../../apps/backend/src/jobs/tournamentLobbyCheck.js';

function makeMockIo() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  return { to, emit, _emit: emit };
}

let handle: ReturnType<typeof setInterval>;
let mockIo: ReturnType<typeof makeMockIo>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockIo = makeMockIo();
});

afterEach(() => {
  if (handle) clearInterval(handle);
  vi.useRealTimers();
});

const baseMeta = {
  tournamentId: 'tournament-1',
  matchId: 'match-1',
  player1Id: 'player1',
  player2Id: 'player2',
  expiresAt: Date.now() - 1000,
};

describe('startTournamentLobbyCheck — both players joined', () => {
  it('activates game, starts timer, emits tournament.game_start to both players', async () => {
    mockLobbyService.getExpiredLobbies.mockResolvedValue([
      { gameId: 'game-1', meta: baseMeta },
    ]);
    mockLobbyService.getJoinedPlayers.mockResolvedValue(['player1', 'player2']);
    mockLobbyService.clearLobby.mockResolvedValue(undefined);
    mockGameService.activateGame.mockResolvedValue(undefined);
    mockGameTimerService.startTimer.mockResolvedValue(undefined);

    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockGameService.activateGame).toHaveBeenCalledWith('game-1');
    expect(mockGameTimerService.startTimer).toHaveBeenCalledWith('game-1', 1);

    expect(mockIo.to).toHaveBeenCalledWith('user:player1');
    expect(mockIo.to).toHaveBeenCalledWith('user:player2');
    expect(mockIo._emit).toHaveBeenCalledWith('tournament.game_start', {
      gameId: 'game-1',
      tournamentId: 'tournament-1',
      playerNumber: 1,
    });
    expect(mockIo._emit).toHaveBeenCalledWith('tournament.game_start', {
      gameId: 'game-1',
      tournamentId: 'tournament-1',
      playerNumber: 2,
    });
  });

  it('does not call recordMatchResult when both joined', async () => {
    mockLobbyService.getExpiredLobbies.mockResolvedValue([
      { gameId: 'game-1', meta: baseMeta },
    ]);
    mockLobbyService.getJoinedPlayers.mockResolvedValue(['player1', 'player2']);
    mockLobbyService.clearLobby.mockResolvedValue(undefined);
    mockGameService.activateGame.mockResolvedValue(undefined);
    mockGameTimerService.startTimer.mockResolvedValue(undefined);

    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockTournamentService.recordMatchResult).not.toHaveBeenCalled();
  });
});

describe('startTournamentLobbyCheck — only player1 joined', () => {
  it('player1 wins by forfeit, emits forfeit/win events, calls recordMatchResult', async () => {
    mockLobbyService.getExpiredLobbies.mockResolvedValue([
      { gameId: 'game-1', meta: baseMeta },
    ]);
    mockLobbyService.getJoinedPlayers.mockResolvedValue(['player1']);
    mockLobbyService.clearLobby.mockResolvedValue(undefined);
    mockTournamentService.recordMatchResult.mockResolvedValue(undefined);

    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(2_000);

    // Loser (player2) gets forfeit event
    expect(mockIo.to).toHaveBeenCalledWith('user:player2');
    expect(mockIo._emit).toHaveBeenCalledWith('tournament.lobby_forfeit', {
      gameId: 'game-1',
      tournamentId: 'tournament-1',
      reason: 'Did not join lobby in time',
    });

    // Winner (player1) gets win event
    expect(mockIo.to).toHaveBeenCalledWith('user:player1');
    expect(mockIo._emit).toHaveBeenCalledWith('tournament.lobby_win', {
      gameId: 'game-1',
      tournamentId: 'tournament-1',
      reason: 'Opponent did not join lobby',
    });

    expect(mockTournamentService.recordMatchResult).toHaveBeenCalledWith(
      'tournament-1', 'match-1', 'player1', mockIo,
    );
  });
});

describe('startTournamentLobbyCheck — only player2 joined', () => {
  it('player2 wins by forfeit', async () => {
    mockLobbyService.getExpiredLobbies.mockResolvedValue([
      { gameId: 'game-1', meta: baseMeta },
    ]);
    mockLobbyService.getJoinedPlayers.mockResolvedValue(['player2']);
    mockLobbyService.clearLobby.mockResolvedValue(undefined);
    mockTournamentService.recordMatchResult.mockResolvedValue(undefined);

    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockTournamentService.recordMatchResult).toHaveBeenCalledWith(
      'tournament-1', 'match-1', 'player2', mockIo,
    );

    // Loser is player1
    expect(mockIo._emit).toHaveBeenCalledWith('tournament.lobby_forfeit', {
      gameId: 'game-1',
      tournamentId: 'tournament-1',
      reason: 'Did not join lobby in time',
    });
  });
});

describe('startTournamentLobbyCheck — neither player joined', () => {
  it('player1 advances by convention', async () => {
    mockLobbyService.getExpiredLobbies.mockResolvedValue([
      { gameId: 'game-1', meta: baseMeta },
    ]);
    mockLobbyService.getJoinedPlayers.mockResolvedValue([]);
    mockLobbyService.clearLobby.mockResolvedValue(undefined);
    mockTournamentService.recordMatchResult.mockResolvedValue(undefined);

    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockTournamentService.recordMatchResult).toHaveBeenCalledWith(
      'tournament-1', 'match-1', 'player1', mockIo,
    );
  });

  it('logs warn with winner and loser', async () => {
    mockLobbyService.getExpiredLobbies.mockResolvedValue([
      { gameId: 'game-1', meta: baseMeta },
    ]);
    mockLobbyService.getJoinedPlayers.mockResolvedValue([]);
    mockLobbyService.clearLobby.mockResolvedValue(undefined);
    mockTournamentService.recordMatchResult.mockResolvedValue(undefined);

    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Tournament lobby forfeit: game=game-1 winner=player1 loser=player2',
    );
  });
});

describe('startTournamentLobbyCheck — empty expired lobbies', () => {
  it('does nothing when no expired lobbies', async () => {
    mockLobbyService.getExpiredLobbies.mockResolvedValue([]);

    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockLobbyService.getJoinedPlayers).not.toHaveBeenCalled();
    expect(mockLobbyService.clearLobby).not.toHaveBeenCalled();
    expect(mockTournamentService.recordMatchResult).not.toHaveBeenCalled();
  });
});

describe('startTournamentLobbyCheck — error handling', () => {
  it('logs outer error when getExpiredLobbies throws', async () => {
    mockLobbyService.getExpiredLobbies.mockRejectedValue(new Error('Redis down'));

    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Tournament lobby check error: Redis down',
    );
  });

  it('does not crash on outer error', async () => {
    mockLobbyService.getExpiredLobbies.mockRejectedValue(new Error('fail'));
    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await expect(vi.advanceTimersByTimeAsync(2_000)).resolves.not.toThrow();
  });

  it('fires on 2s interval', async () => {
    mockLobbyService.getExpiredLobbies.mockResolvedValue([]);
    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockLobbyService.getExpiredLobbies).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockLobbyService.getExpiredLobbies).toHaveBeenCalledTimes(2);
  });

  it('reads joined players BEFORE clearing lobby', async () => {
    const callOrder: string[] = [];
    mockLobbyService.getExpiredLobbies.mockResolvedValue([
      { gameId: 'game-1', meta: baseMeta },
    ]);
    mockLobbyService.getJoinedPlayers.mockImplementation(async () => {
      callOrder.push('getJoinedPlayers');
      return ['player1'];
    });
    mockLobbyService.clearLobby.mockImplementation(async () => {
      callOrder.push('clearLobby');
    });
    mockTournamentService.recordMatchResult.mockResolvedValue(undefined);

    handle = startTournamentLobbyCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(callOrder).toEqual(['getJoinedPlayers', 'clearLobby']);
  });
});
