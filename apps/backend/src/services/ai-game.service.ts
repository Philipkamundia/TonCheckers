/**
 * AiGameService — AI practice game management (PRD §8)
 *
 * Rules:
 * - No TON wagered
 * - No ELO impact
 * - Full PRD §5 rule enforcement
 * - Same 30s move timer as PvP
 * - 4 difficulty levels
 */

import pool from '../config/db.js';
import { GameTimerService } from './game-timer.service.js';
import { initialGameState } from '../engine/board.js';
import { getAvailableMoves, applyMoveWithPromotion, nextGameState,
         hashBoardState, checkWinCondition, type Player } from '../engine/index.js';
import { getAiMove, type AiDifficulty } from '../engine/ai/index.js';
import { logger } from '../utils/logger.js';
import type { Server } from 'socket.io';

export class AiGameService {

  /** Create a new AI game record and return the game ID */
  static async createAiGame(
    userId:     string,
    difficulty: AiDifficulty,
  ): Promise<{ gameId: string; initialBoard: ReturnType<typeof initialGameState>['board'] }> {
    const state = initialGameState();

    const { rows: [game] } = await pool.query(
      `INSERT INTO games
         (mode, status, player1_id, stake, board_state, active_player, ai_difficulty, started_at)
       VALUES ('ai', 'active', $1, 0, $2, 1, $3, NOW())
       RETURNING id`,
      [userId, state, difficulty],
    );

    await GameTimerService.startTimer(game.id, 1);
    logger.info(`AI game created: id=${game.id} user=${userId} difficulty=${difficulty}`);
    return { gameId: game.id, initialBoard: state.board };
  }

  /**
   * Process a human move in an AI game, then generate and apply AI response.
   * Returns the updated board state and AI move for the WebSocket handler.
   */
  static async processHumanMove(
    gameId: string,
    from:   { row: number; col: number },
    to:     { row: number; col: number },
    io:     Server,
  ): Promise<{
    valid:      boolean;
    reason?:    string;
    newState?:  ReturnType<typeof initialGameState>;
    aiMove?:    { from: { row: number; col: number }; to: { row: number; col: number } };
    gameOver?:  { result: string; winner?: Player; reason?: string };
  }> {
    // Load game
    const { rows: [game] } = await pool.query(
      `SELECT id, board_state AS "boardState", active_player AS "activePlayer",
              ai_difficulty AS "aiDifficulty", player1_id AS "player1Id"
       FROM games WHERE id=$1 AND mode='ai' AND status='active'`,
      [gameId],
    );
    if (!game) return { valid: false, reason: 'Game not found or not active' };
    if (game.activePlayer !== 1) return { valid: false, reason: 'Not your turn' };

    // Validate coordinate bounds
    const validCoord = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7;
    if (!validCoord(from?.row) || !validCoord(from?.col) || !validCoord(to?.row) || !validCoord(to?.col)) {
      return { valid: false, reason: 'Invalid coordinates' };
    }

    const state = game.boardState;

    // Validate and apply human move
    const legalMoves = getAvailableMoves(state.board, 1);
    const move = legalMoves.find(
      m => m.from.row === from.row && m.from.col === from.col &&
           m.to.row   === to.row   && m.to.col   === to.col,
    );
    if (!move) {
      logger.warn(`[AI] Illegal move game=${gameId} from=(${from.row},${from.col}) to=(${to.row},${to.col}) moveCount=${state.moveCount} legalCount=${legalMoves.length} legal=${JSON.stringify(legalMoves.map(m => ({ fr: m.from.row, fc: m.from.col, tr: m.to.row, tc: m.to.col })))} board=${JSON.stringify(state.board)}`);
      return { valid: false, reason: 'Illegal move' };
    }

    const afterHuman = applyMoveWithPromotion(state.board, move);
    const hash1      = hashBoardState(afterHuman, 2);
    const state1     = nextGameState(state, move, hash1, afterHuman);

    // Check if human won
    const afterHumanResult = checkWinCondition(afterHuman, 2, state1.boardHashHistory);
    if (afterHumanResult.status !== 'ongoing') {
      await pool.query(
        `UPDATE games SET status='completed', board_state=$1, ended_at=NOW(), updated_at=NOW() WHERE id=$2`,
        [state1, gameId],
      );
      await GameTimerService.clearTimer(gameId);
      return {
        valid: true, newState: state1,
        gameOver: {
          result: afterHumanResult.status,
          winner: afterHumanResult.status === 'win' ? afterHumanResult.winner : undefined,
          reason: afterHumanResult.status === 'win' ? afterHumanResult.reason : 'draw',
        },
      };
    }

    // AI takes its turn
    await GameTimerService.startTimer(gameId, 2);

    const difficulty = game.aiDifficulty as AiDifficulty;
    const aiMoveResult = getAiMove(state1.board, 2, difficulty);

    if (!aiMoveResult) {
      // AI has no moves — human wins
      await pool.query(
        `UPDATE games SET status='completed', board_state=$1, ended_at=NOW(), updated_at=NOW() WHERE id=$2`,
        [state1, gameId],
      );
      await GameTimerService.clearTimer(gameId);
      return {
        valid: true, newState: state1,
        gameOver: { result: 'win', winner: 1, reason: 'no_moves' },
      };
    }

    const afterAi  = applyMoveWithPromotion(state1.board, aiMoveResult);
    const hash2    = hashBoardState(afterAi, 1);
    const state2   = nextGameState(state1, aiMoveResult, hash2, afterAi);

    // Persist and reset timer for human's next turn
    await pool.query(
      `UPDATE games SET board_state=$1, active_player=1, move_count=$2, updated_at=NOW() WHERE id=$3`,
      [state2, state2.moveCount, gameId],
    );
    await GameTimerService.startTimer(gameId, 1);

    // Check if AI won
    const afterAiResult = checkWinCondition(afterAi, 1, state2.boardHashHistory);
    if (afterAiResult.status !== 'ongoing') {
      await pool.query(
        `UPDATE games SET status='completed', ended_at=NOW(), updated_at=NOW() WHERE id=$1`, [gameId],
      );
      await GameTimerService.clearTimer(gameId);
      return {
        valid: true, newState: state2,
        aiMove: { from: aiMoveResult.from, to: aiMoveResult.to },
        gameOver: {
          result: afterAiResult.status,
          winner: afterAiResult.status === 'win' ? afterAiResult.winner : undefined,
          reason: afterAiResult.status === 'win' ? afterAiResult.reason : 'draw',
        },
      };
    }

    return {
      valid:   true,
      newState: state2,
      aiMove:  { from: aiMoveResult.from, to: aiMoveResult.to },
    };
  }
}
