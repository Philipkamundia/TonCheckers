/**
 * ai/index.ts — AI move dispatcher
 *
 * PRD §8 difficulty levels:
 *   Beginner     → random move
 *   Intermediate → greedy (best immediate score)
 *   Hard         → minimax depth 4
 *   Master       → alpha-beta depth 8 with enhanced evaluation
 */

import { Board, Player, Move } from '../board.js';
import { randomMove }    from './random.js';
import { greedyMove }    from './greedy.js';
import { minimaxMove }   from './minimax.js';
import { alphaBetaMove } from './alphaBeta.js';

export type AiDifficulty = 'beginner' | 'intermediate' | 'hard' | 'master';

export function getAiMove(board: Board, player: Player, difficulty: AiDifficulty): Move | null {
  switch (difficulty) {
    case 'beginner':     return randomMove(board, player);
    case 'intermediate': return greedyMove(board, player);
    case 'hard':         return minimaxMove(board, player);
    case 'master':       return alphaBetaMove(board, player);
  }
}
