/**
 * tests/unit/services/deposit-detection.extended.test.ts
 *
 * Covers uncovered branches in DepositDetectionService:
 * - fetchRecentTransactions pagination (multi-page, stop conditions)
 * - parse: zero-value transactions skipped
 * - processTransaction: balance row missing → INSERT fallback
 * - processTransaction: duplicate hash (idempotency)
 * - start/stop lifecycle
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDbQuery, mockDbConnect, mockDbClient, mockNotify, mockGetHotWallet } = vi.hoisted(() => {
  const mockDbClient = { query: vi.fn(), release: vi.fn() };
  return {
    mockDbQuery:      vi.fn(),
    mockDbConnect:    vi.fn().mockResolvedValue(mockDbClient),
    mockDbClient,
    mockNotify:       vi.fn(),
    mockGetHotWallet: vi.fn(),
  };
});

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery, connect: mockDbConnect },
}));
vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: mockNotify },
}));
vi.mock('../../../apps/backend/src/services/treasury.service.js', () => ({
  TreasuryService: { getHotWalletAddress: mockGetHotWallet },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { DepositDetectionService } from '../../../apps/backend/src/services/deposit-detection.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockNotify.mockResolvedValue(undefined);
  mockDbClient.release.mockReturnValue(undefined);
  mockGetHotWallet.mockReturnValue('EQDhot123');
  process.env.TON_NETWORK = 'testnet';
  delete process.env.TON_API_KEY;
  delete process.env.MIN_DEPOSIT_TON;
});

function makeTx(overrides = {}) {
  return {
    hash: 'hash-abc',
    amount: '1000000000', // 1 TON in nanoTON
    memo: 'aaaaaaaa-0000-0000-0000-000000000001',
    fromAddress: 'EQDsender',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeApiResponse(txs: unknown[], ok = true) {
  return { ok, result: txs };
}

function makeRawTx(hash: string, value: string, memo: string) {
  return {
    transaction_id: { hash, lt: '12345' },
    in_msg: { value, message: memo, source: 'EQDsender' },
    utime: Date.now(),
  };
}

// ─── start / stop ─────────────────────────────────────────────────────────────

describe('DepositDetectionService.start / stop', () => {
  it('starts polling and can be stopped', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => makeApiResponse([]) });
    await DepositDetectionService.start();
    DepositDetectionService.stop();
    // Should not throw
  });

  it('does not start twice', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => makeApiResponse([]) });
    await DepositDetectionService.start();
    await DepositDetectionService.start(); // second call ignored
    DepositDetectionService.stop();
  });
});

// ─── fetchRecentTransactions — pagination ─────────────────────────────────────

describe('DepositDetectionService — pagination', () => {
  it('stops after fewer than 100 results (end of data)', async () => {
    // First page: 50 txs (< 100 → stop)
    const txs = Array.from({ length: 50 }, (_, i) => makeRawTx(`hash-${i}`, '1000000000', 'memo'));
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeApiResponse(txs) });
    mockDbQuery.mockResolvedValue({ rows: [{ id: 'existing' }] }); // all duplicates

    await DepositDetectionService.start();
    DepositDetectionService.stop();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('paginates when first page has exactly 100 results', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeRawTx(`hash-p1-${i}`, '1000000000', 'memo'));
    const page2 = Array.from({ length: 30 }, (_, i) => makeRawTx(`hash-p2-${i}`, '1000000000', 'memo'));

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => makeApiResponse(page1) })
      .mockResolvedValueOnce({ ok: true, json: async () => makeApiResponse(page2) });
    mockDbQuery.mockResolvedValue({ rows: [{ id: 'existing' }] }); // all duplicates

    await DepositDetectionService.start();
    DepositDetectionService.stop();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles API error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await DepositDetectionService.start();
    DepositDetectionService.stop();
    // Should not throw
  });

  it('handles non-ok API response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    await DepositDetectionService.start();
    DepositDetectionService.stop();
  });
});

// ─── parse — zero-value transactions ─────────────────────────────────────────

describe('DepositDetectionService — parse', () => {
  it('skips transactions with zero value', async () => {
    const zeroTx = makeRawTx('hash-zero', '0', 'memo');
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeApiResponse([zeroTx]) });
    mockDbQuery.mockResolvedValue({ rows: [] });

    await DepositDetectionService.start();
    DepositDetectionService.stop();

    // No DB queries for the zero-value tx (no idempotency check needed)
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('skips transactions with missing in_msg', async () => {
    const noMsg = { transaction_id: { hash: 'h1', lt: '1' }, utime: Date.now() };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeApiResponse([noMsg]) });
    mockDbQuery.mockResolvedValue({ rows: [] });

    await DepositDetectionService.start();
    DepositDetectionService.stop();

    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});

// ─── processTransaction — idempotency ────────────────────────────────────────

describe('DepositDetectionService — idempotency', () => {
  it('skips already-processed transaction (duplicate hash)', async () => {
    const tx = makeRawTx('hash-dup', '1000000000', 'aaaaaaaa-0000-0000-0000-000000000001');
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeApiResponse([tx]) });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-tx' }] }); // already exists

    await DepositDetectionService.start();
    DepositDetectionService.stop();

    expect(mockDbQuery).toHaveBeenCalledTimes(1); // only the idempotency check
  });
});

// ─── processTransaction — balance row missing ─────────────────────────────────

describe('DepositDetectionService — balance row missing fallback', () => {
  it('creates balance row when UPDATE returns rowCount=0', async () => {
    const tx = makeRawTx('hash-new', '2000000000', 'aaaaaaaa-0000-0000-0000-000000000001');
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeApiResponse([tx]) });

    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // idempotency: not duplicate
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }); // user found

    let insertCallCount = 0;
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK'))
        return Promise.resolve({});
      if (sql.includes('INSERT INTO transactions')) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('UPDATE balances')) {
        insertCallCount++;
        return Promise.resolve({ rowCount: 0 }); // balance row missing
      }
      if (sql.includes('INSERT INTO balances')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await DepositDetectionService.start();
    DepositDetectionService.stop();

    // Should have tried UPDATE then INSERT
    const insertBalCall = mockDbClient.query.mock.calls.find(c =>
      c[0].includes('INSERT INTO balances')
    );
    expect(insertBalCall).toBeDefined();
  });

  it('handles DB error during credit gracefully', async () => {
    const tx = makeRawTx('hash-err', '2000000000', 'aaaaaaaa-0000-0000-0000-000000000001');
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeApiResponse([tx]) });

    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // not duplicate
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }); // user found

    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      if (sql.includes('INSERT INTO transactions')) throw new Error('Constraint violation');
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await DepositDetectionService.start();
    DepositDetectionService.stop();
    // Should not throw
  });
});
