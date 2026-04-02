/**
 * greedy.ts — Intermediate AI
 * Evaluates all legal moves, picks the one with the best immediate board score.
 * No lookahead — purely greedy.
 * PRD §8: Intermediate difficulty level
 */

import { Board, Player, Move, Square, P1, P2, P1_KING, P2_KING } from '../board.js';
import { getAvailableMoves } from '../moves.js';
import { applyMoveWithPromotion } from '../rules.js';

/**
 * Simple material evaluation.
 * Regular piece = 1 point, King = 1.5 points.
 * Returns score from player's perspective (positive = good).
 */
export function evaluateBoard(board: Board, player: Player): number {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c] as Square;
      if (sq === P1)      score += player === 1 ?  1.0 : -1.0;
      if (sq === P2)      score += player === 2 ?  1.0 : -1.0;
      if (sq === P1_KING) score += player === 1 ?  1.5 : -1.5;
      if (sq === P2_KING) score += player === 2 ?  1.5 : -1.5;
    }
  }
  return score;
}

export function greedyMove(board: Board, player: Player): Move | null {
  const moves = getAvailableMoves(board, player);
  if (!moves.length) return null;

  let bestMove = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    const newBoard = applyMoveWithPromotion(board, move);
    const score    = evaluateBoard(newBoard, player);
    if (score > bestScore) {
      bestScore = score;
      bestMove  = move;
    }
  }

  return bestMove;
}
