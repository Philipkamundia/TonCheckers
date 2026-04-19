/**
 * tests/unit/middleware/requireAdmin.unconfigured.test.ts
 *
 * Tests the ADMIN_NOT_CONFIGURED branches that require env vars to be absent.
 * Must be a separate file because requireAdmin reads env at module load time.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ─── No TREASURY_WALLET_ADDRESS configured ────────────────────────────────────

describe('requireAdmin — TREASURY_WALLET_ADDRESS not set', () => {
  it('returns ADMIN_NOT_CONFIGURED when treasury wallet env is missing', async () => {
    vi.stubEnv('TREASURY_WALLET_ADDRESS', '');
    vi.stubEnv('ADMIN_PASSCODE', 'secret');

    // Re-import fresh module with no treasury wallet
    const mod = await import('../../../apps/backend/src/middleware/requireAdmin.js?v=no-treasury');
    const { requireAdmin } = mod;

    const mockNext = vi.fn() as NextFunction;
    const req = { headers: { 'x-admin-wallet': 'EQDsome', 'x-admin-passcode': 'secret' } } as unknown as Request;
    requireAdmin(req, {} as Response, mockNext);

    const err = (mockNext as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('ADMIN_NOT_CONFIGURED');
  });
});

// ─── generateAdminChallenge ───────────────────────────────────────────────────

describe('generateAdminChallenge', () => {
  it('returns a string starting with checkton-admin:', async () => {
    vi.stubEnv('TREASURY_WALLET_ADDRESS', 'EQDtest');
    vi.stubEnv('ADMIN_PASSCODE', 'secret');
    const { generateAdminChallenge } = await import('../../../apps/backend/src/middleware/requireAdmin.js');
    const challenge = generateAdminChallenge();
    expect(challenge).toMatch(/^checkton-admin:\d+$/);
  });
});
