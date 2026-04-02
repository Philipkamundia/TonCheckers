/**
 * aiGameHandler.ts — WebSocket events for AI practice games (PRD §8)
 *
 * Events in:  ai.start, ai.move
 * Events out: ai.state, ai.move_ok, ai.move_invalid, ai.end
 *
 * No wagering, no ELO, full rule enforcement.
 */

import { Server, Socket } from 'socket.io';
import { AiGameService } from '../../services/ai-game.service.js';
import { type AiDifficulty } from '../../engine/ai/index.js';
import { logger } from '../../utils/logger.js';
import pool from '../../config/db.js';

export function registerAiGameHandlers(io: Server, socket: Socket): void {
  const userId = (socket as Socket & { userId: string }).userId;

  // ─── ai.start ─────────────────────────────────────────────────────────────
  socket.on('ai.start', async ({ difficulty }: { difficulty: AiDifficulty }) => {
    try {
      const validDifficulties: AiDifficulty[] = ['beginner', 'intermediate', 'hard', 'master'];
      if (!validDifficulties.includes(difficulty)) {
        return socket.emit('error', { message: 'Invalid difficulty' });
      }

      const { gameId, initialBoard } = await AiGameService.createAiGame(userId, difficulty);
      socket.join(`game:${gameId}`);

      socket.emit('ai.state', {
        gameId,
        difficulty,
        board:        initialBoard,
        activePlayer: 1,
        remainingMs:  30_000,
        message:      'AI game started — you are Player 1',
      });

      logger.debug(`AI game started: ${gameId} user=${userId} difficulty=${difficulty}`);
    } catch (err) {
      logger.error(`ai.start: ${(err as Error).message}`);
      socket.emit('error', { message: 'Failed to start AI game' });
    }
  });

  // ─── ai.state.request ────────────────────────────────────────────────────
  socket.on('ai.state.request', async ({ gameId }: { gameId: string }) => {
    try {
      const { rows: [game] } = await pool.query(
        `SELECT id, board_state AS "boardState", active_player AS "activePlayer", ai_difficulty AS "aiDifficulty"
         FROM games WHERE id=$1 AND mode='ai' AND player1_id=$2`,
        [gameId, userId],
      );
      if (!game) return socket.emit('error', { message: 'Game not found' });
      socket.join(`game:${gameId}`);
      socket.emit('ai.state', {
        gameId,
        difficulty: game.aiDifficulty,
        board:        game.boardState.board,
        activePlayer: game.activePlayer,
        remainingMs:  30_000,
      });
    } catch (err) {
      logger.error(`ai.state.request: ${(err as Error).message}`);
    }
  });
  socket.on('ai.move', async ({ gameId, from, to }: {
    gameId: string;
    from: { row: number; col: number };
    to:   { row: number; col: number };
  }) => {
    try {
      const result = await AiGameService.processHumanMove(gameId, from, to, io);

      if (!result.valid) {
        return socket.emit('ai.move_invalid', { gameId, reason: result.reason });
      }

      if (result.gameOver) {
        socket.emit('ai.end', {
          gameId,
          result:  result.gameOver.result,
          winner:  result.gameOver.winner,
          reason:  result.gameOver.reason,
          board:   result.newState?.board,
          message: result.gameOver.winner === 1 ? '🎉 You win!' : result.gameOver.result === 'draw' ? 'Draw!' : '🤖 AI wins!',
          note:    'Practice game — no ELO change, no wagering',
        });
        return;
      }

      socket.emit('ai.move_ok', {
        gameId,
        board:        result.newState?.board,
        aiMove:       result.aiMove,
        activePlayer: 1,
        remainingMs:  30_000,
      });

    } catch (err) {
      logger.error(`ai.move: ${(err as Error).message}`);
      socket.emit('ai.move_invalid', { gameId, reason: 'Server error' });
    }
  });

  // ─── ai.undo ──────────────────────────────────────────────────────────────
  socket.on('ai.undo', async ({ gameId }: { gameId: string }) => {
    try {
      const result = await AiGameService.undoLastMove(gameId, userId);
      if (!result.ok) return socket.emit('ai.undo_fail', { reason: result.reason });
      socket.emit('ai.state', { gameId, board: result.board, activePlayer: 1, remainingMs: 30_000 });
    } catch (err) {
      logger.error(`ai.undo: ${(err as Error).message}`);
    }
  });

  // ─── ai.restart ───────────────────────────────────────────────────────────
  socket.on('ai.restart', async ({ gameId }: { gameId: string }) => {
    try {
      const result = await AiGameService.restartGame(gameId, userId);
      if (!result.ok) return socket.emit('error', { message: result.reason });
      socket.emit('ai.state', { gameId, board: result.board, activePlayer: 1, remainingMs: 30_000 });
    } catch (err) {
      logger.error(`ai.restart: ${(err as Error).message}`);
    }
  });

  // ─── ai.tip ───────────────────────────────────────────────────────────────
  socket.on('ai.tip', async ({ gameId }: { gameId: string }) => {
    try {
      const result = await AiGameService.getTip(gameId, userId);
      if (!result.ok) return socket.emit('ai.tip_result', { ok: false, reason: result.reason });
      socket.emit('ai.tip_result', { ok: true, from: result.from, to: result.to });
    } catch (err) {
      logger.error(`ai.tip: ${(err as Error).message}`);
    }
  });
}
