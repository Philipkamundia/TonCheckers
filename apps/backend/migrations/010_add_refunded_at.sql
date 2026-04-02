-- 010_add_refunded_at.sql
-- Track when a withdrawal was refunded to prevent double-refunds

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_transactions_refunded ON transactions(refunded_at)
  WHERE refunded_at IS NOT NULL;
