/**
 * tests/integration/jobs/withdrawalRecovery.test.ts
 *
 * withdrawalRecovery job — stuck withdrawal detection and recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockLogger } = vi.hoisted(() => ({
  mockQuery:  vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockQuery },
}));
vi.mock('../../../apps/backend/src/utils/logger.js', () => ({ logger: mockLogger }));

import { runWithdrawalRecovery } from '../../../apps/backend/src/jobs/withdrawalRecovery.js';

const TX_BASE = {
  id: 'tx-001', user_id: 'user-1', amount: '1.0',
  destination: 'EQDdest000000000000000000000000000000000000000001',
  updated_at: new Date(Date.now() - 15 * 60_000), // 15 min ago
};

beforeEach(() => vi.resetAllMocks());

describe('runWithdrawalRecovery — no stuck transactions', () => {
  it('does nothing when no stuck transactions', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await runWithdrawalRecovery();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe('runWithdrawalRecovery — confirmed hash', () => {
  it('marks confirmed when real on-chain hash exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...TX_BASE, ton_tx_hash: 'abc123realhash', hot_wallet_seqno: null, status: 'processing' }] })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE confirmed

    await runWithdrawalRecovery();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status='confirmed'"),
      expect.arrayContaining(['tx-001']),
    );
  });
});

describe('runWithdrawalRecovery — pending hash (broadcast but unconfirmed)', () => {
  it('waits before refunding when pending hash is recent', async () => {
    const recentTx = {
      ...TX_BASE,
      ton_tx_hash: 'pending:EQDhot:seq42:' + Date.now(),
      hot_wallet_seqno: 42,
      status: 'processing',
      updated_at: new Date(Date.now() - 5 * 60_000), // only 5 min ago
    };
    mockQuery.mockResolvedValueOnce({ rows: [recentTx] });

    // Mock fetch to return no on-chain match
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
    });

    await runWithdrawalRecovery();

    // Should NOT mark for manual review yet — too recent
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the SELECT
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('waiting for confirmation'));
  });
});

describe('runWithdrawalRecovery — no hot wallet address', () => {
  it('skips refund when HOT_WALLET_ADDRESS missing and no pending hash', async () => {
    const tx = { ...TX_BASE, ton_tx_hash: null, hot_wallet_seqno: null, status: 'processing' };
    mockQuery.mockResolvedValueOnce({ rows: [tx] });

    const original = process.env.HOT_WALLET_ADDRESS;
    delete process.env.HOT_WALLET_ADDRESS;

    await runWithdrawalRecovery();

    process.env.HOT_WALLET_ADDRESS = original;
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('missing HOT_WALLET_ADDRESS'));
  });
});

describe('runWithdrawalRecovery — DB error resilience', () => {
  it('logs error and does not throw when DB query fails', async () => {
    mockQuery.mockRejectedValue(new Error('Connection refused'));
    await expect(runWithdrawalRecovery()).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Withdrawal recovery job error'));
  });
});

describe('runWithdrawalRecovery — manual review flag', () => {
  it('flags for manual review when on-chain check finds nothing for old pending tx', async () => {
    const oldTx = {
      ...TX_BASE,
      ton_tx_hash: 'pending:EQDhot:seq42:' + (Date.now() - 35 * 60_000),
      hot_wallet_seqno: 42,
      status: 'processing',
      updated_at: new Date(Date.now() - 35 * 60_000), // 35 min ago
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldTx] })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE admin_note

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
    });

    await runWithdrawalRecovery();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('admin_note'),
      expect.arrayContaining(['tx-001']),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('manual review required'));
  });
});
