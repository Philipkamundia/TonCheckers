-- 001_create_users.sql
-- Users: wallet-based identity, auto-generated username, ELO rating

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(64) UNIQUE NOT NULL,
  username      VARCHAR(64) UNIQUE NOT NULL,
  elo           INTEGER NOT NULL DEFAULT 1200,
  total_won     NUMERIC(18, 9) NOT NULL DEFAULT 0,  -- TON won all-time
  total_wagered NUMERIC(18, 9) NOT NULL DEFAULT 0,  -- TON wagered all-time
  games_played  INTEGER NOT NULL DEFAULT 0,
  games_won     INTEGER NOT NULL DEFAULT 0,
  games_lost    INTEGER NOT NULL DEFAULT 0,
  games_drawn   INTEGER NOT NULL DEFAULT 0,
  is_banned     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
CREATE INDEX IF NOT EXISTS idx_users_total_won ON users(total_won DESC);

-- telegram_id: stored at auth time from initData, used for bot notifications
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(32);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
