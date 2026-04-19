/**
 * tests/unit/jobs/tournamentStartCheck.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPool, mockTournamentService, mockNotificationService, mockLogger } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockTournamentService: {
    startTournament: vi.fn(),
    recoverStuckRound: vi.fn(),
  },
  mockNotificationService: {
    send: vi.fn(),
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: mockPool,
}));

vi.mock('../../../apps/backend/src/services/tournament.service.js', () => ({
  TournamentService: mockTournamentService,
}));

vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: mockNotificationService,
}));

vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { startTournamentStartCheck } from '../../../apps/backend/src/jobs/tournamentStartCheck.js';

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

describe('startTournamentStartCheck — checkDue', () => {
  it('starts due tournaments', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 't1' }, { id: 't2' }] }) // checkDue
      .mockResolvedValueOnce({ rows: [] }) // checkStuckRounds
      .mockResolvedValueOnce({ rows: [] }); // notifyUpcoming
    mockTournamentService.startTournament.mockResolvedValue(undefined);

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockTournamentService.startTournament).toHaveBeenCalledWith('t1', mockIo);
    expect(mockTournamentService.startTournament).toHaveBeenCalledWith('t2', mockIo);
  });

  it('handles error per tournament without stopping others', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 't1' }, { id: 't2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockTournamentService.startTournament
      .mockRejectedValueOnce(new Error('start failed'))
      .mockResolvedValueOnce(undefined);

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockLogger.error).toHaveBeenCalledWith('Start failed: t1: start failed');
    expect(mockTournamentService.startTournament).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no due tournaments', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockTournamentService.startTournament).not.toHaveBeenCalled();
  });
});

describe('startTournamentStartCheck — checkStuckRounds', () => {
  it('recovers stuck rounds', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // checkDue
      .mockResolvedValueOnce({ rows: [{ id: 't1', currentRound: 2 }] }) // checkStuckRounds
      .mockResolvedValueOnce({ rows: [] }); // notifyUpcoming
    mockTournamentService.recoverStuckRound.mockResolvedValue(undefined);

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Tournament recovery: stuck at round 2 for tournament=t1 — re-running checkRoundComplete',
    );
    expect(mockTournamentService.recoverStuckRound).toHaveBeenCalledWith('t1', 2, mockIo);
  });

  it('handles error per stuck tournament', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 't1', currentRound: 1 }, { id: 't2', currentRound: 3 }] })
      .mockResolvedValueOnce({ rows: [] });
    mockTournamentService.recoverStuckRound
      .mockRejectedValueOnce(new Error('recovery failed'))
      .mockResolvedValueOnce(undefined);

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Tournament round recovery failed: t1: recovery failed',
    );
    expect(mockTournamentService.recoverStuckRound).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no stuck rounds', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockTournamentService.recoverStuckRound).not.toHaveBeenCalled();
  });
});

describe('startTournamentStartCheck — notifyUpcoming', () => {
  it('sends notifications and emits socket event for each participant', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // checkDue
      .mockResolvedValueOnce({ rows: [] }) // checkStuckRounds
      .mockResolvedValueOnce({ rows: [{ id: 't1', name: 'Grand Prix', uids: ['u1', 'u2'] }] }); // notifyUpcoming
    mockNotificationService.send.mockResolvedValue(undefined);

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockNotificationService.send).toHaveBeenCalledWith('u1', 'tournament_starting', { name: 'Grand Prix' });
    expect(mockNotificationService.send).toHaveBeenCalledWith('u2', 'tournament_starting', { name: 'Grand Prix' });

    expect(mockIo.to).toHaveBeenCalledWith('user:u1');
    expect(mockIo.to).toHaveBeenCalledWith('user:u2');
    expect(mockIo._emit).toHaveBeenCalledWith('tournament.starting_soon', {
      tournamentId: 't1',
      name: 'Grand Prix',
      minutesUntil: 30,
    });
  });

  it('does nothing when no upcoming tournaments', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('handles multiple tournaments with multiple participants', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { id: 't1', name: 'Cup A', uids: ['u1', 'u2'] },
        { id: 't2', name: 'Cup B', uids: ['u3'] },
      ]});
    mockNotificationService.send.mockResolvedValue(undefined);

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockNotificationService.send).toHaveBeenCalledTimes(3);
  });
});

describe('startTournamentStartCheck — outer error handling', () => {
  it('logs outer error when pool.query throws', async () => {
    mockPool.query.mockRejectedValue(new Error('DB connection lost'));

    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Tournament check error: DB connection lost',
    );
  });

  it('does not crash on outer error', async () => {
    mockPool.query.mockRejectedValue(new Error('fail'));
    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    await expect(vi.advanceTimersByTimeAsync(30_000)).resolves.not.toThrow();
  });

  it('fires on 30s interval', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockPool.query).toHaveBeenCalledTimes(3); // checkDue + checkStuckRounds + notifyUpcoming

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockPool.query).toHaveBeenCalledTimes(6);
  });

  it('logs info on start', () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    handle = startTournamentStartCheck(mockIo as unknown as import('socket.io').Server);
    expect(mockLogger.info).toHaveBeenCalledWith('Tournament start check: every 30s');
  });
});
