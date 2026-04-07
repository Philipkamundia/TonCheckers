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
import { TournamentLobbyService } from './tournament-lobby.service.js';
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

    // Check not already joined (fast pre-check before acquiring locks)
    const { rows: existing } = await pool.query(
      'SELECT 1 FROM tournament_participants WHERE tournament_id=$1 AND user_id=$2',
      [tournamentId, userId],
    );
    if (existing.length) throw new AppError(409, 'Already registered', 'ALREADY_REGISTERED');

    const { rows: [user] } = await pool.query('SELECT elo FROM users WHERE id=$1', [userId]);
    const fee = parseFloat(t.entryFee);

    // Everything in one transaction: capacity check + balance deduction + participant insert
    // This eliminates the window where balance is deducted but join fails with no recovery.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock tournament row and recheck capacity atomically
      const { rows: [locked] } = await client.query(
        `SELECT bracket_size,
                (SELECT COUNT(*)::int FROM tournament_participants WHERE tournament_id=$1) AS participant_count
         FROM tournaments WHERE id=$1 FOR UPDATE`,
        [tournamentId],
      );
      if (locked.participant_count >= locked.bracket_size) {
        await client.query('ROLLBACK');
        throw new AppError(400, 'Tournament is full', 'TOURNAMENT_FULL');
      }

      // Deduct entry fee inside the transaction — if anything below fails, this rolls back too
      if (fee > 0) {
        const { rowCount } = await client.query(
          `UPDATE balances
           SET available = available - $1::numeric, updated_at = NOW()
           WHERE user_id = $2 AND available >= $1::numeric`,
          [t.entryFee, userId],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          throw new AppError(400, 'Insufficient balance', 'INSUFFICIENT_BALANCE');
        }
      }

      // Insert participant
      await client.query(
        `INSERT INTO tournament_participants (tournament_id, user_id, seed_elo)
         VALUES ($1,$2,$3)`,
        [tournamentId, userId, user.elo],
      );

      // Add entry fee to prize pool
      if (fee > 0) {
        await client.query(
          `UPDATE tournaments SET prize_pool=prize_pool+$1::numeric, updated_at=NOW() WHERE id=$2`,
          [t.entryFee, tournamentId],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
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
      `SELECT t.id, t.name, t.status,
              t.bracket_size      AS "bracketSize",
              t.entry_fee::text   AS "entryFee",
              t.prize_pool::text  AS "prizePool",
              t.current_round     AS "currentRound",
              t.starts_at         AS "startsAt",
              t.started_at        AS "startedAt",
              t.completed_at      AS "completedAt",
              t.winner_id         AS "winnerId",
              t.winner_payout::text AS "winnerPayout",
              t.creator_id        AS "creatorId",
              t.created_at        AS "createdAt",
              u.username          AS "creatorUsername"
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
      await TournamentService.cancelTournament(tournamentId, 'Insufficient participants', io);
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

        // Create game in 'waiting' status — activates once both players join lobby
        const { rows: [p1] } = await client.query('SELECT elo FROM users WHERE id=$1', [m.player1Id]);
        const { rows: [p2] } = await client.query('SELECT elo FROM users WHERE id=$1', [m.player2Id]);

        const game = await GameService.createGame(
          m.player1Id!, m.player2Id!, '0',
          p1?.elo ?? 1200, p2?.elo ?? 1200,
          initialGameState(),
          client,
          'waiting',
        );

        await client.query(
          `INSERT INTO tournament_matches
             (tournament_id, game_id, round, match_number, player1_id, player2_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tournamentId, game.id, m.round, m.matchNumber, m.player1Id, m.player2Id],
        );

        // Store match row id for lobby creation (after commit)
        (m as any)._gameId   = game.id;
        (m as any)._matchId  = null; // resolved after commit below
        (m as any)._p1Uname  = p1;
        (m as any)._p2Uname  = p2;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Tournament start failed: ${tournamentId}: ${(err as Error).message}`);
      throw err;
    } finally {
      client.release();
    }

    // After commit — create lobbies and notify players per match
    const userCache = new Map<string, { username: string; elo: number }>();
    for (const p of participants) {
      const { rows: [u] } = await pool.query('SELECT username, elo FROM users WHERE id=$1', [p.userId]);
      if (u) userCache.set(p.userId, u);
    }

    for (const m of matches) {
      if (m.isBye) {
        // Bye player advances — notify them
        const byeUser = userCache.get(m.player1Id!);
        await NotificationService.send(m.player1Id!, 'tournament_match_ready', {
          tournamentName: t.name, round: 1,
        });
        io.to(`user:${m.player1Id}`).emit('tournament.bye_advance', {
          tournamentId, round: 1, username: byeUser?.username,
        });
        continue;
      }

      const gameId  = (m as any)._gameId as string;
      const { rows: [matchRow] } = await pool.query(
        `SELECT id FROM tournament_matches WHERE tournament_id=$1 AND game_id=$2`,
        [tournamentId, gameId],
      );

      await TournamentLobbyService.createLobby(
        gameId, tournamentId, matchRow.id, m.player1Id!, m.player2Id!,
      );

      const p1Info = userCache.get(m.player1Id!) ?? { username: 'Opponent', elo: 1200 };
      const p2Info = userCache.get(m.player2Id!) ?? { username: 'Opponent', elo: 1200 };

      // Notify each player with their opponent's info
      await NotificationService.send(m.player1Id!, 'tournament_match_ready', { tournamentName: t.name, round: 1 });
      io.to(`user:${m.player1Id}`).emit('tournament.lobby_ready', {
        tournamentId, gameId, round: 1,
        opponentId:       m.player2Id,
        opponentUsername: p2Info.username,
        opponentElo:      p2Info.elo,
      });

      await NotificationService.send(m.player2Id!, 'tournament_match_ready', { tournamentName: t.name, round: 1 });
      io.to(`user:${m.player2Id}`).emit('tournament.lobby_ready', {
        tournamentId, gameId, round: 1,
        opponentId:       m.player1Id,
        opponentUsername: p1Info.username,
        opponentElo:      p1Info.elo,
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

      // Update participant — advance winner, eliminate loser
      await client.query(
        `UPDATE tournament_participants SET current_round=current_round+1
         WHERE tournament_id=$1 AND user_id=$2`,
        [tournamentId, winnerId],
      );

      // Eliminate the loser — the other player in this match who is not the winner
      await client.query(
        `UPDATE tournament_participants SET is_eliminated=true
         WHERE tournament_id=$1
           AND is_eliminated=false
           AND user_id != $2
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

    const { rows: [t] } = await pool.query('SELECT name FROM tournaments WHERE id=$1', [tournamentId]);

    for (const m of newMatches) {
      if (m.isBye && m.player1Id) {
        await pool.query(
          `INSERT INTO tournament_matches (tournament_id, round, match_number, player1_id, is_bye, winner_id)
           VALUES ($1,$2,$3,$4,true,$4)`,
          [tournamentId, nextRound, m.matchNumber, m.player1Id],
        );
        io.to(`user:${m.player1Id}`).emit('tournament.bye_advance', { tournamentId, round: nextRound });
        continue;
      }

      const { rows: [p1] } = await pool.query('SELECT username, elo FROM users WHERE id=$1', [m.player1Id]);
      const { rows: [p2] } = await pool.query('SELECT username, elo FROM users WHERE id=$1', [m.player2Id]);

      const game = await GameService.createGame(
        m.player1Id!, m.player2Id!, '0',
        p1?.elo ?? 1200, p2?.elo ?? 1200,
        initialGameState(),
        undefined,
        'waiting',
      );

      const { rows: [matchRow] } = await pool.query(
        `INSERT INTO tournament_matches
           (tournament_id, game_id, round, match_number, player1_id, player2_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [tournamentId, game.id, nextRound, m.matchNumber, m.player1Id, m.player2Id],
      );

      await TournamentLobbyService.createLobby(
        game.id, tournamentId, matchRow.id, m.player1Id!, m.player2Id!,
      );

      await NotificationService.send(m.player1Id!, 'tournament_match_ready', { tournamentName: t?.name, round: nextRound });
      io.to(`user:${m.player1Id}`).emit('tournament.lobby_ready', {
        tournamentId, gameId: game.id, round: nextRound,
        opponentId:       m.player2Id,
        opponentUsername: p2?.username ?? 'Opponent',
        opponentElo:      p2?.elo ?? 1200,
      });

      await NotificationService.send(m.player2Id!, 'tournament_match_ready', { tournamentName: t?.name, round: nextRound });
      io.to(`user:${m.player2Id}`).emit('tournament.lobby_ready', {
        tournamentId, gameId: game.id, round: nextRound,
        opponentId:       m.player1Id,
        opponentUsername: p1?.username ?? 'Opponent',
        opponentElo:      p1?.elo ?? 1200,
      });
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

      // Guard: only finalize if still in_progress — prevents double-execution
      const { rowCount } = await client.query(
        `UPDATE tournaments SET status='completed', winner_id=$1,
           winner_payout=$2, creator_payout=$3, platform_fee=$4,
           completed_at=NOW(), updated_at=NOW()
         WHERE id=$5 AND status='in_progress'`,
        [winnerId, winnerPayout, creatorPayout, platformFee, tournamentId],
      );
      if (!rowCount) { await client.query('ROLLBACK'); return; }

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

  /** Public entry point for the recovery job to re-run a stuck round check */
  static async recoverStuckRound(tournamentId: string, round: number, io: Server): Promise<void> {
    await TournamentService.checkRoundComplete(tournamentId, round, io);
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────

  static async cancelTournament(tournamentId: string, reason: string, io?: Server): Promise<void> {
    const { rows: [t] } = await pool.query(
      `SELECT entry_fee::text AS "entryFee", name FROM tournaments WHERE id=$1`, [tournamentId],
    );

    await pool.query(
      `UPDATE tournaments SET status='cancelled', updated_at=NOW() WHERE id=$1`, [tournamentId],
    );

    const { rows: participants } = await pool.query(
      'SELECT user_id AS "userId" FROM tournament_participants WHERE tournament_id=$1',
      [tournamentId],
    );

    for (const p of participants) {
      if (parseFloat(t.entryFee) > 0) {
        await BalanceService.creditBalance(p.userId, t.entryFee);
      }
      io?.to(`user:${p.userId}`).emit('tournament.cancelled', {
        tournamentId, reason, refunded: t.entryFee,
      });
    }

    logger.info(`Tournament cancelled: ${tournamentId} reason=${reason} refunded=${participants.length} players`);
  }
}
