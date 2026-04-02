/**
 * conditions.ts — Win, loss, and draw condition detection
 *
 * PRD §5 Win Conditions:
 * - Capture all opponent pieces
 * - Block all opponent pieces so they have no legal moves
 * - Opponent's move timer expires (handled by game-timer.service, not here)
 * - Opponent resigns (handled by WebSocket handler, not here)
 *
 * PRD §5 Draw Conditions:
 * - Both players have < 5 pieces AND same position repeated 25 times
 */

import {
  Board, Player,
  countPieces,
} from './board.js';
import { getAvailableMoves } from './moves.js';
import { hashBoardState, isDrawByRepetition } from './hash.js';

export type GameResult =
  | { status: 'ongoing' }
  | { status: 'win';  winner: Player; reason: 'no_pieces' | 'no_moves' | 'timeout' | 'resign' }
  | { status: 'draw'; reason: 'repetition' };

/**
 * Check win/draw conditions after a move has been applied.
 *
 * Called AFTER the move is applied and active player has switched
 * to the player who must now move.
 *
 * @param board         Current board (after move applied + kings promoted)
 * @param activePlayer  Player who must move next
 * @param history       Board hash history (for draw detection)
 */
export function checkWinCondition(
  board:        Board,
  activePlayer: Player,
  history:      string[],
): GameResult {
  const opponent: Player = activePlayer === 1 ? 2 : 1;

  const activePieces   = countPieces(board, activePlayer);
  const opponentPieces = countPieces(board, opponent);

  // Win: active player has no pieces left → opponent wins
  if (activePieces === 0) {
    return { status: 'win', winner: opponent, reason: 'no_pieces' };
  }

  // Win: active player has no legal moves → opponent wins
  const moves = getAvailableMoves(board, activePlayer);
  if (moves.length === 0) {
    return { status: 'win', winner: opponent, reason: 'no_moves' };
  }

  // Draw: position repetition (PRD §5)
  const hash = hashBoardState(board, activePlayer);
  if (isDrawByRepetition(history, hash, activePieces, opponentPieces)) {
    return { status: 'draw', reason: 'repetition' };
  }

  return { status: 'ongoing' };
}

/**
 * Convenience: check if a specific player has lost (no pieces or no moves).
 */
export function hasPlayerLost(board: Board, player: Player): boolean {
  if (countPieces(board, player) === 0) return true;
  if (getAvailableMoves(board, player).length === 0) return true;
  return false;
}
