/**
 * tests/unit/services/treasury.service.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TreasuryService } from '../../../apps/backend/src/services/treasury.service.js';

beforeEach(() => {
  delete process.env.HOT_WALLET_ADDRESS;
});

describe('TreasuryService.getHotWalletAddress', () => {
  it('returns address from env', () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot123';
    expect(TreasuryService.getHotWalletAddress()).toBe('EQDhot123');
  });

  it('throws when env not set', () => {
    expect(() => TreasuryService.getHotWalletAddress()).toThrow('HOT_WALLET_ADDRESS not configured');
  });
});

describe('TreasuryService.getDepositTarget', () => {
  it('returns address and userId as memo', () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot123';
    const target = TreasuryService.getDepositTarget('user-abc');
    expect(target.address).toBe('EQDhot123');
    expect(target.memo).toBe('user-abc');
  });
});

describe('TreasuryService.sendWithdrawal', () => {
  it('throws not-implemented error', async () => {
    await expect(TreasuryService.sendWithdrawal('EQD', '1', 'u1'))
      .rejects.toThrow('Phase 8');
  });
});

describe('TreasuryService.checkRefillNeeded', () => {
  it('returns false (stub)', async () => {
    expect(await TreasuryService.checkRefillNeeded(1000)).toBe(false);
  });
});
