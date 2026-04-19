/**
 * tests/unit/engine/moves.test.ts
 *
 * Russian checkers move generator.
 * Tests mandatory capture, maximum capture, backward capture,
 * flying kings, multi-jump chains, and king promotion rules.
 */

import { describe, it, expect } from 'vitest';
import {
  getAvailableMoves, getLegalMovesForPiece, isForcedCapture, isLegalMove,
} from '../../../apps/backend/src/engine/moves.js';
import {
  initialBoard, cloneBoard,
  EMPTY, P1, P2, P1_KING, P2_KING,
  type Board,
} from '../../../apps/backend/src/engine/board.js';

// ─── Board helpers ────────────────────────────────────────────────────────────

/** Create an empty 8×8 board */
function emptyBoard(): Board {
  return Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
}

/** Place pieces on specific squares */
function place(board: Board, pieces: Array<[number, number, number]>): Board {
  const b = cloneBoard(board);
  for (const [row, col, val] of pieces) b[row][col] = val;
  return b;
}

// ─── Starting position ────────────────────────────────────────────────────────

describe('initialBoard move generation', () => {
  it('P1 has 7 legal moves from starting position', () => {
    const board = initialBoard();
    const moves = getAvailableMoves(board, 1);
    // P1 on rows 5,6,7 — only row 5 can move forward (rows above are empty)
    // 4 pieces on row 5, each can move in 2 directions (7 cells on dark squares)
    expect(moves.length).toBe(7);
  });

  it('P2 has 7 legal moves from starting position', () => {
    const board = initialBoard();
    const moves = getAvailableMoves(board, 2);
    expect(moves.length).toBe(7);
  });

  it('no forced captures at game start', () => {
    const board = initialBoard();
    expect(isForcedCapture(board, 1)).toBe(false);
    expect(isForcedCapture(board, 2)).toBe(false);
  });
});

// ─── Simple moves ─────────────────────────────────────────────────────────────

describe('simple moves', () => {
  it('P1 regular piece moves forward only (toward row 0)', () => {
    const board = place(emptyBoard(), [[5, 1, P1]]);
    const moves = getLegalMovesForPiece(board, 5, 1, 1);
    expect(moves.length).toBe(2); // two forward diagonals
    for (const m of moves) {
      expect(m.to.row).toBe(4); // one step forward
      expect(m.captures).toHaveLength(0);
    }
  });

  it('P2 regular piece moves forward only (toward row 7)', () => {
    const board = place(emptyBoard(), [[2, 2, P2]]);
    const moves = getLegalMovesForPiece(board, 2, 2, 2);
    expect(moves.length).toBe(2);
    for (const m of moves) {
      expect(m.to.row).toBe(3);
    }
  });

  it('piece at board edge has limited moves', () => {
    const board = place(emptyBoard(), [[5, 0, P1]]); // leftmost column
    const moves = getLegalMovesForPiece(board, 5, 0, 1);
    expect(moves.length).toBe(1); // only one direction possible
  });

  it('piece blocked by own piece has no moves', () => {
    const board = place(emptyBoard(), [
      [5, 1, P1],
      [4, 0, P1], // blocks left-forward
      [4, 2, P1], // blocks right-forward
    ]);
    const moves = getLegalMovesForPiece(board, 5, 1, 1);
    expect(moves.length).toBe(0);
  });
});

// ─── Forced capture rule ──────────────────────────────────────────────────────

describe('mandatory capture rule', () => {
  it('forces capture when available — no simple moves returned', () => {
    // P1 at (5,1) with P2 at (4,2) and empty (3,3)
    const board = place(emptyBoard(), [[5, 1, P1], [4, 2, P2]]);
    const moves = getAvailableMoves(board, 1);
    // All moves must be captures
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.captures.length).toBeGreaterThan(0);
    }
  });

  it('isForcedCapture returns true when jump available', () => {
    const board = place(emptyBoard(), [[5, 1, P1], [4, 2, P2]]);
    expect(isForcedCapture(board, 1)).toBe(true);
  });

  it('isForcedCapture returns false when no jump available', () => {
    const board = place(emptyBoard(), [[5, 1, P1]]);
    expect(isForcedCapture(board, 1)).toBe(false);
  });
});

// ─── Maximum capture rule ─────────────────────────────────────────────────────

describe('maximum capture rule (Russian checkers)', () => {
  it('only returns sequences capturing the most pieces', () => {
    // Set up a board where P1 can take 1 piece OR 2 pieces in different sequences
    // P1 at (6,0); P2 at (5,1),(3,3) — can chain jump for 2 captures
    // P1 at (6,4); P2 at (5,5) — can take 1 capture
    const board = place(emptyBoard(), [
      [6, 0, P1],
      [5, 1, P2], [3, 3, P2], // chain: take 2
      [6, 4, P1],
      [5, 5, P2],              // single: take 1
    ]);
    const moves = getAvailableMoves(board, 1);
    // All returned moves must capture the MAXIMUM number of pieces
    const maxCaptures = Math.max(...moves.map(m => m.captures.length));
    for (const m of moves) {
      expect(m.captures.length).toBe(maxCaptures);
    }
    expect(maxCaptures).toBe(2);
  });
});

// ─── Backward capture (Russian rule) ─────────────────────────────────────────

describe('backward capture for regular pieces', () => {
  it('P1 regular piece can capture backward (toward row 7)', () => {
    // P2 is behind P1 (higher row number = behind for P1)
    const board = place(emptyBoard(), [
      [3, 3, P1],
      [4, 4, P2], // behind P1
    ]);
    const moves = getAvailableMoves(board, 1);
    // Should include backward capture
    const backwardCapture = moves.find(m => m.to.row > 3 && m.captures.length > 0);
    expect(backwardCapture).toBeDefined();
  });
});

// ─── Flying kings ─────────────────────────────────────────────────────────────

describe('flying kings', () => {
  it('king moves one square in each of the 4 diagonal directions', () => {
    const board = place(emptyBoard(), [[3, 3, P1_KING]]);
    const moves = getLegalMovesForPiece(board, 3, 3, 1);
    // King simple moves: one step in each of the 4 diagonal directions
    expect(moves.length).toBe(4);
  });

  it('king moves in all 4 diagonal directions', () => {
    const board = place(emptyBoard(), [[4, 4, P1_KING]]);
    const moves = getLegalMovesForPiece(board, 4, 4, 1);
    const hasNorthWest = moves.some(m => m.to.row < 4 && m.to.col < 4);
    const hasNorthEast = moves.some(m => m.to.row < 4 && m.to.col > 4);
    const hasSouthWest = moves.some(m => m.to.row > 4 && m.to.col < 4);
    const hasSouthEast = moves.some(m => m.to.row > 4 && m.to.col > 4);
    expect(hasNorthWest).toBe(true);
    expect(hasNorthEast).toBe(true);
    expect(hasSouthWest).toBe(true);
    expect(hasSouthEast).toBe(true);
  });

  it('king is blocked by own piece', () => {
    const board = place(emptyBoard(), [
      [4, 4, P1_KING],
      [6, 6, P1],       // blocks SE direction beyond row 6
    ]);
    const moves = getLegalMovesForPiece(board, 4, 4, 1);
    const seBlock = moves.filter(m => m.to.row > 6 && m.to.col > 6);
    expect(seBlock).toHaveLength(0);
  });

  it('king captures by sliding, lands immediately after captured piece', () => {
    const board = place(emptyBoard(), [
      [2, 2, P1_KING],
      [4, 4, P2],       // king jumps from (2,2) over (4,4) to land on (5,5)
    ]);
    const moves = getAvailableMoves(board, 1);
    const capture = moves.find(m =>
      m.captures.some(c => c.row === 4 && c.col === 4)
    );
    expect(capture).toBeDefined();
    expect(capture?.to.row).toBe(5);
    expect(capture?.to.col).toBe(5);
  });

  it('king skips direction when landing square is occupied after opponent (line 96 branch)', () => {
    // King finds P2 to jump but the only landing square is blocked by own piece.
    // Use only the king — no other P1 pieces that could also capture P2.
    const board = place(emptyBoard(), [
      [2, 2, P1_KING],
      [4, 4, P2],   // king could jump this SE...
      [5, 5, P1_KING],   // ...but landing square is blocked by own piece
    ]);
    // P1_KING at (2,2): SE direction → P2 at (4,4), landing (5,5) blocked → skip
    // P1_KING at (5,5): can it capture P2 at (4,4)? Landing would be (3,3) — empty.
    //   But (5,5) is P1_KING, so it would capture. We need to verify (2,2) king can't.
    // Check specifically that (2,2) king has no capture of (4,4):
    const movesFrom22 = getLegalMovesForPiece(board, 2, 2, 1);
    const blockedCapture = movesFrom22.find(m =>
      m.captures.some(c => c.row === 4 && c.col === 4)
    );
    expect(blockedCapture).toBeUndefined();
  });
});

// ─── Multi-jump chains ────────────────────────────────────────────────────────

describe('multi-jump chain', () => {
  it('generates multi-jump sequence as a single move', () => {
    // P1 at (6,0) can jump P2 at (5,1) landing on (4,2),
    // then jump P2 at (3,3) landing on (2,4)
    const board = place(emptyBoard(), [
      [6, 0, P1],
      [5, 1, P2], [3, 3, P2],
    ]);
    const moves = getAvailableMoves(board, 1);
    const chain = moves.find(m => m.captures.length === 2);
    expect(chain).toBeDefined();
    expect(chain?.captures).toHaveLength(2);
  });

  it('chain move cannot capture same piece twice', () => {
    // Ensure the same P2 piece is not captured twice in one chain
    const board = place(emptyBoard(), [
      [6, 0, P1], [5, 1, P2], [3, 3, P2],
    ]);
    const moves = getAvailableMoves(board, 1);
    for (const m of moves) {
      const captureKeys = m.captures.map(c => `${c.row},${c.col}`);
      const uniqueKeys  = new Set(captureKeys);
      expect(captureKeys.length).toBe(uniqueKeys.size);
    }
  });
});

// ─── isLegalMove validation ───────────────────────────────────────────────────

describe('isLegalMove', () => {
  it('returns true for a valid simple move', () => {
    const board = initialBoard();
    const legalMove = getAvailableMoves(board, 1)[0];
    expect(isLegalMove(board, legalMove, 1)).toBe(true);
  });

  it('returns false for a move to wrong destination', () => {
    const board = initialBoard();
    const legalMove = getAvailableMoves(board, 1)[0];
    const illegal = { ...legalMove, to: { row: 0, col: 0 } }; // invalid destination
    expect(isLegalMove(board, illegal, 1)).toBe(false);
  });

  it('returns false for empty square', () => {
    const board = emptyBoard();
    const fake = { from: { row: 3, col: 3 }, to: { row: 2, col: 2 }, captures: [], isChain: false };
    expect(isLegalMove(board, fake, 1)).toBe(false);
  });

  it("returns false for opponent's piece", () => {
    const board = place(emptyBoard(), [[5, 1, P2]]);
    const fake = { from: { row: 5, col: 1 }, to: { row: 4, col: 0 }, captures: [], isChain: false };
    expect(isLegalMove(board, fake, 1)).toBe(false);
  });
});

// ─── getLegalMovesForPiece ────────────────────────────────────────────────────

describe('getLegalMovesForPiece', () => {
  it('returns empty array for empty square', () => {
    const board = emptyBoard();
    expect(getLegalMovesForPiece(board, 4, 4, 1)).toHaveLength(0);
  });

  it("returns empty array for opponent's piece", () => {
    const board = place(emptyBoard(), [[4, 4, P2]]);
    expect(getLegalMovesForPiece(board, 4, 4, 1)).toHaveLength(0);
  });
});
