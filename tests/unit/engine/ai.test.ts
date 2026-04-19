/**
 * tests/unit/engine/ai.test.ts
 *
 * AI move generators: random, greedy, minimax, alphaBeta, dispatcher.
 */

import { describe, it, expect } from 'vitest';
import { getAiMove } from '../../../apps/backend/src/engine/ai/index.js';
import { randomMove } from '../../../apps/backend/src/engine/ai/random.js';
import { greedyMove, evaluateBoard } from '../../../apps/backend/src/engine/ai/greedy.js';
import { minimaxMove } from '../../../apps/backend/src/engine/ai/minimax.js';
import { alphaBetaMove } from '../../../apps/backend/src/engine/ai/alphaBeta.js';
import {
  initialBoard, cloneBoard, EMPTY, P1, P2, P1_KING, P2_KING, type Board,
} from '../../../apps/backend/src/engine/board.js';

function emptyBoard(): Board {
  return Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
}

function place(board: Board, pieces: Array<[number, number, number]>): Board {
  const b = cloneBoard(board);
  for (const [r, c, v] of pieces) b[r][c] = v;
  return b;
}

// ─── randomMove ───────────────────────────────────────────────────────────────

describe('randomMove', () => {
  it('returns a legal move from starting position', () => {
    const move = randomMove(initialBoard(), 1);
    expect(move).not.toBeNull();
    expect(move?.from).toBeDefined();
    expect(move?.to).toBeDefined();
  });

  it('returns null when no moves available', () => {
    expect(randomMove(emptyBoard(), 1)).toBeNull();
  });

  it('returns a move for P2', () => {
    expect(randomMove(initialBoard(), 2)).not.toBeNull();
  });
});

// ─── evaluateBoard ────────────────────────────────────────────────────────────

describe('evaluateBoard', () => {
  it('returns 0 for symmetric starting position', () => {
    expect(evaluateBoard(initialBoard(), 1)).toBe(0);
  });

  it('returns positive when player has more pieces', () => {
    const board = place(emptyBoard(), [[5, 1, P1], [5, 3, P1], [2, 2, P2]]);
    expect(evaluateBoard(board, 1)).toBeGreaterThan(0);
  });

  it('returns negative when player has fewer pieces', () => {
    const board = place(emptyBoard(), [[5, 1, P1], [2, 2, P2], [2, 4, P2]]);
    expect(evaluateBoard(board, 1)).toBeLessThan(0);
  });

  it('values kings at 1.5x regular pieces', () => {
    const boardKing = place(emptyBoard(), [[4, 4, P1_KING], [2, 2, P2]]);
    const boardPiece = place(emptyBoard(), [[4, 4, P1], [2, 2, P2]]);
    expect(evaluateBoard(boardKing, 1)).toBeGreaterThan(evaluateBoard(boardPiece, 1));
  });

  it('evaluates from P2 perspective correctly', () => {
    const board = place(emptyBoard(), [[5, 1, P1], [2, 2, P2], [2, 4, P2_KING]]);
    expect(evaluateBoard(board, 2)).toBeGreaterThan(0);
  });
});

// ─── greedyMove ───────────────────────────────────────────────────────────────

describe('greedyMove', () => {
  it('returns a move from starting position', () => {
    expect(greedyMove(initialBoard(), 1)).not.toBeNull();
  });

  it('returns null when no moves available', () => {
    expect(greedyMove(emptyBoard(), 1)).toBeNull();
  });

  it('prefers a capture move (gains material)', () => {
    // P1 can capture P2 — greedy should take it
    const board = place(emptyBoard(), [
      [5, 1, P1],
      [4, 2, P2], // capturable
      [0, 0, P2], // far away P2 piece to keep game going
    ]);
    const move = greedyMove(board, 1);
    expect(move).not.toBeNull();
    expect(move?.captures.length).toBeGreaterThan(0);
  });
});

// ─── minimaxMove ─────────────────────────────────────────────────────────────

describe('minimaxMove', () => {
  it('returns a move from starting position', () => {
    const move = minimaxMove(initialBoard(), 1);
    expect(move).not.toBeNull();
  });

  it('returns null when no moves available', () => {
    expect(minimaxMove(emptyBoard(), 1)).toBeNull();
  });

  it('returns a move for P2', () => {
    expect(minimaxMove(initialBoard(), 2)).not.toBeNull();
  });
});

// ─── alphaBetaMove ────────────────────────────────────────────────────────────

describe('alphaBetaMove', () => {
  it('returns a move from starting position', () => {
    const move = alphaBetaMove(initialBoard(), 1);
    expect(move).not.toBeNull();
  });

  it('returns null when no moves available', () => {
    expect(alphaBetaMove(emptyBoard(), 1)).toBeNull();
  });

  it('returns a move for P2', () => {
    expect(alphaBetaMove(initialBoard(), 2)).not.toBeNull();
  });
});

// ─── getAiMove dispatcher ─────────────────────────────────────────────────────

describe('getAiMove', () => {
  it('dispatches beginner → randomMove', () => {
    const move = getAiMove(initialBoard(), 1, 'beginner');
    expect(move).not.toBeNull();
  });

  it('dispatches intermediate → greedyMove', () => {
    const move = getAiMove(initialBoard(), 1, 'intermediate');
    expect(move).not.toBeNull();
  });

  it('dispatches hard → minimaxMove', () => {
    const move = getAiMove(initialBoard(), 1, 'hard');
    expect(move).not.toBeNull();
  });

  it('dispatches master → alphaBetaMove', () => {
    const move = getAiMove(initialBoard(), 1, 'master');
    expect(move).not.toBeNull();
  });
});
