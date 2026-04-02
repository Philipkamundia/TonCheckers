-- 011_fix_destination_length.sql
-- TON wallet addresses in raw/bounceable format can exceed 64 chars
-- Increase destination and memo columns to VARCHAR(128)

ALTER TABLE transactions
  ALTER COLUMN destination TYPE VARCHAR(128),
  ALTER COLUMN memo        TYPE VARCHAR(256);
