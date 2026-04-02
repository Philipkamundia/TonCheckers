-- 002_create_balances.sql
-- Virtual balances: available, locked (in active game/tournament), total

CREATE TABLE IF NOT EXISTS balances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  available        NUMERIC(18, 9) NOT NULL DEFAULT 0,  -- spendable balance
  locked           NUMERIC(18, 9) NOT NULL DEFAULT 0,  -- in active games
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT balances_available_non_negative CHECK (available >= 0),
  CONSTRAINT balances_locked_non_negative CHECK (locked >= 0),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_balances_user_id ON balances(user_id);
