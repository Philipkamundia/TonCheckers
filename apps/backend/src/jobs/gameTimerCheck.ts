/**
 * gameTimerCheck.ts — 1s timer expiry job (PRD §6)
 * Uses SettlementService for full ELO + payout settlement on timeout.
 */
import { Server } from 'socket.io';
import { GameTimerService } from '../services/game-timer.service.js';
import { GameService } from '../services/game.service.js';
import { SettlementService } from '../services/settlement.service.js';
import { GameRoomManager } from '../websocket/rooms/gameRoom.js';
import pool from '../config/db.js';
import { logger } from '../utils/logger.js';

export function startTimerCheckJob(io: Server): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      const expired = await GameTimerService.getExpiredGames();

      for (const { gameId, timedOutPlayer } of expired) {
        const game = await GameService.getGame(gameId);
        if (!game || game.status !== 'active') {
          await GameTimerService.clearTimer(gameId);
          continue;
        }

        const winnerId = timedOutPlayer === 1 ? game.player2Id! : game.player1Id;
        const loserId  = timedOutPlayer === 1 ? game.player1Id  : game.player2Id!;

        await GameTimerService.clearTimer(gameId);

        // AI games (mode='ai') — no financial settlement, just end the game
        if (game.mode === 'ai') {
          await pool.query(
            `UPDATE games SET status='completed', ended_at=NOW(), updated_at=NOW() WHERE id=$1`,
            [gameId],
          );
          io.to(`game:${gameId}`).emit('ai.end', {
            gameId,
            result:  'win',
            winner:  timedOutPlayer === 1 ? 2 : 1,
            reason:  'timeout',
            board:   game.boardState?.board,
            message: timedOutPlayer === 1 ? '⏱ Time\'s up! AI wins.' : '⏱ Time\'s up! You win!',
          });
          // Also emit to user room since AI game room may not be joined
          io.to(`user:${game.player1Id}`).emit('ai.end', {
            gameId, result: 'win', winner: timedOutPlayer === 1 ? 2 : 1, reason: 'timeout',
          });
          GameRoomManager.remove(gameId);
          logger.info(`AI timeout: game=${gameId} timedOut=player${timedOutPlayer}`);
          continue;
        }

        const result = await SettlementService.settleWin(
          gameId, winnerId, loserId, 'timeout', game.stake, io,
        );
        if (result.alreadySettled) { GameRoomManager.remove(gameId); continue; }

        io.to(`game:${gameId}`).emit('game.tick', { gameId, remainingMs: 0 });
        io.to(`game:${gameId}`).emit('game.end', {
          gameId,
          result:        'win',
          winner:        timedOutPlayer === 1 ? 2 : 1,
          reason:        'timeout',
          timedOutPlayer,
          winnerId,
          loserId,
          winnerPayout:  result.winnerPayout,
          platformFee:   result.platformFee,
          prizePool:     result.prizePool,
          stake:         result.stake,
          eloChanges:    result.eloChanges,
        });

        GameRoomManager.remove(gameId);
        logger.info(`Timeout: game=${gameId} timedOut=player${timedOutPlayer}`);
      }
    } catch (err) {
      logger.error(`Timer job: ${(err as Error).message}`);
    }
  }, 1_000);
}
