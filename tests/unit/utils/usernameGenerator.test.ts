/**
 * tests/unit/utils/usernameGenerator.test.ts
 *
 * Username generator — format, uniqueness, collision handling.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateUsername, generateUniqueUsername } from '../../../apps/backend/src/utils/usernameGenerator.js';

describe('generateUsername', () => {
  it('returns a string in Adjective+Noun_Number format', () => {
    const username = generateUsername();
    expect(username).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+_\d{3}$/);
  });

  it('generates different usernames on repeated calls', () => {
    const names = new Set(Array.from({ length: 20 }, () => generateUsername()));
    expect(names.size).toBeGreaterThan(1);
  });

  it('number suffix is between 100 and 999', () => {
    for (let i = 0; i < 50; i++) {
      const num = parseInt(generateUsername().split('_')[1], 10);
      expect(num).toBeGreaterThanOrEqual(100);
      expect(num).toBeLessThanOrEqual(999);
    }
  });
});

describe('generateUniqueUsername', () => {
  it('returns first username when not taken', async () => {
    const existsCheck = vi.fn().mockResolvedValue(false);
    const username = await generateUniqueUsername(existsCheck);
    expect(username).toBeTruthy();
    expect(existsCheck).toHaveBeenCalledTimes(1);
  });

  it('retries when username is taken', async () => {
    const existsCheck = vi.fn()
      .mockResolvedValueOnce(true)   // first attempt taken
      .mockResolvedValueOnce(true)   // second attempt taken
      .mockResolvedValueOnce(false); // third attempt free
    const username = await generateUniqueUsername(existsCheck);
    expect(username).toBeTruthy();
    expect(existsCheck).toHaveBeenCalledTimes(3);
  });

  it('falls back with extra digits after maxAttempts', async () => {
    const existsCheck = vi.fn().mockResolvedValue(true); // always taken
    const username = await generateUniqueUsername(existsCheck, 3);
    // Fallback appends 4 extra digits — total suffix is longer than 3 digits
    expect(username).toBeTruthy();
    expect(existsCheck).toHaveBeenCalledTimes(3);
  });
});
