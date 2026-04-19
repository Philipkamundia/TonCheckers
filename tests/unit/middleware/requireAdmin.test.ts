/**
 * tests/unit/middleware/requireAdmin.test.ts
 *
 * requireAdmin middleware — wallet + passcode enforcement.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Set env before importing the module (module-level constant reads env at load time)
const TREASURY = 'EQDtreasuryWalletAddress000000000000000000000000001';
const PASSCODE = 'supersecret';

vi.stubEnv('TREASURY_WALLET_ADDRESS', TREASURY);
vi.stubEnv('ADMIN_PASSCODE', PASSCODE);

const { requireAdmin } = await import('../../../apps/backend/src/middleware/requireAdmin.js');

function mockReq(headers: Record<string, string> = {}): Partial<Request> {
  return { headers } as any;
}

const mockRes  = {} as Response;
const mockNext = vi.fn() as NextFunction;

beforeEach(() => vi.clearAllMocks());

describe('requireAdmin', () => {
  it('calls next() with no error for valid wallet and passcode', () => {
    const req = mockReq({
      'x-admin-wallet':   TREASURY,
      'x-admin-passcode': PASSCODE,
    }) as any;
    requireAdmin(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(); // no error arg
  });

  it('rejects when wallet header is missing', () => {
    const req = mockReq({ 'x-admin-passcode': PASSCODE }) as any;
    requireAdmin(req, mockRes, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('rejects when wallet does not match treasury', () => {
    const req = mockReq({
      'x-admin-wallet':   'EQDwrongWallet000000000000000000000000000000002',
      'x-admin-passcode': PASSCODE,
    }) as any;
    requireAdmin(req, mockRes, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });

  it('rejects when passcode header is missing', () => {
    const req = mockReq({ 'x-admin-wallet': TREASURY }) as any;
    requireAdmin(req, mockRes, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });

  it('rejects when passcode is wrong', () => {
    const req = mockReq({
      'x-admin-wallet':   TREASURY,
      'x-admin-passcode': 'wrongpasscode',
    }) as any;
    requireAdmin(req, mockRes, mockNext);
    const err = (mockNext as any).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });
});
