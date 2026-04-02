/**
 * settlement.test.ts — Tests for SettlementService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (must be before vi.mock calls) ─────────────────────────────

const { mockQuery, mockClient } = vi.hoisted(() => {
  const mockClient = {
    query:   vi.fn(),
    release: vi.fn(),
  };
  const mockQuery = vi.fn();
  return { mockQuery, mockClient };
});

vi.mock('../config/db.js', () => ({
  default: {
    query:   (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue(mockClient),
  },
}));

vi.mock('../services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/tournament.service.js', () => ({
  TournamentService: { recordMatchResult: vi.fn().mockResolvedValue(undefined) },
}));

import { SettlementService } from '../services/settlement.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WINNER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const LOSER_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';
const GAME_ID   = 'cccccccc-0000-0000-0000-000000000003';

function setupSuccessfulTransaction(rowCount = 1) {
  mockClient.query.mockImplementation((sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve();
    if (typeof sql === 'string' && sql.includes('UPDATE games')) return Promise.resolve({ rowCount });
    return Promise.resolve({ rowCount: 1, rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  // Default fallback for any unexpected pool.query calls (e.g. tournament_matches lookup)
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ─── calculateWinPayout ───────────────────────────────────────────────────────

describe('calculateWinPayout (PRD §12)', () => {
  it('0 TON stake → 0 payout, 0 fee', () => {
    const r = SettlementService.calculateWinPayout('0');
    expect(r.winnerPayout).toBe('0.000000000');
    expect(r.platformFee).toBe('0.000000000');
    expect(r.prizePool).toBe('0.000000000');
  });

  it('1 TON stake → 1.70 payout, 0.30 fee', () => {
    const r = SettlementService.calculateWinPayout('1');
    expect(parseFloat(r.winnerPayout)).toBeCloseTo(1.70, 9);
    expect(parseFloat(r.platformFee)).toBeCloseTo(0.30, 9);
    expect(parseFloat(r.prizePool)).toBeCloseTo(2.00, 9);
  });

  it('10 TON stake → 17.00 payout, 3.00 fee', () => {
    const r = SettlementService.calculateWinPayout('10');
    expect(parseFloat(r.winnerPayout)).toBeCloseTo(17.00, 9);
    expect(parseFloat(r.platformFee)).toBeCloseTo(3.00, 9);
  });

  it('payout + fee = prizePool for all common stakes', () => {
    for (const stake of ['0.1', '0.5', '1', '2', '5', '10', '50']) {
      const r = SettlementService.calculateWinPayout(stake);
      const sum = parseFloat(r.winnerPayout) + parseFloat(r.platformFee);
      expect(sum).toBeCloseTo(parseFloat(r.prizePool), 6);
    }
  });
});

// ─── settleWin ────────────────────────────────────────────────────────────────

describe('settleWin', () => {
  it('throws if winner or loser not found in DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1'),
    ).rejects.toThrow('player not found');
  });

  it('returns early with zero deltas if game already settled (rowCount=0)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }],
    });
    setupSuccessfulTransaction(0);

    const result = await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1');

    expect(result.eloChanges.winner.delta).toBe(0);
    expect(result.eloChanges.loser.delta).toBe(0);
    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).not.toContain('COMMIT');
    expect(calls).toContain('ROLLBACK');
  });

  it('applies correct ELO changes for equal-rated players', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }] })
      .mockResolvedValueOnce({ rows: [] }); // tournament_matches lookup
    setupSuccessfulTransaction(1);

    const result = await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1');

    expect(result.eloChanges.winner.delta).toBe(20);
    expect(result.eloChanges.loser.delta).toBe(-20);
    expect(result.eloChanges.winner.after).toBe(1220);
    expect(result.eloChanges.loser.after).toBe(1180);
  });

  it('skips balance operations for tournament games (stake=0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }] })
      .mockResolvedValueOnce({ rows: [] }); // tournament_matches
    setupSuccessfulTransaction(1);

    await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '0');

    const balanceQueries = mockClient.query.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((q: string) => q.includes('balances'));
    expect(balanceQueries).toHaveLength(0);
  });

  it('does touch balances for real-money games (stake>0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }] })
      .mockResolvedValueOnce({ rows: [] });
    setupSuccessfulTransaction(1);

    await SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1');

    const balanceQueries = mockClient.query.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((q: string) => q.includes('balances'));
    expect(balanceQueries.length).toBeGreaterThan(0);
  });

  it('releases DB client even when an error is thrown mid-transaction', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: WINNER_ID, elo: 1200 }, { id: LOSER_ID, elo: 1200 }] });
    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (sql === 'ROLLBACK') return Promise.resolve();
      return Promise.reject(new Error('DB error'));
    });

    await expect(
      SettlementService.settleWin(GAME_ID, WINNER_ID, LOSER_ID, 'no_pieces', '1'),
    ).rejects.toThrow('DB error');

    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});

// ─── settleDraw ───────────────────────────────────────────────────────────────

describe('settleDraw', () => {
  const P1 = WINNER_ID;
  const P2 = LOSER_ID;

  it('returns early if game already settled (rowCount=0)', async () => {
    setupSuccessfulTransaction(0);
    const result = await SettlementService.settleDraw(GAME_ID, P1, P2, '1');
    expect(result.stake).toBe('1');
    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).not.toContain('COMMIT');
  });

  it('unlocks stakes for both players on draw', async () => {
    setupSuccessfulTransaction(1);
    await SettlementService.settleDraw(GAME_ID, P1, P2, '2');

    const balanceQueries = mockClient.query.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((q: string) => q.includes('balances'));
    expect(balanceQueries.length).toBeGreaterThan(0);
    expect(balanceQueries.some(q => q.includes('locked') && q.includes('available'))).toBe(true);
  });

  it('releases DB client on error', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (sql === 'ROLLBACK') return Promise.resolve();
      return Promise.reject(new Error('DB error'));
    });

    await expect(
      SettlementService.settleDraw(GAME_ID, P1, P2, '1'),
    ).rejects.toThrow('DB error');

    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});
