import pool from '../config/db.js';
import { type PoolClient } from 'pg';
import { NotificationService } from './notification.service.js';
import { logger } from '../utils/logger.js';
import type { GameState } from '../engine/board.js';

export interface GameRecord {
  id:               string;
  mode:             'pvp' | 'ai';
  status:           'waiting' | 'active' | 'completed' | 'crashed' | 'cancelled';
  player1Id:        string;
  player2Id:        string | null;
  stake:            string;
  boardState:       GameState | null;
  activePlayer:     1 | 2;
  player1EloBefore: number;
  player2EloBefore: number | null;
  createdAt:        string;
}

export class GameService {

  static async createGame(
    player1Id: string, player2Id: string, stake: string,
    player1Elo: number, player2Elo: number, initialState: GameState,
    db: typeof pool | PoolClient = pool,
    status: 'active' | 'waiting' = 'active',
  ): Promise<GameRecord> {
    const { rows: [game] } = await (db as typeof pool).query(
      `INSERT INTO games
         (mode, status, player1_id, player2_id, stake, board_state,
          active_player, player1_elo_before, player2_elo_before)
       VALUES ('pvp',$1,$2,$3,$4,$5,1,$6,$7)
       RETURNING id, mode, status,
         player1_id AS "player1Id", player2_id AS "player2Id",
         stake::text, board_state AS "boardState",
         active_player AS "activePlayer",
         player1_elo_before AS "player1EloBefore",
         player2_elo_before AS "player2EloBefore",
         created_at AS "createdAt"`,
      [status, player1Id, player2Id, stake, initialState, player1Elo, player2Elo],
    );
    return game as GameRecord;
  }

  static async getGame(gameId: string): Promise<GameRecord | null> {
    const { rows } = await pool.query(
      `SELECT id, mode, status,
         player1_id AS "player1Id", player2_id AS "player2Id",
         stake::text, board_state AS "boardState",
         active_player AS "activePlayer",
         player1_elo_before AS "player1EloBefore",
         player2_elo_before AS "player2EloBefore",
         created_at AS "createdAt"
       FROM games WHERE id = $1`,
      [gameId],
    );
    return (rows[0] as GameRecord) ?? null;
  }

  static async updateBoardState(
    gameId: string, state: GameState, activePlayer: 1 | 2, moveCount: number,
  ): Promise<void> {
    await pool.query(
      `UPDATE games SET board_state=$1, active_player=$2, move_count=$3,
         started_at=COALESCE(started_at,NOW()), updated_at=NOW() WHERE id=$4`,
      [state, activePlayer, moveCount, gameId],
    );
  }

  /** PRD §14 — crash recovery: refund all active and waiting games on server start */
  static async recoverCrashedGames(): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT id, player1_id, player2_id, stake::text, status FROM games WHERE status IN ('active','waiting')`,
    );
    const recovered: string[] = [];

    for (const g of rows) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (g.status === 'active') {
          // Genuinely crashed mid-game — log it and notify players
          await client.query(
            `UPDATE games SET status='crashed', ended_at=NOW(), updated_at=NOW() WHERE id=$1`, [g.id],
          );
          await client.query(
            `INSERT INTO crash_log (game_id,player1_id,player2_id,stake,refund_amount)
             VALUES ($1,$2,$3,$4,$4)`,
            [g.id, g.player1_id, g.player2_id, g.stake],
          );
        } else {
          // 'waiting' = lobby countdown — just cancel silently, no crash log, no notification
          await client.query(
            `UPDATE games SET status='cancelled', updated_at=NOW() WHERE id=$1`, [g.id],
          );
        }

        // Only refund if there was an actual stake locked
        const stakeNum = parseFloat(g.stake);
        if (stakeNum > 0) {
          const playerIds = [g.player1_id, g.player2_id].filter(Boolean);
          if (playerIds.length) {
            await client.query(
              `UPDATE balances SET available=available+$1::numeric, locked=locked-$1::numeric,
                 updated_at=NOW() WHERE user_id=ANY($2::uuid[]) AND locked >= $1::numeric`,
              [g.stake, playerIds],
            );
          }
        }

        if (g.status === 'active') {
          await client.query(
            `UPDATE crash_log SET player1_refunded=true,player2_refunded=true,refunded_at=NOW() WHERE game_id=$1`,
            [g.id],
          );
        }

        await client.query('COMMIT');
        recovered.push(g.id);

        // Only notify for actual crashes (active games), not cancelled lobbies
        if (g.status === 'active' && stakeNum > 0) {
          for (const uid of [g.player1_id, g.player2_id]) {
            if (uid) await NotificationService.send(uid, 'server_crash_refund', { amount: g.stake });
          }
          logger.warn(`Crash recovered: game=${g.id} stake=${g.stake}`);
        } else {
          logger.info(`Lobby cancelled on restart: game=${g.id}`);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`Recovery failed game=${g.id}: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }

    if (recovered.length) logger.warn(`Recovered ${recovered.length} crashed/waiting games`);
    return recovered;
  }
}
