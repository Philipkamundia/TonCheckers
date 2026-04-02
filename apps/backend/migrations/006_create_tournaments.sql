-- 006_create_tournaments.sql
-- Tournament metadata and bracket tracking

CREATE TYPE tournament_status AS ENUM ('open', 'in_progress', 'completed', 'cancelled');

CREATE TABLE IF NOT EXISTS tournaments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      UUID NOT NULL REFERENCES users(id),
  name            VARCHAR(128) NOT NULL,
  status          tournament_status NOT NULL DEFAULT 'open',
  bracket_size    SMALLINT NOT NULL CHECK (bracket_size IN (8, 16, 32, 64)),
  entry_fee       NUMERIC(18, 9) NOT NULL,
  prize_pool      NUMERIC(18, 9) NOT NULL DEFAULT 0,  -- accumulates as players join
  current_round   SMALLINT NOT NULL DEFAULT 0,
  starts_at       TIMESTAMPTZ NOT NULL,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  winner_id       UUID REFERENCES users(id),
  winner_payout   NUMERIC(18, 9) NOT NULL DEFAULT 0,
  creator_payout  NUMERIC(18, 9) NOT NULL DEFAULT 0,
  platform_fee    NUMERIC(18, 9) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tournament participants
CREATE TABLE IF NOT EXISTS tournament_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  seed_elo        INTEGER NOT NULL,   -- ELO at time of joining (for bracket seeding)
  is_eliminated   BOOLEAN NOT NULL DEFAULT false,
  received_bye    BOOLEAN NOT NULL DEFAULT false,
  current_round   SMALLINT NOT NULL DEFAULT 0,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tournament_id, user_id)
);

-- Tournament bracket matches
CREATE TABLE IF NOT EXISTS tournament_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  game_id         UUID REFERENCES games(id),
  round           SMALLINT NOT NULL,
  match_number    SMALLINT NOT NULL,
  player1_id      UUID REFERENCES users(id),
  player2_id      UUID REFERENCES users(id),
  winner_id       UUID REFERENCES users(id),
  is_bye          BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tournament_id, round, match_number)
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_starts_at ON tournaments(starts_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament ON tournament_participants(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament ON tournament_matches(tournament_id, round);
