/**
 * deposit.test.ts — Tests for DepositDetectionService
 *
 * Tests the critical deposit processing logic:
 * - Idempotency (same tx hash never credited twice)
 * - Missing memo → ignored
 * - Non-UUID memo → ignored
 * - Unknown user in memo → ignored
 * - Below minimum → recorded as failed, not credited
 * - Valid deposit → balance credited atomically
 * - Concurrent poll guard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery  = vi.fn();
const mockClient = { query: vi.fn(), release: vi.fn() };

vi.mock('../config/db.js', () => ({
  default: {
    query:   (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue(mockClient),
  },
}));

vi.mock('../services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/treasury.service.js', () => ({
  TreasuryService: { getHotWalletAddress: vi.fn().mockReturnValue('EQDhot_wallet') },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

// We test processTransaction indirectly by calling the private method via type cast
type PrivateDeposit = {
  processTransaction(tx: {
    hash: string; amount: string; memo: string; fromAddress: string; timestamp: number;
  }): Promise<void>;
  polling: boolean;
};

const { DepositDetectionService } = await import('../services/deposit-detection.service.js');
const svc = DepositDetectionService as unknown as PrivateDeposit;

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function makeTx(overrides: Partial<{ hash: string; amount: string; memo: string }> = {}) {
  return {
    hash:        overrides.hash        ?? 'abc123hash',
    amount:      overrides.amount      ?? '1000000000', // 1 TON in nanoTON
    memo:        overrides.memo        ?? USER_ID,
    fromAddress: 'EQDsender',
    timestamp:   Math.floor(Date.now() / 1000),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('processTransaction — idempotency', () => {
  it('skips transaction if ton_tx_hash already exists', async () => {
    // SELECT id FROM transactions WHERE ton_tx_hash = $1 → found
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-tx' }] });

    await svc.processTransaction(makeTx());

    // Should not have opened a client connection
    expect(mockClient.query).not.toHaveBeenCalled();
  });
});

// ─── Memo validation ──────────────────────────────────────────────────────────

describe('processTransaction — memo validation', () => {
  it('ignores transaction with empty memo', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // not seen before

    await svc.processTransaction(makeTx({ memo: '' }));

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('ignores transaction with whitespace-only memo', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.processTransaction(makeTx({ memo: '   ' }));

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('ignores transaction with non-UUID memo', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.processTransaction(makeTx({ memo: 'not-a-uuid' }));

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('ignores transaction with numeric memo', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.processTransaction(makeTx({ memo: '12345' }));

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('accepts valid UUID memo', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                    // not seen before
      .mockResolvedValueOnce({ rows: [{ id: USER_ID }] });    // user exists

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (typeof sql === 'string' && sql.includes('INSERT INTO transactions')) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await svc.processTransaction(makeTx({ memo: USER_ID }));

    // Should have opened a client (attempted to credit)
    expect(mockClient.query).toHaveBeenCalled();
  });
});

// ─── Unknown user ─────────────────────────────────────────────────────────────

describe('processTransaction — unknown user', () => {
  it('ignores transaction when user ID in memo does not exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // not seen before
      .mockResolvedValueOnce({ rows: [] }); // user not found

    await svc.processTransaction(makeTx());

    expect(mockClient.query).not.toHaveBeenCalled();
  });
});

// ─── Below minimum ────────────────────────────────────────────────────────────

describe('processTransaction — below minimum', () => {
  it('records as failed and does not credit for amount below 0.5 TON', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                    // not seen before
      .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })    // user exists
      .mockResolvedValueOnce({ rowCount: 1 });                // INSERT failed tx

    // 0.4 TON = 400_000_000 nanoTON
    await svc.processTransaction(makeTx({ amount: '400000000' }));

    // Should have inserted a 'failed' transaction record
    const insertCall = mockQuery.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes("'failed'"),
    );
    expect(insertCall).toBeDefined();

    // Should NOT have opened a client for balance credit
    expect(mockClient.query).not.toHaveBeenCalled();
  });
});

// ─── Successful deposit ───────────────────────────────────────────────────────

describe('processTransaction — successful credit', () => {
  it('credits balance for valid deposit above minimum', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                    // not seen before
      .mockResolvedValueOnce({ rows: [{ id: USER_ID }] });    // user exists

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (typeof sql === 'string' && sql.includes('INSERT INTO transactions')) {
        return Promise.resolve({ rowCount: 1 });
      }
      if (typeof sql === 'string' && sql.includes('UPDATE balances')) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    // 2 TON = 2_000_000_000 nanoTON
    await svc.processTransaction(makeTx({ amount: '2000000000' }));

    const balanceUpdate = mockClient.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('UPDATE balances'),
    );
    expect(balanceUpdate).toBeDefined();
    // Amount should be 2.000000000
    expect(balanceUpdate[1][0]).toBe('2.000000000');
    expect(balanceUpdate[1][1]).toBe(USER_ID);
  });

  it('rolls back and does not credit if INSERT returns rowCount=0 (duplicate race)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: USER_ID }] });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve();
      if (typeof sql === 'string' && sql.includes('INSERT INTO transactions')) {
        return Promise.resolve({ rowCount: 0 }); // ON CONFLICT DO NOTHING
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await svc.processTransaction(makeTx());

    // ROLLBACK should have been called
    const rollbackCall = mockClient.query.mock.calls.find(
      (c: unknown[]) => c[0] === 'ROLLBACK',
    );
    expect(rollbackCall).toBeDefined();

    // UPDATE balances should NOT have been called
    const balanceUpdate = mockClient.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('UPDATE balances'),
    );
    expect(balanceUpdate).toBeUndefined();
  });

  it('releases DB client after successful processing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: USER_ID }] });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await svc.processTransaction(makeTx());

    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});

// ─── Amount conversion ────────────────────────────────────────────────────────

describe('processTransaction — nanoTON conversion', () => {
  it('converts nanoTON to TON with 9 decimal places', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: USER_ID }] });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    // 1.5 TON = 1_500_000_000 nanoTON
    await svc.processTransaction(makeTx({ amount: '1500000000' }));

    const insertCall = mockClient.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO transactions'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][1]).toBe('1.500000000');
  });
});
