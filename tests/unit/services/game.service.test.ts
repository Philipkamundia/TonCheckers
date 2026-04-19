/**
 * tests/unit/services/game.service.test.ts
 *
 * GameService — createGame, activateGame, getGame, updateBoardState, recoverCrashedGames.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameService } from '../../../apps/backend/src/services/game.service.js';
import { initialGameState } from '../../../apps/backend/src/engine/board.js';

const { mockQuery, mockConnect, mockClient } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  return { mockQuery: vi.fn(), mockConnect: vi.fn(), mockClient };
});

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockQuery, connect: mockConnect },
}));

vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));

const P1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const P2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const G_ID = 'cccccccc-0000-0000-0000-000000000003';

beforeEach(() => {
  vi.resetAllMocks();
  mockConnect.mockResolvedValue(mockClient);
  mockClient.release.mockReturnValue(undefined);
});

describe('GameService.createGame', () => {
  it('inserts game and returns record', async () => {
    const gameRow = {
      id: G_ID, mode: 'pvp', status: 'active',
      player1Id: P1, player2Id: P2, stake: '1.0',
      boardState: null, activePlayer: 1,
      player1EloBefore: 1200, player2EloBefore: 1200,
      createdAt: new Date().toISOString(),
    };
    mockQuery.mockResolvedValue({ rows: [gameRow] });
    const game = await GameService.createGame(P1, P2, '1.0', 1200, 1200, initialGameState());
    expect(game.id).toBe(G_ID);
    expect(game.player1Id).toBe(P1);
    expect(game.stake).toBe('1.0');
  });

  it('creates game with waiting status', async () => {
    const gameRow = { id: G_ID, mode: 'pvp', status: 'waiting', player1Id: P1, player2Id: P2, stake: '1.0', boardState: null, activePlayer: 1, player1EloBefore: 1200, player2EloBefore: 1200, createdAt: new Date().toISOString() };
    mockQuery.mockResolvedValue({ rows: [gameRow] });
    const game = await GameService.createGame(P1, P2, '1.0', 1200, 1200, initialGameState(), undefined, 'waiting');
    expect(game.status).toBe('waiting');
  });
});

describe('GameService.activateGame', () => {
  it('updates game status to active', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    await GameService.activateGame(G_ID);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status='active'"),
      [G_ID],
    );
  });
});

describe('GameService.getGame', () => {
  it('returns game record when found', async () => {
    const gameRow = { id: G_ID, mode: 'pvp', status: 'active', player1Id: P1, player2Id: P2, stake: '1.0', boardState: null, activePlayer: 1, player1EloBefore: 1200, player2EloBefore: 1200, createdAt: new Date().toISOString() };
    mockQuery.mockResolvedValue({ rows: [gameRow] });
    const game = await GameService.getGame(G_ID);
    expect(game?.id).toBe(G_ID);
  });

  it('returns null when game not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await GameService.getGame('nonexistent')).toBeNull();
  });
});

describe('GameService.updateBoardState', () => {
  it('updates board state with correct params', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    const state = initialGameState();
    await GameService.updateBoardState(G_ID, state, 2, 5);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('board_state'),
      [state, 2, 5, G_ID],
    );
  });
});

describe('GameService.recoverCrashedGames', () => {
  it('returns empty array when no crashed games', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const recovered = await GameService.recoverCrashedGames();
    expect(recovered).toEqual([]);
  });

  it('recovers active game: marks crashed, refunds stakes, logs crash', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: G_ID, player1_id: P1, player2_id: P2, stake: '1.0', status: 'active' }],
    });
    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      return Promise.resolve({ rowCount: 1 });
    });

    const recovered = await GameService.recoverCrashedGames();
    expect(recovered).toContain(G_ID);
    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some(s => s.includes("status='crashed'"))).toBe(true);
    expect(calls.some(s => s.includes('crash_log'))).toBe(true);
    expect(calls.some(s => s.includes('available=available+'))).toBe(true);
  });

  it('cancels waiting game (lobby countdown) without crash log', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: G_ID, player1_id: P1, player2_id: P2, stake: '1.0', status: 'waiting' }],
    });
    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      return Promise.resolve({ rowCount: 1 });
    });

    const recovered = await GameService.recoverCrashedGames();
    expect(recovered).toContain(G_ID);
    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some(s => s.includes("status='cancelled'"))).toBe(true);
    expect(calls.some(s => s.includes('crash_log'))).toBe(false);
  });

  it('skips balance refund for zero-stake games', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: G_ID, player1_id: P1, player2_id: P2, stake: '0', status: 'active' }],
    });
    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      return Promise.resolve({ rowCount: 1 });
    });

    await GameService.recoverCrashedGames();
    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some(s => s.includes('available=available+'))).toBe(false);
  });

  it('continues recovering other games if one fails', async () => {
    const G2 = 'dddddddd-0000-0000-0000-000000000004';
    mockQuery.mockResolvedValue({
      rows: [
        { id: G_ID, player1_id: P1, player2_id: P2, stake: '1.0', status: 'active' },
        { id: G2,   player1_id: P1, player2_id: P2, stake: '1.0', status: 'active' },
      ],
    });
    let callCount = 0;
    mockClient.query.mockImplementation((sql: string) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].some(k => sql.includes(k))) return Promise.resolve({});
      callCount++;
      if (callCount === 1) throw new Error('DB error on first game');
      return Promise.resolve({ rowCount: 1 });
    });

    const recovered = await GameService.recoverCrashedGames();
    // Second game should still be recovered
    expect(recovered).toContain(G2);
  });
});
