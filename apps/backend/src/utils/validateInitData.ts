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
    // Parse manually — URLSearchParams decodes '+' as space which corrupts values.
    // We need %XX decoding only (not + → space).
    const entries: Array<[string, string]> = initDataRaw.split('&').map(pair => {
      const eq = pair.indexOf('=');
      if (eq === -1) return [decodeURIComponent(pair), ''];
      return [
        decodeURIComponent(pair.slice(0, eq)),
        decodeURIComponent(pair.slice(eq + 1)),
      ];
    });

    const dataMap = new Map(entries);
    const hash = dataMap.get('hash');

    if (!hash) {
      return { valid: false, error: 'Missing hash in initData' };
    }

    // Build data_check_string per Telegram spec — all fields except hash, sorted
    const checkPairs = entries
      .filter(([k]) => k !== 'hash')
      .map(([k, v]) => `${k}=${v}`)
      .sort();

    const dataCheckString = checkPairs.join('\n');

    // secret_key = HMAC-SHA256("WebAppData", bot_token)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== hash) {
      return { valid: false, error: 'Hash mismatch — initData tampered' };
    }

    // Check auth_date not older than 24 hours
    const authDate = parseInt(dataMap.get('auth_date') ?? '0', 10);
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (age > 86_400) {
      return { valid: false, error: 'initData expired (older than 24 hours)' };
    }

    const data = Object.fromEntries(dataMap);

    let telegramId: string | undefined;
    if (data.user) {
      try {
        telegramId = String(JSON.parse(data.user).id);
      } catch { /* malformed user field */ }
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
