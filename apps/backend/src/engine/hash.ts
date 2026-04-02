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
 * No piece-count restriction (unlike the old 25-rep / <5 pieces rule).
 */
export function isDrawByRepetition(
  history:  string[],
  hash:     string,
  _p1Pieces: number,
  _p2Pieces: number,
): boolean {
  return countRepetitions(history, hash) >= 3;
}
