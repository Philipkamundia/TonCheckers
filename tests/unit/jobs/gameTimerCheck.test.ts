/**
 * tests/unit/jobs/gameTimerCheck.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGameTimerService, mockGameService, mockSettlementService, mockPool, mockGameRoomManager, mockLogger } = vi.hoisted(() => ({
  mockGameTimerService: {
    getExpiredGames: vi.fn(),
    clearTimer: vi.fn(),
  },
  mockGameService: {
    getGame: vi.fn(),
  },
  mockSettlementService: {
    settleWin: vi.fn(),
  },
  mockPool: {
    query: vi.fn(),
  },
  mockGameRoomManager: {
    remove: vi.fn(),
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/services/game-timer.service.js', () => ({
  GameTimerService: mockGameTimerService,
}));

vi.mock('../../../apps/backend/src/services/game.service.js', () => ({
  GameService: mockGameService,
}));

vi.mock('../../../apps/backend/src/services/settlement.service.js', () => ({
  SettlementService: mockSettlementService,
}));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: mockPool,
}));

vi.mock('../../../apps/backend/src/websocket/rooms/gameRoom.js', () => ({
  GameRoomManager: mockGameRoomManager,
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { startTimerCheckJob } from '../../../apps/backend/src/jobs/gameTimerCheck.js';

function makeMockIo() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  return { to, emit, _emit: emit };
}

let handle: ReturnType<typeof setInterval>;
let mockIo: ReturnType<typeof makeMockIo>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockIo = makeMockIo();
});

afterEach(() => {
  if (handle) clearInterval(handle);
  vi.useRealTimers();
});

const aiGame = {
  id: 'game-ai',
  mode: 'ai' as const,
  status: 'active' as const,
  player1Id: 'user-1',
  player2Id: null,
  stake: '0',
  boardState: { board: [[0]], activePlayer: 1 },
  activePlayer: 1 as const,
  player1EloBefore: 1200,
  player2EloBefore: null,
  createdAt: '2025-01-01',
};

const pvpGame = {
  id: 'game-pvp',
  mode: 'pvp' as const,
  status: 'active' as const,
  player1Id: 'user-1',
  player2Id: 'user-2',
  stake: '1.0',
  boardState: { board: [[0]], activePlayer: 1 },
  activePlayer: 1 as const,
  player1EloBefore: 1200,
  player2EloBefore: 1100,
  createdAt: '2025-01-01',
};

describe('startTimerCheckJob — AI game timeout', () => {
  it('updates DB, emits ai.end to game room and user room, removes from GameRoomManager', async () => {
    mockGameTimerService.getExpiredGames.mockResolvedValue([
      { gameId: 'game-ai', timedOutPlayer: 1 },
    ]);
    mockGameService.getGame.mockResolvedValue(aiGame);
    mockGameTimerService.clearTimer.mockResolvedValue(undefined);
    mockPool.query.mockResolvedValue({ rows: [] });

    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE games SET status='completed'"),
      ['game-ai'],
    );

    // Emits to game room
    expect(mockIo.to).toHaveBeenCalledWith('game:game-ai');
    expect(mockIo._emit).toHaveBeenCalledWith('ai.end', expect.objectContaining({
      gameId: 'game-ai',
      result: 'win',
      winner: 2, // player1 timed out → AI (player2) wins
      reason: 'timeout',
    }));

    // Emits to user room
    expect(mockIo.to).toHaveBeenCalledWith('user:user-1');
    expect(mockIo._emit).toHaveBeenCalledWith('ai.end', expect.objectContaining({
      gameId: 'game-ai',
      result: 'win',
      winner: 2,
      reason: 'timeout',
    }));

    expect(mockGameRoomManager.remove).toHaveBeenCalledWith('game-ai');
  });

  it('emits correct winner when player2 times out in AI game', async () => {
    mockGameTimerService.getExpiredGames.mockResolvedValue([
      { gameId: 'game-ai', timedOutPlayer: 2 },
    ]);
    mockGameService.getGame.mockResolvedValue(aiGame);
    mockGameTimerService.clearTimer.mockResolvedValue(undefined);
    mockPool.query.mockResolvedValue({ rows: [] });

    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockIo._emit).toHaveBeenCalledWith('ai.end', expect.objectContaining({
      winner: 1, // player2 timed out → player1 wins
    }));
  });
});

describe('startTimerCheckJob — PvP game timeout', () => {
  it('calls settleWin and emits game.end with payout data', async () => {
    mockGameTimerService.getExpiredGames.mockResolvedValue([
      { gameId: 'game-pvp', timedOutPlayer: 1 },
    ]);
    mockGameService.getGame.mockResolvedValue(pvpGame);
    mockGameTimerService.clearTimer.mockResolvedValue(undefined);
    mockSettlementService.settleWin.mockResolvedValue({
      gameId: 'game-pvp',
      winnerId: 'user-2',
      loserId: 'user-1',
      stake: '1.0',
      prizePool: '2.0',
      platformFee: '0.3',
      winnerPayout: '1.7',
      alreadySettled: false,
      eloChanges: {
        winner: { before: 1100, after: 1116, delta: 16 },
        loser: { before: 1200, after: 1184, delta: -16 },
      },
    });

    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockSettlementService.settleWin).toHaveBeenCalledWith(
      'game-pvp', 'user-2', 'user-1', 'timeout', '1.0', mockIo,
    );

    expect(mockIo._emit).toHaveBeenCalledWith('game.end', expect.objectContaining({
      gameId: 'game-pvp',
      result: 'win',
      winner: 2,
      reason: 'timeout',
      timedOutPlayer: 1,
      winnerId: 'user-2',
      loserId: 'user-1',
      winnerPayout: '1.7',
      platformFee: '0.3',
      prizePool: '2.0',
    }));

    expect(mockGameRoomManager.remove).toHaveBeenCalledWith('game-pvp');
  });

  it('emits game.end to both user rooms as fallback', async () => {
    mockGameTimerService.getExpiredGames.mockResolvedValue([
      { gameId: 'game-pvp', timedOutPlayer: 1 },
    ]);
    mockGameService.getGame.mockResolvedValue(pvpGame);
    mockGameTimerService.clearTimer.mockResolvedValue(undefined);
    mockSettlementService.settleWin.mockResolvedValue({
      gameId: 'game-pvp', winnerId: 'user-2', loserId: 'user-1',
      stake: '1.0', prizePool: '2.0', platformFee: '0.3', winnerPayout: '1.7',
      alreadySettled: false,
      eloChanges: { winner: { before: 1100, after: 1116, delta: 16 }, loser: { before: 1200, after: 1184, delta: -16 } },
    });

    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockIo.to).toHaveBeenCalledWith('user:user-1');
    expect(mockIo.to).toHaveBeenCalledWith('user:user-2');
  });
});

describe('startTimerCheckJob — already settled game', () => {
  it('skips when alreadySettled=true', async () => {
    mockGameTimerService.getExpiredGames.mockResolvedValue([
      { gameId: 'game-pvp', timedOutPlayer: 1 },
    ]);
    mockGameService.getGame.mockResolvedValue(pvpGame);
    mockGameTimerService.clearTimer.mockResolvedValue(undefined);
    mockSettlementService.settleWin.mockResolvedValue({
      gameId: 'game-pvp', winnerId: 'user-2', loserId: 'user-1',
      stake: '1.0', prizePool: '2.0', platformFee: '0.3', winnerPayout: '1.7',
      alreadySettled: true,
      eloChanges: { winner: { before: 1100, after: 1100, delta: 0 }, loser: { before: 1200, after: 1200, delta: 0 } },
    });

    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(1_000);

    // game.end should NOT be emitted
    const emitCalls = mockIo._emit.mock.calls;
    const gameEndCalls = emitCalls.filter(([event]: [string]) => event === 'game.end');
    expect(gameEndCalls).toHaveLength(0);

    expect(mockGameRoomManager.remove).toHaveBeenCalledWith('game-pvp');
  });
});

describe('startTimerCheckJob — game not found or not active', () => {
  it('clears timer and skips when game not found', async () => {
    mockGameTimerService.getExpiredGames.mockResolvedValue([
      { gameId: 'game-missing', timedOutPlayer: 1 },
    ]);
    mockGameService.getGame.mockResolvedValue(null);
    mockGameTimerService.clearTimer.mockResolvedValue(undefined);

    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockGameTimerService.clearTimer).toHaveBeenCalledWith('game-missing');
    expect(mockSettlementService.settleWin).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('clears timer and skips when game is not active', async () => {
    mockGameTimerService.getExpiredGames.mockResolvedValue([
      { gameId: 'game-done', timedOutPlayer: 1 },
    ]);
    mockGameService.getGame.mockResolvedValue({ ...pvpGame, status: 'completed' });
    mockGameTimerService.clearTimer.mockResolvedValue(undefined);

    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockGameTimerService.clearTimer).toHaveBeenCalledWith('game-done');
    expect(mockSettlementService.settleWin).not.toHaveBeenCalled();
  });
});

describe('startTimerCheckJob — error handling', () => {
  it('logs outer error when getExpiredGames throws', async () => {
    mockGameTimerService.getExpiredGames.mockRejectedValue(new Error('Redis error'));

    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockLogger.error).toHaveBeenCalledWith('Timer job: Redis error');
  });

  it('does not crash on outer error', async () => {
    mockGameTimerService.getExpiredGames.mockRejectedValue(new Error('fail'));
    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);
    await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
  });

  it('fires on 1s interval', async () => {
    mockGameTimerService.getExpiredGames.mockResolvedValue([]);
    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockGameTimerService.getExpiredGames).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockGameTimerService.getExpiredGames).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no expired games', async () => {
    mockGameTimerService.getExpiredGames.mockResolvedValue([]);
    handle = startTimerCheckJob(mockIo as unknown as import('socket.io').Server);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockGameService.getGame).not.toHaveBeenCalled();
    expect(mockSettlementService.settleWin).not.toHaveBeenCalled();
  });
});
