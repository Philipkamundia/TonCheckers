/**
 * tournamentStartCheck.ts — 30s job (PRD §9)
 * Auto-starts tournaments at start time regardless of fill status.
 * Sends "starting soon" Telegram notifications 30 minutes before.
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
