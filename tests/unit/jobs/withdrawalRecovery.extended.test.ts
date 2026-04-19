/**
 * tests/unit/jobs/withdrawalRecovery.extended.test.ts
 *
 * Covers the uncovered branches in withdrawalRecovery.ts:
 * - recoverTransaction: real hash → confirm immediately
 * - recoverTransaction: no hot wallet → skip
 * - recoverTransaction: on-chain found → confirm
 * - recoverTransaction: pending hash too young → wait
 * - recoverTransaction: pending hash old enough → mark for review
 * - recoverTransaction: processing stuck → mark for review
 * - checkOnChain: API unavailable → queried=false
 * - runWithdrawalRecovery: exported function
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDbQuery } = vi.hoisted(() => ({ mockDbQuery: vi.fn() }));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { startWithdrawalRecoveryJob, runWithdrawalRecovery } from '../../../apps/backend/src/jobs/withdrawalRecovery.js';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HOT_WALLET_ADDRESS;
  delete process.env.TON_API_KEY;
  process.env.TON_NETWORK = 'testnet';
});

function makeTx(overrides = {}) {
  return {
    id: 'tx-1',
    user_id: 'user-1',
    amount: '5',
    destination: 'EQDdest',
    ton_tx_hash: null as string | null,
    hot_wallet_seqno: null as number | null,
    updated_at: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
    status: 'processing',
    ...overrides,
  };
}

// ─── startWithdrawalRecoveryJob ───────────────────────────────────────────────

describe('startWithdrawalRecoveryJob', () => {
  it('returns an interval handle', () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    vi.useFakeTimers();
    const handle = startWithdrawalRecoveryJob();
    expect(handle).toBeDefined();
    clearInterval(handle);
    vi.useRealTimers();
  });
});

// ─── runWithdrawalRecovery ────────────────────────────────────────────────────

describe('runWithdrawalRecovery', () => {
  it('does nothing when no stuck transactions', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await runWithdrawalRecovery();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('handles DB error gracefully', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('DB down'));
    await expect(runWithdrawalRecovery()).resolves.toBeUndefined();
  });

  // ─── recoverTransaction: real hash → confirm ────────────────────────────

  it('confirms transaction immediately when real on-chain hash exists', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [makeTx({ ton_tx_hash: 'real-hash-abc123' })] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE confirmed

    await runWithdrawalRecovery();

    const confirmCall = mockDbQuery.mock.calls.find(c =>
      c[0].includes("status='confirmed'")
    );
    expect(confirmCall).toBeDefined();
  });

  // ─── recoverTransaction: no hot wallet → skip ───────────────────────────

  it('skips when no HOT_WALLET_ADDRESS and no pending hash hint', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [makeTx({ ton_tx_hash: null })] });

    await runWithdrawalRecovery();

    // Only the initial SELECT query — no UPDATE
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  // ─── recoverTransaction: on-chain found ─────────────────────────────────

  it('confirms when on-chain match found via API', async () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot';
    mockDbQuery
      .mockResolvedValueOnce({ rows: [makeTx()] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE confirmed

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        result: [{
          transaction_id: { hash: 'found-hash', lt: '100' },
          out_msgs: [{ destination: 'EQDdest', value: 5_000_000_000 }],
        }],
      }),
    });

    await runWithdrawalRecovery();

    const confirmCall = mockDbQuery.mock.calls.find(c =>
      c[0].includes("status='confirmed'")
    );
    expect(confirmCall).toBeDefined();
  });

  // ─── recoverTransaction: API unavailable ────────────────────────────────

  it('skips when TON API is unavailable (queried=false)', async () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot';
    mockDbQuery.mockResolvedValueOnce({ rows: [makeTx()] });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await runWithdrawalRecovery();

    // No UPDATE queries
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('skips when fetch throws (network error)', async () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot';
    mockDbQuery.mockResolvedValueOnce({ rows: [makeTx()] });
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await runWithdrawalRecovery();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  // ─── recoverTransaction: pending hash too young ──────────────────────────

  it('waits when pending hash is less than 30 minutes old', async () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot';
    const recentTx = makeTx({
      ton_tx_hash: 'pending:EQDhot:seq42:12345',
      updated_at: new Date(Date.now() - 5 * 60 * 1000), // only 5 min ago
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [recentTx] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: [] }), // not found on-chain
    });

    await runWithdrawalRecovery();

    // No UPDATE — too young to refund
    const updateCall = mockDbQuery.mock.calls.find(c => c[0].includes('UPDATE'));
    expect(updateCall).toBeUndefined();
  });

  // ─── recoverTransaction: pending hash old enough → mark for review ───────

  it('marks for manual review when pending hash is old and not found on-chain', async () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot';
    const oldTx = makeTx({
      ton_tx_hash: 'pending:EQDhot:seq42:12345',
      updated_at: new Date(Date.now() - 35 * 60 * 1000), // 35 min ago
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [oldTx] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE admin_note

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: [] }), // not found on-chain
    });

    await runWithdrawalRecovery();

    const reviewCall = mockDbQuery.mock.calls.find(c =>
      c[0].includes('admin_note') && c[0].includes('manual review')
    );
    expect(reviewCall).toBeDefined();
  });

  // ─── recoverTransaction: processing stuck → mark for review ─────────────

  it('marks processing tx for manual review when not found on-chain', async () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot';
    mockDbQuery
      .mockResolvedValueOnce({ rows: [makeTx({ ton_tx_hash: null })] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE admin_note

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
    });

    await runWithdrawalRecovery();

    const reviewCall = mockDbQuery.mock.calls.find(c =>
      c[0].includes('admin_note')
    );
    expect(reviewCall).toBeDefined();
  });

  // ─── recoverTransaction: error handling ─────────────────────────────────

  it('continues processing other transactions when one fails', async () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot';
    mockDbQuery
      .mockResolvedValueOnce({ rows: [makeTx({ id: 'tx-1' }), makeTx({ id: 'tx-2', ton_tx_hash: 'real-hash' })] })
      .mockRejectedValueOnce(new Error('DB error on tx-1')) // tx-1 fails
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // tx-2 succeeds

    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: [] }) });

    await runWithdrawalRecovery();
    // Should not throw
  });

  // ─── checkOnChain: pagination ────────────────────────────────────────────

  it('paginates through multiple pages to find hash', async () => {
    process.env.HOT_WALLET_ADDRESS = 'EQDhot';
    mockDbQuery
      .mockResolvedValueOnce({ rows: [makeTx()] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    // Page 1: 100 txs, no match
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      transaction_id: { hash: `h${i}`, lt: `${100 - i}` },
      out_msgs: [{ destination: 'EQDother', value: 1000 }],
    }));
    // Page 2: match found
    const page2 = [{
      transaction_id: { hash: 'found-on-page2', lt: '1' },
      out_msgs: [{ destination: 'EQDdest', value: 5_000_000_000 }],
    }];

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: page1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: page2 }) });

    await runWithdrawalRecovery();

    const confirmCall = mockDbQuery.mock.calls.find(c => c[0].includes("status='confirmed'"));
    expect(confirmCall).toBeDefined();
  });

  it('uses pending hash hot wallet address when HOT_WALLET_ADDRESS not set', async () => {
    delete process.env.HOT_WALLET_ADDRESS;
    const tx = makeTx({ ton_tx_hash: 'pending:EQDhot-from-hash:seq42:12345' });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [tx] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
    });

    await runWithdrawalRecovery();
    // Should have called fetch with the hot wallet from the pending hash
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('EQDhot-from-hash'),
    );
  });
});
