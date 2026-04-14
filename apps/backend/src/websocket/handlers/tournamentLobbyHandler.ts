/**
 * tournamentLobbyHandler.ts
 *
 * Handles tournament.lobby_join events.
 * Presence is only recorded here.
 * Game activation/forfeit is resolved by tournamentLobbyCheck after full 10s window.
 */
import { Server, Socket } from 'socket.io';
import { TournamentLobbyService } from '../../services/tournament-lobby.service.js';
import { logger } from '../../utils/logger.js';

export function registerTournamentLobbyHandlers(io: Server, socket: Socket): void {
  const userId = (socket as Socket & { userId: string }).userId;

  /**
   * Client emits this when they land on the tournament lobby screen.
   * Payload: { gameId }
   */
  socket.on('tournament.lobby_join', async ({ gameId }: { gameId: string }) => {
    try {
      const { meta } = await TournamentLobbyService.playerJoined(gameId, userId);

      if (!meta) {
        // Lobby expired — tell client the match was forfeited
        socket.emit('tournament.lobby_expired', { gameId });
        return;
      }

      // Confirm to this player they're registered
      socket.emit('tournament.lobby_joined', { gameId, userId });

      logger.info(`Tournament lobby joined: game=${gameId} user=${userId} (awaiting full 10s window)`);
    } catch (err) {
      logger.error(`tournament.lobby_join: ${(err as Error).message}`);
    }
  });
}
