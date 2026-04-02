/**
 * TournamentService — Full tournament lifecycle management
 *
 * PRD §9: Create, join, start, bracket, advance, prize distribution, cancel
 */
import pool from '../config/db.js';
import { BalanceService } from './balance.service.js';
import { BracketService } from './bracket.service.js';
import { NotificationService } from './notification.service.js';
import { GameService } from './game.service.js';
import { GameTimerService } from './game-timer.service.js';
import { initialGameState } from '../engine/board.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import type { Server } from 'socket.io';

const VALID_BRACKET_SIZES = [8, 16, 32, 64];

export class TournamentService {

  // ─── Create ───────────────────────────────────────────────────────────────

  static async createTournament(
    creatorId:   string,
    name:        string,
    bracketSize: number,
    entryFee:    string,
    startsAt:    string,
  ) {
    if (!VALID_BRACKET_SIZES.includes(bracketSize)) {
      throw new AppError(400, `Bracket size must be one of ${VALID_BRACKET_SIZES.join(', ')}`, 'INVALID_BRACKET_SIZE');
    }
    if (parseFloat(entryFee) < 0) throw new AppError(400, 'Entry fee cannot be negative', 'INVALID_ENTRY_FEE');

    const startDate = new Date(startsAt);
    if (isNaN(startDate.getTime()) || startDate <= new Date()) {
      throw new AppError(400, 'Start time must be a valid future date', 'INVALID_START_TIME');
    }

    const { rows: [t] } = await pool.query(
      `INSERT INTO tournaments (creator_id, name, bracket_size, entry_fee, starts_at, status)
       VALUES ($1,$2,$3,$4,$5,'open')
       RETURNING id, name, bracket_size AS "bracketSize", entry_fee::text AS "entryFee",
                 prize_pool::text AS "prizePool", status, starts_at AS "startsAt",
                 created_at AS "createdAt"`,
      [creatorId, name, bracketSize, entryFee, startDate],
    );

    logger.info(`Tournament created: id=${t.id} by=${creatorId} size=${bracketSize} fee=${entryFee}`);
    return t;
  }

  // ─── Join ─────────────────────────────────────────────────────────────────

  static async joinTournament(tournamentId: string, userId: string) {
    const { rows: [t] } = await pool.query(
      `SELECT id, status, bracket_size, entry_fee::text AS "entryFee", prize_pool::text AS "prizePool"
       FROM tournaments WHERE id=$1`,
      [tournamentId],
    );
    if (!t) throw new AppError(404, 'Tournament not found', 'NOT_FOUND');
    if (t.status !== 'open') throw new AppError(400, 'Tournament is not accepting registrations', 'TOURNAMENT_CLOSED');

    // Check not already joined
    const { rows: existing } = await pool.query(
      'SELECT 1 FROM tournament_participants WHERE tournament_id=$1 AND user_id=$2',
      [tournamentId, userId],
    );
    if (existing.length) throw new AppError(409, 'Already registered', 'ALREADY_REGISTERED');

    // Deduct entry fee before transaction (throws if insufficient)
    const fee = parseFloat(t.entryFee);
    if (fee > 0) await BalanceService.deductBalance(userId, t.entryFee);

    const { rows: [user] } = await pool.query('SELECT elo FROM users WHERE id=$1', [userId]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the tournament row and recheck bracket capacity atomically
      const { rows: [locked] } = await client.query(
        `SELECT bracket_size,
                (SELECT COUNT(*)::int FROM tournament_participants WHERE tournament_id=$1) AS participant_count
         FROM tournaments WHERE id=$1 FOR UPDATE`,
        [tournamentId],
      );
      if (locked.participant_count >= locked.bracket_size) {
        await client.query('ROLLBACK');
        if (fee > 0) await BalanceService.creditBalance(userId, t.entryFee);
        throw new AppError(400, 'Tournament is full', 'TOURNAMENT_FULL');
      }

      await client.query(
        `INSERT INTO tournament_participants (tournament_id, user_id, seed_elo)
         VALUES ($1,$2,$3)`,
        [tournamentId, userId, user.elo],
      );

      // Add entry fee to prize pool
      await client.query(
        `UPDATE tournaments SET prize_pool=prize_pool+$1::numeric, updated_at=NOW() WHERE id=$2`,
        [t.entryFee, tournamentId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if (fee > 0 && !(err instanceof AppError && err.code === 'TOURNAMENT_FULL')) {
        await BalanceService.creditBalance(userId, t.entryFee);
      }
      throw err;
    } finally {
      client.release();
    }

    logger.info(`Tournament join: tournament=${tournamentId} user=${userId}`);
    return { tournamentId, userId, entryFee: t.entryFee };
  }

  // ─── List / Detail ────────────────────────────────────────────────────────

  static async listTournaments(status?: string) {
    const whereClause = status ? `WHERE t.status=$1` : '';
    const params      = status ? [status] : [];

    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.status, t.bracket_size AS "bracketSize",
              t.entry_fee::text AS "entryFee", t.prize_pool::text AS "prizePool",
              t.current_round AS "currentRound", t.starts_at AS "startsAt",
              t.created_at AS "createdAt",
              u.username AS "creatorUsername",
              COUNT(p.user_id)::int AS "participantCount"
       FROM tournaments t
       JOIN users u ON u.id=t.creator_id
       LEFT JOIN tournament_participants p ON p.tournament_id=t.id
       ${whereClause}
       GROUP BY t.id, u.username
       ORDER BY t.starts_at ASC`,
      params,
    );
    return rows;
  }

  static async getTournamentDetail(tournamentId: string) {
    const { rows: [t] } = await pool.query(
      `SELECT t.*, t.entry_fee::text AS "entryFee", t.prize_pool::text AS "prizePool",
              u.username AS "creatorUsername"
       FROM tournaments t JOIN users u ON u.id=t.creator_id WHERE t.id=$1`,
      [tournamentId],
    );
    if (!t) throw new AppError(404, 'Tournament not found', 'NOT_FOUND');

    const { rows: participants } = await pool.query(
      `SELECT p.user_id AS "userId", u.username, u.elo, p.seed_elo AS "seedElo",
              p.is_eliminated AS "isEliminated", p.received_bye AS "receivedBye",
              p.current_round AS "currentRound"
       FROM tournament_participants p JOIN users u ON u.id=p.user_id
       WHERE p.tournament_id=$1 ORDER BY p.seed_elo DESC`,
      [tournamentId],
    );

    const { rows: matches } = await pool.query(
      `SELECT m.id, m.round, m.match_number AS "matchNumber",
              m.player1_id AS "player1Id", m.player2_id AS "player2Id",
              m.winner_id AS "winnerId", m.is_bye AS "isBye", m.game_id AS "gameId"
       FROM tournament_matches m WHERE m.tournament_id=$1 ORDER BY m.round, m.match_number`,
      [tournamentId],
    );

    return { ...t, participants, matches };
  }

  // ─── Start (called by the 30s job) ───────────────────────────────────────

  static async startTournament(tournamentId: string, io: Server): Promise<void> {
    const { rows: [t] } = await pool.query(
      `SELECT id, name, status, bracket_size AS "bracketSize",
              entry_fee::text AS "entryFee", prize_pool::text AS "prizePool",
              creator_id AS "creatorId"
       FROM tournaments WHERE id=$1`,
      [tournamentId],
    );
    if (!t || t.status !== 'open') return;

    const { rows: participants } = await pool.query(
      `SELECT p.user_id AS "userId", p.seed_elo AS "seedElo"
       FROM tournament_participants p WHERE p.tournament_id=$1`,
      [tournamentId],
    );

    // PRD §9: 0 or 1 participants → cancel, refund all
    if (participants.length <= 1) {
      await TournamentService.cancelTournament(tournamentId, 'Insufficient participants');
      return;
    }

    // Generate bracket
    const { matches, byePlayers } = BracketService.generateRound1(
      participants.map(p => ({ userId: p.userId, seedElo: p.seedElo })),
      t.bracketSize,
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update tournament status
      await client.query(
        `UPDATE tournaments SET status='in_progress', current_round=1,
           started_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [tournamentId],
      );

      // Mark bye players
      for (const userId of byePlayers) {
        await client.query(
          `UPDATE tournament_participants SET received_bye=true, current_round=2
           WHERE tournament_id=$1 AND user_id=$2`,
          [tournamentId, userId],
        );
      }

      // Insert match records and create games for non-bye matches
      for (const m of matches) {
        if (m.isBye) {
          await client.query(
            `INSERT INTO tournament_matches (tournament_id, round, match_number, player1_id, is_bye, winner_id)
             VALUES ($1,$2,$3,$4,true,$4)`,
            [tournamentId, m.round, m.matchNumber, m.player1Id],
          );
          continue;
        }

        // Create the actual game — pass client so it's part of the transaction
        const { rows: [p1] } = await client.query('SELECT elo FROM users WHERE id=$1', [m.player1Id]);
        const { rows: [p2] } = await client.query('SELECT elo FROM users WHERE id=$1', [m.player2Id]);

        const game = await GameService.createGame(
          m.player1Id!, m.player2Id!, '0', // no stake in tournament
          p1?.elo ?? 1200, p2?.elo ?? 1200,
          initialGameState(),
          client,
        );

        await client.query(
          `INSERT INTO tournament_matches
             (tournament_id, game_id, round, match_number, player1_id, player2_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tournamentId, game.id, m.round, m.matchNumber, m.player1Id, m.player2Id],
        );

        // Start 30s move timer for tournament games
        await GameTimerService.startTimer(game.id, 1);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Tournament start failed: ${tournamentId}: ${(err as Error).message}`);
      throw err;
    } finally {
      client.release();
    }

    // Notify all participants
    for (const p of participants) {
      await NotificationService.send(p.userId, 'tournament_match_ready', {
        tournamentName: t.name,
        round: 1,
      });
      io.to(`user:${p.userId}`).emit('tournament.match_ready', {
        tournamentId,
        round: 1,
      });
    }

    logger.info(`Tournament started: ${tournamentId} players=${participants.length} byes=${byePlayers.length}`);
  }

  // ─── Advance round after a match completes ────────────────────────────────

  static async recordMatchResult(
    tournamentId: string,
    matchId:      string,
    winnerId:     string,
    io:           Server,
  ): Promise<void> {
    const client = await pool.connect();
    let matchRound: number;
    try {
      await client.query('BEGIN');

      // Record winner
      const { rows: [match] } = await client.query(
        `UPDATE tournament_matches SET winner_id=$1
         WHERE id=$2 AND tournament_id=$3 RETURNING round, match_number`,
        [winnerId, matchId, tournamentId],
      );
      matchRound = match.round;

      // Update participant
      await client.query(
        `UPDATE tournament_participants SET current_round=current_round+1
         WHERE tournament_id=$1 AND user_id=$2`,
        [tournamentId, winnerId],
      );
      await client.query(
        // Loser is eliminated
        `UPDATE tournament_participants SET is_eliminated=true
         WHERE tournament_id=$1 AND user_id != $2
           AND user_id IN (
             SELECT player1_id FROM tournament_matches WHERE id=$3
             UNION
             SELECT player2_id FROM tournament_matches WHERE id=$3
           )`,
        [tournamentId, winnerId, matchId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Called after COMMIT so a failure here doesn't trigger ROLLBACK on committed tx
    await TournamentService.checkRoundComplete(tournamentId, matchRound!, io);
  }

  private static async checkRoundComplete(
    tournamentId: string, round: number, io: Server,
  ): Promise<void> {
    // Check if all non-bye matches in this round have a winner
    const { rows: pending } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM tournament_matches
       WHERE tournament_id=$1 AND round=$2 AND winner_id IS NULL AND is_bye=false`,
      [tournamentId, round],
    );

    if (pending[0].count > 0) return; // Round still in progress

    // Get all winners from this round (including byes)
    const { rows: winners } = await pool.query(
      `SELECT winner_id AS "winnerId" FROM tournament_matches
       WHERE tournament_id=$1 AND round=$2 ORDER BY match_number`,
      [tournamentId, round],
    );

    const winnerIds = winners.map((w: { winnerId: string }) => w.winnerId).filter(Boolean);

    // Check if tournament is over (only 1 winner left)
    if (winnerIds.length === 1) {
      await TournamentService.finalizeTournament(tournamentId, winnerIds[0], io);
      return;
    }

    // Generate next round
    const nextRound   = round + 1;
    const newMatches  = BracketService.generateNextRound(winnerIds, nextRound);

    await pool.query(
      `UPDATE tournaments SET current_round=$1, updated_at=NOW() WHERE id=$2`,
      [nextRound, tournamentId],
    );

    for (const m of newMatches) {
      if (m.isBye && m.player1Id) {
        await pool.query(
          `INSERT INTO tournament_matches (tournament_id, round, match_number, player1_id, is_bye, winner_id)
           VALUES ($1,$2,$3,$4,true,$4)`,
          [tournamentId, nextRound, m.matchNumber, m.player1Id],
        );
        continue;
      }

      const { rows: [p1] } = await pool.query('SELECT elo FROM users WHERE id=$1', [m.player1Id]);
      const { rows: [p2] } = await pool.query('SELECT elo FROM users WHERE id=$1', [m.player2Id]);

      const game = await GameService.createGame(
        m.player1Id!, m.player2Id!, '0',
        p1?.elo ?? 1200, p2?.elo ?? 1200,
        initialGameState(),
      );

      await pool.query(
        `INSERT INTO tournament_matches
           (tournament_id, game_id, round, match_number, player1_id, player2_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tournamentId, game.id, nextRound, m.matchNumber, m.player1Id, m.player2Id],
      );

      await GameTimerService.startTimer(game.id, 1);
    }

    // Notify participants of new round
    const { rows: [t] } = await pool.query('SELECT name FROM tournaments WHERE id=$1', [tournamentId]);
    for (const userId of winnerIds) {
      await NotificationService.send(userId, 'tournament_match_ready', {
        tournamentName: t?.name, round: nextRound,
      });
      io.to(`user:${userId}`).emit('tournament.match_ready', { tournamentId, round: nextRound });
    }

    logger.info(`Tournament round ${nextRound} started: ${tournamentId}`);
  }

  // ─── Finalize ─────────────────────────────────────────────────────────────

  static async finalizeTournament(
    tournamentId: string, winnerId: string, io: Server,
  ): Promise<void> {
    const { rows: [t] } = await pool.query(
      `SELECT name, prize_pool::text AS "prizePool", creator_id AS "creatorId"
       FROM tournaments WHERE id=$1`,
      [tournamentId],
    );

    const { winnerPayout, creatorPayout, platformFee } = BracketService.calculatePrizes(t.prizePool);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE tournaments SET status='completed', winner_id=$1,
           winner_payout=$2, creator_payout=$3, platform_fee=$4,
           completed_at=NOW(), updated_at=NOW() WHERE id=$5`,
        [winnerId, winnerPayout, creatorPayout, platformFee, tournamentId],
      );

      // Credit winner
      await client.query(
        `UPDATE balances SET available=available+$1::numeric, updated_at=NOW() WHERE user_id=$2`,
        [winnerPayout, winnerId],
      );
      await client.query(
        `UPDATE users SET total_won=total_won+$1::numeric, updated_at=NOW() WHERE id=$2`,
        [winnerPayout, winnerId],
      );

      // Credit creator — if winner is also the creator, merge into one credit
      if (t.creatorId !== winnerId) {
        await client.query(
          `UPDATE balances SET available=available+$1::numeric, updated_at=NOW() WHERE user_id=$2`,
          [creatorPayout, t.creatorId],
        );
      } else {
        // Winner is the creator — add creator fee on top of winner payout already credited
        await client.query(
          `UPDATE balances SET available=available+$1::numeric, updated_at=NOW() WHERE user_id=$2`,
          [creatorPayout, winnerId],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Notify winner
    await NotificationService.send(winnerId, 'tournament_result', {
      won: true, tournamentName: t.name, payout: winnerPayout,
    });
    io.to(`user:${winnerId}`).emit('tournament.completed', {
      tournamentId, winnerId, winnerPayout, creatorPayout, platformFee,
    });

    logger.info(`Tournament complete: ${tournamentId} winner=${winnerId} payout=${winnerPayout}`);
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────

  static async cancelTournament(tournamentId: string, reason: string): Promise<void> {
    const { rows: [t] } = await pool.query(
      `SELECT entry_fee::text AS "entryFee" FROM tournaments WHERE id=$1`, [tournamentId],
    );

    await pool.query(
      `UPDATE tournaments SET status='cancelled', updated_at=NOW() WHERE id=$1`, [tournamentId],
    );

    // Refund all entry fees
    const { rows: participants } = await pool.query(
      'SELECT user_id AS "userId" FROM tournament_participants WHERE tournament_id=$1',
      [tournamentId],
    );

    for (const p of participants) {
      if (parseFloat(t.entryFee) > 0) {
        await BalanceService.creditBalance(p.userId, t.entryFee);
      }
    }

    logger.info(`Tournament cancelled: ${tournamentId} reason=${reason} refunded=${participants.length} players`);
  }
}
