/**
 * tests/unit/services/wallet.service.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletService } from '../../../apps/backend/src/services/wallet.service.js';

const { mockGetBalance, mockGetHistory, mockDbQuery, mockGetDepositTarget } = vi.hoisted(() => ({
  mockGetBalance:       vi.fn(),
  mockGetHistory:       vi.fn(),
  mockDbQuery:          vi.fn(),
  mockGetDepositTarget: vi.fn(),
}));

vi.mock('../../../apps/backend/src/services/balance.service.js', () => ({
  BalanceService: { getBalance: mockGetBalance, getHistory: mockGetHistory },
}));

vi.mock('../../../apps/backend/src/services/treasury.service.js', () => ({
  TreasuryService: { getDepositTarget: mockGetDepositTarget },
}));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIN_DEPOSIT_TON = '0.5';
});

describe('WalletService.getBalance', () => {
  it('delegates to BalanceService', async () => {
    mockGetBalance.mockResolvedValueOnce({ available: '5.0', locked: '1.0' });
    const result = await WalletService.getBalance('u1');
    expect(result).toEqual({ available: '5.0', locked: '1.0' });
    expect(mockGetBalance).toHaveBeenCalledWith('u1');
  });
});

describe('WalletService.getHistory', () => {
  it('delegates to BalanceService', async () => {
    mockGetHistory.mockResolvedValueOnce([{ id: 'tx1' }]);
    const result = await WalletService.getHistory('u1', 1, 20);
    expect(result).toEqual([{ id: 'tx1' }]);
    expect(mockGetHistory).toHaveBeenCalledWith('u1', 1, 20);
  });
});

describe('WalletService.initDeposit', () => {
  it('returns address, memo, and minimumAmount', () => {
    mockGetDepositTarget.mockReturnValueOnce({ address: 'EQDhot', memo: 'user-1' });
    const result = WalletService.initDeposit('user-1');
    expect(result.address).toBe('EQDhot');
    expect(result.memo).toBe('user-1');
    expect(result.minimumAmount).toBe(0.5);
  });
});

describe('WalletService.getTotalObligations', () => {
  it('returns sum of all balances', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ total: 1234.5 }] });
    const total = await WalletService.getTotalObligations();
    expect(total).toBe(1234.5);
  });
});
