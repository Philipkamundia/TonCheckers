/**
 * minimax.ts — Hard AI
 * Classic minimax search to depth 4.
 * PRD §8: Hard difficulty level
 */

import { Board, Player, Move } from '../board.js';
import { getAvailableMoves } from '../moves.js';
import { applyMoveWithPromotion } from '../rules.js';
import { checkWinCondition } from '../conditions.js';
import { hashBoardState } from '../hash.js';
import { evaluateBoard } from './greedy.js';

const MINIMAX_DEPTH = 4;

function minimax(
  board:   Board,
  player:  Player,           // whose turn it is
  aiPlayer: Player,          // who we're optimising for
  depth:   number,
  history: string[],
): number {
  // Terminal conditions
  const result = checkWinCondition(board, player, history);
  if (result.status === 'win')  return result.winner === aiPlayer ? 1000 - (MINIMAX_DEPTH - depth) : -1000 + (MINIMAX_DEPTH - depth);
  if (result.status === 'draw') return 0;
  if (depth === 0)              return evaluateBoard(board, aiPlayer);

  const moves    = getAvailableMoves(board, player);
  const isMaxing = player === aiPlayer;
  let   best     = isMaxing ? -Infinity : Infinity;

  for (const move of moves) {
    const newBoard  = applyMoveWithPromotion(board, move);
    const newHash   = hashBoardState(newBoard, player === 1 ? 2 : 1);
    const newHistory = [...history, newHash];
    const score     = minimax(newBoard, player === 1 ? 2 : 1, aiPlayer, depth - 1, newHistory);
    best = isMaxing ? Math.max(best, score) : Math.min(best, score);
  }

  return best;
}

export function minimaxMove(board: Board, aiPlayer: Player): Move | null {
  const moves = getAvailableMoves(board, aiPlayer);
  if (!moves.length) return null;

  let bestMove  = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    const newBoard  = applyMoveWithPromotion(board, move);
    const newHash   = hashBoardState(newBoard, aiPlayer === 1 ? 2 : 1);
    const score     = minimax(newBoard, aiPlayer === 1 ? 2 : 1, aiPlayer, MINIMAX_DEPTH - 1, [newHash]);
    if (score > bestScore) {
      bestScore = score;
      bestMove  = move;
    }
  }

  return bestMove;
}
