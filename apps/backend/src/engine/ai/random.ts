/**
 * random.ts — Beginner AI
 * Picks a uniformly random legal move. No strategy.
 * PRD §8: Beginner difficulty level
 */

import { Board, Player, Move } from '../board.js';
import { getAvailableMoves } from '../moves.js';

export function randomMove(board: Board, player: Player): Move | null {
  const moves = getAvailableMoves(board, player);
  if (!moves.length) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}
