-- 009_fix_wallet_address_length.sql
-- TON raw addresses (0:hex) are 66 chars; base64url formats up to 96 chars.
-- Expand to 128 to safely cover all TON address formats.

ALTER TABLE users ALTER COLUMN wallet_address TYPE VARCHAR(128);
