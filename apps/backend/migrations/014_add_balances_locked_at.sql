-- Migration 014: Add locked_at to balances for orphaned lock detection
-- M-06: The existing recovery job uses updated_at which changes on every balance
-- operation. A dedicated locked_at column only updates when locked > 0 is first set,
-- giving the recovery job a precise "how long has this been locked" signal.
ALTER TABLE balances ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- Backfill: for any currently locked balances, set locked_at to updated_at
UPDATE balances SET locked_at = updated_at WHERE locked > 0 AND locked_at IS NULL;
