/**
 * tests/unit/services/auth.service.test.ts
 *
 * AuthService — token helpers, TonConnect proof verification, user flows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../../../apps/backend/src/services/auth.service.js';
import { AppError } from '../../../apps/backend/src/middleware/errorHandler.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockDbQuery, mockDbConnect, mockDbClient, mockRedis, mockValidateInitData, mockGenerateUsername } = vi.hoisted(() => {
  const mockDbClient = { query: vi.fn(), release: vi.fn() };
  return {
    mockDbQuery:           vi.fn(),
    mockDbConnect:         vi.fn().mockResolvedValue(mockDbClient),
    mockDbClient,
    mockRedis:             { get: vi.fn(), set: vi.fn(), del: vi.fn() },
    mockValidateInitData:  vi.fn(),
    mockGenerateUsername:  vi.fn(),
  };
});

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery, connect: mockDbConnect },
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({
  default: mockRedis,
}));

vi.mock('../../../apps/backend/src/utils/validateInitData.js', () => ({
  validateInitData: mockValidateInitData,
}));

vi.mock('../../../apps/backend/src/utils/usernameGenerator.js', () => ({
  generateUniqueUsername: mockGenerateUsername,
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET         = 'test-secret-key-long-enough';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-long-enough';
  process.env.NODE_ENV           = 'test';
});

// ─── issueTokens / verifyAccessToken ─────────────────────────────────────────

describe('AuthService.issueTokens', () => {
  it('returns accessToken, refreshToken, and expiresIn', () => {
    const result = AuthService.issueTokens('user-1', 'EQDwallet');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.expiresIn).toBe(86400);
  });
});

describe('AuthService.verifyAccessToken', () => {
  it('returns payload for valid token', () => {
    const { accessToken } = AuthService.issueTokens('user-1', 'EQDwallet');
    const payload = AuthService.verifyAccessToken(accessToken);
    expect(payload.userId).toBe('user-1');
    expect(payload.walletAddress).toBe('EQDwallet');
  });

  it('throws TOKEN_INVALID for garbage token', () => {
    expect(() => AuthService.verifyAccessToken('not.a.token'))
      .toThrow(AppError);
    expect(() => AuthService.verifyAccessToken('not.a.token'))
      .toThrow('Invalid or expired token');
  });
});

describe('AuthService.verifyRefreshToken', () => {
  it('returns payload for valid refresh token', () => {
    const { refreshToken } = AuthService.issueTokens('user-2', 'EQDwallet2');
    const payload = AuthService.verifyRefreshToken(refreshToken);
    expect(payload.userId).toBe('user-2');
  });

  it('throws TOKEN_INVALID for access token used as refresh', () => {
    const { accessToken } = AuthService.issueTokens('user-1', 'EQDwallet');
    expect(() => AuthService.verifyRefreshToken(accessToken))
      .toThrow(AppError);
  });

  it('throws TOKEN_INVALID for garbage token', () => {
    expect(() => AuthService.verifyRefreshToken('garbage'))
      .toThrow(AppError);
  });
});

// ─── verifyTonConnectProof ────────────────────────────────────────────────────

describe('AuthService.verifyTonConnectProof', () => {
  const validProof = {
    timestamp:  Math.floor(Date.now() / 1000) - 10, // 10s ago — within 5min window
    payload:    'nonce-abc123',
    domain:     { value: 'localhost', lengthBytes: 9 },
    signature:  Buffer.alloc(64).toString('base64'),
    publicKey:  undefined as string | undefined,
    stateInit:  undefined as string | undefined,
  };

  it('rejects proof older than 5 minutes', async () => {
    const oldProof = { ...validProof, timestamp: Math.floor(Date.now() / 1000) - 400 };
    const result = await AuthService.verifyTonConnectProof('EQDwallet', oldProof);
    expect(result).toBe(false);
  });

  it('rejects replayed proof (nonce already used)', async () => {
    mockRedis.set.mockResolvedValueOnce(null); // null = key already existed = replay
    const result = await AuthService.verifyTonConnectProof('EQDwallet', validProof);
    expect(result).toBe(false);
  });

  it('returns true in development mode (skips signature check)', async () => {
    process.env.NODE_ENV = 'development';
    mockRedis.set.mockResolvedValueOnce('OK'); // first use
    const result = await AuthService.verifyTonConnectProof('EQDwallet', validProof);
    expect(result).toBe(true);
  });

  it('returns false when no stateInit and no publicKey in production', async () => {
    process.env.NODE_ENV = 'production';
    mockRedis.set.mockResolvedValueOnce('OK');
    const proofNoKey = { ...validProof, stateInit: undefined, publicKey: undefined };
    const result = await AuthService.verifyTonConnectProof('EQDwallet', proofNoKey);
    expect(result).toBe(false);
  });

  it('returns false for invalid publicKey format', async () => {
    process.env.NODE_ENV = 'production';
    mockRedis.set.mockResolvedValueOnce('OK');
    const proofBadKey = { ...validProof, publicKey: 'not-hex' };
    const result = await AuthService.verifyTonConnectProof('EQDwallet', proofBadKey);
    expect(result).toBe(false);
  });
});

// ─── findByWallet / findById ──────────────────────────────────────────────────

describe('AuthService.findByWallet', () => {
  it('returns user profile when found', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', walletAddress: 'EQD', username: 'alice', elo: 1200 }] });
    const user = await AuthService.findByWallet('EQD');
    expect(user?.id).toBe('u1');
  });

  it('returns null when not found', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const user = await AuthService.findByWallet('EQDunknown');
    expect(user).toBeNull();
  });
});

describe('AuthService.findById', () => {
  it('returns user profile when found', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', walletAddress: 'EQD', username: 'alice', elo: 1200 }] });
    const user = await AuthService.findById('u1');
    expect(user?.username).toBe('alice');
  });

  it('returns null when not found', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    expect(await AuthService.findById('ghost')).toBeNull();
  });
});

// ─── createUser ───────────────────────────────────────────────────────────────

describe('AuthService.createUser', () => {
  it('creates user and balance row in a transaction', async () => {
    mockGenerateUsername.mockImplementationOnce(async (check: (s: string) => Promise<boolean>) => {
      await check('alice123'); // simulate uniqueness check
      return 'alice123';
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // username uniqueness check

    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN') || sql.includes('COMMIT')) return Promise.resolve({});
      if (sql.includes('INSERT INTO users')) return Promise.resolve({ rows: [{ id: 'new-user', username: 'alice123', elo: 1200, walletAddress: 'EQD', gamesPlayed: 0, gamesWon: 0, gamesLost: 0, gamesDrawn: 0, totalWon: '0', createdAt: new Date().toISOString() }] });
      return Promise.resolve({ rows: [] });
    });

    const user = await AuthService.createUser('EQD', 'tg123');
    expect(user.username).toBe('alice123');
    expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back on DB error', async () => {
    mockGenerateUsername.mockResolvedValueOnce('bob456');
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      throw new Error('DB insert failed');
    });

    await expect(AuthService.createUser('EQD')).rejects.toThrow('DB insert failed');
    expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// ─── connect ─────────────────────────────────────────────────────────────────

describe('AuthService.connect', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns existing user without proof check', async () => {
    mockValidateInitData.mockReturnValueOnce({ valid: true, telegramId: 'tg1' });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', walletAddress: 'EQD', username: 'alice', elo: 1200 }] });

    const result = await AuthService.connect('EQD', {} as never, 'raw-init-data');
    expect(result.isNew).toBe(false);
    expect(result.user.id).toBe('u1');
  });

  it('throws INIT_DATA_INVALID for bad initData', async () => {
    mockValidateInitData.mockReturnValueOnce({ valid: false, error: 'bad hash' });
    await expect(AuthService.connect('EQD', {} as never, 'bad'))
      .rejects.toMatchObject({ code: 'INIT_DATA_INVALID' });
  });

  it('throws PROOF_INVALID when proof fails for new wallet', async () => {
    mockValidateInitData.mockReturnValueOnce({ valid: true, telegramId: 'tg1' });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no existing user
    mockRedis.set.mockResolvedValueOnce(null); // replay → proof fails

    await expect(AuthService.connect('EQDnew', { timestamp: Math.floor(Date.now() / 1000) - 10, payload: 'x', domain: { value: 'x', lengthBytes: 1 }, signature: '' } as never, 'raw'))
      .rejects.toMatchObject({ code: 'PROOF_INVALID' });
  });
});

// ─── verify ──────────────────────────────────────────────────────────────────

describe('AuthService.verify', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns tokens for existing wallet', async () => {
    mockValidateInitData.mockReturnValueOnce({ valid: true });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', walletAddress: 'EQD', username: 'alice', elo: 1200 }] });

    const result = await AuthService.verify('EQD', 'raw');
    expect(result.isNew).toBe(false);
    expect(result.tokens.accessToken).toBeTruthy();
  });

  it('throws USER_NOT_FOUND for unregistered wallet', async () => {
    mockValidateInitData.mockReturnValueOnce({ valid: true });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await expect(AuthService.verify('EQDunknown', 'raw'))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('throws INIT_DATA_INVALID for bad initData', async () => {
    mockValidateInitData.mockReturnValueOnce({ valid: false, error: 'expired' });
    await expect(AuthService.verify('EQD', 'bad'))
      .rejects.toMatchObject({ code: 'INIT_DATA_INVALID' });
  });
});

// ─── refresh ─────────────────────────────────────────────────────────────────

describe('AuthService.refresh', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns new accessToken for valid refresh token', async () => {
    const { refreshToken } = AuthService.issueTokens('u1', 'EQD');
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', walletAddress: 'EQD', username: 'alice', elo: 1200 }] });

    const result = await AuthService.refresh(refreshToken);
    expect(result.accessToken).toBeTruthy();
    expect(result.expiresIn).toBe(86400);
  });

  it('throws USER_NOT_FOUND if user deleted after token issued', async () => {
    const { refreshToken } = AuthService.issueTokens('u1', 'EQD');
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // user gone

    await expect(AuthService.refresh(refreshToken))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('throws TOKEN_INVALID for garbage refresh token', async () => {
    await expect(AuthService.refresh('garbage'))
      .rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });
});
