-- Migration 015: Add seqno + refunded_at to transactions
-- H-06: Store the TON wallet seqno used when broadcasting a withdrawal.
-- This allows the recovery job to identify the exact on-chain transaction
-- by seqno rather than the ambiguous (destination + amount) match, preventing
-- a different transaction for the same amount+destination from being mismatched.
-- refunded_at already exists on some deployments from migration 010; use IF NOT EXISTS.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS hot_wallet_seqno INTEGER;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_transactions_processing_stuck
  ON transactions (status, updated_at)
  WHERE status = 'processing' AND refunded_at IS NULL;
