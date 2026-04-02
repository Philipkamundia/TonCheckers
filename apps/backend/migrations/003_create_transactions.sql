-- 003_create_transactions.sql
-- All on-chain TON movements: deposits and withdrawals

CREATE TYPE transaction_type AS ENUM ('deposit', 'withdrawal');
CREATE TYPE transaction_status AS ENUM ('pending', 'processing', 'confirmed', 'failed', 'rejected');

CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            transaction_type NOT NULL,
  status          transaction_status NOT NULL DEFAULT 'pending',
  amount          NUMERIC(18, 9) NOT NULL,
  ton_tx_hash     VARCHAR(128) UNIQUE,           -- on-chain tx hash (null until confirmed)
  destination     VARCHAR(64),                   -- withdrawal: destination wallet
  memo            VARCHAR(128),                  -- deposit: memo used to attribute payment
  admin_note      TEXT,                          -- admin review note for large withdrawals
  requires_review BOOLEAN NOT NULL DEFAULT false, -- true if > 100 TON
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT transactions_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_ton_tx_hash ON transactions(ton_tx_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_requires_review ON transactions(requires_review) WHERE requires_review = true;
