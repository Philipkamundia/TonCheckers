/**
 * tournamentBracketHandler.ts
 *
 * Client emits tournament.bracket_join when they land on the bracket screen.
 * Records them as present for the 30s window.
 */
import { Socket } from 'socket.io';
import { TournamentBracketService } from '../../services/tournament-bracket.service.js';
import { logger } from '../../utils/logger.js';

export function registerTournamentBracketHandlers(socket: Socket): void {
  const userId = (socket as Socket & { userId: string }).userId;

  socket.on('tournament.bracket_join', async ({ tournamentId }: { tournamentId: string }) => {
    try {
      const ok = await TournamentBracketService.playerJoined(tournamentId, userId);
      if (ok) {
        socket.emit('tournament.bracket_joined', { tournamentId });
        logger.info(`Bracket presence: tournament=${tournamentId} user=${userId}`);
      } else {
        // Window already closed
        socket.emit('tournament.bracket_expired', { tournamentId });
      }
    } catch (err) {
      logger.error(`tournament.bracket_join: ${(err as Error).message}`);
    }
  });
}
