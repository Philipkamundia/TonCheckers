/**
 * tournamentBracketCheck.ts — runs every 2s
 *
 * When a bracket presence window expires (30s):
 *   - Present players → generate bracket from them, create games, open lobbies
 *   - Absent players  → mark eliminated (forfeit)
 *   - If 0 or 1 present → cancel tournament, refund all
 */
import { Server } from 'socket.io';
import { TournamentBracketService } from '../services/tournament-bracket.service.js';
import { TournamentService } from '../services/tournament.service.js';
import { logger } from '../utils/logger.js';

export function startTournamentBracketCheck(io: Server): ReturnType<typeof setInterval> {
  logger.info('Tournament bracket check: every 2s');
  return setInterval(async () => {
    try {
      const expired = await TournamentBracketService.getExpiredWindows();
      for (const { tournamentId, meta } of expired) {
        // Read present players then clear atomically
        const present = await TournamentBracketService.getPresentPlayers(tournamentId);
        await TournamentBracketService.clearWindow(tournamentId);

        logger.info(`Bracket window expired: tournament=${tournamentId} present=${present.length}/${meta.participants.length}`);

        try {
          await TournamentService.resolveBracketWindow(tournamentId, present, meta.participants, io);
        } catch (err) {
          logger.error(`Bracket resolve failed: tournament=${tournamentId}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      logger.error(`Tournament bracket check error: ${(err as Error).message}`);
    }
  }, 2_000);
}
