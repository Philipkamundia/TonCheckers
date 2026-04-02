/**
 * AdminService — Admin dashboard data (PRD §15)
 *
 * Features:
 * - Withdrawal approval queue (above 100 TON)
 * - Treasury health monitor
 * - Suspicious account flagging
 * - Tournament oversight
 * - Platform fee tracker
 * - User management
 * - Crash log
 */
import pool from '../config/db.js';
import { WithdrawalService } from './withdrawal.service.js';
import { logger } from '../utils/logger.js';

export class AdminService {

  // ─── Withdrawal Queue ─────────────────────────────────────────────────────

  static async getPendingWithdrawals() {
    return WithdrawalService.getPendingReviewWithdrawals();
  }

  static async approveWithdrawal(transactionId: string, adminNote?: string) {
    await WithdrawalService.approveWithdrawal(transactionId, adminNote);
    logger.info(`Admin approved withdrawal: ${transactionId}`);
  }

  static async rejectWithdrawal(transactionId: string, reason: string) {
    await WithdrawalService.rejectWithdrawal(transactionId, reason);
    logger.info(`Admin rejected withdrawal: ${transactionId} reason=${reason}`);
  }

  // ─── Treasury Health ──────────────────────────────────────────────────────

  static async getTreasuryHealth() {
    const { rows: [row] } = await pool.query(
      `SELECT
         COALESCE(SUM(available), 0)::float AS total_available,
         COALESCE(SUM(locked),    0)::float AS total_locked,
         COALESCE(SUM(available + locked), 0)::float AS total_obligations
       FROM balances`,
    );

    // Platform fees earned (sum of all platform_fee from completed games)
    const { rows: [fees] } = await pool.query(
      `SELECT COALESCE(SUM(platform_fee), 0)::float AS total_fees
       FROM games WHERE status = 'completed'`,
    );

    const { rows: [tournFees] } = await pool.query(
      `SELECT COALESCE(SUM(platform_fee), 0)::float AS total_fees
       FROM tournaments WHERE status = 'completed'`,
    );

    return {
      totalObligations:    row.total_obligations,
      totalAvailable:      row.total_available,
      totalLocked:         row.total_locked,
      platformFeesEarned:  (fees.total_fees + tournFees.total_fees).toFixed(9),
      // Hot wallet balance queried live via TON API (wired in production)
      hotWalletBalance:    null,  // populated by TreasuryService in production
    };
  }

  // ─── User Management ─────────────────────────────────────────────────────

  static async listUsers(page = 1, limit = 50, search?: string) {
    const offset = (page - 1) * limit;
    const where  = search ? `WHERE u.username ILIKE $3 OR u.wallet_address ILIKE $3` : '';
    const params = search ? [limit, offset, `%${search}%`] : [limit, offset];

    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.wallet_address AS "walletAddress", u.elo,
              u.games_played AS "gamesPlayed", u.games_won AS "gamesWon",
              u.total_won::text AS "totalWon", u.is_banned AS "isBanned",
              b.available::text AS "available", b.locked::text AS "locked",
              u.created_at AS "createdAt"
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    );

    const { rows: [count] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users ${search ? `WHERE username ILIKE $1 OR wallet_address ILIKE $1` : ''}`,
      search ? [`%${search}%`] : [],
    );

    return { users: rows, total: count.total, page, totalPages: Math.ceil(count.total / limit) };
  }

  static async banUser(userId: string, reason: string) {
    await pool.query(
      `UPDATE users SET is_banned=true, updated_at=NOW() WHERE id=$1`, [userId],
    );
    logger.warn(`User banned: ${userId} reason=${reason}`);
  }

  static async unbanUser(userId: string) {
    await pool.query(
      `UPDATE users SET is_banned=false, updated_at=NOW() WHERE id=$1`, [userId],
    );
    logger.info(`User unbanned: ${userId}`);
  }

  // ─── Game Log ─────────────────────────────────────────────────────────────

  static async getGameLog(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const [{ rows }, { rows: [countRow] }] = await Promise.all([
      pool.query(
        `SELECT g.id, g.mode, g.status, g.result,
              p1.username AS "player1", p2.username AS "player2",
              g.stake::text, g.platform_fee::text AS "platformFee",
              g.winner_payout::text AS "winnerPayout",
              g.player1_elo_before AS "p1EloBefore", g.player1_elo_after AS "p1EloAfter",
              g.player2_elo_before AS "p2EloBefore", g.player2_elo_after AS "p2EloAfter",
              g.move_count AS "moveCount",
              g.started_at AS "startedAt", g.ended_at AS "endedAt"
       FROM games g
       LEFT JOIN users p1 ON p1.id = g.player1_id
       LEFT JOIN users p2 ON p2.id = g.player2_id
       WHERE g.mode = 'pvp'
       ORDER BY g.created_at DESC
       LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM games WHERE mode = 'pvp'`),
    ]);
    return { games: rows, total: countRow.total, page, totalPages: Math.ceil(countRow.total / limit) };
  }

  // ─── Tournament Oversight ─────────────────────────────────────────────────

  static async getTournamentOverview() {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.status, t.bracket_size AS "bracketSize",
              t.entry_fee::text AS "entryFee", t.prize_pool::text AS "prizePool",
              t.platform_fee::text AS "platformFee",
              t.current_round AS "currentRound",
              u.username AS "creatorUsername",
              COUNT(p.user_id)::int AS "participantCount",
              t.starts_at AS "startsAt", t.completed_at AS "completedAt"
       FROM tournaments t
       JOIN users u ON u.id = t.creator_id
       LEFT JOIN tournament_participants p ON p.tournament_id = t.id
       GROUP BY t.id, u.username
       ORDER BY t.created_at DESC
       LIMIT 100`,
    );
    return rows;
  }

  // ─── Crash Log ────────────────────────────────────────────────────────────

  static async getCrashLog(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const [{ rows }, { rows: [countRow] }] = await Promise.all([
      pool.query(
        `SELECT cl.id, cl.game_id AS "gameId",
              p1.username AS "player1", p2.username AS "player2",
              cl.stake::text, cl.refund_amount::text AS "refundAmount",
              cl.player1_refunded AS "player1Refunded",
              cl.player2_refunded AS "player2Refunded",
              cl.crash_detected_at AS "crashDetectedAt",
              cl.refunded_at AS "refundedAt"
       FROM crash_log cl
       LEFT JOIN users p1 ON p1.id = cl.player1_id
       LEFT JOIN users p2 ON p2.id = cl.player2_id
       ORDER BY cl.crash_detected_at DESC
       LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM crash_log`),
    ]);
    return { crashes: rows, total: countRow.total, page, totalPages: Math.ceil(countRow.total / limit) };
  }

  // ─── Fee Tracker ──────────────────────────────────────────────────────────

  static async getFeeBreakdown() {
    const { rows: daily } = await pool.query(
      `SELECT DATE(ended_at) AS date,
              COUNT(*)::int AS games,
              SUM(platform_fee)::float AS fees
       FROM games
       WHERE status = 'completed' AND ended_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(ended_at)
       ORDER BY date DESC`,
    );

    const { rows: [totals] } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_games,
         COALESCE(SUM(platform_fee), 0)::float AS total_pvp_fees
       FROM games WHERE status = 'completed'`,
    );

    const { rows: [tournTotals] } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_tournaments,
         COALESCE(SUM(platform_fee), 0)::float AS total_tournament_fees
       FROM tournaments WHERE status = 'completed'`,
    );

    return {
      dailyBreakdown:       daily,
      totalGames:           totals.total_games,
      totalPvpFees:         totals.total_pvp_fees?.toFixed(9),
      totalTournaments:     tournTotals.total_tournaments,
      totalTournamentFees:  tournTotals.total_tournament_fees?.toFixed(9),
      totalFees:            ((totals.total_pvp_fees ?? 0) + (tournTotals.total_tournament_fees ?? 0)).toFixed(9),
    };
  }

  // ─── Stats Summary ────────────────────────────────────────────────────────

  static async getSummary() {
    const { rows: [stats] } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users)                           AS total_users,
        (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '24 hours') AS new_users_today,
        (SELECT COUNT(*)::int FROM games WHERE status='active')    AS active_games,
        (SELECT COUNT(*)::int FROM matchmaking_queue WHERE status='waiting') AS queue_size,
        (SELECT COUNT(*)::int FROM tournaments WHERE status='open') AS open_tournaments,
        (SELECT COUNT(*)::int FROM transactions WHERE requires_review=true AND status='pending') AS pending_withdrawals
    `);
    return stats;
  }
}
