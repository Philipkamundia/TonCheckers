/**
 * tournamentLobbyHandler.ts
 *
 * Handles tournament.lobby_join events.
 * When both players join → activate game (flip to 'active', start move timer).
 * The 10s forfeit for no-shows is handled by the tournamentLobbyCheck job.
 */
import { Server, Socket } from 'socket.io';
import { TournamentLobbyService } from '../../services/tournament-lobby.service.js';
import { GameService } from '../../services/game.service.js';
import { GameTimerService } from '../../services/game-timer.service.js';
import { logger } from '../../utils/logger.js';

export function registerTournamentLobbyHandlers(io: Server, socket: Socket): void {
  const userId = (socket as Socket & { userId: string }).userId;

  /**
   * Client emits this when they land on the tournament lobby screen.
   * Payload: { gameId }
   */
  socket.on('tournament.lobby_join', async ({ gameId }: { gameId: string }) => {
    try {
      const { bothPresent, meta } = await TournamentLobbyService.playerJoined(gameId, userId);

      if (!meta) {
        // Lobby expired — tell client the match was forfeited
        socket.emit('tournament.lobby_expired', { gameId });
        return;
      }

      // Confirm to this player they're registered
      socket.emit('tournament.lobby_joined', { gameId, userId });

      if (bothPresent) {
        // Use a Redis lock to prevent double-activation if both players join simultaneously
        const lockKey = `t:lobby:lock:${gameId}`;
        const locked  = await (await import('../../config/redis.js')).default.set(lockKey, '1', 'PX', 10_000, 'NX');
        if (!locked) return; // another concurrent call already handling this

        // Both players present — activate the game
        await GameService.activateGame(gameId);
        await GameTimerService.startTimer(gameId, 1);
        await TournamentLobbyService.clearLobby(gameId);

        io.to(`user:${meta.player1Id}`).emit('tournament.game_start', {
          gameId, tournamentId: meta.tournamentId, playerNumber: 1,
        });
        io.to(`user:${meta.player2Id}`).emit('tournament.game_start', {
          gameId, tournamentId: meta.tournamentId, playerNumber: 2,
        });

        logger.info(`Tournament lobby both present: game=${gameId} — game activated`);
      }
    } catch (err) {
      logger.error(`tournament.lobby_join: ${(err as Error).message}`);
    }
  });
}
