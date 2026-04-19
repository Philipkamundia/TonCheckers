/**
 * tests/unit/middleware/auth.test.ts
 *
 * requireAuth middleware — JWT validation on every protected route.
 */

import { describe, it, expect, vi } from 'vitest';
import { requireAuth } from '../../../apps/backend/src/middleware/auth.js';
import { makeAccessToken, makeExpiredToken, makeUser } from '../../fixtures/index.js';
import type { Request, Response, NextFunction } from 'express';

function mockReq(headers: Record<string, string> = {}): Partial<Request> {
  return { headers } as any;
}

const mockRes: Partial<Response>  = {};
const mockNext: NextFunction       = vi.fn();

beforeEach(() => vi.clearAllMocks());

describe('requireAuth middleware', () => {
  const user = makeUser();

  it('attaches req.user and calls next() on valid Bearer token', () => {
    const token = makeAccessToken(user.id, user.walletAddress);
    const req   = mockReq({ authorization: `Bearer ${token}` }) as any;
    requireAuth(req, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(); // no error
    expect(req.user?.userId).toBe(user.id);
    expect(req.user?.walletAddress).toBe(user.walletAddress);
  });

  it('calls next(AppError 401) when Authorization header missing', () => {
    const req = mockReq({}) as any;
    requireAuth(req, mockRes as Response, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('calls next(AppError 401) when header not Bearer type', () => {
    const req = mockReq({ authorization: 'Basic dXNlcjpwYXNz' }) as any;
    requireAuth(req, mockRes as Response, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('calls next(AppError 401) for expired token', () => {
    const token = makeExpiredToken(user.id, user.walletAddress);
    const req   = mockReq({ authorization: `Bearer ${token}` }) as any;
    requireAuth(req, mockRes as Response, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('TOKEN_INVALID');
  });

  it('calls next(AppError 401) for tampered token', () => {
    const token   = makeAccessToken(user.id, user.walletAddress);
    const tampered = token.slice(0, -5) + 'XXXXX';
    const req     = mockReq({ authorization: `Bearer ${tampered}` }) as any;
    requireAuth(req, mockRes as Response, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('calls next(AppError 401) for empty token string', () => {
    const req = mockReq({ authorization: 'Bearer ' }) as any;
    requireAuth(req, mockRes as Response, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('rejects token signed with wrong secret', async () => {
    const { sign } = await import('jsonwebtoken');
    const badToken = sign(
      { userId: user.id, walletAddress: user.walletAddress },
      'wrong-secret',
      { expiresIn: 3600 },
    );
    const req = mockReq({ authorization: `Bearer ${badToken}` }) as any;
    requireAuth(req, mockRes as Response, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });
});
