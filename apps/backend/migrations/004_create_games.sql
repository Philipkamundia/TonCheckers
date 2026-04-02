-- 004_create_games.sql
-- PvP and AI game records

CREATE TYPE game_mode AS ENUM ('pvp', 'ai');
CREATE TYPE game_status AS ENUM ('waiting', 'active', 'completed', 'crashed', 'cancelled');
CREATE TYPE game_result AS ENUM ('player1_win', 'player2_win', 'draw', 'crashed', 'cancelled');
CREATE TYPE ai_difficulty AS ENUM ('beginner', 'intermediate', 'hard', 'master');

CREATE TABLE IF NOT EXISTS games (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode            game_mode NOT NULL DEFAULT 'pvp',
  status          game_status NOT NULL DEFAULT 'waiting',
  result          game_result,
  player1_id      UUID NOT NULL REFERENCES users(id),
  player2_id      UUID REFERENCES users(id),          -- NULL for AI games
  ai_difficulty   ai_difficulty,                       -- set for AI games
  stake           NUMERIC(18, 9) NOT NULL DEFAULT 0,  -- per-player stake (0 for AI)
  platform_fee    NUMERIC(18, 9) NOT NULL DEFAULT 0,  -- 15% of winnings
  winner_payout   NUMERIC(18, 9) NOT NULL DEFAULT 0,  -- what winner receives
  board_state     JSONB,                               -- current board as JSON
  move_count      INTEGER NOT NULL DEFAULT 0,
  board_hash_history JSONB NOT NULL DEFAULT '[]',     -- for draw detection (25 repetitions)
  player1_elo_before INTEGER,
  player2_elo_before INTEGER,
  player1_elo_after  INTEGER,
  player2_elo_after  INTEGER,
  active_player   SMALLINT NOT NULL DEFAULT 1,        -- 1 or 2
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_games_player1 ON games(player1_id);
CREATE INDEX IF NOT EXISTS idx_games_player2 ON games(player2_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_active ON games(status) WHERE status = 'active';
