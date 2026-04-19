/**
 * tests/unit/jobs/orphanedLockRecovery.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDbQuery, mockDbConnect, mockDbClient } = vi.hoisted(() => {
  const mockDbClient = { query: vi.fn(), release: vi.fn() };
  return { mockDbQuery: vi.fn(), mockDbConnect: vi.fn().mockResolvedValue(mockDbClient), mockDbClient };
});

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery, connect: mockDbConnect },
}));

import { startOrphanedLockRecoveryJob } from '../../../apps/backend/src/jobs/orphanedLockRecovery.js';

// Helper: run the job's initial scan and wait for it to complete
async function runJob() {
  vi.useFakeTimers();
  const handle = startOrphanedLockRecoveryJob();
  vi.useRealTimers();
  // Wait for the initial async recoverOrphanedLocks() to settle
  await new Promise(r => setTimeout(r, 10));
  clearInterval(handle);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbClient.release.mockReturnValue(undefined);
});

function setupClientTransaction(responses: Array<{ rows: unknown[]; rowCount?: number }>) {
  let i = 0;
  mockDbClient.query.mockImplementation((sql: string) => {
    if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK'))
      return Promise.resolve({});
    return Promise.resolve(responses[i++] ?? { rows: [], rowCount: 0 });
  });
}

describe('startOrphanedLockRecoveryJob', () => {
  it('returns an interval handle', () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const handle = startOrphanedLockRecoveryJob();
    expect(handle).toBeDefined();
    clearInterval(handle);
  });
});

describe('recoverOrphanedLocks', () => {
  it('does nothing when no orphaned locks found', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    await runJob();
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it('processes each orphaned lock found', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ user_id: 'u1', locked: '1.0' }],
    });
    setupClientTransaction([
      { rows: [{ locked: '1.0' }] },  // balance check
      { rows: [] },                    // no active games
      { rows: [] },                    // no queue entries
      { rows: [], rowCount: 1 },       // UPDATE balances
    ]);

    await runJob();
    expect(mockDbConnect).toHaveBeenCalled();
  });

  it('logs error when outer query fails', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('DB connection failed'));
    await runJob();
    // Should not throw
  });
});

describe('recoverOrphanedLock — individual recovery', () => {
  it('rolls back when balance already cleared (locked=0)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', locked: '1.0' }] });
    setupClientTransaction([{ rows: [{ locked: '0' }] }]);
    await runJob();
    const rollbackCall = mockDbClient.query.mock.calls.find(c => c[0].includes('ROLLBACK'));
    expect(rollbackCall).toBeDefined();
  });

  it('rolls back when balance row missing', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', locked: '1.0' }] });
    setupClientTransaction([{ rows: [] }]);
    await runJob();
    const rollbackCall = mockDbClient.query.mock.calls.find(c => c[0].includes('ROLLBACK'));
    expect(rollbackCall).toBeDefined();
  });

  it('rolls back when user has active game', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', locked: '1.0' }] });
    setupClientTransaction([
      { rows: [{ locked: '1.0' }] },
      { rows: [{ '?column?': 1 }] }, // active game found
    ]);
    await runJob();
    const rollbackCall = mockDbClient.query.mock.calls.find(c => c[0].includes('ROLLBACK'));
    expect(rollbackCall).toBeDefined();
  });

  it('rolls back when user is in matchmaking queue', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', locked: '1.0' }] });
    setupClientTransaction([
      { rows: [{ locked: '1.0' }] },
      { rows: [] },                   // no active game
      { rows: [{ '?column?': 1 }] }, // in queue
    ]);
    await runJob();
    const rollbackCall = mockDbClient.query.mock.calls.find(c => c[0].includes('ROLLBACK'));
    expect(rollbackCall).toBeDefined();
  });

  it('commits and unlocks when lock is genuinely orphaned', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', locked: '1.5' }] });
    setupClientTransaction([
      { rows: [{ locked: '1.5' }] },
      { rows: [] },
      { rows: [] },
      { rows: [], rowCount: 1 },
    ]);
    await runJob();
    const commitCall = mockDbClient.query.mock.calls.find(c => c[0].includes('COMMIT'));
    expect(commitCall).toBeDefined();
  });

  it('rolls back and logs error on DB failure during recovery', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', locked: '1.0' }] });
    let callCount = 0;
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      callCount++;
      if (callCount === 1) throw new Error('Lock timeout');
      return Promise.resolve({ rows: [] });
    });
    await runJob();
    expect(mockDbClient.release).toHaveBeenCalled();
  });
});
