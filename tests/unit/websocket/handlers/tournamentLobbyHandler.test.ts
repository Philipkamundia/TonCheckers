/**
 * tests/unit/websocket/handlers/tournamentLobbyHandler.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger, mockPlayerJoined } = vi.hoisted(() => {
  const mockPlayerJoined = vi.fn();
  const mockLogger = {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  };
  return { mockLogger, mockPlayerJoined };
});

vi.mock('../../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('../../../../apps/backend/src/services/tournament-lobby.service.js', () => ({
  TournamentLobbyService: {
    playerJoined: mockPlayerJoined,
  },
}));

import { registerTournamentLobbyHandlers } from '../../../../apps/backend/src/websocket/handlers/tournamentLobbyHandler.js';

function makeSocket(userId = 'user-1') {
  return {
    id:     'socket-1',
    userId,
    join:   vi.fn(),
    leave:  vi.fn(),
    on:     vi.fn(),
    emit:   vi.fn(),
  } as any;
}

function makeIo() {
  return { to: vi.fn().mockReturnThis(), emit: vi.fn() } as any;
}

function getHandler(socket: ReturnType<typeof makeSocket>, event: string) {
  const call = socket.on.mock.calls.find(([e]: [string]) => e === event);
  if (!call) throw new Error(`Handler for '${event}' not registered`);
  return call[1] as (...args: any[]) => Promise<void>;
}

beforeEach(() => vi.clearAllMocks());

describe('registerTournamentLobbyHandlers', () => {
  it('registers tournament.lobby_join event handler', () => {
    const socket = makeSocket();
    registerTournamentLobbyHandlers(makeIo(), socket);
    expect(socket.on).toHaveBeenCalledWith('tournament.lobby_join', expect.any(Function));
  });

  it('emits tournament.lobby_joined and logs info when playerJoined returns meta', async () => {
    mockPlayerJoined.mockResolvedValue({ meta: { someData: true } });
    const socket = makeSocket('user-7');
    registerTournamentLobbyHandlers(makeIo(), socket);

    const handler = getHandler(socket, 'tournament.lobby_join');
    await handler({ gameId: 'game-abc' });

    expect(mockPlayerJoined).toHaveBeenCalledWith('game-abc', 'user-7');
    expect(socket.emit).toHaveBeenCalledWith('tournament.lobby_joined', {
      gameId: 'game-abc',
      userId: 'user-7',
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Tournament lobby joined: game=game-abc user=user-7 (awaiting full 10s window)',
    );
  });

  it('emits tournament.lobby_expired when playerJoined returns null meta', async () => {
    mockPlayerJoined.mockResolvedValue({ meta: null });
    const socket = makeSocket('user-7');
    registerTournamentLobbyHandlers(makeIo(), socket);

    const handler = getHandler(socket, 'tournament.lobby_join');
    await handler({ gameId: 'game-xyz' });

    expect(socket.emit).toHaveBeenCalledWith('tournament.lobby_expired', { gameId: 'game-xyz' });
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('does not emit lobby_joined when meta is null', async () => {
    mockPlayerJoined.mockResolvedValue({ meta: null });
    const socket = makeSocket();
    registerTournamentLobbyHandlers(makeIo(), socket);

    const handler = getHandler(socket, 'tournament.lobby_join');
    await handler({ gameId: 'game-xyz' });

    expect(socket.emit).not.toHaveBeenCalledWith('tournament.lobby_joined', expect.anything());
  });

  it('logs error and does not crash on service error', async () => {
    mockPlayerJoined.mockRejectedValue(new Error('Redis timeout'));
    const socket = makeSocket('user-7');
    registerTournamentLobbyHandlers(makeIo(), socket);

    const handler = getHandler(socket, 'tournament.lobby_join');
    await expect(handler({ gameId: 'game-err' })).resolves.not.toThrow();

    expect(mockLogger.error).toHaveBeenCalledWith('tournament.lobby_join: Redis timeout');
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
