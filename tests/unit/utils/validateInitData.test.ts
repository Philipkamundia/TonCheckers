/**
 * tests/unit/utils/validateInitData.test.ts
 *
 * Telegram Mini App initData HMAC-SHA256 validation.
 * Critical auth path — tampered initData must be rejected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateInitData, isInitDataValid } from '../../../apps/backend/src/utils/validateInitData.js';
import { makeTelegramInitData } from '../../fixtures/index.js';

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('validateInitData — happy path', () => {
  it('validates correctly signed initData', () => {
    const raw = makeTelegramInitData('123456');
    const result = validateInitData(raw);
    expect(result.valid).toBe(true);
    expect(result.telegramId).toBe('123456');
    expect(result.data).toBeDefined();
  });

  it('extracts user.id as telegramId string', () => {
    const raw = makeTelegramInitData('999888777');
    const result = validateInitData(raw);
    expect(result.telegramId).toBe('999888777');
  });

  it('returns parsed data map including all fields', () => {
    const raw = makeTelegramInitData('100');
    const result = validateInitData(raw);
    expect(result.data).toHaveProperty('auth_date');
    expect(result.data).toHaveProperty('user');
    expect(result.data).toHaveProperty('hash');
  });
});

// ─── Tampered data rejection ──────────────────────────────────────────────────

describe('validateInitData — tamper detection', () => {
  it('rejects initData with no hash field', () => {
    const raw = 'user=%7B%22id%22%3A123%7D&auth_date=1234567890'; // no hash
    const result = validateInitData(raw);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/hash/i);
  });

  it('rejects initData with wrong hash (tampered payload)', () => {
    const raw = makeTelegramInitData('123456789');
    // Tamper: change user id in the string
    const tampered = raw.replace('123456789', '999999999');
    const result = validateInitData(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/tampered|mismatch/i);
  });

  it('rejects initData signed with a different bot token', () => {
    const raw = makeTelegramInitData('123', 'other:bot_token');
    const result = validateInitData(raw); // validates with process.env token
    expect(result.valid).toBe(false);
  });

  it('rejects initData with extra injected field', () => {
    const raw = makeTelegramInitData('123');
    const tampered = raw + '&injected=evil';
    const result = validateInitData(tampered);
    expect(result.valid).toBe(false);
  });
});

// ─── Expiry check ────────────────────────────────────────────────────────────

describe('validateInitData — auth_date expiry', () => {
  it('rejects initData older than 1 hour (3600 seconds)', () => {
    // 3601 seconds old
    const raw = makeTelegramInitData('123', process.env.TELEGRAM_BOT_TOKEN!, 3601);
    const result = validateInitData(raw);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it('accepts initData exactly within 1 hour window', () => {
    // 3599 seconds old — still valid
    const raw = makeTelegramInitData('123', process.env.TELEGRAM_BOT_TOKEN!, 3599);
    const result = validateInitData(raw);
    expect(result.valid).toBe(true);
  });

  it('respects INIT_DATA_MAX_AGE_SECS env override', () => {
    const original = process.env.INIT_DATA_MAX_AGE_SECS;
    process.env.INIT_DATA_MAX_AGE_SECS = '60'; // only 60s allowed
    const raw = makeTelegramInitData('123', process.env.TELEGRAM_BOT_TOKEN!, 61);
    const result = validateInitData(raw);
    expect(result.valid).toBe(false);
    process.env.INIT_DATA_MAX_AGE_SECS = original;
  });
});

// ─── Missing bot token ────────────────────────────────────────────────────────

describe('validateInitData — missing bot token', () => {
  it('returns invalid when bot token not configured', () => {
    const original = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const result = validateInitData('anything');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/bot token/i);
    process.env.TELEGRAM_BOT_TOKEN = original;
  });
});

// ─── Malformed input ─────────────────────────────────────────────────────────

describe('validateInitData — malformed input', () => {
  it('handles empty string gracefully', () => {
    const result = validateInitData('');
    expect(result.valid).toBe(false);
  });

  it('handles single field with no equals sign', () => {
    const result = validateInitData('noequalssign');
    expect(result.valid).toBe(false);
  });

  it('handles malformed user JSON gracefully', () => {
    const badUserRaw = makeTelegramInitData('123').replace(
      /"user":[^&]+/,
      'user=not_valid_json',
    );
    // Should not throw — graceful handling of parse failure
    expect(() => validateInitData(badUserRaw)).not.toThrow();
  });
});

// ─── isInitDataValid ─────────────────────────────────────────────────────────

describe('isInitDataValid', () => {
  it('returns true for valid data', () => {
    const raw = makeTelegramInitData('123');
    expect(isInitDataValid(raw)).toBe(true);
  });

  it('returns false for invalid data', () => {
    expect(isInitDataValid('garbage')).toBe(false);
  });

  it('allows dev_bypass in development mode', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(isInitDataValid('dev_bypass')).toBe(true);
    process.env.NODE_ENV = original;
  });

  it('rejects dev_bypass in production mode', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(isInitDataValid('dev_bypass')).toBe(false);
    process.env.NODE_ENV = original;
  });
});
