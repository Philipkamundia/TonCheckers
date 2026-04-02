/**
 * gameTimerCheck.ts — 1s timer expiry job (PRD §6)
 * Uses SettlementService for full ELO + payout settlement on timeout.
 */
import { Server } from 'socket.io';
import { GameTimerService } from '../services/game-timer.service.js';
import { GameService } from '../services/game.service.js';
import { SettlementService } from '../services/settlement.service.js';
import { GameRoomManager } from '../websocket/rooms/gameRoom.js';
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
        const result = await SettlementService.settleWin(
          gameId, winnerId, loserId, 'timeout', game.stake, io,
        );

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

        io.to(`game:${gameId}`).emit('game.tick', { gameId, remainingMs: 0 });
        GameRoomManager.remove(gameId);
        logger.info(`Timeout: game=${gameId} timedOut=player${timedOutPlayer}`);
      }
    } catch (err) {
      logger.error(`Timer job: ${(err as Error).message}`);
    }
  }, 1_000);
}
