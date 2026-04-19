/**
 * tests/unit/jobs/treasuryMonitor.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockWalletService, mockTreasuryService, mockLogger } = vi.hoisted(() => ({
  mockWalletService: { getTotalObligations: vi.fn() },
  mockTreasuryService: { checkRefillNeeded: vi.fn() },
  mockLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/wallet.service.js', () => ({
  WalletService: mockWalletService,
}));

vi.mock('../../../apps/backend/src/services/treasury.service.js', () => ({
  TreasuryService: mockTreasuryService,
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { startTreasuryMonitor } from '../../../apps/backend/src/jobs/treasuryMonitor.js';

let handle: ReturnType<typeof setInterval>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  if (handle) clearInterval(handle);
  vi.useRealTimers();
});

describe('startTreasuryMonitor', () => {
  it('runs immediately on start', async () => {
    mockWalletService.getTotalObligations.mockResolvedValue(100);
    mockTreasuryService.checkRefillNeeded.mockResolvedValue(false);

    handle = startTreasuryMonitor();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockWalletService.getTotalObligations).toHaveBeenCalledTimes(1);
    expect(mockTreasuryService.checkRefillNeeded).toHaveBeenCalledTimes(1);
  });

  it('returns a setInterval handle', () => {
    mockWalletService.getTotalObligations.mockResolvedValue(50);
    mockTreasuryService.checkRefillNeeded.mockResolvedValue(false);
    handle = startTreasuryMonitor();
    expect(handle).toBeDefined();
  });

  it('runs again after 5 minutes', async () => {
    mockWalletService.getTotalObligations.mockResolvedValue(100);
    mockTreasuryService.checkRefillNeeded.mockResolvedValue(false);

    handle = startTreasuryMonitor();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockWalletService.getTotalObligations).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(mockWalletService.getTotalObligations).toHaveBeenCalledTimes(2);
  });

  it('logs warning when refill is needed', async () => {
    mockWalletService.getTotalObligations.mockResolvedValue(250.5);
    mockTreasuryService.checkRefillNeeded.mockResolvedValue(true);

    handle = startTreasuryMonitor();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Treasury refill needed: obligations=250.50 TON',
    );
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('passes obligations to checkRefillNeeded', async () => {
    mockWalletService.getTotalObligations.mockResolvedValue(42.75);
    mockTreasuryService.checkRefillNeeded.mockResolvedValue(false);

    handle = startTreasuryMonitor();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockTreasuryService.checkRefillNeeded).toHaveBeenCalledWith(42.75);
  });

  it('logs debug when treasury is healthy', async () => {
    mockWalletService.getTotalObligations.mockResolvedValue(100.0);
    mockTreasuryService.checkRefillNeeded.mockResolvedValue(false);

    handle = startTreasuryMonitor();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Treasury healthy: obligations=100.00 TON',
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('logs error when getTotalObligations throws', async () => {
    mockWalletService.getTotalObligations.mockRejectedValue(new Error('Redis down'));

    handle = startTreasuryMonitor();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Treasury monitor error: Redis down',
    );
  });

  it('logs error when checkRefillNeeded throws', async () => {
    mockWalletService.getTotalObligations.mockResolvedValue(100);
    mockTreasuryService.checkRefillNeeded.mockRejectedValue(new Error('Service unavailable'));

    handle = startTreasuryMonitor();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Treasury monitor error: Service unavailable',
    );
  });

  it('does not throw when inner run throws', async () => {
    mockWalletService.getTotalObligations.mockRejectedValue(new Error('fail'));
    expect(() => {
      handle = startTreasuryMonitor();
    }).not.toThrow();
  });

  it('logs info on start', () => {
    mockWalletService.getTotalObligations.mockResolvedValue(0);
    mockTreasuryService.checkRefillNeeded.mockResolvedValue(false);
    handle = startTreasuryMonitor();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Treasury monitor started — checking every 5 minutes',
    );
  });

  it('runs on interval after immediate call', async () => {
    mockWalletService.getTotalObligations.mockResolvedValue(100);
    mockTreasuryService.checkRefillNeeded.mockResolvedValue(false);

    handle = startTreasuryMonitor();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(mockWalletService.getTotalObligations).toHaveBeenCalledTimes(3);
  });
});
