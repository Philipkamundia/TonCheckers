/**
 * SettlementService — Full post-game settlement
 *
 * PRD §12:
 *   Win:   Winner receives (Stake × 2) × 0.85 | Platform fee 15%
 *   Draw:  Both stakes returned, zero fee, zero ELO change
 *
 * PRD §13 post-game payload:
 *   winner, loser, ELO changes, full payout breakdown
 */
import pool from '../config/db.js';
import { EloService } from './elo.service.js';
import { NotificationService } from './notification.service.js';
import { TournamentService } from './tournament.service.js';
import { logger } from '../utils/logger.js';
import type { Server } from 'socket.io';

const PLATFORM_FEE_PCT = 0.15;

export interface SettlementResult {
  gameId:          string;
  winnerId:        string;
  loserId:         string;
  stake:           string;
  prizePool:       string;
  platformFee:     string;
  winnerPayout:    string;
  alreadySettled?: boolean;  // true when game was already settled by another path
  eloChanges: {
    winner: { before: number; after: number; delta: number };
    loser:  { before: number; after: number; delta: number };
  };
}

export interface DrawResult {
  gameId: string; player1Id: string; player2Id: string; stake: string;
}

export class SettlementService {

  /**
   * PRD §12: (Stake × 2) × 0.85
   *
   * H-03: All arithmetic is done in integer nanoTON (BigInt) to avoid
   * IEEE 754 floating-point precision errors that accumulate across many
   * games and prevent treasury reconciliation.
   */
  static calculateWinPayout(stakeEach: string) {
    // Convert to nanoTON (integer, 1 TON = 1e9 nanoTON)
    const stakeNano    = BigInt(Math.round(parseFloat(stakeEach) * 1_000_000_000));
    const prizeNano    = stakeNano * 2n;
    // Integer division: floor semantics (platform rounds down, player rounds up)
    const feeNano      = prizeNano * 15n / 100n;
    const payoutNano   = prizeNano - feeNano;

    const nanoToTon = (n: bigint) => (Number(n) / 1_000_000_000).toFixed(9);
    return {
      prizePool:    nanoToTon(prizeNano),
      platformFee:  nanoToTon(feeNano),
      winnerPayout: nanoToTon(payoutNano),
    };
  }

  /**
   * Full win settlement — single DB transaction:
   * ELO update, balance settlement, stats update, transaction record, notification
   */
  static async settleWin(
    gameId: string, winnerId: string, loserId: string,
    reason: string, stakeEach: string,
    io?: Server,
  ): Promise<SettlementResult> {
    const { prizePool, platformFee, winnerPayout } = SettlementService.calculateWinPayout(stakeEach);
    // N-01: Use explicit string check first to avoid float comparison ambiguity
    const isTournamentGame = stakeEach === '0' || stakeEach === '0.000000000' || parseFloat(stakeEach) === 0;

    const { rows: players } = await pool.query(
      `SELECT id, elo FROM users WHERE id = ANY($1::uuid[])`, [[winnerId, loserId]],
    );
    const winnerRow = players.find((p: { id: string; elo: number }) => p.id === winnerId);
    const loserRow  = players.find((p: { id: string; elo: number }) => p.id === loserId);

    if (!winnerRow || !loserRow) {
      throw new Error(`settleWin: player not found — winner=${winnerId} loser=${loserId}`);
    }

    // ELO: winner=player1, loser=player2 in the calculation
    const elo = EloService.calculate(1, winnerRow.elo, loserRow.elo);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update game record — guard with AND status='active' to prevent double settlement
      const { rowCount } = await client.query(
        `UPDATE games SET
           status='completed',
           result=(CASE WHEN player1_id=$1 THEN 'player1_win' ELSE 'player2_win' END)::game_result,
           platform_fee=$2, winner_payout=$3,
           player1_elo_after=(CASE WHEN player1_id=$1 THEN $4 ELSE $5 END)::integer,
           player2_elo_after=(CASE WHEN player1_id=$1 THEN $5 ELSE $4 END)::integer,
           ended_at=NOW(), updated_at=NOW()
         WHERE id=$6 AND status='active'`,
        [winnerId, platformFee, winnerPayout, elo.player1NewElo, elo.player2NewElo, gameId],
      );

      if (!rowCount) {
        await client.query('ROLLBACK');
        logger.warn(`settleWin: game=${gameId} already settled, skipping`);
        return {
          gameId, winnerId, loserId, stake: stakeEach, prizePool, platformFee, winnerPayout,
          alreadySettled: true,
          eloChanges: {
            winner: { before: winnerRow.elo, after: winnerRow.elo, delta: 0 },
            loser:  { before: loserRow.elo,  after: loserRow.elo,  delta: 0 },
          },
        };
      }

      // Update ELO
      await client.query(`UPDATE users SET elo=$1, updated_at=NOW() WHERE id=$2`, [elo.player1NewElo, winnerId]);
      await client.query(`UPDATE users SET elo=$1, updated_at=NOW() WHERE id=$2`, [elo.player2NewElo, loserId]);

      // Update stats — always track games played/won/lost
      await client.query(
        `UPDATE users SET games_played=games_played+1, games_won=games_won+1,
           total_wagered=total_wagered+$1::numeric, updated_at=NOW()
         WHERE id=$2`,
        [stakeEach, winnerId],
      );
      await client.query(
        `UPDATE users SET games_played=games_played+1, games_lost=games_lost+1,
           total_wagered=total_wagered+$1::numeric, updated_at=NOW() WHERE id=$2`,
        [stakeEach, loserId],
      );

      // Balance settlement — skip for tournament games (stake = 0, no locked funds)
      if (!isTournamentGame) {
        await client.query(
          `UPDATE balances SET locked=locked-$1::numeric, updated_at=NOW() WHERE user_id=$2`,
          [stakeEach, winnerId],
        );
        await client.query(
          `UPDATE balances SET locked=locked-$1::numeric, updated_at=NOW() WHERE user_id=$2`,
          [stakeEach, loserId],
        );
        await client.query(
          `UPDATE balances SET available=available+$1::numeric, updated_at=NOW() WHERE user_id=$2`,
          [winnerPayout, winnerId],
        );
        // Transaction record for winner's payout credit
        await client.query(
          `INSERT INTO transactions (user_id, type, status, amount) VALUES ($1,'deposit','confirmed',$2)`,
          [winnerId, winnerPayout],
        );
        // Update total_won only for real-money games
        await client.query(
          `UPDATE users SET total_won=total_won+$1::numeric, updated_at=NOW() WHERE id=$2`,
          [winnerPayout, winnerId],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Telegram notifications (PRD §11)
    await NotificationService.send(winnerId, 'game_result', {
      won: true, payout: winnerPayout, fee: platformFee,
      eloChange: `+${elo.player1Delta}`,
    });
    await NotificationService.send(loserId, 'game_result', {
      won: false, eloChange: `${elo.player2Delta}`,
    });

    const result: SettlementResult = {
      gameId, winnerId, loserId, stake: stakeEach, prizePool, platformFee, winnerPayout,
      eloChanges: {
        winner: { before: winnerRow.elo, after: elo.player1NewElo, delta: elo.player1Delta },
        loser:  { before: loserRow.elo,  after: elo.player2NewElo, delta: elo.player2Delta },
      },
    };

    logger.info(
      `Settled: game=${gameId} winner=${winnerId} payout=${winnerPayout} ` +
      `fee=${platformFee} eloW=+${elo.player1Delta} eloL=${elo.player2Delta} reason=${reason}`,
    );

    // Advance tournament bracket if this game belongs to a tournament match
    if (io) {
      const { rows: [match] } = await pool.query(
        `SELECT id, tournament_id AS "tournamentId" FROM tournament_matches WHERE game_id=$1`,
        [gameId],
      );
      if (match) {
        TournamentService.recordMatchResult(match.tournamentId, match.id, winnerId, io)
          .catch(err => logger.error(`Tournament bracket advance failed: ${(err as Error).message}`));
      }
    }

    return result;
  }

  /**
   * Draw settlement — PRD §12: stakes returned, zero fee, zero ELO change
   */
  static async settleDraw(
    gameId: string, player1Id: string, player2Id: string, stakeEach: string,
  ): Promise<DrawResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rowCount } = await client.query(
        `UPDATE games SET status='completed', result='draw'::game_result,
           player1_elo_after=player1_elo_before, player2_elo_after=player2_elo_before,
           platform_fee=0, winner_payout=0, ended_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND status='active'`,
        [gameId],
      );

      if (!rowCount) {
        await client.query('ROLLBACK');
        logger.warn(`settleDraw: game=${gameId} already settled, skipping`);
        return { gameId, player1Id, player2Id, stake: stakeEach };
      }

      // Stats: only games_played + games_drawn, no ELO change
      await client.query(
        `UPDATE users SET games_played=games_played+1, games_drawn=games_drawn+1,
           total_wagered=total_wagered+$1::numeric, updated_at=NOW()
         WHERE id=ANY($2::uuid[])`,
        [stakeEach, [player1Id, player2Id]],
      );

      // Unlock stakes back to available
      await client.query(
        `UPDATE balances SET locked=locked-$1::numeric, available=available+$1::numeric,
           updated_at=NOW() WHERE user_id=ANY($2::uuid[])`,
        [stakeEach, [player1Id, player2Id]],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    logger.info(`Draw: game=${gameId} stake=${stakeEach} returned to both`);
    return { gameId, player1Id, player2Id, stake: stakeEach };
  }
}
