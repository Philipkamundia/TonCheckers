/**
 * leaderboardRebuild.ts — Rebuilds all 4 leaderboard caches every 5 minutes (PRD §10)
 */
import { LeaderboardService } from '../services/leaderboard.service.js';
import { logger } from '../utils/logger.js';

export function startLeaderboardRebuild(): ReturnType<typeof setInterval> {
  logger.info('Leaderboard rebuild job: every 5 minutes');
  // Run immediately on start
  LeaderboardService.rebuildAll().catch(err =>
    logger.error(`Leaderboard rebuild error: ${(err as Error).message}`)
  );
  return setInterval(() => {
    LeaderboardService.rebuildAll().catch(err =>
      logger.error(`Leaderboard rebuild error: ${(err as Error).message}`)
    );
  }, 5 * 60_000);
}
