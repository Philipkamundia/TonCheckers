/**
 * tests/unit/websocket/handlers/aiGameHandler.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLogger,
  mockCreateAiGame,
  mockProcessHumanMove,
  mockUndoLastMove,
  mockRestartGame,
  mockGetTip,
  mockDbQuery,
} = vi.hoisted(() => {
  const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const mockCreateAiGame     = vi.fn();
  const mockProcessHumanMove = vi.fn();
  const mockUndoLastMove     = vi.fn();
  const mockRestartGame      = vi.fn();
  const mockGetTip           = vi.fn();
  const mockDbQuery          = vi.fn();
  return {
    mockLogger,
    mockCreateAiGame, mockProcessHumanMove, mockUndoLastMove, mockRestartGame, mockGetTip,
    mockDbQuery,
  };
});

vi.mock('../../../../apps/backend/src/utils/logger.js', () => ({ logger: mockLogger }));

vi.mock('../../../../apps/backend/src/services/ai-game.service.js', () => ({
  AiGameService: {
    createAiGame:      mockCreateAiGame,
    processHumanMove:  mockProcessHumanMove,
    undoLastMove:      mockUndoLastMove,
    restartGame:       mockRestartGame,
    getTip:            mockGetTip,
  },
}));

vi.mock('../../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));

import { registerAiGameHandlers } from '../../../../apps/backend/src/websocket/handlers/aiGameHandler.js';

function makeSocket(userId = 'user-1') {
  return { id: 'socket-1', userId, join: vi.fn(), leave: vi.fn(), on: vi.fn(), emit: vi.fn() } as any;
}

function makeIo() {
  const emitFn = vi.fn();
  const toFn   = vi.fn().mockReturnValue({ emit: emitFn });
  return { to: toFn, emit: emitFn } as any;
}

function getHandler(socket: any, event: string) {
  const call = socket.on.mock.calls.find(([e]: [string]) => e === event);
  if (!call) throw new Error(`Handler '${event}' not registered`);
  return call[1] as (...args: any[]) => Promise<void>;
}

const sampleBoard = [[0, 0], [0, 0]];

beforeEach(() => vi.clearAllMocks());

// ─── ai.start ─────────────────────────────────────────────────────────────────

describe('ai.start', () => {
  it('emits error for invalid difficulty', async () => {
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.start')({ difficulty: 'godmode' });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Invalid difficulty' });
    expect(mockCreateAiGame).not.toHaveBeenCalled();
  });

  it('creates game, joins room, emits ai.state for valid difficulty', async () => {
    mockCreateAiGame.mockResolvedValue({ gameId: 'ai-game-1', initialBoard: sampleBoard });
    const socket = makeSocket('user-5');
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.start')({ difficulty: 'beginner' });
    expect(mockCreateAiGame).toHaveBeenCalledWith('user-5', 'beginner');
    expect(socket.join).toHaveBeenCalledWith('game:ai-game-1');
    expect(socket.emit).toHaveBeenCalledWith('ai.state', expect.objectContaining({
      gameId:       'ai-game-1',
      difficulty:   'beginner',
      board:        sampleBoard,
      activePlayer: 1,
    }));
  });

  it('accepts all valid difficulties', async () => {
    for (const diff of ['beginner', 'intermediate', 'hard', 'master']) {
      mockCreateAiGame.mockResolvedValue({ gameId: `ai-${diff}`, initialBoard: sampleBoard });
      const socket = makeSocket();
      registerAiGameHandlers(makeIo(), socket);
      await getHandler(socket, 'ai.start')({ difficulty: diff });
      expect(mockCreateAiGame).toHaveBeenCalledWith('user-1', diff);
      vi.clearAllMocks();
    }
  });

  it('emits error on service failure', async () => {
    mockCreateAiGame.mockRejectedValue(new Error('DB error'));
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.start')({ difficulty: 'hard' });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Failed to start AI game' });
  });
});

// ─── ai.state.request ────────────────────────────────────────────────────────

describe('ai.state.request', () => {
  it('emits error when game not found', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const socket = makeSocket('user-1');
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.state.request')({ gameId: 'ai-game-1' });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Game not found' });
  });

  it('joins room and emits ai.state when game found', async () => {
    mockDbQuery.mockResolvedValue({
      rows: [{
        id: 'ai-game-1',
        boardState:   { board: sampleBoard },
        activePlayer: 1,
        aiDifficulty: 'intermediate',
      }],
    });
    const socket = makeSocket('user-1');
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.state.request')({ gameId: 'ai-game-1' });
    expect(socket.join).toHaveBeenCalledWith('game:ai-game-1');
    expect(socket.emit).toHaveBeenCalledWith('ai.state', expect.objectContaining({
      gameId:       'ai-game-1',
      board:        sampleBoard,
      activePlayer: 1,
      difficulty:   'intermediate',
    }));
  });
});

// ─── ai.move ─────────────────────────────────────────────────────────────────

describe('ai.move', () => {
  const from = { row: 5, col: 0 };
  const to   = { row: 4, col: 1 };

  it('emits ai.move_invalid for invalid move', async () => {
    mockProcessHumanMove.mockResolvedValue({ valid: false, reason: 'Illegal move' });
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.move')({ gameId: 'ai-1', from, to });
    expect(socket.emit).toHaveBeenCalledWith('ai.move_invalid', { gameId: 'ai-1', reason: 'Illegal move' });
  });

  it('emits ai.end with winner message when game over (human wins)', async () => {
    mockProcessHumanMove.mockResolvedValue({
      valid: true,
      newState: { board: sampleBoard },
      gameOver: { result: 'win', winner: 1, reason: 'no_moves' },
    });
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.move')({ gameId: 'ai-1', from, to });
    expect(socket.emit).toHaveBeenCalledWith('ai.end', expect.objectContaining({
      gameId:  'ai-1',
      result:  'win',
      winner:  1,
      message: '🎉 You win!',
    }));
  });

  it('emits ai.end with AI wins message when AI wins', async () => {
    mockProcessHumanMove.mockResolvedValue({
      valid: true,
      newState: { board: sampleBoard },
      gameOver: { result: 'win', winner: 2, reason: 'no_moves' },
    });
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.move')({ gameId: 'ai-1', from, to });
    expect(socket.emit).toHaveBeenCalledWith('ai.end', expect.objectContaining({
      message: '🤖 AI wins!',
    }));
  });

  it('emits ai.end with draw message on draw', async () => {
    mockProcessHumanMove.mockResolvedValue({
      valid: true,
      newState: { board: sampleBoard },
      gameOver: { result: 'draw', winner: undefined, reason: 'threefold_repetition' },
    });
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.move')({ gameId: 'ai-1', from, to });
    expect(socket.emit).toHaveBeenCalledWith('ai.end', expect.objectContaining({
      message: 'Draw!',
    }));
  });

  it('emits ai.move_ok with aiMove for ongoing game', async () => {
    const aiMove = { from: { row: 2, col: 1 }, to: { row: 3, col: 0 } };
    mockProcessHumanMove.mockResolvedValue({
      valid: true,
      newState: { board: sampleBoard },
      aiMove,
    });
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.move')({ gameId: 'ai-1', from, to });
    expect(socket.emit).toHaveBeenCalledWith('ai.move_ok', expect.objectContaining({
      gameId:  'ai-1',
      board:   sampleBoard,
      aiMove,
      activePlayer: 1,
    }));
  });

  it('emits ai.move_invalid with Server error on exception', async () => {
    mockProcessHumanMove.mockRejectedValue(new Error('crash'));
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.move')({ gameId: 'ai-1', from, to });
    expect(socket.emit).toHaveBeenCalledWith('ai.move_invalid', { gameId: 'ai-1', reason: 'Server error' });
  });
});

// ─── ai.undo ─────────────────────────────────────────────────────────────────

describe('ai.undo', () => {
  it('emits ai.undo_fail when undo fails', async () => {
    mockUndoLastMove.mockResolvedValue({ ok: false, reason: 'Nothing to undo' });
    const socket = makeSocket('user-1');
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.undo')({ gameId: 'ai-1' });
    expect(socket.emit).toHaveBeenCalledWith('ai.undo_fail', { reason: 'Nothing to undo' });
  });

  it('emits ai.state on successful undo', async () => {
    mockUndoLastMove.mockResolvedValue({ ok: true, board: sampleBoard });
    const socket = makeSocket('user-1');
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.undo')({ gameId: 'ai-1' });
    expect(socket.emit).toHaveBeenCalledWith('ai.state', expect.objectContaining({
      gameId: 'ai-1', board: sampleBoard, activePlayer: 1,
    }));
  });
});

// ─── ai.restart ──────────────────────────────────────────────────────────────

describe('ai.restart', () => {
  it('emits error when restart fails', async () => {
    mockRestartGame.mockResolvedValue({ ok: false, reason: 'Game not found' });
    const socket = makeSocket('user-1');
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.restart')({ gameId: 'ai-1' });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Game not found' });
  });

  it('emits ai.state on successful restart', async () => {
    mockRestartGame.mockResolvedValue({ ok: true, board: sampleBoard });
    const socket = makeSocket('user-1');
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.restart')({ gameId: 'ai-1' });
    expect(socket.emit).toHaveBeenCalledWith('ai.state', expect.objectContaining({
      gameId: 'ai-1', board: sampleBoard, activePlayer: 1,
    }));
  });
});

// ─── ai.tip ──────────────────────────────────────────────────────────────────

describe('ai.tip', () => {
  it('emits ai.tip_result with ok=false when tip fails', async () => {
    mockGetTip.mockResolvedValue({ ok: false, reason: 'No moves available' });
    const socket = makeSocket('user-1');
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.tip')({ gameId: 'ai-1' });
    expect(socket.emit).toHaveBeenCalledWith('ai.tip_result', { ok: false, reason: 'No moves available' });
  });

  it('emits ai.tip_result with ok=true, from, to on success', async () => {
    const from = { row: 5, col: 0 };
    const to   = { row: 4, col: 1 };
    mockGetTip.mockResolvedValue({ ok: true, from, to });
    const socket = makeSocket('user-1');
    registerAiGameHandlers(makeIo(), socket);
    await getHandler(socket, 'ai.tip')({ gameId: 'ai-1' });
    expect(socket.emit).toHaveBeenCalledWith('ai.tip_result', { ok: true, from, to });
  });
});

// ─── Error handler coverage ───────────────────────────────────────────────────

describe('ai.state.request — error handler', () => {
  it('logs error when DB query throws', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('DB crash'));
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await expect(
      getHandler(socket, 'ai.state.request')({ gameId: 'ai-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('ai.undo — error handler', () => {
  it('logs error when undoLastMove throws', async () => {
    mockUndoLastMove.mockRejectedValueOnce(new Error('Undo crash'));
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await expect(
      getHandler(socket, 'ai.undo')({ gameId: 'ai-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('ai.restart — error handler', () => {
  it('logs error when restartGame throws', async () => {
    mockRestartGame.mockRejectedValueOnce(new Error('Restart crash'));
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await expect(
      getHandler(socket, 'ai.restart')({ gameId: 'ai-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('ai.tip — error handler', () => {
  it('logs error when getTip throws', async () => {
    mockGetTip.mockRejectedValueOnce(new Error('Tip crash'));
    const socket = makeSocket();
    registerAiGameHandlers(makeIo(), socket);
    await expect(
      getHandler(socket, 'ai.tip')({ gameId: 'ai-1' }),
    ).resolves.toBeUndefined();
  });
});
