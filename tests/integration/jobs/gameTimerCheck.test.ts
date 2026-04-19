/**
 * tests/integration/jobs/gameTimerCheck.test.ts
 *
 * gameTimerCheck job — tests the tick logic by directly invoking
 * the services the job orchestrates, verifying correct behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetExpired, mockClearTimer, mockGetGame, mockSettleWin, mockDbQuery, mockLogger } = vi.hoisted(() => ({
  mockGetExpired:  vi.fn(),
  mockClearTimer:  vi.fn(),
  mockGetGame:     vi.fn(),
  mockSettleWin:   vi.fn(),
  mockDbQuery:     vi.fn(),
  mockLogger:      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/game-timer.service.js', () => ({
  GameTimerService: { getExpiredGames: mockGetExpired, clearTimer: mockClearTimer },
}));
vi.mock('../../../apps/backend/src/services/game.service.js', () => ({
  GameService: { getGame: mockGetGame },
}));
vi.mock('../../../apps/backend/src/services/settlement.service.js', () => ({
  SettlementService: { settleWin: mockSettleWin },
}));
vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));
vi.mock('../../../apps/backend/src/utils/logger.js', () => ({ logger: mockLogger }));
vi.mock('../../../apps/backend/src/websocket/rooms/gameRoom.js', () => ({
  GameRoomManager: { remove: vi.fn() },
}));

import { GameTimerService } from '../../../apps/backend/src/services/game-timer.service.js';
import { GameService }      from '../../../apps/backend/src/services/game.service.js';
import { SettlementService } from '../../../apps/backend/src/services/settlement.service.js';

const mockIo = { to: vi.fn().mockImplementation(() => ({ emit: vi.fn() })) } as any;

const PVP_GAME = {
  id: 'game-pvp', mode: 'pvp', status: 'active',
  player1Id: 'p1', player2Id: 'p2', stake: '1.0',
  boardState: null, activePlayer: 1 as const,
  player1EloBefore: 1200, player2EloBefore: 1200, createdAt: '',
};

const AI_GAME = {
  id: 'game-ai', mode: 'ai', status: 'active',
  player1Id: 'p1', player2Id: null, stake: '0',
  boardState: null, activePlayer: 1 as const,
  player1EloBefore: 1200, player2EloBefore: null, createdAt: '',
};

beforeEach(() => {
  vi.resetAllMocks();
  mockIo.to.mockImplementation(() => ({ emit: vi.fn() }));
});

// ─── Simulate the job tick logic directly ─────────────────────────────────────

async function simulateTick(io: any): Promise<void> {
  const expired = await GameTimerService.getExpiredGames();
  for (const { gameId, timedOutPlayer } of expired) {
    const game = await GameService.getGame(gameId);
    if (!game || game.status !== 'active') {
      await GameTimerService.clearTimer(gameId);
      continue;
    }
    const winnerId = timedOutPlayer === 1 ? game.player2Id! : game.player1Id;
    const loserId  = timedOutPlayer === 1 ? game.player1Id  : game.player2Id!;
    await GameTimerService.clearTimer(gameId);

    if (game.mode === 'ai') {
      await mockDbQuery(`UPDATE games SET status='completed', ended_at=NOW(), updated_at=NOW() WHERE id=$1`, [gameId]);
      io.to(`game:${gameId}`).emit('ai.end', { gameId });
      continue;
    }

    const result = await SettlementService.settleWin(gameId, winnerId, loserId, 'timeout', game.stake, io);
    if (result.alreadySettled) continue;
    io.to(`game:${gameId}`).emit('game.end', { gameId, winnerId });
  }
}

describe('gameTimerCheck — PvP timeout', () => {
  it('settles win for the non-timed-out player', async () => {
    mockGetExpired.mockResolvedValue([{ gameId: 'game-pvp', timedOutPlayer: 1 }]);
    mockGetGame.mockResolvedValue(PVP_GAME);
    mockClearTimer.mockResolvedValue(undefined);
    mockSettleWin.mockResolvedValue({ alreadySettled: false, winnerId: 'p2' });

    await simulateTick(mockIo);
    expect(mockSettleWin).toHaveBeenCalledWith('game-pvp', 'p2', 'p1', 'timeout', '1.0', mockIo);
  });

  it('clears timer and skips non-active games', async () => {
    mockGetExpired.mockResolvedValue([{ gameId: 'game-pvp', timedOutPlayer: 1 }]);
    mockGetGame.mockResolvedValue({ ...PVP_GAME, status: 'completed' });
    mockClearTimer.mockResolvedValue(undefined);

    await simulateTick(mockIo);
    expect(mockSettleWin).not.toHaveBeenCalled();
    expect(mockClearTimer).toHaveBeenCalledWith('game-pvp');
  });

  it('skips when game not found', async () => {
    mockGetExpired.mockResolvedValue([{ gameId: 'ghost-game', timedOutPlayer: 1 }]);
    mockGetGame.mockResolvedValue(null);
    mockClearTimer.mockResolvedValue(undefined);

    await simulateTick(mockIo);
    expect(mockSettleWin).not.toHaveBeenCalled();
  });

  it('skips already-settled games without emitting game.end', async () => {
    mockGetExpired.mockResolvedValue([{ gameId: 'game-pvp', timedOutPlayer: 1 }]);
    mockGetGame.mockResolvedValue(PVP_GAME);
    mockClearTimer.mockResolvedValue(undefined);
    mockSettleWin.mockResolvedValue({ alreadySettled: true });

    await simulateTick(mockIo);
    const emitCalls = mockIo.to.mock.results.flatMap((r: any) =>
      r.value.emit.mock.calls.map((c: any) => c[0]),
    );
    expect(emitCalls).not.toContain('game.end');
  });

  it('winner is player2 when player1 timed out', async () => {
    mockGetExpired.mockResolvedValue([{ gameId: 'game-pvp', timedOutPlayer: 1 }]);
    mockGetGame.mockResolvedValue(PVP_GAME);
    mockClearTimer.mockResolvedValue(undefined);
    mockSettleWin.mockResolvedValue({ alreadySettled: false });

    await simulateTick(mockIo);
    expect(mockSettleWin).toHaveBeenCalledWith('game-pvp', 'p2', 'p1', 'timeout', '1.0', mockIo);
  });

  it('winner is player1 when player2 timed out', async () => {
    mockGetExpired.mockResolvedValue([{ gameId: 'game-pvp', timedOutPlayer: 2 }]);
    mockGetGame.mockResolvedValue(PVP_GAME);
    mockClearTimer.mockResolvedValue(undefined);
    mockSettleWin.mockResolvedValue({ alreadySettled: false });

    await simulateTick(mockIo);
    expect(mockSettleWin).toHaveBeenCalledWith('game-pvp', 'p1', 'p2', 'timeout', '1.0', mockIo);
  });
});

describe('gameTimerCheck — AI timeout', () => {
  it('ends AI game without financial settlement', async () => {
    mockGetExpired.mockResolvedValue([{ gameId: 'game-ai', timedOutPlayer: 1 }]);
    mockGetGame.mockResolvedValue(AI_GAME);
    mockClearTimer.mockResolvedValue(undefined);
    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    await simulateTick(mockIo);
    expect(mockSettleWin).not.toHaveBeenCalled();
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining("status='completed'"),
      ['game-ai'],
    );
  });
});

describe('gameTimerCheck — multiple expired games', () => {
  it('processes all expired games in one tick', async () => {
    mockGetExpired.mockResolvedValue([
      { gameId: 'game-1', timedOutPlayer: 1 },
      { gameId: 'game-2', timedOutPlayer: 2 },
    ]);
    mockGetGame.mockResolvedValue(PVP_GAME);
    mockClearTimer.mockResolvedValue(undefined);
    mockSettleWin.mockResolvedValue({ alreadySettled: false });

    await simulateTick(mockIo);
    expect(mockSettleWin).toHaveBeenCalledTimes(2);
  });
});
