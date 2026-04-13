/**
 * board.ts — Board representation and initialisation
 *
 * Russian checkers — 8×8 board, dark squares only.
 * Row 0 = top (player2 side), row 7 = bottom (player1 side).
 *
 * Piece values:
 *   0 = empty
 *   1 = player1 regular piece  (moves UP the board, toward row 0)
 *   2 = player2 regular piece  (moves DOWN the board, toward row 7)
 *   3 = player1 king           (flies any distance diagonally)
 *   4 = player2 king           (flies any distance diagonally)
 *
 * Rules enforced by the engine:
 *   - Mandatory capture (forced jumps)
 *   - Maximum capture sequence (must take the most pieces)
 *   - Backward capture for all pieces
 *   - Flying kings (slide any number of squares)
 *   - King promotion at end of full move only
 *   - Draw by 3-fold repetition
 */

export const EMPTY   = 0;
export const P1      = 1;  // player1 regular
export const P2      = 2;  // player2 regular
export const P1_KING = 3;  // player1 king
export const P2_KING = 4;  // player2 king

export type Square = 0 | 1 | 2 | 3 | 4;
export type Board  = Square[][];

export type Player = 1 | 2;

export interface Position {
  row: number;
  col: number;
}

export interface Move {
  from:     Position;
  to:       Position;
  captures: Position[];   // squares captured (may be >1 for multi-jump)
  isChain:  boolean;      // true if this is a mid-chain continuation move
}

export interface GameState {
  board:              Board;
  activePlayer:       Player;
  boardHashHistory:   string[];  // for draw detection (PRD §5: threefold repetition)
  moveCount:          number;
  movesSinceCapture?: number;    // N-05: 50-move no-capture draw rule counter (optional for back-compat)
}

/** Create a deep copy of a board */
export function cloneBoard(board: Board): Board {
  return board.map(row => [...row] as Square[]);
}

/** Create the standard starting board (PRD §5: standard 8×8 checkers) */
export function initialBoard(): Board {
  const board: Board = Array.from({ length: 8 }, () => Array(8).fill(EMPTY) as Square[]);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      // Only dark squares — (row + col) must be odd
      if ((row + col) % 2 === 0) continue;

      if (row < 3) {
        board[row][col] = P2;  // player2 starts at top (rows 0-2)
      } else if (row > 4) {
        board[row][col] = P1;  // player1 starts at bottom (rows 5-7)
      }
    }
  }

  return board;
}

/** Create a fresh GameState for a new game */
export function initialGameState(): GameState {
  const board = initialBoard();
  return {
    board,
    activePlayer:     1,
    boardHashHistory: [],
    moveCount:        0,
  };
}

/** Check if a position is within the 8×8 board */
export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

/** Check if a piece belongs to the given player */
export function isOwnPiece(square: Square, player: Player): boolean {
  if (player === 1) return square === P1 || square === P1_KING;
  return square === P2 || square === P2_KING;
}

/** Check if a piece belongs to the opponent */
export function isOpponentPiece(square: Square, player: Player): boolean {
  if (player === 1) return square === P2 || square === P2_KING;
  return square === P1 || square === P1_KING;
}

/** Check if a piece is a king */
export function isKing(square: Square): boolean {
  return square === P1_KING || square === P2_KING;
}

/** Get all positions occupied by a player's pieces */
export function getPlayerPieces(board: Board, player: Player): Position[] {
  const pieces: Position[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (isOwnPiece(board[row][col], player)) {
        pieces.push({ row, col });
      }
    }
  }
  return pieces;
}

/** Count pieces for a player */
export function countPieces(board: Board, player: Player): number {
  return getPlayerPieces(board, player).length;
}
