/**
 * tests/unit/engine/rules.test.ts
 *
 * applyMove, promoteKings, applyMoveWithPromotion, nextGameState
 */

import { describe, it, expect } from 'vitest';
import { applyMove, promoteKings, applyMoveWithPromotion, nextGameState } from '../../../apps/backend/src/engine/rules.js';
import { cloneBoard, EMPTY, P1, P2, P1_KING, P2_KING, type Board, type GameState } from '../../../apps/backend/src/engine/board.js';

function emptyBoard(): Board {
  return Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
}

function place(board: Board, pieces: Array<[number, number, number]>): Board {
  const b = cloneBoard(board);
  for (const [r, c, v] of pieces) b[r][c] = v;
  return b;
}

// ─── applyMove ────────────────────────────────────────────────────────────────

describe('applyMove', () => {
  it('moves piece from source to destination', () => {
    const board = place(emptyBoard(), [[5, 1, P1]]);
    const move  = { from: { row: 5, col: 1 }, to: { row: 4, col: 2 }, captures: [], isChain: false };
    const next  = applyMove(board, move);
    expect(next[5][1]).toBe(EMPTY);
    expect(next[4][2]).toBe(P1);
  });

  it('removes captured piece', () => {
    const board = place(emptyBoard(), [[5, 1, P1], [4, 2, P2]]);
    const move  = {
      from: { row: 5, col: 1 }, to: { row: 3, col: 3 },
      captures: [{ row: 4, col: 2 }], isChain: false,
    };
    const next = applyMove(board, move);
    expect(next[4][2]).toBe(EMPTY);
    expect(next[3][3]).toBe(P1);
    expect(next[5][1]).toBe(EMPTY);
  });

  it('removes multiple captured pieces in a chain', () => {
    const board = place(emptyBoard(), [[6, 0, P1], [5, 1, P2], [3, 3, P2]]);
    const move  = {
      from: { row: 6, col: 0 }, to: { row: 2, col: 4 },
      captures: [{ row: 5, col: 1 }, { row: 3, col: 3 }], isChain: false,
    };
    const next = applyMove(board, move);
    expect(next[5][1]).toBe(EMPTY);
    expect(next[3][3]).toBe(EMPTY);
    expect(next[2][4]).toBe(P1);
  });

  it('does not mutate the original board', () => {
    const board = place(emptyBoard(), [[5, 1, P1]]);
    const move  = { from: { row: 5, col: 1 }, to: { row: 4, col: 2 }, captures: [], isChain: false };
    applyMove(board, move);
    expect(board[5][1]).toBe(P1); // original unchanged
  });
});

// ─── promoteKings ─────────────────────────────────────────────────────────────

describe('promoteKings', () => {
  it('promotes P1 piece at row 0 to P1_KING', () => {
    const board = place(emptyBoard(), [[0, 2, P1]]);
    const next  = promoteKings(board);
    expect(next[0][2]).toBe(P1_KING);
  });

  it('promotes P2 piece at row 7 to P2_KING', () => {
    const board = place(emptyBoard(), [[7, 4, P2]]);
    const next  = promoteKings(board);
    expect(next[7][4]).toBe(P2_KING);
  });

  it('does not promote P1 piece not at row 0', () => {
    const board = place(emptyBoard(), [[3, 3, P1]]);
    const next  = promoteKings(board);
    expect(next[3][3]).toBe(P1);
  });

  it('does not promote P2 piece not at row 7', () => {
    const board = place(emptyBoard(), [[4, 4, P2]]);
    const next  = promoteKings(board);
    expect(next[4][4]).toBe(P2);
  });

  it('does not affect existing kings', () => {
    const board = place(emptyBoard(), [[0, 0, P1_KING], [7, 7, P2_KING]]);
    const next  = promoteKings(board);
    expect(next[0][0]).toBe(P1_KING);
    expect(next[7][7]).toBe(P2_KING);
  });

  it('does not mutate the original board', () => {
    const board = place(emptyBoard(), [[0, 2, P1]]);
    promoteKings(board);
    expect(board[0][2]).toBe(P1);
  });
});

// ─── applyMoveWithPromotion ───────────────────────────────────────────────────

describe('applyMoveWithPromotion', () => {
  it('moves piece and promotes in one call', () => {
    const board = place(emptyBoard(), [[1, 1, P1]]);
    const move  = { from: { row: 1, col: 1 }, to: { row: 0, col: 2 }, captures: [], isChain: false };
    const next  = applyMoveWithPromotion(board, move);
    expect(next[0][2]).toBe(P1_KING);
    expect(next[1][1]).toBe(EMPTY);
  });

  it('does not promote when piece does not reach back row', () => {
    const board = place(emptyBoard(), [[5, 1, P1]]);
    const move  = { from: { row: 5, col: 1 }, to: { row: 4, col: 2 }, captures: [], isChain: false };
    const next  = applyMoveWithPromotion(board, move);
    expect(next[4][2]).toBe(P1);
  });
});

// ─── nextGameState ────────────────────────────────────────────────────────────

describe('nextGameState', () => {
  const board = emptyBoard();
  const state: GameState = {
    board,
    activePlayer: 1,
    boardHashHistory: ['hash1'],
    moveCount: 5,
  };
  const move = { from: { row: 5, col: 1 }, to: { row: 4, col: 2 }, captures: [], isChain: false };

  it('switches active player from 1 to 2', () => {
    const next = nextGameState(state, move, 'hash2', board);
    expect(next.activePlayer).toBe(2);
  });

  it('switches active player from 2 to 1', () => {
    const state2: GameState = { ...state, activePlayer: 2 };
    const next = nextGameState(state2, move, 'hash2', board);
    expect(next.activePlayer).toBe(1);
  });

  it('appends new hash to history', () => {
    const next = nextGameState(state, move, 'hash2', board);
    expect(next.boardHashHistory).toEqual(['hash1', 'hash2']);
  });

  it('increments moveCount', () => {
    const next = nextGameState(state, move, 'hash2', board);
    expect(next.moveCount).toBe(6);
  });

  it('uses the provided nextBoard', () => {
    const newBoard = place(emptyBoard(), [[4, 2, P1]]);
    const next = nextGameState(state, move, 'hash2', newBoard);
    expect(next.board[4][2]).toBe(P1);
  });
});
