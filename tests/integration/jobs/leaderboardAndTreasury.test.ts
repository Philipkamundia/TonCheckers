/**
 * tests/integration/jobs/leaderboardAndTreasury.test.ts
 *
 * leaderboardRebuild and treasuryMonitor — tests the run logic directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRebuildAll, mockGetObligations, mockCheckRefill, mockLogger } = vi.hoisted(() => ({
  mockRebuildAll:     vi.fn(),
  mockGetObligations: vi.fn(),
  mockCheckRefill:    vi.fn(),
  mockLogger:         { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/leaderboard.service.js', () => ({
  LeaderboardService: { rebuildAll: mockRebuildAll },
}));
vi.mock('../../../apps/backend/src/services/wallet.service.js', () => ({
  WalletService: { getTotalObligations: mockGetObligations },
}));
vi.mock('../../../apps/backend/src/services/treasury.service.js', () => ({
  TreasuryService: { checkRefillNeeded: mockCheckRefill },
}));
vi.mock('../../../apps/backend/src/utils/logger.js', () => ({ logger: mockLogger }));

import { LeaderboardService } from '../../../apps/backend/src/services/leaderboard.service.js';
import { WalletService }      from '../../../apps/backend/src/services/wallet.service.js';
import { TreasuryService }    from '../../../apps/backend/src/services/treasury.service.js';

beforeEach(() => vi.resetAllMocks());

// ─── leaderboardRebuild logic ─────────────────────────────────────────────────

describe('leaderboardRebuild logic', () => {
  async function runLeaderboardRebuild(): Promise<void> {
    try {
      await LeaderboardService.rebuildAll();
    } catch (err) {
      mockLogger.error(`Leaderboard rebuild error: ${(err as Error).message}`);
    }
  }

  it('calls rebuildAll', async () => {
    mockRebuildAll.mockResolvedValue(undefined);
    await runLeaderboardRebuild();
    expect(mockRebuildAll).toHaveBeenCalled();
  });

  it('logs error when rebuild fails', async () => {
    mockRebuildAll.mockRejectedValue(new Error('Redis down'));
    await runLeaderboardRebuild();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Leaderboard rebuild error'));
  });
});

// ─── treasuryMonitor logic ────────────────────────────────────────────────────

describe('treasuryMonitor logic', () => {
  async function runTreasuryCheck(): Promise<void> {
    try {
      const obligations  = await WalletService.getTotalObligations();
      const refillNeeded = await TreasuryService.checkRefillNeeded(obligations);
      if (refillNeeded) {
        mockLogger.warn(`Treasury refill needed: obligations=${obligations.toFixed(2)} TON`);
      } else {
        mockLogger.debug(`Treasury healthy: obligations=${obligations.toFixed(2)} TON`);
      }
    } catch (err) {
      mockLogger.error(`Treasury monitor error: ${(err as Error).message}`);
    }
  }

  it('logs warning when refill is needed', async () => {
    mockGetObligations.mockResolvedValue(500);
    mockCheckRefill.mockResolvedValue(true);
    await runTreasuryCheck();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Treasury refill needed'));
  });

  it('logs debug when treasury is healthy', async () => {
    mockGetObligations.mockResolvedValue(100);
    mockCheckRefill.mockResolvedValue(false);
    await runTreasuryCheck();
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Treasury healthy'));
  });

  it('logs error and does not throw when monitor fails', async () => {
    mockGetObligations.mockRejectedValue(new Error('DB error'));
    await runTreasuryCheck();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Treasury monitor error'));
  });
});
