import crypto from 'crypto';

/**
 * Validates Telegram Mini App initData using HMAC-SHA256.
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Algorithm:
 * 1. Parse initData query string into key=value pairs
 * 2. Remove the `hash` field, sort remaining pairs alphabetically
 * 3. Join with \n as data_check_string
 * 4. secret_key = HMAC-SHA256(bot_token, "WebAppData")
 * 5. computed_hash = HMAC-SHA256(data_check_string, secret_key)
 * 6. Compare computed_hash with provided hash
 */
export function validateInitData(initDataRaw: string): {
  valid: boolean;
  data?: Record<string, string>;
  telegramId?: string;
  error?: string;
} {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return { valid: false, error: 'Bot token not configured' };
  }

  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');

    if (!hash) {
      return { valid: false, error: 'Missing hash in initData' };
    }

    // Build data_check_string — all fields except hash, sorted alphabetically
    const pairs: string[] = [];
    params.forEach((value, key) => {
      if (key !== 'hash') pairs.push(`${key}=${value}`);
    });
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    // Derive secret key: HMAC-SHA256(bot_token, "WebAppData")
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Compute expected hash
    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== hash) {
      return { valid: false, error: 'Hash mismatch — initData tampered' };
    }

    // Check auth_date is not too old (max 24 hours for active sessions)
    // Note: only enforce on first connect, not on re-auth (verify endpoint)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (age > 86_400) {
      return { valid: false, error: 'initData expired (older than 24 hours)' };
    }

    // Parse user object if present
    const data: Record<string, string> = {};
    params.forEach((value, key) => { data[key] = value; });

    let telegramId: string | undefined;
    if (data.user) {
      try {
        const user = JSON.parse(data.user);
        telegramId = String(user.id);
      } catch {
        // user field malformed — still valid auth, just no telegramId
      }
    }

    return { valid: true, data, telegramId };
  } catch (err) {
    return { valid: false, error: `Validation error: ${(err as Error).message}` };
  }
}

/**
 * In development/test mode, bypass initData validation.
 * Never used in production.
 */
export function isInitDataValid(initDataRaw: string): boolean {
  if (process.env.NODE_ENV === 'development' && initDataRaw === 'dev_bypass') {
    return true;
  }
  return validateInitData(initDataRaw).valid;
}
