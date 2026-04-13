/**
 * balanceReconciliation.ts — Nightly financial integrity check
 *
 * Architecture recommendation from audit:
 * "There is no job that reconciles:
 *  - Sum of all balances.available + locked = expected total platform liability
 *  - Sum of confirmed deposits - confirmed withdrawals = expected balance
 * A daily reconciliation job with alerting is essential for financial integrity."
 *
 * What this job checks:
 *
 * 1. LEDGER BALANCE — Does the sum of all user balances match the expected
 *    value derived from the transaction ledger?
 *    Expected = Σ confirmed deposits - Σ confirmed/sent withdrawals
 *    Actual   = Σ (balances.available + balances.locked)
 *    Discrepancy > tolerance → ALERT (does NOT auto-correct — requires human review)
 *
 * 2. NEGATIVE BALANCES — Any user whose available or locked balance is negative
 *    (should never happen due to CHECK constraints, but belt-and-suspenders).
 *
 * 3. LOCKED WITHOUT GAME — Flagged separately by orphanedLockRecovery (15 min).
 *    This job reports the count as a secondary health metric.
 *
 * 4. PROCESSING WITHDRAWALS STUCK > 30 MIN — Separate from the 10-min recovery
 *    job, this is a reporting-only check for admin awareness.
 *
 * Runs every 4 hours. Results are logged at WARN/ERROR level so they appear in
 * Railway/Sentry alerting. A dedicated DB table stores each run's snapshot for
 * trend analysis.
 *
 * IMPORTANT: This job NEVER modifies balances. It only reads and reports.
 * All corrections must be done manually by an admin after investigation.
 */

import pool from '../config/db.js';
import { logger } from '../utils/logger.js';

/** Acceptable discrepancy in TON (floating point / fee rounding tolerance) */
const TOLERANCE_TON = 0.000_001; // 1 nanoTON effectively

const POLL_INTERVAL_MS = 4 * 60 * 60 * 1_000; // every 4 hours

export function startBalanceReconciliationJob(): ReturnType<typeof setInterval> {
  // Run immediately on startup, then every 4 hours
  runReconciliation().catch(err =>
    logger.error(`Reconciliation startup run failed: ${(err as Error).message}`),
  );
  return setInterval(() => {
    runReconciliation().catch(err =>
      logger.error(`Reconciliation job error: ${(err as Error).message}`),
    );
  }, POLL_INTERVAL_MS);
}

/** Exported so the admin controller can trigger an on-demand run */
export async function runReconciliation(): Promise<void> {
  const startedAt = Date.now();
  logger.info('Balance reconciliation started');

  try {
    // ── 1. Total platform liability (sum of all user balances) ────────────
    const { rows: [liabilityRow] } = await pool.query<{
      total_available: string;
      total_locked:    string;
      total_liability: string;
      user_count:      number;
    }>(`
      SELECT
        SUM(available)::text          AS total_available,
        SUM(locked)::text             AS total_locked,
        (SUM(available) + SUM(locked))::text AS total_liability,
        COUNT(*)::int                 AS user_count
      FROM balances
    `);

    // ── 2. Expected balance from transaction ledger ────────────────────────
    const { rows: [ledgerRow] } = await pool.query<{
      total_deposits:    string;
      total_withdrawals: string;
      total_game_wins:   string;
      expected_balance:  string;
    }>(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'deposit'    AND status = 'confirmed'
                          THEN amount ELSE 0 END), 0)::text AS total_deposits,
        COALESCE(SUM(CASE WHEN type = 'withdrawal' AND status IN ('confirmed', 'processing')
                          THEN amount ELSE 0 END), 0)::text AS total_withdrawals,
        -- Game wins credited as 'deposit' type transactions (see settlement.service.ts)
        -- so they're already included in total_deposits above.
        '0'::text AS total_game_wins,
        COALESCE(SUM(CASE WHEN type = 'deposit'    AND status = 'confirmed'
                          THEN amount ELSE 0 END)
               - SUM(CASE WHEN type = 'withdrawal' AND status IN ('confirmed', 'processing')
                          THEN amount ELSE 0 END)
               , 0)::text AS expected_balance
      FROM transactions
    `);

    const liability = parseFloat(liabilityRow.total_liability ?? '0');
    const expected  = parseFloat(ledgerRow.expected_balance ?? '0');
    const discrepancy = Math.abs(liability - expected);

    // ── 3. Negative balance check ─────────────────────────────────────────
    const { rows: negativeRows } = await pool.query<{ user_id: string; available: string; locked: string }>(`
      SELECT user_id, available::text, locked::text
      FROM balances
      WHERE available < 0 OR locked < 0
    `);

    // ── 4. Orphaned locks count ───────────────────────────────────────────
    const { rows: [orphanRow] } = await pool.query<{ orphaned: number }>(`
      SELECT COUNT(*)::int AS orphaned
      FROM balances b
      WHERE b.locked > 0
        AND COALESCE(b.locked_at, b.updated_at) < NOW() - INTERVAL '15 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM games g
          WHERE g.status IN ('active','waiting')
            AND (g.player1_id = b.user_id OR g.player2_id = b.user_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM matchmaking_queue mq
          WHERE mq.user_id = b.user_id AND mq.status = 'waiting'
        )
    `);

    // ── 5. Stuck processing withdrawals ──────────────────────────────────
    const { rows: [stuckRow] } = await pool.query<{ stuck: number }>(`
      SELECT COUNT(*)::int AS stuck
      FROM transactions
      WHERE type = 'withdrawal'
        AND status = 'processing'
        AND refunded_at IS NULL
        AND updated_at < NOW() - INTERVAL '30 minutes'
    `);

    // ── 6. Persist snapshot ───────────────────────────────────────────────
    try {
      await pool.query(`
        INSERT INTO reconciliation_log
          (total_liability, expected_balance, discrepancy, user_count,
           negative_balance_count, orphaned_lock_count, stuck_withdrawal_count,
           total_deposits, total_withdrawals, duration_ms)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        liabilityRow.total_liability,
        ledgerRow.expected_balance,
        discrepancy.toFixed(9),
        liabilityRow.user_count,
        negativeRows.length,
        orphanRow.orphaned,
        stuckRow.stuck,
        ledgerRow.total_deposits,
        ledgerRow.total_withdrawals,
        Date.now() - startedAt,
      ]);
    } catch {
      // Table may not exist yet (migration hasn't run) — log only, don't crash
      logger.warn('reconciliation_log table not found — skipping snapshot persistence (run migrations)');
    }

    // ── 7. Alerting ───────────────────────────────────────────────────────
    const durationMs = Date.now() - startedAt;

    if (discrepancy > TOLERANCE_TON) {
      logger.error(
        `🚨 BALANCE DISCREPANCY DETECTED: ` +
        `liability=${liability.toFixed(9)} TON, ledger_expected=${expected.toFixed(9)} TON, ` +
        `discrepancy=${discrepancy.toFixed(9)} TON — REQUIRES MANUAL INVESTIGATION`,
      );
    } else {
      logger.info(
        `✅ Reconciliation OK: liability=${liability.toFixed(9)} TON, ` +
        `users=${liabilityRow.user_count}, duration=${durationMs}ms`,
      );
    }

    if (negativeRows.length > 0) {
      logger.error(
        `🚨 NEGATIVE BALANCES: ${negativeRows.length} user(s) have negative available or locked — ` +
        `user_ids=[${negativeRows.map(r => r.user_id).join(', ')}]`,
      );
    }

    if (orphanRow.orphaned > 0) {
      logger.warn(`⚠️  Orphaned locks: ${orphanRow.orphaned} user(s) — orphanedLockRecovery job should clear these`);
    }

    if (stuckRow.stuck > 0) {
      logger.warn(`⚠️  Stuck withdrawals: ${stuckRow.stuck} transaction(s) in 'processing' > 30min — withdrawalRecovery job should handle these`);
    }
  } catch (err) {
    logger.error(`Balance reconciliation failed: ${(err as Error).message}`);
  }
}
