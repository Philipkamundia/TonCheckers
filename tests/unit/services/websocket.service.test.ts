/**
 * tests/unit/services/websocket.service.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthService,
  mockRedis,
  mockRegisterGameHandlers,
  mockRegisterUserHandlers,
  mockRegisterAiGameHandlers,
  mockRegisterTournamentLobbyHandlers,
  mockRegisterTournamentBracketHandlers,
  mockLogger,
} = vi.hoisted(() => ({
  mockAuthService: { verifyAccessToken: vi.fn() },
  mockRedis: { incr: vi.fn(), expire: vi.fn() },
  mockRegisterGameHandlers: vi.fn(),
  mockRegisterUserHandlers: vi.fn(),
  mockRegisterAiGameHandlers: vi.fn(),
  mockRegisterTournamentLobbyHandlers: vi.fn(),
  mockRegisterTournamentBracketHandlers: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/auth.service.js', () => ({
  AuthService: mockAuthService,
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({
  default: mockRedis,
}));

vi.mock('../../../apps/backend/src/websocket/handlers/gameHandler.js', () => ({
  registerGameHandlers: mockRegisterGameHandlers,
}));

vi.mock('../../../apps/backend/src/websocket/handlers/userHandler.js', () => ({
  registerUserHandlers: mockRegisterUserHandlers,
}));

vi.mock('../../../apps/backend/src/websocket/handlers/aiGameHandler.js', () => ({
  registerAiGameHandlers: mockRegisterAiGameHandlers,
}));

vi.mock('../../../apps/backend/src/websocket/handlers/tournamentLobbyHandler.js', () => ({
  registerTournamentLobbyHandlers: mockRegisterTournamentLobbyHandlers,
}));

vi.mock('../../../apps/backend/src/websocket/handlers/tournamentBracketHandler.js', () => ({
  registerTournamentBracketHandlers: mockRegisterTournamentBracketHandlers,
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { WebSocketService } from '../../../apps/backend/src/services/websocket.service.js';

// ─── Mock Socket.IO helpers ───────────────────────────────────────────────────

function makeSocket(overrides: Record<string, unknown> = {}) {
  const socket = {
    id: 'socket-1',
    handshake: { auth: {}, headers: {} },
    userId: undefined as string | undefined,
    rooms: new Set<string>(['socket-1']),
    use: vi.fn(),
    on: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    emit: vi.fn(),
    ...overrides,
  };
  return socket;
}

function makeIo() {
  const connectionHandlers: Array<(socket: ReturnType<typeof makeSocket>) => void> = [];
  const middlewares: Array<(socket: ReturnType<typeof makeSocket>, next: (err?: Error) => void) => void> = [];

  const emitFn = vi.fn();
  const toFn = vi.fn().mockReturnValue({ emit: emitFn });

  const io = {
    use: vi.fn().mockImplementation((fn) => { middlewares.push(fn); }),
    on: vi.fn().mockImplementation((event, fn) => {
      if (event === 'connection') connectionHandlers.push(fn);
    }),
    to: toFn,
    emit: emitFn,
    _middlewares: middlewares,
    _connectionHandlers: connectionHandlers,
    _triggerConnection: (socket: ReturnType<typeof makeSocket>) => {
      connectionHandlers.forEach(fn => fn(socket));
    },
    _runMiddleware: (socket: ReturnType<typeof makeSocket>, next: (err?: Error) => void) => {
      middlewares.forEach(fn => fn(socket, next));
    },
  };
  return io;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WebSocketService constructor', () => {
  it('sets up auth middleware via io.use', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);
    expect(io.use).toHaveBeenCalledTimes(1);
  });

  it('sets up connection handler via io.on', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);
    expect(io.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('logs initialised message', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);
    expect(mockLogger.info).toHaveBeenCalledWith('WebSocket server initialised');
  });
});

describe('WebSocketService auth middleware', () => {
  it('sets userId and calls next() for valid token from auth.token', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    mockAuthService.verifyAccessToken.mockReturnValue({ userId: 'user-1', walletAddress: 'EQD' });

    const socket = makeSocket({ handshake: { auth: { token: 'valid-token' }, headers: {} } });
    const next = vi.fn();

    io._runMiddleware(socket as unknown as ReturnType<typeof makeSocket>, next);

    expect(mockAuthService.verifyAccessToken).toHaveBeenCalledWith('valid-token');
    expect((socket as { userId?: string }).userId).toBe('user-1');
    expect(next).toHaveBeenCalledWith(); // no error
  });

  it('sets userId from Authorization header', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    mockAuthService.verifyAccessToken.mockReturnValue({ userId: 'user-2', walletAddress: 'EQD' });

    const socket = makeSocket({
      handshake: { auth: {}, headers: { authorization: 'Bearer header-token' } },
    });
    const next = vi.fn();

    io._runMiddleware(socket as unknown as ReturnType<typeof makeSocket>, next);

    expect(mockAuthService.verifyAccessToken).toHaveBeenCalledWith('header-token');
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(Error) when token is missing', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const socket = makeSocket({ handshake: { auth: {}, headers: {} } });
    const next = vi.fn();

    io._runMiddleware(socket as unknown as ReturnType<typeof makeSocket>, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    const err = next.mock.calls[0][0] as Error;
    expect(err.message).toBe('Authentication required');
  });

  it('calls next(Error) when token is invalid', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    mockAuthService.verifyAccessToken.mockImplementation(() => {
      throw new Error('jwt malformed');
    });

    const socket = makeSocket({ handshake: { auth: { token: 'bad-token' }, headers: {} } });
    const next = vi.fn();

    io._runMiddleware(socket as unknown as ReturnType<typeof makeSocket>, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    const err = next.mock.calls[0][0] as Error;
    expect(err.message).toBe('Invalid token');
  });
});

describe('WebSocketService connection handler', () => {
  it('registers all 5 handler functions on connection', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const socket = makeSocket();
    (socket as { userId: string }).userId = 'user-1';
    io._triggerConnection(socket as unknown as ReturnType<typeof makeSocket>);

    expect(mockRegisterUserHandlers).toHaveBeenCalledWith(socket);
    expect(mockRegisterGameHandlers).toHaveBeenCalledWith(io, socket);
    expect(mockRegisterAiGameHandlers).toHaveBeenCalledWith(io, socket);
    expect(mockRegisterTournamentLobbyHandlers).toHaveBeenCalledWith(io, socket);
    expect(mockRegisterTournamentBracketHandlers).toHaveBeenCalledWith(socket);
  });

  it('registers disconnect handler', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const socket = makeSocket();
    (socket as { userId: string }).userId = 'user-1';
    io._triggerConnection(socket as unknown as ReturnType<typeof makeSocket>);

    expect(socket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });

  it('registers socket.use for rate limiting', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const socket = makeSocket();
    (socket as { userId: string }).userId = 'user-1';
    io._triggerConnection(socket as unknown as ReturnType<typeof makeSocket>);

    expect(socket.use).toHaveBeenCalledTimes(1);
  });
});

describe('WebSocketService disconnect handler', () => {
  it('leaves all rooms on disconnect', () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const rooms = new Set(['socket-1', 'game:g1', 'user:u1']);
    const socket = makeSocket({ rooms });
    (socket as { userId: string }).userId = 'user-1';
    io._triggerConnection(socket as unknown as ReturnType<typeof makeSocket>);

    // Find and call the disconnect handler
    const disconnectCall = socket.on.mock.calls.find(([event]) => event === 'disconnect');
    expect(disconnectCall).toBeDefined();
    const disconnectHandler = disconnectCall![1] as (reason: string) => void;
    disconnectHandler('transport close');

    expect(socket.leave).toHaveBeenCalledWith('socket-1');
    expect(socket.leave).toHaveBeenCalledWith('game:g1');
    expect(socket.leave).toHaveBeenCalledWith('user:u1');
  });
});

describe('WebSocketService rate limiting', () => {
  function getSocketUseHandler(socket: ReturnType<typeof makeSocket>) {
    const useCall = socket.use.mock.calls[0];
    return useCall[0] as ([event]: [string], next: () => void) => void;
  }

  it('allows through when under general rate limit', async () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const socket = makeSocket();
    (socket as { userId: string }).userId = 'user-1';
    io._triggerConnection(socket as unknown as ReturnType<typeof makeSocket>);

    mockRedis.incr.mockResolvedValue(1); // first event in window
    mockRedis.expire.mockResolvedValue(1);

    const handler = getSocketUseHandler(socket);
    const next = vi.fn();
    handler(['some.event'], next);

    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalled();
  });

  it('drops event when general rate limit exceeded (no next call)', async () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const socket = makeSocket();
    (socket as { userId: string }).userId = 'user-1';
    io._triggerConnection(socket as unknown as ReturnType<typeof makeSocket>);

    mockRedis.incr.mockResolvedValue(11); // over limit of 10
    mockRedis.expire.mockResolvedValue(1);

    const handler = getSocketUseHandler(socket);
    const next = vi.fn();
    handler(['some.event'], next);

    await vi.advanceTimersByTimeAsync(0);
    expect(next).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('WS rate limit exceeded'),
    );
  });

  it('emits game.move_invalid when move rate limit exceeded', async () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const socket = makeSocket();
    (socket as { userId: string }).userId = 'user-1';
    io._triggerConnection(socket as unknown as ReturnType<typeof makeSocket>);

    // General limit OK, move limit exceeded
    mockRedis.incr
      .mockResolvedValueOnce(1)  // general count
      .mockResolvedValueOnce(4); // move count > 3
    mockRedis.expire.mockResolvedValue(1);

    const handler = getSocketUseHandler(socket);
    const next = vi.fn();
    handler(['game.move'], next);

    await vi.advanceTimersByTimeAsync(0);
    expect(next).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('game.move_invalid', {
      reason: 'Too many moves — slow down',
    });
  });

  it('allows through on Redis error (general)', async () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const socket = makeSocket();
    (socket as { userId: string }).userId = 'user-1';
    io._triggerConnection(socket as unknown as ReturnType<typeof makeSocket>);

    mockRedis.incr.mockRejectedValue(new Error('Redis down'));

    const handler = getSocketUseHandler(socket);
    const next = vi.fn();
    handler(['some.event'], next);

    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalled();
  });

  it('allows through on Redis error (move)', async () => {
    const io = makeIo();
    new WebSocketService(io as unknown as import('socket.io').Server);

    const socket = makeSocket();
    (socket as { userId: string }).userId = 'user-1';
    io._triggerConnection(socket as unknown as ReturnType<typeof makeSocket>);

    mockRedis.incr
      .mockResolvedValueOnce(1)  // general OK
      .mockRejectedValueOnce(new Error('Redis down')); // move fails
    mockRedis.expire.mockResolvedValue(1);

    const handler = getSocketUseHandler(socket);
    const next = vi.fn();
    handler(['game.move'], next);

    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalled();
  });
});

describe('WebSocketService.emitToGame', () => {
  it('calls io.to(game:{gameId}).emit(event, data)', () => {
    const io = makeIo();
    const service = new WebSocketService(io as unknown as import('socket.io').Server);

    service.emitToGame('game-123', 'game.tick', { remaining: 5000 });

    expect(io.to).toHaveBeenCalledWith('game:game-123');
    expect(io.emit).toHaveBeenCalledWith('game.tick', { remaining: 5000 });
  });
});

describe('WebSocketService.emitToUser', () => {
  it('calls io.to(user:{userId}).emit(event, data)', () => {
    const io = makeIo();
    const service = new WebSocketService(io as unknown as import('socket.io').Server);

    service.emitToUser('user-456', 'user.balance_updated', { available: '10.0' });

    expect(io.to).toHaveBeenCalledWith('user:user-456');
    expect(io.emit).toHaveBeenCalledWith('user.balance_updated', { available: '10.0' });
  });
});

describe('WebSocketService.getServer', () => {
  it('returns the io instance', () => {
    const io = makeIo();
    const service = new WebSocketService(io as unknown as import('socket.io').Server);

    expect(service.getServer()).toBe(io);
  });
});
