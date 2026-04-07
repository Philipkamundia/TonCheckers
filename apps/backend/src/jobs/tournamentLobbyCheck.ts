/**
 * tournamentLobbyCheck.ts — runs every 2s
 *
 * Checks for expired tournament lobbies (10s window elapsed).
 * If only one player joined → they win by forfeit.
 * If neither joined → cancel the match and eliminate both (treat as double forfeit,
 *   higher-seeded player advances — handled by giving the win to player1 by convention).
 */
import { Server } from 'socket.io';
import { TournamentLobbyService } from '../services/tournament-lobby.service.js';
import { TournamentService } from '../services/tournament.service.js';
import { logger } from '../utils/logger.js';

export function startTournamentLobbyCheck(io: Server): ReturnType<typeof setInterval> {
  logger.info('Tournament lobby check: every 2s');
  return setInterval(async () => {
    try {
      const expired = await TournamentLobbyService.getExpiredLobbies();
      for (const { gameId, meta } of expired) {
        // Read joined players BEFORE clearing — clearing deletes the players key
        const joined = await TournamentLobbyService.getJoinedPlayers(gameId);
        await TournamentLobbyService.clearLobby(gameId);

        let winnerId: string;
        let loserId:  string;

        if (joined.includes(meta.player1Id) && !joined.includes(meta.player2Id)) {
          winnerId = meta.player1Id;
          loserId  = meta.player2Id;
        } else if (joined.includes(meta.player2Id) && !joined.includes(meta.player1Id)) {
          winnerId = meta.player2Id;
          loserId  = meta.player1Id;
        } else {
          // Neither or both joined but game wasn't activated — shouldn't happen,
          // but if neither showed up, player1 advances (higher seed by bracket order)
          winnerId = meta.player1Id;
          loserId  = meta.player2Id;
        }

        logger.warn(`Tournament lobby forfeit: game=${gameId} winner=${winnerId} loser=${loserId}`);

        // Notify loser
        io.to(`user:${loserId}`).emit('tournament.lobby_forfeit', {
          gameId,
          tournamentId: meta.tournamentId,
          reason: 'Did not join lobby in time',
        });

        // Notify winner
        io.to(`user:${winnerId}`).emit('tournament.lobby_win', {
          gameId,
          tournamentId: meta.tournamentId,
          reason: 'Opponent did not join lobby',
        });

        // Record result in bracket — this advances the round
        await TournamentService.recordMatchResult(
          meta.tournamentId, meta.matchId, winnerId, io,
        );
      }
    } catch (err) {
      logger.error(`Tournament lobby check error: ${(err as Error).message}`);
    }
  }, 2_000);
}
