-- 005_create_matchmaking_queue.sql
-- Players waiting to be matched for PvP games

CREATE TYPE queue_status AS ENUM ('waiting', 'matched', 'cancelled');

CREATE TABLE IF NOT EXISTS matchmaking_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  elo             INTEGER NOT NULL,
  stake           NUMERIC(18, 9) NOT NULL,
  status          queue_status NOT NULL DEFAULT 'waiting',
  game_id         UUID REFERENCES games(id),   -- set when matched
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_at      TIMESTAMPTZ
);

-- Only one active (waiting) queue entry per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_one_active_per_user
  ON matchmaking_queue(user_id) WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_queue_status ON matchmaking_queue(status) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_queue_elo ON matchmaking_queue(elo) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_queue_stake ON matchmaking_queue(stake) WHERE status = 'waiting';
