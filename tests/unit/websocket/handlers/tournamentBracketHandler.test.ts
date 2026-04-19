/**
 * tests/unit/websocket/handlers/tournamentBracketHandler.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger, mockPlayerJoined } = vi.hoisted(() => {
  const mockPlayerJoined = vi.fn();
  const mockLogger = {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  };
  return { mockLogger, mockPlayerJoined };
});

vi.mock('../../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('../../../../apps/backend/src/services/tournament-bracket.service.js', () => ({
  TournamentBracketService: {
    playerJoined: mockPlayerJoined,
  },
}));

import { registerTournamentBracketHandlers } from '../../../../apps/backend/src/websocket/handlers/tournamentBracketHandler.js';

function makeSocket(userId = 'user-1') {
  return {
    id:     'socket-1',
    userId,
    join:   vi.fn(),
    leave:  vi.fn(),
    on:     vi.fn(),
    emit:   vi.fn(),
  } as any;
}

function getHandler(socket: ReturnType<typeof makeSocket>, event: string) {
  const call = socket.on.mock.calls.find(([e]: [string]) => e === event);
  if (!call) throw new Error(`Handler for '${event}' not registered`);
  return call[1] as (...args: any[]) => Promise<void>;
}

beforeEach(() => vi.clearAllMocks());

describe('registerTournamentBracketHandlers', () => {
  it('registers tournament.bracket_join event handler', () => {
    const socket = makeSocket();
    registerTournamentBracketHandlers(socket);
    expect(socket.on).toHaveBeenCalledWith('tournament.bracket_join', expect.any(Function));
  });

  it('emits tournament.bracket_joined and logs info when playerJoined returns true', async () => {
    mockPlayerJoined.mockResolvedValue(true);
    const socket = makeSocket('user-5');
    registerTournamentBracketHandlers(socket);

    const handler = getHandler(socket, 'tournament.bracket_join');
    await handler({ tournamentId: 'tourney-1' });

    expect(mockPlayerJoined).toHaveBeenCalledWith('tourney-1', 'user-5');
    expect(socket.emit).toHaveBeenCalledWith('tournament.bracket_joined', { tournamentId: 'tourney-1' });
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Bracket presence: tournament=tourney-1 user=user-5',
    );
  });

  it('emits tournament.bracket_expired when playerJoined returns false (window closed)', async () => {
    mockPlayerJoined.mockResolvedValue(false);
    const socket = makeSocket('user-5');
    registerTournamentBracketHandlers(socket);

    const handler = getHandler(socket, 'tournament.bracket_join');
    await handler({ tournamentId: 'tourney-2' });

    expect(socket.emit).toHaveBeenCalledWith('tournament.bracket_expired', { tournamentId: 'tourney-2' });
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('logs error and does not crash on service error', async () => {
    mockPlayerJoined.mockRejectedValue(new Error('DB failure'));
    const socket = makeSocket('user-5');
    registerTournamentBracketHandlers(socket);

    const handler = getHandler(socket, 'tournament.bracket_join');
    await expect(handler({ tournamentId: 'tourney-3' })).resolves.not.toThrow();

    expect(mockLogger.error).toHaveBeenCalledWith('tournament.bracket_join: DB failure');
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does not emit bracket_joined when window is closed', async () => {
    mockPlayerJoined.mockResolvedValue(false);
    const socket = makeSocket();
    registerTournamentBracketHandlers(socket);

    const handler = getHandler(socket, 'tournament.bracket_join');
    await handler({ tournamentId: 'tourney-4' });

    expect(socket.emit).not.toHaveBeenCalledWith('tournament.bracket_joined', expect.anything());
  });
});
