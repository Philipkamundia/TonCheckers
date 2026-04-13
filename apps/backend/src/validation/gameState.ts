/**
 * gameState.ts — Zod runtime validation for board state read from the database
 *
 * M-07: board_state is stored as JSONB and returned as an opaque object.
 * If a bug or direct DB manipulation corrupts the column, the game engine
 * receives invalid data and can throw obscure errors mid-game.
 * Validating on every read ensures we catch corruption early and crash the
 * specific game cleanly (returning an error) rather than the whole server.
 */
import { z } from 'zod';
import type { GameState } from '../engine/board.js';
import { logger } from '../utils/logger.js';

// Square: 0 = empty, 1 = P1, 2 = P2, 3 = P1_KING, 4 = P2_KING
const SquareSchema = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
]);

const BoardRowSchema = z.array(SquareSchema).length(8);

const BoardSchema = z.array(BoardRowSchema).length(8);

const GameStateSchema = z.object({
  board:              BoardSchema,
  activePlayer:       z.union([z.literal(1), z.literal(2)]),
  boardHashHistory:   z.array(z.string()),
  moveCount:          z.number().int().nonnegative(),
  movesSinceCapture:  z.number().int().nonnegative().optional(),  // N-05: 50-move rule counter
}).passthrough();  // allow any future fields

/**
 * Validate and parse a raw board_state value from the database.
 * Returns the parsed GameState, or null with a logged error if invalid.
 */
export function parseGameState(raw: unknown): GameState | null {
  const result = GameStateSchema.safeParse(raw);
  if (!result.success) {
    logger.error(
      `GameState validation failed: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
    return null;
  }
  return result.data as GameState;
}

/**
 * Validate a board_state value and throw an AppError if invalid.
 * Use this in game.move handler where an invalid state should reject the move.
 */
export function assertGameState(raw: unknown): GameState {
  const parsed = parseGameState(raw);
  if (!parsed) {
    throw new Error('Corrupted board state — game cannot continue safely');
  }
  return parsed;
}
