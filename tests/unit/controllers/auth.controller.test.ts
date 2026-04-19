/**
 * tests/unit/controllers/auth.controller.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const { mockAuthService } = vi.hoisted(() => ({
  mockAuthService: {
    connect:    vi.fn(),
    verify:     vi.fn(),
    refresh:    vi.fn(),
    findById:   vi.fn(),
  },
}));

vi.mock('../../../apps/backend/src/services/auth.service.js', () => ({ AuthService: mockAuthService }));

const { authController } = await import('../../../apps/backend/src/controllers/auth.controller.js');

function makeRes() {
  const res = { json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}
function makeReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, params: {}, query: {}, user: { userId: 'u1', walletAddress: 'EQD' }, ...overrides } as unknown as Request;
}
const next = vi.fn() as NextFunction;

const VALID_PROOF = {
  timestamp: Math.floor(Date.now() / 1000) - 10,
  domain: { value: 'localhost', lengthBytes: 9 },
  signature: 'base64sig',
  payload: 'nonce123',
};
const USER = { id: 'u1', username: 'alice', elo: 1200, walletAddress: 'EQDtest123456789012' };
const TOKENS = { accessToken: 'access-tok', refreshToken: 'refresh-tok', expiresIn: 86400 };

beforeEach(() => vi.clearAllMocks());

// ─── connect ─────────────────────────────────────────────────────────────────

describe('authController.connect', () => {
  const validBody = {
    walletAddress: 'EQDtest123456789012',
    initData: 'query_id=abc&user=123',
    proof: VALID_PROOF,
  };

  it('returns 201 for new user', async () => {
    mockAuthService.connect.mockResolvedValueOnce({ user: USER, tokens: TOKENS, isNew: true });
    const res = makeRes();
    await authController.connect(makeReq({ body: validBody }), res, next);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, isNew: true }));
  });

  it('returns 200 for existing user', async () => {
    mockAuthService.connect.mockResolvedValueOnce({ user: USER, tokens: TOKENS, isNew: false });
    const res = makeRes();
    await authController.connect(makeReq({ body: validBody }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, isNew: false }));
  });

  it('returns 400 for invalid body (missing proof)', async () => {
    const res = makeRes();
    await authController.connect(makeReq({ body: { walletAddress: 'EQDtest123456789012', initData: 'abc' } }), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('returns 400 for short walletAddress', async () => {
    await authController.connect(makeReq({ body: { ...validBody, walletAddress: 'short' } }), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('calls next on service error', async () => {
    mockAuthService.connect.mockRejectedValueOnce(new Error('proof invalid'));
    await authController.connect(makeReq({ body: validBody }), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── verify ──────────────────────────────────────────────────────────────────

describe('authController.verify', () => {
  const validBody = { walletAddress: 'EQDtest123456789012', initData: 'query_id=abc' };

  it('returns 200 for existing user', async () => {
    mockAuthService.verify.mockResolvedValueOnce({ user: USER, tokens: TOKENS, isNew: false });
    const res = makeRes();
    await authController.verify(makeReq({ body: validBody }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('returns 400 for empty initData', async () => {
    await authController.verify(makeReq({ body: { walletAddress: 'EQDtest123456789012', initData: '' } }), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('calls next on service error', async () => {
    mockAuthService.verify.mockRejectedValueOnce(new Error('not found'));
    await authController.verify(makeReq({ body: validBody }), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── refresh ─────────────────────────────────────────────────────────────────

describe('authController.refresh', () => {
  it('returns new access token', async () => {
    mockAuthService.refresh.mockResolvedValueOnce({ accessToken: 'new-tok', expiresIn: 86400 });
    const res = makeRes();
    await authController.refresh(makeReq({ body: { refreshToken: 'a'.repeat(20) } }), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, accessToken: 'new-tok', expiresIn: 86400 });
  });

  it('returns 400 for short refresh token', async () => {
    await authController.refresh(makeReq({ body: { refreshToken: 'short' } }), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('calls next on service error', async () => {
    mockAuthService.refresh.mockRejectedValueOnce(new Error('invalid'));
    await authController.refresh(makeReq({ body: { refreshToken: 'a'.repeat(20) } }), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── me ──────────────────────────────────────────────────────────────────────

describe('authController.me', () => {
  it('returns user profile', async () => {
    mockAuthService.findById.mockResolvedValueOnce(USER);
    const res = makeRes();
    await authController.me(makeReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true, user: USER });
  });

  it('returns 404 when user not found', async () => {
    mockAuthService.findById.mockResolvedValueOnce(null);
    await authController.me(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('calls next on service error', async () => {
    mockAuthService.findById.mockRejectedValueOnce(new Error('DB error'));
    await authController.me(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
