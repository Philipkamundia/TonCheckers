import { Server } from 'socket.io';
import { TournamentRoundPreviewService } from '../services/tournament-round-preview.service.js';
import { TournamentService } from '../services/tournament.service.js';
import { logger } from '../utils/logger.js';

export function startTournamentRoundPreviewCheck(io: Server): ReturnType<typeof setInterval> {
  logger.info('Tournament round preview check: every 2s');
  return setInterval(async () => {
    try {
      const expired = await TournamentRoundPreviewService.getExpiredWindows();
      for (const preview of expired) {
        await TournamentRoundPreviewService.clearWindow(preview.tournamentId);
        for (const match of preview.matches) {
          try {
            await TournamentService.activateRoundMatchLobby(
              preview.tournamentId,
              preview.round,
              match,
              io,
            );
          } catch (err) {
            logger.error(
              `Round preview activation failed: tournament=${preview.tournamentId} round=${preview.round} game=${match.gameId}: ${(err as Error).message}`,
            );
          }
        }
      }
    } catch (err) {
      logger.error(`Tournament round preview check error: ${(err as Error).message}`);
    }
  }, 2_000);
}
