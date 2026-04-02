/**
 * rules.ts — Move application and king promotion
 *
 * PRD §5:
 * - King promotion occurs at END of full move — not mid-chain
 * - Multi-jump chains must be completed in one turn
 */

import {
  Board, Move, Player, GameState,
  P1, P2, P1_KING, P2_KING, EMPTY,
  cloneBoard,
} from './board.js';

/**
 * Apply a move to the board, returning a new immutable board state.
 * Does NOT promote kings — call promoteKings() after the full move.
 *
 * Handles:
 * - Simple moves (piece slides to adjacent square)
 * - Single captures (jump over one opponent piece)
 * - Multi-jump chains (multiple captures in one turn)
 */
export function applyMove(board: Board, move: Move): Board {
  const next = cloneBoard(board);

  // Move the piece
  next[move.to.row][move.to.col]     = next[move.from.row][move.from.col];
  next[move.from.row][move.from.col] = EMPTY;

  // Remove all captured pieces
  for (const cap of move.captures) {
    next[cap.row][cap.col] = EMPTY;
  }

  return next;
}

/**
 * Promote pieces that have reached the opponent's back row.
 * PRD §5: Promotion occurs at END of full move — not mid-chain.
 *
 * Player 1 promotes at row 0 (P1 → P1_KING)
 * Player 2 promotes at row 7 (P2 → P2_KING)
 */
export function promoteKings(board: Board): Board {
  const next = cloneBoard(board);

  for (let col = 0; col < 8; col++) {
    if (next[0][col] === P1) next[0][col] = P1_KING;   // P1 reaches row 0
    if (next[7][col] === P2) next[7][col] = P2_KING;   // P2 reaches row 7
  }

  return next;
}

/**
 * Apply a move and then promote kings (in correct order per PRD §5).
 * This is the main function called by the game loop.
 */
export function applyMoveWithPromotion(board: Board, move: Move): Board {
  const afterMove = applyMove(board, move);
  return promoteKings(afterMove);
}

/**
 * Create the next GameState after a move is applied.
 * Accepts the already-computed next board to avoid double-applying the move.
 * Switches active player and increments move count.
 */
export function nextGameState(state: GameState, _move: Move, boardHash: string, nextBoard: Board): GameState {
  return {
    board:            nextBoard,
    activePlayer:     state.activePlayer === 1 ? 2 : 1,
    boardHashHistory: [...state.boardHashHistory, boardHash],
    moveCount:        state.moveCount + 1,
  };
}
