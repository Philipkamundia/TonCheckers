/**
 * tournamentStartCheck.ts — 30s job (PRD §9)
 * Auto-starts tournaments at start time regardless of fill status.
 * Sends "starting soon" Telegram notifications 30 minutes before.
 * Recovers tournaments where checkRoundComplete was interrupted after COMMIT.
 */
import { Server } from 'socket.io';
import pool from '../config/db.js';
import { TournamentService } from '../services/tournament.service.js';
import { NotificationService } from '../services/notification.service.js';
import { logger } from '../utils/logger.js';

export function startTournamentStartCheck(io: Server): ReturnType<typeof setInterval> {
  logger.info('Tournament start check: every 30s');
  return setInterval(async () => {
    try {
      await checkDue(io);
      await checkStuckRounds(io);
      await notifyUpcoming(io);
    } catch (err) {
      logger.error(`Tournament check error: ${(err as Error).message}`);
    }
  }, 30_000);
}

async function checkDue(io: Server): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id FROM tournaments WHERE status='open' AND starts_at <= NOW()`,
  );
  for (const { id } of rows) {
    try {
      await TournamentService.startTournament(id, io);
    } catch (err) {
      logger.error(`Start failed: ${id}: ${(err as Error).message}`);
    }
  }
}

/**
 * Recover tournaments where the server crashed after COMMIT in recordMatchResult
 * but before checkRoundComplete generated the next round.
 *
 * Detection: in_progress tournament where current_round has no pending non-bye matches
 * AND no matches exist for current_round + 1 (next round not generated yet).
 * Wait at least 2 minutes before recovering to avoid racing with an in-flight checkRoundComplete.
 */
async function checkStuckRounds(io: Server): Promise<void> {
  const { rows } = await pool.query(
    `SELECT t.id, t.current_round AS "currentRound"
     FROM tournaments t
     WHERE t.status = 'in_progress'
       AND t.updated_at < NOW() - INTERVAL '2 minutes'
       AND NOT EXISTS (
         -- No pending non-bye matches in current round
         SELECT 1 FROM tournament_matches m
         WHERE m.tournament_id = t.id
           AND m.round = t.current_round
           AND m.is_bye = false
           AND m.winner_id IS NULL
       )
       AND NOT EXISTS (
         -- Next round hasn't been generated yet
         SELECT 1 FROM tournament_matches m
         WHERE m.tournament_id = t.id
           AND m.round = t.current_round + 1
       )`,
  );

  for (const { id, currentRound } of rows) {
    try {
      logger.warn(`Tournament recovery: stuck at round ${currentRound} for tournament=${id} — re-running checkRoundComplete`);
      await TournamentService.recoverStuckRound(id, currentRound, io);
    } catch (err) {
      logger.error(`Tournament round recovery failed: ${id}: ${(err as Error).message}`);
    }
  }
}

/** PRD §11: "Tournament Starting Soon" — 30 min before */
async function notifyUpcoming(io: Server): Promise<void> {
  const in30 = new Date(Date.now() + 30 * 60_000);
  const in29 = new Date(Date.now() + 29 * 60_000);

  const { rows } = await pool.query(
    `SELECT t.id, t.name, ARRAY_AGG(p.user_id) AS uids
     FROM tournaments t
     JOIN tournament_participants p ON p.tournament_id=t.id
     WHERE t.status='open' AND t.starts_at BETWEEN $1 AND $2
     GROUP BY t.id, t.name`,
    [in29, in30],
  );

  for (const t of rows) {
    for (const uid of (t.uids as string[])) {
      await NotificationService.send(uid, 'tournament_starting', { name: t.name });
      io.to(`user:${uid}`).emit('tournament.starting_soon', { tournamentId: t.id, name: t.name, minutesUntil: 30 });
    }
  }
}
