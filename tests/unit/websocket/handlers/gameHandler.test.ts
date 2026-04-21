/**
 * tests/unit/websocket/handlers/gameHandler.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockLogger,
  mockGetGame,
  mockUpdateBoardState,
  mockGetRemainingMs,
  mockStartTimer,
  mockClearTimer,
  mockSettleWin,
  mockSettleDraw,
  mockRoomCreate,
  mockRoomGet,
  mockRoomGetBySocketId,
  mockRoomUpdateSocket,
  mockRoomRemove,
  mockRoomRemoveSocket,
  mockGetAvailableMoves,
  mockApplyMoveWithPromotion,
  mockNextGameState,
  mockHashBoardState,
  mockCheckWinCondition,
  mockAssertGameState,
  mockRedisSet,
  mockRedisGet,
  mockRedisDel,
  mockDbQuery,
} = vi.hoisted(() => {
  const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const mockGetGame          = vi.fn();
  const mockUpdateBoardState = vi.fn();
  const mockGetRemainingMs   = vi.fn();
  const mockStartTimer       = vi.fn();
  const mockClearTimer       = vi.fn();
  const mockSettleWin        = vi.fn();
  const mockSettleDraw       = vi.fn();
  const mockRoomCreate       = vi.fn();
  const mockRoomGet          = vi.fn();
  const mockRoomGetBySocketId = vi.fn();
  const mockRoomUpdateSocket = vi.fn();
  const mockRoomRemove       = vi.fn();
  const mockRoomRemoveSocket = vi.fn();
  const mockGetAvailableMoves       = vi.fn();
  const mockApplyMoveWithPromotion  = vi.fn();
  const mockNextGameState           = vi.fn();
  const mockHashBoardState          = vi.fn();
  const mockCheckWinCondition       = vi.fn();
  const mockAssertGameState         = vi.fn();
  const mockRedisSet = vi.fn();
  const mockRedisGet = vi.fn();
  const mockRedisDel = vi.fn();
  const mockDbQuery  = vi.fn();
  return {
    mockLogger,
    mockGetGame, mockUpdateBoardState,
    mockGetRemainingMs, mockStartTimer, mockClearTimer,
    mockSettleWin, mockSettleDraw,
    mockRoomCreate, mockRoomGet, mockRoomGetBySocketId,
    mockRoomUpdateSocket, mockRoomRemove, mockRoomRemoveSocket,
    mockGetAvailableMoves, mockApplyMoveWithPromotion,
    mockNextGameState, mockHashBoardState, mockCheckWinCondition,
    mockAssertGameState,
    mockRedisSet, mockRedisGet, mockRedisDel,
    mockDbQuery,
  };
});

vi.mock('../../../../apps/backend/src/utils/logger.js', () => ({ logger: mockLogger }));

vi.mock('../../../../apps/backend/src/services/game.service.js', () => ({
  GameService: { getGame: mockGetGame, updateBoardState: mockUpdateBoardState },
}));

vi.mock('../../../../apps/backend/src/services/game-timer.service.js', () => ({
  GameTimerService: {
    getRemainingMs: mockGetRemainingMs,
    startTimer:     mockStartTimer,
    clearTimer:     mockClearTimer,
  },
}));

vi.mock('../../../../apps/backend/src/services/settlement.service.js', () => ({
  SettlementService: { settleWin: mockSettleWin, settleDraw: mockSettleDraw },
}));

vi.mock('../../../../apps/backend/src/websocket/rooms/gameRoom.js', () => ({
  GameRoomManager: {
    create:          mockRoomCreate,
    get:             mockRoomGet,
    getBySocketId:   mockRoomGetBySocketId,
    updateSocket:    mockRoomUpdateSocket,
    remove:          mockRoomRemove,
    removeSocket:    mockRoomRemoveSocket,
  },
}));

vi.mock('../../../../apps/backend/src/engine/index.js', () => ({
  getAvailableMoves:      mockGetAvailableMoves,
  applyMoveWithPromotion: mockApplyMoveWithPromotion,
  nextGameState:          mockNextGameState,
  hashBoardState:         mockHashBoardState,
  checkWinCondition:      mockCheckWinCondition,
}));

vi.mock('../../../../apps/backend/src/validation/gameState.js', () => ({
  assertGameState: mockAssertGameState,
}));

vi.mock('../../../../apps/backend/src/config/redis.js', () => ({
  default: { set: mockRedisSet, get: mockRedisGet, del: mockRedisDel },
}));

vi.mock('../../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));

import { registerGameHandlers } from '../../../../apps/backend/src/websocket/handlers/gameHandler.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSocket(userId = 'player-1', socketId = 'socket-1') {
  return { id: socketId, userId, join: vi.fn(), leave: vi.fn(), on: vi.fn(), emit: vi.fn() } as any;
}

function makeIo() {
  const emitFn = vi.fn();
  const toFn   = vi.fn().mockReturnValue({ emit: emitFn });
  return { to: toFn, emit: emitFn, _toEmit: emitFn } as any;
}

function getHandler(socket: any, event: string) {
  const call = socket.on.mock.calls.find(([e]: [string]) => e === event);
  if (!call) throw new Error(`Handler '${event}' not registered`);
  return call[1] as (...args: any[]) => Promise<void>;
}

function makeGame(overrides: Record<string, any> = {}) {
  return {
    id:           'game-1',
    status:       'active',
    player1Id:    'player-1',
    player2Id:    'player-2',
    stake:        '1.0',
    activePlayer: 1,
    boardState: {
      board:            [[]],
      activePlayer:     1,
      boardHashHistory: [],
      moveCount:        0,
      movesSinceCapture: 0,
    },
    ...overrides,
  };
}

function makeSettleResult(overrides: Record<string, any> = {}) {
  return {
    gameId:       'game-1',
    winnerId:     'player-2',
    loserId:      'player-1',
    stake:        '1.0',
    prizePool:    '2.0',
    platformFee:  '0.3',
    winnerPayout: '1.7',
    alreadySettled: false,
    eloChanges: {
      winner: { before: 1000, after: 1016, delta: 16 },
      loser:  { before: 1000, after: 984,  delta: -16 },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default passthrough for assertGameState
  mockAssertGameState.mockImplementation((s: any) => s);
  mockGetRemainingMs.mockResolvedValue(25_000);
  mockStartTimer.mockResolvedValue(undefined);
  mockClearTimer.mockResolvedValue(undefined);
  mockUpdateBoardState.mockResolvedValue(undefined);
});

// ─── game.subscribe ───────────────────────────────────────────────────────────

describe('game.subscribe', () => {
  it('emits error when game not found', async () => {
    mockGetGame.mockResolvedValue(null);
    const socket = makeSocket();
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.subscribe')({ gameId: 'game-1' });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Game not found' });
  });

  it('emits error when user is not a participant', async () => {
    mockGetGame.mockResolvedValue(makeGame({ player1Id: 'other-1', player2Id: 'other-2' }));
    const socket = makeSocket('stranger');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.subscribe')({ gameId: 'game-1' });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not a participant' });
  });

  it('creates room and joins socket for active game with no existing room', async () => {
    mockGetGame.mockResolvedValue(makeGame({ status: 'active' }));
    mockRoomGet.mockReturnValue(undefined);
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.subscribe')({ gameId: 'game-1' });
    expect(mockRoomCreate).toHaveBeenCalledWith(expect.objectContaining({
      gameId:    'game-1',
      player1Id: 'player-1',
      player2Id: 'player-2',
    }));
    expect(socket.join).toHaveBeenCalledWith('game:game-1');
    expect(socket.emit).toHaveBeenCalledWith('game.state', expect.objectContaining({ gameId: 'game-1' }));
  });

  it('updates socket for active game with existing room', async () => {
    mockGetGame.mockResolvedValue(makeGame({ status: 'active' }));
    mockRoomGet.mockReturnValue({ gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2' });
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.subscribe')({ gameId: 'game-1' });
    expect(mockRoomUpdateSocket).toHaveBeenCalledWith('game-1', 'player-1', 'socket-1');
    expect(socket.join).toHaveBeenCalledWith('game:game-1');
  });

  it('emits game.state for completed game but does NOT join room', async () => {
    mockGetGame.mockResolvedValue(makeGame({ status: 'completed' }));
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.subscribe')({ gameId: 'game-1' });
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('game.state', expect.objectContaining({ status: 'completed' }));
  });

  it('emits game.crashed for crashed game', async () => {
    mockGetGame.mockResolvedValue(makeGame({ status: 'crashed' }));
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.subscribe')({ gameId: 'game-1' });
    expect(socket.emit).toHaveBeenCalledWith('game.crashed', { gameId: 'game-1' });
  });

  it('cancels pending disconnect timer and notifies opponent on reconnect', async () => {
    mockGetGame.mockResolvedValue(makeGame({ status: 'active' }));
    mockRoomGet.mockReturnValue({
      gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2',
      player1SocketId: null, player2SocketId: 'socket-2',
    });

    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);

    // First: trigger disconnect to set a timer
    mockRoomGetBySocketId.mockReturnValue({
      gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2', stake: '1.0',
    });
    mockGetGame.mockResolvedValueOnce(makeGame({ status: 'active' }))
               .mockResolvedValue(makeGame({ status: 'active' }));

    const disconnectHandler = getHandler(socket, 'disconnect');
    await disconnectHandler();

    // Now subscribe again — should cancel the timer
    await getHandler(socket, 'game.subscribe')({ gameId: 'game-1' });

    // Opponent should be notified of reconnect
    expect(io.to).toHaveBeenCalledWith('user:player-2');
  });
});

// ─── game.move ────────────────────────────────────────────────────────────────

describe('game.move', () => {
  const validFrom = { row: 5, col: 0 };
  const validTo   = { row: 4, col: 1 };
  const validMove = { from: validFrom, to: validTo, captures: [], isChain: false };

  function setupValidMove() {
    const game = makeGame();
    mockGetGame.mockResolvedValue(game);
    mockAssertGameState.mockReturnValue(game.boardState);
    mockGetAvailableMoves.mockReturnValue([validMove]);
    mockApplyMoveWithPromotion.mockReturnValue([[]]);
    mockHashBoardState.mockReturnValue('hash-1');
    mockNextGameState.mockReturnValue({
      board: [[]], activePlayer: 2, boardHashHistory: ['hash-1'], moveCount: 1, movesSinceCapture: 1,
    });
    mockCheckWinCondition.mockReturnValue({ status: 'ongoing' });
  }

  it('emits game.move_invalid when game not active', async () => {
    mockGetGame.mockResolvedValue(null);
    const socket = makeSocket();
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });
    expect(socket.emit).toHaveBeenCalledWith('game.move_invalid', { gameId: 'game-1', reason: 'Game not active' });
  });

  it('emits game.move_invalid for invalid coordinates', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockAssertGameState.mockReturnValue(makeGame().boardState);
    const socket = makeSocket();
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: { row: -1, col: 0 }, to: validTo });
    expect(socket.emit).toHaveBeenCalledWith('game.move_invalid', { gameId: 'game-1', reason: 'Invalid coordinates' });
  });

  it('emits game.move_invalid when not player turn', async () => {
    mockGetGame.mockResolvedValue(makeGame({ activePlayer: 2 }));
    mockAssertGameState.mockReturnValue(makeGame().boardState);
    const socket = makeSocket('player-1'); // player-1 is player 1, but active is 2
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });
    expect(socket.emit).toHaveBeenCalledWith('game.move_invalid', { gameId: 'game-1', reason: 'Not your turn' });
  });

  it('emits game.move_invalid for illegal move', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockAssertGameState.mockReturnValue(makeGame().boardState);
    mockGetAvailableMoves.mockReturnValue([]); // no legal moves
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });
    expect(socket.emit).toHaveBeenCalledWith('game.move_invalid', { gameId: 'game-1', reason: 'Illegal move' });
  });

  it('emits game.move_ok for valid ongoing move', async () => {
    setupValidMove();
    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });
    expect(io.to).toHaveBeenCalledWith('game:game-1');
    expect(io._toEmit).toHaveBeenCalledWith('game.move_ok', expect.objectContaining({ gameId: 'game-1' }));
  });

  it('settles win and emits game.end when player wins', async () => {
    setupValidMove();
    mockCheckWinCondition.mockReturnValue({ status: 'win', winner: 1, reason: 'no_moves' });
    mockSettleWin.mockResolvedValue(makeSettleResult({ winnerId: 'player-1', loserId: 'player-2' }));
    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });
    expect(mockSettleWin).toHaveBeenCalled();
    expect(io._toEmit).toHaveBeenCalledWith('game.end', expect.objectContaining({ result: 'win' }));
    expect(mockRoomRemove).toHaveBeenCalledWith('game-1');
  });

  it('settles draw and emits game.draw on draw condition', async () => {
    setupValidMove();
    mockCheckWinCondition.mockReturnValue({ status: 'draw', reason: 'threefold_repetition' });
    mockSettleDraw.mockResolvedValue({ gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2', stake: '1.0' });
    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });
    expect(mockSettleDraw).toHaveBeenCalled();
    expect(io._toEmit).toHaveBeenCalledWith('game.draw', expect.objectContaining({ gameId: 'game-1' }));
    expect(mockRoomRemove).toHaveBeenCalledWith('game-1');
  });

  it('removes room but does not emit game.end when already settled', async () => {
    setupValidMove();
    mockCheckWinCondition.mockReturnValue({ status: 'win', winner: 1, reason: 'no_moves' });
    mockSettleWin.mockResolvedValue(makeSettleResult({ alreadySettled: true }));
    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });
    expect(mockRoomRemove).toHaveBeenCalledWith('game-1');
    expect(io._toEmit).not.toHaveBeenCalledWith('game.end', expect.anything());
  });

  it('emits game.move_invalid with Server error on exception', async () => {
    mockGetGame.mockRejectedValue(new Error('DB crash'));
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });
    expect(socket.emit).toHaveBeenCalledWith('game.move_invalid', { gameId: 'game-1', reason: 'Server error' });
  });
});

// ─── game.resign ─────────────────────────────────────────────────────────────

describe('game.resign', () => {
  it('is a no-op when game not found', async () => {
    mockGetGame.mockResolvedValue(null);
    const socket = makeSocket();
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.resign')({ gameId: 'game-1' });
    expect(mockSettleWin).not.toHaveBeenCalled();
    expect(io._toEmit).not.toHaveBeenCalled();
  });

  it('is a no-op when user is not a participant', async () => {
    mockGetGame.mockResolvedValue(makeGame({ player1Id: 'other-1', player2Id: 'other-2' }));
    const socket = makeSocket('stranger');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.resign')({ gameId: 'game-1' });
    expect(mockSettleWin).not.toHaveBeenCalled();
  });

  it('settles win and emits game.end on valid resign', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockSettleWin.mockResolvedValue(makeSettleResult({ winnerId: 'player-2', loserId: 'player-1' }));
    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.resign')({ gameId: 'game-1' });
    expect(mockSettleWin).toHaveBeenCalledWith('game-1', 'player-2', 'player-1', 'resign', '1.0', io);
    expect(io._toEmit).toHaveBeenCalledWith('game.end', expect.objectContaining({ reason: 'resign' }));
    expect(mockRoomRemove).toHaveBeenCalledWith('game-1');
  });

  it('is a no-op when already settled', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockSettleWin.mockResolvedValue(makeSettleResult({ alreadySettled: true }));
    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.resign')({ gameId: 'game-1' });
    expect(io._toEmit).not.toHaveBeenCalledWith('game.end', expect.anything());
  });
});

// ─── game.offer_draw ─────────────────────────────────────────────────────────

describe('game.offer_draw', () => {
  it('stores offer in Redis and emits game.draw_offer to opponent', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockDbQuery.mockResolvedValue({ rows: [{ username: 'Alice' }] });
    mockRedisSet.mockResolvedValue('OK');
    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.offer_draw')({ gameId: 'game-1' });
    expect(mockRedisSet).toHaveBeenCalledWith('draw:offer:game-1', 'player-1', 'EX', 60);
    expect(io.to).toHaveBeenCalledWith('user:player-2');
    expect(io._toEmit).toHaveBeenCalledWith('game.draw_offer', expect.objectContaining({
      gameId: 'game-1', fromUserId: 'player-1',
    }));
  });
});

// ─── game.accept_draw ────────────────────────────────────────────────────────

describe('game.accept_draw', () => {
  it('emits error when no pending draw offer', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockRedisGet.mockResolvedValue(null);
    const socket = makeSocket('player-2');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.accept_draw')({ gameId: 'game-1' });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'No pending draw offer' });
  });

  it('emits error when player tries to accept their own offer', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockRedisGet.mockResolvedValue('player-2'); // player-2 offered
    const socket = makeSocket('player-2');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.accept_draw')({ gameId: 'game-1' });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Cannot accept your own draw offer' });
  });

  it('settles draw and emits game.draw on valid accept', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockRedisGet.mockResolvedValue('player-1'); // player-1 offered, player-2 accepts
    mockRedisDel.mockResolvedValue(1);
    mockSettleDraw.mockResolvedValue({ gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2', stake: '1.0' });
    const socket = makeSocket('player-2');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.accept_draw')({ gameId: 'game-1' });
    expect(mockSettleDraw).toHaveBeenCalledWith('game-1', 'player-1', 'player-2', '1.0', io);
    expect(io._toEmit).toHaveBeenCalledWith('game.draw', expect.objectContaining({
      gameId: 'game-1', message: 'Draw agreed — stakes returned in full',
    }));
    expect(mockRoomRemove).toHaveBeenCalledWith('game-1');
  });
});

// ─── game.decline_draw ───────────────────────────────────────────────────────

describe('game.decline_draw', () => {
  it('deletes Redis key and emits game.draw_offer_declined to opponent', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockRedisDel.mockResolvedValue(1);
    const socket = makeSocket('player-2');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.decline_draw')({ gameId: 'game-1' });
    expect(mockRedisDel).toHaveBeenCalledWith('draw:offer:game-1');
    expect(io.to).toHaveBeenCalledWith('user:player-1');
    expect(io._toEmit).toHaveBeenCalledWith('game.draw_offer_declined', { gameId: 'game-1' });
  });
});

// ─── disconnect ───────────────────────────────────────────────────────────────

describe('disconnect', () => {
  it('is a no-op when socket has no room', async () => {
    mockRoomGetBySocketId.mockReturnValue(undefined);
    const socket = makeSocket();
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'disconnect')();
    expect(mockGetGame).not.toHaveBeenCalled();
  });

  it('starts grace timer and notifies opponent for active game', async () => {
    const room = { gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2', stake: '1.0' };
    mockRoomGetBySocketId.mockReturnValue(room);
    mockGetGame.mockResolvedValue(makeGame({ status: 'active' }));
    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'disconnect')();
    expect(io.to).toHaveBeenCalledWith('user:player-2');
    expect(io._toEmit).toHaveBeenCalledWith('game.opponent_disconnected', expect.objectContaining({
      gameId: 'game-1', graceMs: 30_000,
    }));
  });

  it('settles win after 30s grace period expires', async () => {
    vi.useFakeTimers();
    const room = { gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2', stake: '1.0' };
    mockRoomGetBySocketId.mockReturnValue(room);
    mockGetGame.mockResolvedValue(makeGame({ status: 'active' }));
    mockRoomGet.mockReturnValue(null); // player did not reconnect
    mockSettleWin.mockResolvedValue(makeSettleResult({ winnerId: 'player-2', loserId: 'player-1' }));

    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'disconnect')();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockSettleWin).toHaveBeenCalledWith(
      'game-1', 'player-2', 'player-1', 'disconnect', '1.0', io,
    );
    expect(io._toEmit).toHaveBeenCalledWith('game.end', expect.objectContaining({
      reason: 'disconnect', winnerId: 'player-2',
    }));
    vi.useRealTimers();
  });
});

// ─── Additional branch coverage ───────────────────────────────────────────────

describe('game.move — additional branches', () => {
  const validFrom = { row: 5, col: 0 };
  const validTo   = { row: 4, col: 1 };
  const validMove = { from: validFrom, to: validTo, captures: [], isChain: false };

  it('emits game.move_invalid when assertGameState throws (corrupted board)', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockAssertGameState.mockImplementation(() => { throw new Error('Corrupted'); });
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });
    expect(socket.emit).toHaveBeenCalledWith('game.move_invalid', {
      gameId: 'game-1', reason: 'Game state error — please contact support',
    });
  });

  it('emits draw with no_capture_limit message when 50-move rule triggered', async () => {
    const game = makeGame();
    mockGetGame.mockResolvedValue(game);
    mockAssertGameState.mockReturnValue(game.boardState);
    mockGetAvailableMoves.mockReturnValue([validMove]);
    mockApplyMoveWithPromotion.mockReturnValue([[]]);
    mockHashBoardState.mockReturnValue('hash-1');
    mockNextGameState.mockReturnValue({
      board: [[]], activePlayer: 2, boardHashHistory: ['hash-1'], moveCount: 50, movesSinceCapture: 50,
    });
    mockCheckWinCondition.mockReturnValue({ status: 'draw', reason: 'no_capture_limit' });
    mockSettleDraw.mockResolvedValue({ gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2', stake: '1.0' });

    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });

    expect(io._toEmit).toHaveBeenCalledWith('game.draw', expect.objectContaining({
      reason: 'no_capture_limit',
      message: 'Draw — 50 moves without capture. Stakes returned in full.',
    }));
  });

  it('resets movesSinceCapture to 0 when move has captures', async () => {
    const captureMove = { ...validMove, captures: [{ row: 4, col: 1 }] };
    const game = makeGame({ boardState: { ...makeGame().boardState, movesSinceCapture: 10 } });
    mockGetGame.mockResolvedValue(game);
    mockAssertGameState.mockReturnValue(game.boardState);
    mockGetAvailableMoves.mockReturnValue([captureMove]);
    mockApplyMoveWithPromotion.mockReturnValue([[]]);
    mockHashBoardState.mockReturnValue('hash-1');
    mockNextGameState.mockReturnValue({
      board: [[]], activePlayer: 2, boardHashHistory: ['hash-1'], moveCount: 1, movesSinceCapture: 0,
    });
    mockCheckWinCondition.mockReturnValue({ status: 'ongoing' });

    const socket = makeSocket('player-1');
    const io = makeIo();
    registerGameHandlers(io, socket);
    await getHandler(socket, 'game.move')({ gameId: 'game-1', from: validFrom, to: validTo });

    // movesSinceCapture should be 0 (reset by capture)
    expect(mockCheckWinCondition).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), 0,
    );
  });
});

describe('game.resign — error handling', () => {
  it('logs error when settleWin throws', async () => {
    mockGetGame.mockResolvedValue(makeGame());
    mockSettleWin.mockRejectedValueOnce(new Error('Settlement DB error'));
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    // Should not throw
    await expect(
      getHandler(socket, 'game.resign')({ gameId: 'game-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('disconnect — additional branches', () => {
  it('is a no-op when game is not active (already ended)', async () => {
    const room = { gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2', stake: '1.0' };
    mockRoomGetBySocketId.mockReturnValue(room);
    mockGetGame.mockResolvedValue(makeGame({ status: 'completed' }));
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'disconnect')();
    expect(mockSettleWin).not.toHaveBeenCalled();
  });

  it('skips forfeit when no opponent (winnerId is null)', async () => {
    const room = { gameId: 'game-1', player1Id: 'player-1', player2Id: null, stake: '1.0' };
    mockRoomGetBySocketId.mockReturnValue(room);
    mockGetGame.mockResolvedValue(makeGame({ player2Id: null, status: 'active' }));
    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'disconnect')();
    expect(mockSettleWin).not.toHaveBeenCalled();
  });

  it('does not forfeit when player reconnected during grace period', async () => {
    vi.useFakeTimers();
    const room = { gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2', stake: '1.0' };
    mockRoomGetBySocketId.mockReturnValue(room);
    mockGetGame.mockResolvedValue(makeGame({ status: 'active' }));
    // Room shows player1 has a socket (reconnected)
    mockRoomGet.mockReturnValue({ player1Id: 'player-1', player2Id: 'player-2', player1SocketId: 'new-socket', player2SocketId: 'socket-2' });

    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'disconnect')();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockSettleWin).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not forfeit when game ended during grace period', async () => {
    vi.useFakeTimers();
    const room = { gameId: 'game-1', player1Id: 'player-1', player2Id: 'player-2', stake: '1.0' };
    mockRoomGetBySocketId.mockReturnValue(room);
    mockGetGame
      .mockResolvedValueOnce(makeGame({ status: 'active' })) // initial disconnect check
      .mockResolvedValueOnce(makeGame({ status: 'completed' })); // re-check after grace period
    mockRoomGet.mockReturnValue(null);

    const socket = makeSocket('player-1');
    registerGameHandlers(makeIo(), socket);
    await getHandler(socket, 'disconnect')();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockSettleWin).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
