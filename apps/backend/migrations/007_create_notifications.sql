-- 007_create_notifications.sql
-- Telegram bot notification log

CREATE TYPE notification_type AS ENUM (
  'deposit_confirmed',
  'withdrawal_processed',
  'game_result',
  'tournament_starting',
  'tournament_match_ready',
  'tournament_result',
  'server_crash_refund'
);

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            notification_type NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  sent            BOOLEAN NOT NULL DEFAULT false,
  sent_at         TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unsent ON notifications(sent, created_at) WHERE sent = false;
