/**
 * tests/unit/services/ai-game.service.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPool,
  mockGameTimerService,
  mockGetAvailableMoves,
  mockApplyMoveWithPromotion,
  mockNextGameState,
  mockHashBoardState,
  mockCheckWinCondition,
  mockInitialGameState,
  mockGetAiMove,
  mockLogger,
} = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockGameTimerService: {
    startTimer: vi.fn(),
    clearTimer: vi.fn(),
  },
  mockGetAvailableMoves: vi.fn(),
  mockApplyMoveWithPromotion: vi.fn(),
  mockNextGameState: vi.fn(),
  mockHashBoardState: vi.fn(),
  mockCheckWinCondition: vi.fn(),
  mockInitialGameState: vi.fn(),
  mockGetAiMove: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: mockPool,
}));

vi.mock('../../../apps/backend/src/services/game-timer.service.js', () => ({
  GameTimerService: mockGameTimerService,
}));

vi.mock('../../../apps/backend/src/engine/index.js', () => ({
  getAvailableMoves: mockGetAvailableMoves,
  applyMoveWithPromotion: mockApplyMoveWithPromotion,
  nextGameState: mockNextGameState,
  hashBoardState: mockHashBoardState,
  checkWinCondition: mockCheckWinCondition,
}));

vi.mock('../../../apps/backend/src/engine/board.js', () => ({
  initialGameState: mockInitialGameState,
}));

vi.mock('../../../apps/backend/src/engine/ai/index.js', () => ({
  getAiMove: mockGetAiMove,
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { AiGameService } from '../../../apps/backend/src/services/ai-game.service.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const mockBoard = [[1, 0], [0, 2]];
const mockState = {
  board: mockBoard,
  activePlayer: 1,
  boardHashHistory: [],
  moveCount: 0,
  movesSinceCapture: 0,
};

const mockIo = {} as import('socket.io').Server;

beforeEach(() => {
  vi.clearAllMocks();

  // Default engine mocks
  mockInitialGameState.mockReturnValue({ ...mockState });
  mockGetAvailableMoves.mockReturnValue([]);
  mockApplyMoveWithPromotion.mockReturnValue(mockBoard);
  mockNextGameState.mockReturnValue({ ...mockState, moveCount: 1 });
  mockHashBoardState.mockReturnValue('hash-1');
  mockCheckWinCondition.mockReturnValue({ status: 'ongoing' });
  mockGetAiMove.mockReturnValue(null);
  mockGameTimerService.startTimer.mockResolvedValue(undefined);
  mockGameTimerService.clearTimer.mockResolvedValue(undefined);
});

// ─── createAiGame ─────────────────────────────────────────────────────────────

describe('AiGameService.createAiGame', () => {
  it('inserts game, starts timer, returns gameId and initialBoard', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'game-ai-1' }] });

    const result = await AiGameService.createAiGame('user-1', 'easy');

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO games'),
      expect.arrayContaining(['user-1', expect.anything(), 'easy']),
    );
    expect(mockGameTimerService.startTimer).toHaveBeenCalledWith('game-ai-1', 1);
    expect(result.gameId).toBe('game-ai-1');
    expect(result.initialBoard).toBe(mockBoard);
  });

  it('uses initialGameState to create the board', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'game-ai-2' }] });

    await AiGameService.createAiGame('user-1', 'hard');

    expect(mockInitialGameState).toHaveBeenCalledTimes(1);
  });
});

// ─── processHumanMove ─────────────────────────────────────────────────────────

describe('AiGameService.processHumanMove — game not found', () => {
  it('returns valid=false when game not found', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await AiGameService.processHumanMove(
      'game-1', { row: 5, col: 0 }, { row: 4, col: 1 }, mockIo,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Game not found or not active');
  });
});

describe('AiGameService.processHumanMove — not player turn', () => {
  it('returns valid=false when activePlayer is 2', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'game-1', boardState: mockState, activePlayer: 2, aiDifficulty: 'easy', player1Id: 'user-1' }],
    });

    const result = await AiGameService.processHumanMove(
      'game-1', { row: 5, col: 0 }, { row: 4, col: 1 }, mockIo,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Not your turn');
  });
});

describe('AiGameService.processHumanMove — invalid coordinates', () => {
  const cases = [
    { from: { row: -1, col: 0 }, to: { row: 4, col: 1 }, label: 'negative row' },
    { from: { row: 5, col: 8 }, to: { row: 4, col: 1 }, label: 'col out of bounds' },
    { from: { row: 5, col: 0 }, to: { row: 4, col: -1 }, label: 'negative to.col' },
    { from: { row: 1.5, col: 0 }, to: { row: 4, col: 1 }, label: 'non-integer row' },
  ];

  for (const { from, to, label } of cases) {
    it(`returns valid=false for ${label}`, async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'game-1', boardState: mockState, activePlayer: 1, aiDifficulty: 'easy', player1Id: 'user-1' }],
      });

      const result = await AiGameService.processHumanMove('game-1', from, to, mockIo);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid coordinates');
    });
  }
});

describe('AiGameService.processHumanMove — illegal move', () => {
  it('returns valid=false when move not in legal moves', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'game-1', boardState: mockState, activePlayer: 1, aiDifficulty: 'easy', player1Id: 'user-1' }],
    });
    // No legal moves available
    mockGetAvailableMoves.mockReturnValue([]);

    const result = await AiGameService.processHumanMove(
      'game-1', { row: 5, col: 0 }, { row: 4, col: 1 }, mockIo,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Illegal move');
  });
});

describe('AiGameService.processHumanMove — human wins after move', () => {
  it('returns gameOver with winner when human wins', async () => {
    const gameRow = {
      id: 'game-1', boardState: mockState, activePlayer: 1,
      aiDifficulty: 'easy', player1Id: 'user-1',
    };

    const legalMove = {
      from: { row: 5, col: 0 }, to: { row: 4, col: 1 },
      captures: [], isChain: false,
    };
    mockGetAvailableMoves.mockReturnValue([legalMove]);
    mockApplyMoveWithPromotion.mockReturnValue(mockBoard);
    mockHashBoardState.mockReturnValue('hash-after-human');
    mockNextGameState.mockReturnValue({ ...mockState, moveCount: 1 });
    // Human wins
    mockCheckWinCondition.mockReturnValueOnce({ status: 'win', winner: 1, reason: 'no_pieces' });

    mockPool.query
      .mockResolvedValueOnce({ rows: [gameRow] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await AiGameService.processHumanMove(
      'game-1', { row: 5, col: 0 }, { row: 4, col: 1 }, mockIo,
    );

    expect(result.valid).toBe(true);
    expect(result.gameOver).toBeDefined();
    expect(result.gameOver!.result).toBe('win');
    expect(result.gameOver!.winner).toBe(1);
    expect(mockGameTimerService.clearTimer).toHaveBeenCalledWith('game-1');
  });
});

describe('AiGameService.processHumanMove — AI has no moves', () => {
  it('returns human wins when AI has no moves', async () => {
    const gameRow = {
      id: 'game-1', boardState: mockState, activePlayer: 1,
      aiDifficulty: 'easy', player1Id: 'user-1',
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [gameRow] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const legalMove = {
      from: { row: 5, col: 0 }, to: { row: 4, col: 1 },
      captures: [], isChain: false,
    };
    mockGetAvailableMoves.mockReturnValue([legalMove]);
    mockApplyMoveWithPromotion.mockReturnValue(mockBoard);
    mockHashBoardState.mockReturnValue('hash-1');
    mockNextGameState.mockReturnValue({ ...mockState, moveCount: 1 });
    // Human move doesn't end game
    mockCheckWinCondition.mockReturnValueOnce({ status: 'ongoing' });
    // AI has no moves
    mockGetAiMove.mockReturnValue(null);

    // Start the async operation and advance timers concurrently
    const resultPromise = AiGameService.processHumanMove(
      'game-1', { row: 5, col: 0 }, { row: 4, col: 1 }, mockIo,
    );

    // Advance past the 2s AI thinking delay
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result.valid).toBe(true);
    expect(result.gameOver).toBeDefined();
    expect(result.gameOver!.winner).toBe(1);
    expect(result.gameOver!.reason).toBe('no_moves');
  });
});

describe('AiGameService.processHumanMove — normal move', () => {
  it('returns valid=true with aiMove when game continues', async () => {
    const gameRow = {
      id: 'game-1', boardState: mockState, activePlayer: 1,
      aiDifficulty: 'easy', player1Id: 'user-1',
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [gameRow] })  // SELECT
      .mockResolvedValueOnce({ rows: [] });          // UPDATE after AI move

    const legalMove = {
      from: { row: 5, col: 0 }, to: { row: 4, col: 1 },
      captures: [], isChain: false,
    };
    const aiMoveResult = {
      from: { row: 2, col: 1 }, to: { row: 3, col: 0 },
      captures: [], isChain: false,
    };
    mockGetAvailableMoves.mockReturnValue([legalMove]);
    mockApplyMoveWithPromotion.mockReturnValue(mockBoard);
    mockHashBoardState.mockReturnValue('hash-1');
    mockNextGameState.mockReturnValue({ ...mockState, moveCount: 1 });
    mockCheckWinCondition.mockReturnValue({ status: 'ongoing' });
    mockGetAiMove.mockReturnValue(aiMoveResult);

    const resultPromise = AiGameService.processHumanMove(
      'game-1', { row: 5, col: 0 }, { row: 4, col: 1 }, mockIo,
    );

    // Advance past the 2s AI thinking delay
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result.valid).toBe(true);
    expect(result.aiMove).toEqual({ from: { row: 2, col: 1 }, to: { row: 3, col: 0 } });
    expect(result.gameOver).toBeUndefined();
  });
});

describe('AiGameService.processHumanMove — AI wins after its move', () => {
  it('returns gameOver when AI wins', async () => {
    const gameRow = {
      id: 'game-1', boardState: mockState, activePlayer: 1,
      aiDifficulty: 'easy', player1Id: 'user-1',
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [gameRow] })  // SELECT
      .mockResolvedValueOnce({ rows: [] })           // UPDATE board state
      .mockResolvedValueOnce({ rows: [] });           // UPDATE status=completed

    const legalMove = {
      from: { row: 5, col: 0 }, to: { row: 4, col: 1 },
      captures: [], isChain: false,
    };
    const aiMoveResult = {
      from: { row: 2, col: 1 }, to: { row: 3, col: 0 },
      captures: [], isChain: false,
    };
    mockGetAvailableMoves.mockReturnValue([legalMove]);
    mockApplyMoveWithPromotion.mockReturnValue(mockBoard);
    mockHashBoardState.mockReturnValue('hash-1');
    mockNextGameState.mockReturnValue({ ...mockState, moveCount: 1 });
    // Human move: ongoing; AI move: AI wins
    mockCheckWinCondition
      .mockReturnValueOnce({ status: 'ongoing' })
      .mockReturnValueOnce({ status: 'win', winner: 2, reason: 'no_pieces' });
    mockGetAiMove.mockReturnValue(aiMoveResult);

    const resultPromise = AiGameService.processHumanMove(
      'game-1', { row: 5, col: 0 }, { row: 4, col: 1 }, mockIo,
    );

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result.valid).toBe(true);
    expect(result.gameOver).toBeDefined();
    expect(result.gameOver!.winner).toBe(2);
    expect(mockGameTimerService.clearTimer).toHaveBeenCalledWith('game-1');
  });
});

// ─── undoLastMove ─────────────────────────────────────────────────────────────

describe('AiGameService.undoLastMove', () => {
  it('returns ok=false when game not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await AiGameService.undoLastMove('game-1', 'user-1');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Game not found');
  });

  it('returns ok=false when no prevState', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ boardState: { ...mockState, prevState: undefined }, player1Id: 'user-1' }],
    });

    const result = await AiGameService.undoLastMove('game-1', 'user-1');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Nothing to undo');
  });

  it('returns ok=true and restores prevState on success', async () => {
    const prevState = { ...mockState, moveCount: 0, board: [[0, 1], [2, 0]] };
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ boardState: { ...mockState, prevState }, player1Id: 'user-1' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await AiGameService.undoLastMove('game-1', 'user-1');

    expect(result.ok).toBe(true);
    expect(result.board).toBe(prevState.board);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE games'),
      expect.arrayContaining([prevState, prevState.moveCount, 'game-1']),
    );
    expect(mockGameTimerService.startTimer).toHaveBeenCalledWith('game-1', 1);
  });

  it('returns ok=false when userId does not match player1Id', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ boardState: mockState, player1Id: 'other-user' }],
    });

    const result = await AiGameService.undoLastMove('game-1', 'user-1');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Game not found');
  });
});

// ─── restartGame ──────────────────────────────────────────────────────────────

describe('AiGameService.restartGame', () => {
  it('returns ok=false when game not found', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await AiGameService.restartGame('game-1', 'user-1');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Game not found');
  });

  it('returns ok=false when userId does not match', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ player1Id: 'other-user', aiDifficulty: 'easy' }],
    });

    const result = await AiGameService.restartGame('game-1', 'user-1');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Game not found');
  });

  it('resets to initial state and returns ok=true with board', async () => {
    const freshState = { ...mockState, moveCount: 0 };
    mockInitialGameState.mockReturnValue(freshState);
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ player1Id: 'user-1', aiDifficulty: 'easy' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await AiGameService.restartGame('game-1', 'user-1');

    expect(result.ok).toBe(true);
    expect(result.board).toBe(freshState.board);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE games'),
      expect.arrayContaining([freshState, 'game-1']),
    );
    expect(mockGameTimerService.startTimer).toHaveBeenCalledWith('game-1', 1);
  });
});

// ─── getTip ───────────────────────────────────────────────────────────────────

describe('AiGameService.getTip', () => {
  it('returns ok=false when game not found', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await AiGameService.getTip('game-1', 'user-1');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Game not found');
  });

  it('returns ok=false when userId does not match', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ boardState: mockState, player1Id: 'other-user', aiDifficulty: 'easy' }],
    });

    const result = await AiGameService.getTip('game-1', 'user-1');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Game not found');
  });

  it('returns ok=false when no moves available', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ boardState: mockState, player1Id: 'user-1', aiDifficulty: 'easy' }],
    });
    mockGetAiMove.mockReturnValue(null);

    const result = await AiGameService.getTip('game-1', 'user-1');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('No moves available');
  });

  it('returns ok=true with from/to coordinates on success', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ boardState: mockState, player1Id: 'user-1', aiDifficulty: 'easy' }],
    });
    mockGetAiMove.mockReturnValue({
      from: { row: 5, col: 2 }, to: { row: 4, col: 3 },
      captures: [], isChain: false,
    });

    const result = await AiGameService.getTip('game-1', 'user-1');

    expect(result.ok).toBe(true);
    expect(result.from).toEqual({ row: 5, col: 2 });
    expect(result.to).toEqual({ row: 4, col: 3 });
  });

  it('uses intermediate difficulty for tips regardless of game difficulty', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ boardState: mockState, player1Id: 'user-1', aiDifficulty: 'hard' }],
    });
    mockGetAiMove.mockReturnValue({
      from: { row: 5, col: 0 }, to: { row: 4, col: 1 },
      captures: [], isChain: false,
    });

    await AiGameService.getTip('game-1', 'user-1');

    expect(mockGetAiMove).toHaveBeenCalledWith(mockState.board, 1, 'intermediate');
  });
});
