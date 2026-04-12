-- Migration 013: admin_audit_log table
-- N-03: Persistent audit trail for all admin actions (approvals, bans, balance adjustments).
-- Required for post-incident forensics; previously only logged to console/stdout.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_wallet    TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  target_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_wallet_idx ON admin_audit_log (admin_wallet);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx   ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx        ON admin_audit_log (action);
