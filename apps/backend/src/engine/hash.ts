/**
 * hash.ts — Deterministic board state hashing for draw detection
 *
 * Russian checkers draw rule: same position repeated 3 times = draw.
 * Hash includes board layout + active player.
 */

import crypto from 'crypto';
import { Board, Player } from './board.js';

/** Compute a deterministic SHA-256 hash of the board state + active player. */
export function hashBoardState(board: Board, activePlayer: Player): string {
  const flat  = board.map(row => row.join('')).join('|');
  const input = `${flat}:${activePlayer}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Count how many times a specific hash appears in the history. */
export function countRepetitions(history: string[], hash: string): number {
  return history.filter(h => h === hash).length;
}

/**
 * Russian checkers draw condition: same position repeated 3 times.
 *
 * C-09: This is the correct threshold per Russian/international checkers rules.
 * The shared constant REPEATED_POSITION_LIMIT (25) was incorrect and has been
 * updated to 3 to match this implementation.
 * Reference: FIDE Draughts rules §6 — threefold repetition.
 */
export function isDrawByRepetition(
  history:   string[],
  hash:      string,
  _p1Pieces: number,
  _p2Pieces: number,
): boolean {
  return countRepetitions(history, hash) >= 3;
}
