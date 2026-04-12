/**
 * orphanedLockRecovery.ts — Recover stuck locked balances
 *
 * Scans for users with locked > 0 who have no active game and are not
 * in the matchmaking queue. If the lock has been sitting for > 15 minutes
 * it is considered orphaned and refunded.
 *
 * Causes of orphaned locks:
 * - joinQueue: lockBalance succeeded but Redis/DB insert failed and refund also failed
 * - Server crash during matchmaking before game was created
 *
 * Runs every 15 minutes.
 */
import pool from '../config/db.js';
import { logger } from '../utils/logger.js';

const ORPHAN_THRESHOLD_MINS = 15;
const POLL_INTERVAL_MS      = 15 * 60 * 1000;

export function startOrphanedLockRecoveryJob(): ReturnType<typeof setInterval> {
  recoverOrphanedLocks();
  return setInterval(recoverOrphanedLocks, POLL_INTERVAL_MS);
}

async function recoverOrphanedLocks(): Promise<void> {
  try {
    // Find users with locked balance who have:
    // 1. No active or waiting game
    // 2. No waiting matchmaking queue entry
    // 3. Lock has been sitting for > ORPHAN_THRESHOLD_MINS (use updated_at on balances)
    // M-06: Use locked_at (set when lock is first acquired) rather than updated_at
    // (which changes on every balance operation) so orphaned locks are reliably detected.
    const { rows } = await pool.query<{
      user_id: string; locked: string;
    }>(
      `SELECT b.user_id, b.locked::text
       FROM balances b
       WHERE b.locked > 0
         AND COALESCE(b.locked_at, b.updated_at) < NOW() - INTERVAL '${ORPHAN_THRESHOLD_MINS} minutes'
         AND NOT EXISTS (
           SELECT 1 FROM games g
           WHERE g.status IN ('active', 'waiting')
             AND (g.player1_id = b.user_id OR g.player2_id = b.user_id)
         )
         AND NOT EXISTS (
           SELECT 1 FROM matchmaking_queue mq
           WHERE mq.user_id = b.user_id AND mq.status = 'waiting'
         )`,
    );

    if (!rows.length) return;
    logger.warn(`Orphaned lock recovery: found ${rows.length} user(s) with stuck locked balance`);

    for (const row of rows) {
      await recoverOrphanedLock(row.user_id, row.locked);
    }
  } catch (err) {
    logger.error(`Orphaned lock recovery job error: ${(err as Error).message}`);
  }
}

async function recoverOrphanedLock(userId: string, lockedAmount: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-check inside transaction — conditions may have changed
    const { rows: [balance] } = await client.query(
      `SELECT locked::text FROM balances WHERE user_id=$1 FOR UPDATE`,
      [userId],
    );

    if (!balance || parseFloat(balance.locked) <= 0) {
      await client.query('ROLLBACK');
      return; // Already resolved
    }

    // Verify still no active game or queue entry
    const { rows: activeGames } = await client.query(
      `SELECT 1 FROM games WHERE status IN ('active','waiting')
       AND (player1_id=$1 OR player2_id=$1) LIMIT 1`,
      [userId],
    );
    if (activeGames.length) {
      await client.query('ROLLBACK');
      return; // User is in a game — lock is legitimate
    }

    const { rows: queueEntries } = await client.query(
      `SELECT 1 FROM matchmaking_queue WHERE user_id=$1 AND status='waiting' LIMIT 1`,
      [userId],
    );
    if (queueEntries.length) {
      await client.query('ROLLBACK');
      return; // User is in queue — lock is legitimate
    }

    // Safe to unlock — move locked → available
    await client.query(
      `UPDATE balances
       SET available = available + locked,
           locked    = 0,
           updated_at = NOW()
       WHERE user_id = $1 AND locked > 0`,
      [userId],
    );

    await client.query('COMMIT');
    logger.warn(`Orphaned lock recovered: user=${userId} amount=${lockedAmount} TON unlocked`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`Orphaned lock recovery failed for user=${userId}: ${(err as Error).message}`);
  } finally {
    client.release();
  }
}
