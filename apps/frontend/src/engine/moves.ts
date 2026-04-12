/**
 * Frontend copy of the moves engine — used for local move highlighting only.
 * The server is AUTHORITATIVE; this is for UI feedback (showing legal squares).
 *
 * N-06: Keep in sync with apps/backend/src/engine/moves.ts.
 * Last synced: 2026-04-12
 */

import {
  Board, Move, Player, Position, Square,
  EMPTY, P1, P2, P1_KING, P2_KING,
  cloneBoard, inBounds, isOwnPiece, isOpponentPiece, isKing,
} from './board.js';

/** All 4 diagonal directions */
const ALL_DIRECTIONS: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/**
 * Forward movement directions for regular pieces (non-capture moves only).
 * Russian checkers: regular pieces move forward only, but capture in all directions.
 */
function getForwardDirections(square: Square): Array<[number, number]> {
  if (square === P1) return [[-1, -1], [-1, 1]]; // P1 moves toward row 0
  if (square === P2) return [[1, -1], [1, 1]];   // P2 moves toward row 7
  return ALL_DIRECTIONS; // kings move all directions
}

/**
 * Get all simple (non-capture) moves for a piece at (row, col).
 * Flying kings: slide any number of squares diagonally.
 */
function getSimpleMoves(board: Board, row: number, col: number): Move[] {
  const square = board[row][col];
  const moves: Move[] = [];

  // Kings move one square in all 4 directions (no flying for simple moves)
  // Regular pieces move one step forward only
  const dirs = isKing(square) ? ALL_DIRECTIONS : getForwardDirections(square);

  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (inBounds(nr, nc) && board[nr][nc] === EMPTY) {
      moves.push({ from: { row, col }, to: { row: nr, col: nc }, captures: [], isChain: false });
    }
  }

  return moves;
}

/**
 * Recursively find all capture chains from a given position.
 *
 * Russian rules:
 * - All pieces (regular and kings) capture in all 4 diagonal directions
 * - Flying kings: can land any number of squares past the captured piece
 * - King promotion blocked mid-chain
 * - Cannot capture the same piece twice in one chain
 */
function getCaptureChains(
  board:      Board,
  row:        number,
  col:        number,
  player:     Player,
  captured:   Set<string>,  // positions already captured in this chain
  chainStart: Position,     // original starting position of the full move
  isKingPiece: boolean,
): Move[] {
  const results: Move[] = [];

  for (const [dr, dc] of ALL_DIRECTIONS) {
    if (isKingPiece) {
      // King capture: scan along diagonal to find an opponent piece to jump
      let scanRow = row + dr;
      let scanCol = col + dc;

      // Slide until we hit something
      while (inBounds(scanRow, scanCol) && board[scanRow][scanCol] === EMPTY) {
        scanRow += dr;
        scanCol += dc;
      }

      // Must be an opponent piece that hasn't been captured yet
      if (!inBounds(scanRow, scanCol)) continue;
      const midKey = `${scanRow},${scanCol}`;
      if (captured.has(midKey)) continue;
      if (!isOpponentPiece(board[scanRow][scanCol], player)) continue;

      // King must land on the single adjacent square immediately after the captured piece
      const landRow = scanRow + dr;
      const landCol = scanCol + dc;
      if (!inBounds(landRow, landCol) || board[landRow][landCol] !== EMPTY) continue;

      const newCaptured = new Set(captured);
      newCaptured.add(midKey);

      const tempBoard = cloneBoard(board);
      tempBoard[scanRow][scanCol] = EMPTY;
      tempBoard[landRow][landCol] = tempBoard[row][col];
      tempBoard[row][col] = EMPTY;

      const continuations = getCaptureChains(
        tempBoard, landRow, landCol, player, newCaptured, chainStart, true,
      );

      if (continuations.length > 0) {
        results.push(...continuations);
      } else {
        const allCaptures = Array.from(newCaptured).map(k => {
          const [r, c] = k.split(',').map(Number);
          return { row: r, col: c };
        });
        results.push({
          from:     chainStart,
          to:       { row: landRow, col: landCol },
          captures: allCaptures,
          isChain:  newCaptured.size > 1,
        });
      }
    } else {
      // Regular piece: jump exactly 2 squares
      const midRow  = row + dr;
      const midCol  = col + dc;
      const landRow = row + 2 * dr;
      const landCol = col + 2 * dc;

      if (!inBounds(landRow, landCol)) continue;
      if (board[landRow][landCol] !== EMPTY) continue;

      const midKey = `${midRow},${midCol}`;
      if (captured.has(midKey)) continue;

      const midSquare = board[midRow][midCol];
      if (!isOpponentPiece(midSquare, player)) continue;

      const newCaptured = new Set(captured);
      newCaptured.add(midKey);

      const tempBoard = cloneBoard(board);
      tempBoard[midRow][midCol] = EMPTY;
      tempBoard[landRow][landCol] = tempBoard[row][col];
      tempBoard[row][col] = EMPTY;
      // No promotion mid-chain

      const continuations = getCaptureChains(
        tempBoard, landRow, landCol, player, newCaptured, chainStart, false,
      );

      if (continuations.length > 0) {
        results.push(...continuations);
      } else {
        const allCaptures = Array.from(newCaptured).map(k => {
          const [r, c] = k.split(',').map(Number);
          return { row: r, col: c };
        });
        results.push({
          from:     chainStart,
          to:       { row: landRow, col: landCol },
          captures: allCaptures,
          isChain:  newCaptured.size > 1,
        });
      }
    }
  }

  return results;
}

/**
 * Get all jump (capture) moves available for a piece.
 */
function getCaptureMoves(board: Board, row: number, col: number, player: Player): Move[] {
  const square    = board[row][col];
  const kingPiece = isKing(square);
  return getCaptureChains(board, row, col, player, new Set(), { row, col }, kingPiece);
}

/**
 * Get all legal moves for a specific piece.
 * Respects forced capture rule — returns only jumps if any are available.
 * Note: maximum capture filtering happens in getAvailableMoves.
 */
export function getLegalMovesForPiece(board: Board, row: number, col: number, player: Player): Move[] {
  const square = board[row][col];
  if (!isOwnPiece(square, player)) return [];

  const captures = getCaptureMoves(board, row, col, player);
  return captures.length > 0 ? captures : getSimpleMoves(board, row, col);
}

/**
 * Get ALL legal moves for a player.
 *
 * Russian checkers rules:
 * 1. Forced captures: if ANY jump exists anywhere, ONLY jumps are returned.
 * 2. Maximum capture: among all capture sequences, only those capturing
 *    the MOST pieces are legal. Player must maximise captures.
 */
export function getAvailableMoves(board: Board, player: Player): Move[] {
  const allCaptures: Move[] = [];
  const allSimple:   Move[] = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (!isOwnPiece(board[row][col], player)) continue;

      const captures = getCaptureMoves(board, row, col, player);
      if (captures.length > 0) {
        allCaptures.push(...captures);
      } else {
        allSimple.push(...getSimpleMoves(board, row, col));
      }
    }
  }

  if (allCaptures.length === 0) return allSimple;

  // Russian rule: must take the sequence that captures the maximum number of pieces
  const maxCaptures = Math.max(...allCaptures.map(m => m.captures.length));
  return allCaptures.filter(m => m.captures.length === maxCaptures);
}

/**
 * Check if the player has any forced capture available.
 */
export function isForcedCapture(board: Board, player: Player): boolean {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (!isOwnPiece(board[row][col], player)) continue;
      if (getCaptureMoves(board, row, col, player).length > 0) return true;
    }
  }
  return false;
}

/**
 * Validate that a given move is in the list of legal moves.
 */
export function isLegalMove(board: Board, move: Move, player: Player): boolean {
  const legal = getAvailableMoves(board, player);
  return legal.some(m =>
    m.from.row  === move.from.row  &&
    m.from.col  === move.from.col  &&
    m.to.row    === move.to.row    &&
    m.to.col    === move.to.col    &&
    m.captures.length === move.captures.length,
  );
}
