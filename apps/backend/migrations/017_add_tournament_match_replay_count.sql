-- Track one replay attempt for tournament draw handling.
-- Rule:
--   first draw  -> replay_count becomes 1 and match is replayed
--   second draw -> force winner by higher seed ELO

ALTER TABLE tournament_matches
ADD COLUMN IF NOT EXISTS replay_count SMALLINT NOT NULL DEFAULT 0;
