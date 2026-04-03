-- 012_unique_telegram_id.sql
-- One game account per Telegram user
-- A Telegram user connecting a second wallet gets their existing account back

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id
  ON users(telegram_id)
  WHERE telegram_id IS NOT NULL;
