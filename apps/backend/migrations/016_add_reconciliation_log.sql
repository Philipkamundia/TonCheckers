-- Migration 016: reconciliation_log table
-- Stores snapshots of each balance reconciliation run for trend analysis
-- and audit trail. Written by balanceReconciliation.ts every 4 hours.
CREATE TABLE IF NOT EXISTS reconciliation_log (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  total_liability          NUMERIC(18,9) NOT NULL,   -- sum of all user balances
  expected_balance         NUMERIC(18,9) NOT NULL,   -- from transaction ledger
  discrepancy              NUMERIC(18,9) NOT NULL,   -- abs(liability - expected)
  user_count               INTEGER NOT NULL,
  negative_balance_count   INTEGER NOT NULL DEFAULT 0,
  orphaned_lock_count      INTEGER NOT NULL DEFAULT 0,
  stuck_withdrawal_count   INTEGER NOT NULL DEFAULT 0,
  total_deposits           NUMERIC(18,9) NOT NULL DEFAULT 0,
  total_withdrawals        NUMERIC(18,9) NOT NULL DEFAULT 0,
  duration_ms              INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep last 90 days of snapshots (6 runs/day × 90 = 540 rows max)
CREATE INDEX IF NOT EXISTS idx_reconciliation_log_created_at
  ON reconciliation_log (created_at DESC);

-- Partial index for quick "any discrepancy?" queries
CREATE INDEX IF NOT EXISTS idx_reconciliation_log_discrepancy
  ON reconciliation_log (discrepancy)
  WHERE discrepancy > 0.000001;
