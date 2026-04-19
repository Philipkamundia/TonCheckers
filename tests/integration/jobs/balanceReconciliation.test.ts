/**
 * tests/integration/jobs/balanceReconciliation.test.ts
 *
 * Balance reconciliation job — verifies that the financial integrity check
 * correctly detects discrepancies, negative balances, and orphaned locks.
 *
 * Uses mocked DB pool to simulate exact query responses. The goal is to
 * ensure the reporting and alerting logic fires correctly for each condition.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReconciliation } from '../../../apps/backend/src/jobs/balanceReconciliation.js';

// ─── Mock pool ────────────────────────────────────────────────────────────────

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockQuery },
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    http:  vi.fn(),
  },
}));

const { logger } = await import('../../../apps/backend/src/utils/logger.js');

// ─── Query response factories ─────────────────────────────────────────────────

function makeLiabilityRow(available: string, locked: string, userCount = 10) {
  const total = (parseFloat(available) + parseFloat(locked)).toFixed(9);
  return { total_available: available, total_locked: locked, total_liability: total, user_count: userCount };
}

function makeLedgerRow(deposits: string, withdrawals: string) {
  const expected = (parseFloat(deposits) - parseFloat(withdrawals)).toFixed(9);
  return {
    total_deposits:    deposits,
    total_withdrawals: withdrawals,
    total_game_wins:   '0',
    expected_balance:  expected,
  };
}

function setupQueries(overrides: {
  liability?:  ReturnType<typeof makeLiabilityRow>;
  ledger?:     ReturnType<typeof makeLedgerRow>;
  negatives?:  Array<{ user_id: string; available: string; locked: string }>;
  orphaned?:   number;
  stuck?:      number;
  logInsert?:  boolean;
} = {}) {
  const {
    liability  = makeLiabilityRow('100.000000000', '20.000000000'),
    ledger     = makeLedgerRow('120.000000000', '0.000000000'),
    negatives  = [],
    orphaned   = 0,
    stuck      = 0,
    logInsert  = true,
  } = overrides;

  mockQuery
    .mockResolvedValueOnce({ rows: [liability] })   // 1: platform liability
    .mockResolvedValueOnce({ rows: [ledger] })       // 2: ledger expected
    .mockResolvedValueOnce({ rows: negatives })      // 3: negative balances
    .mockResolvedValueOnce({ rows: [{ orphaned }] }) // 4: orphaned locks
    .mockResolvedValueOnce({ rows: [{ stuck }] })    // 5: stuck withdrawals
    .mockResolvedValueOnce({ rows: [] });             // 6: reconciliation_log INSERT
}

beforeEach(() => vi.clearAllMocks());

// ─── Healthy state ────────────────────────────────────────────────────────────

describe('runReconciliation — healthy state', () => {
  it('logs OK when liability matches ledger within tolerance', async () => {
    setupQueries(); // liability=120, ledger expected=120
    await runReconciliation();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Reconciliation OK'),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('DISCREPANCY'),
    );
  });

  it('accepts discrepancy within 1 nanoTON tolerance', async () => {
    const liability = makeLiabilityRow('120.000000001', '0');
    const ledger    = makeLedgerRow('120.000000000', '0');
    setupQueries({ liability, ledger });
    await runReconciliation();
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('DISCREPANCY'),
    );
  });
});

// ─── Balance discrepancy detection ───────────────────────────────────────────

describe('runReconciliation — discrepancy detection', () => {
  it('logs ALERT when liability does not match ledger', async () => {
    const liability = makeLiabilityRow('130.000000000', '0'); // 130 TON held
    const ledger    = makeLedgerRow('120.000000000', '0');     // only 120 should be
    setupQueries({ liability, ledger });

    await runReconciliation();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('BALANCE DISCREPANCY DETECTED'),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('10.000000000'),
    );
  });

  it('includes both liability and expected values in the alert', async () => {
    const liability = makeLiabilityRow('50.000000000', '0');
    const ledger    = makeLedgerRow('100.000000000', '0');
    setupQueries({ liability, ledger });

    await runReconciliation();
    const errorCall = (logger.error as any).mock.calls.find(
      (args: string[]) => args[0].includes('DISCREPANCY'),
    );
    expect(errorCall[0]).toContain('50.000000000');
    expect(errorCall[0]).toContain('100.000000000');
  });

  it('does NOT auto-correct balances (read-only job)', async () => {
    const liability = makeLiabilityRow('130.000000000', '0');
    const ledger    = makeLedgerRow('120.000000000', '0');
    setupQueries({ liability, ledger });

    await runReconciliation();

    // Verify no UPDATE calls were made to balances table
    const updateCalls = (mockQuery as any).mock.calls.filter(
      (args: string[][]) => args[0]?.includes?.('UPDATE balances'),
    );
    expect(updateCalls).toHaveLength(0);
  });
});

// ─── Negative balance detection ───────────────────────────────────────────────

describe('runReconciliation — negative balance detection', () => {
  it('alerts when any user has negative balance', async () => {
    const negatives = [
      { user_id: 'user-evil-1', available: '-5.0', locked: '0' },
      { user_id: 'user-evil-2', available: '0',    locked: '-1.0' },
    ];
    setupQueries({ negatives });

    await runReconciliation();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('NEGATIVE BALANCES'),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('user-evil-1'),
    );
  });

  it('does not alert when no negative balances', async () => {
    setupQueries({ negatives: [] });
    await runReconciliation();
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('NEGATIVE BALANCES'),
    );
  });
});

// ─── Orphaned lock detection ──────────────────────────────────────────────────

describe('runReconciliation — orphaned lock reporting', () => {
  it('logs warning when orphaned locks exist', async () => {
    setupQueries({ orphaned: 3 });
    await runReconciliation();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Orphaned locks: 3'),
    );
  });

  it('does not warn when no orphaned locks', async () => {
    setupQueries({ orphaned: 0 });
    await runReconciliation();
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Orphaned'),
    );
  });
});

// ─── Stuck withdrawal detection ──────────────────────────────────────────────

describe('runReconciliation — stuck withdrawal detection', () => {
  it('logs warning when processing withdrawals stuck > 30min', async () => {
    setupQueries({ stuck: 2 });
    await runReconciliation();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Stuck withdrawals: 2'),
    );
  });

  it('does not warn when no stuck withdrawals', async () => {
    setupQueries({ stuck: 0 });
    await runReconciliation();
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Stuck'),
    );
  });
});

// ─── Resilience ──────────────────────────────────────────────────────────────

describe('runReconciliation — resilience', () => {
  it('handles reconciliation_log table missing (migration not run)', async () => {
    setupQueries();
    // Override last mock to throw "table not found"
    mockQuery.mockRejectedValueOnce(new Error('relation "reconciliation_log" does not exist'));
    // Actually the insert is the 6th call — let's override it
    const mocks = [...Array(5)].map(() => Promise.resolve({ rows: [] }));
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({ rows: [makeLiabilityRow('100', '0')] })
      .mockResolvedValueOnce({ rows: [makeLedgerRow('100', '0')] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ orphaned: 0 }] })
      .mockResolvedValueOnce({ rows: [{ stuck: 0 }] })
      .mockRejectedValueOnce(new Error('relation "reconciliation_log" does not exist'));

    // Should not throw — just logs a warning
    await expect(runReconciliation()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('reconciliation_log table not found'),
    );
  });

  it('logs error and does not throw when DB query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(runReconciliation()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Balance reconciliation failed'),
    );
  });
});
