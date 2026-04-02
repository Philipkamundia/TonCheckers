-- 008_create_crash_log.sql
-- Server crash incident log and refund audit trail (PRD §14)

CREATE TABLE IF NOT EXISTS crash_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id),
  player1_id      UUID NOT NULL REFERENCES users(id),
  player2_id      UUID REFERENCES users(id),
  stake           NUMERIC(18, 9) NOT NULL,
  refund_amount   NUMERIC(18, 9) NOT NULL,   -- per player
  player1_refunded BOOLEAN NOT NULL DEFAULT false,
  player2_refunded BOOLEAN NOT NULL DEFAULT false,
  crash_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refunded_at     TIMESTAMPTZ,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_crash_log_game_id ON crash_log(game_id);
CREATE INDEX IF NOT EXISTS idx_crash_log_pending ON crash_log(refunded_at) WHERE refunded_at IS NULL;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
