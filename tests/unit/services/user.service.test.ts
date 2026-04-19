/**
 * tests/unit/services/user.service.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from '../../../apps/backend/src/services/user.service.js';
import { AppError } from '../../../apps/backend/src/middleware/errorHandler.js';

const { mockDbQuery } = vi.hoisted(() => ({ mockDbQuery: vi.fn() }));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));

beforeEach(() => vi.clearAllMocks());

const PROFILE = { id: 'u1', username: 'alice', elo: 1200, gamesPlayed: 5, gamesWon: 3, gamesLost: 1, gamesDrawn: 1, totalWon: '2.5', createdAt: '2024-01-01' };

describe('UserService.getProfile', () => {
  it('returns profile for existing user', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [PROFILE] });
    const p = await UserService.getProfile('u1');
    expect(p.username).toBe('alice');
    expect(p.elo).toBe(1200);
  });

  it('throws USER_NOT_FOUND for unknown user', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(UserService.getProfile('ghost')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});

describe('UserService.getProfileByUsername', () => {
  it('returns profile for existing username', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [PROFILE] });
    const p = await UserService.getProfileByUsername('alice');
    expect(p.id).toBe('u1');
  });

  it('throws USER_NOT_FOUND for unknown username', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(UserService.getProfileByUsername('nobody')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});

describe('UserService.isBanned', () => {
  it('returns true for banned user', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ is_banned: true }] });
    expect(await UserService.isBanned('u1')).toBe(true);
  });

  it('returns false for non-banned user', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ is_banned: false }] });
    expect(await UserService.isBanned('u1')).toBe(false);
  });

  it('returns false when user not found', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    expect(await UserService.isBanned('ghost')).toBe(false);
  });
});
