/**
 * tests/unit/websocket/gameRoom.test.ts
 *
 * GameRoomManager — pure in-memory data structure, no mocks needed.
 * Full coverage of all 8 methods.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameRoomManager, type GameRoom } from '../../../apps/backend/src/websocket/rooms/gameRoom.js';

// Clear internal maps between tests by removing all rooms used across all describe blocks
function clearAll() {
  const ids = [
    'game-create',
    'game-create-2',
    'game-create-3',
    'game-getBySocket',
    'game-playerNum',
    'game-updateSocket',
    'game-updateSocket-2',
    'game-remove',
    'game-remove-2',
    'game-remove-3',
    'game-removeSocket',
    'game-getSockets',
    'game-getSockets-2',
    'game-getSockets-3',
  ];
  for (const id of ids) GameRoomManager.remove(id);
}

function makeRoom(overrides: Partial<GameRoom> = {}): GameRoom {
  return {
    gameId:          'game-create',
    player1Id:       'player-1',
    player2Id:       'player-2',
    player1SocketId: 'socket-1',
    player2SocketId: 'socket-2',
    stake:           '1.0',
    ...overrides,
  };
}

beforeEach(() => clearAll());

// ─── create / get ─────────────────────────────────────────────────────────────

describe('GameRoomManager.create / get', () => {
  it('creates a room and retrieves it by gameId', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-create' }));
    const room = GameRoomManager.get('game-create');
    expect(room).toBeDefined();
    expect(room?.player1Id).toBe('player-1');
    expect(room?.player2Id).toBe('player-2');
    expect(room?.stake).toBe('1.0');
  });

  it('returns undefined for unknown gameId', () => {
    expect(GameRoomManager.get('nonexistent')).toBeUndefined();
  });

  it('creates room with null socket IDs', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-create-2', player1SocketId: null, player2SocketId: null }));
    const room = GameRoomManager.get('game-create-2');
    expect(room?.player1SocketId).toBeNull();
    expect(room?.player2SocketId).toBeNull();
  });
});

// ─── getBySocketId ────────────────────────────────────────────────────────────

describe('GameRoomManager.getBySocketId', () => {
  it('returns room for player1 socket', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-getBySocket' }));
    const room = GameRoomManager.getBySocketId('socket-1');
    expect(room?.gameId).toBe('game-getBySocket');
  });

  it('returns room for player2 socket', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-getBySocket' }));
    const room = GameRoomManager.getBySocketId('socket-2');
    expect(room?.gameId).toBe('game-getBySocket');
  });

  it('returns undefined for unknown socket', () => {
    expect(GameRoomManager.getBySocketId('unknown-socket')).toBeUndefined();
  });
});

// ─── getPlayerNumber ──────────────────────────────────────────────────────────

describe('GameRoomManager.getPlayerNumber', () => {
  it('returns 1 for player1 socket', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-playerNum' }));
    expect(GameRoomManager.getPlayerNumber('game-playerNum', 'socket-1')).toBe(1);
  });

  it('returns 2 for player2 socket', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-playerNum' }));
    expect(GameRoomManager.getPlayerNumber('game-playerNum', 'socket-2')).toBe(2);
  });

  it('returns null for unknown socket in known room', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-playerNum' }));
    expect(GameRoomManager.getPlayerNumber('game-playerNum', 'unknown')).toBeNull();
  });

  it('returns null for unknown gameId', () => {
    expect(GameRoomManager.getPlayerNumber('nonexistent', 'socket-1')).toBeNull();
  });
});

// ─── updateSocket ─────────────────────────────────────────────────────────────

describe('GameRoomManager.updateSocket', () => {
  it('updates player1 socket on reconnect', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-updateSocket' }));
    GameRoomManager.updateSocket('game-updateSocket', 'player-1', 'socket-1-new');
    const room = GameRoomManager.get('game-updateSocket');
    expect(room?.player1SocketId).toBe('socket-1-new');
    // Old socket should no longer map to this game
    expect(GameRoomManager.getBySocketId('socket-1')).toBeUndefined();
    // New socket should map
    expect(GameRoomManager.getBySocketId('socket-1-new')?.gameId).toBe('game-updateSocket');
  });

  it('updates player2 socket on reconnect', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-updateSocket' }));
    GameRoomManager.updateSocket('game-updateSocket', 'player-2', 'socket-2-new');
    const room = GameRoomManager.get('game-updateSocket');
    expect(room?.player2SocketId).toBe('socket-2-new');
  });

  it('does nothing for unknown gameId', () => {
    // Should not throw
    expect(() => GameRoomManager.updateSocket('nonexistent', 'player-1', 'socket-x')).not.toThrow();
  });

  it('handles player1 with null socket (first connect)', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-updateSocket-2', player1SocketId: null }));
    GameRoomManager.updateSocket('game-updateSocket-2', 'player-1', 'socket-new');
    expect(GameRoomManager.get('game-updateSocket-2')?.player1SocketId).toBe('socket-new');
  });
});

// ─── remove ───────────────────────────────────────────────────────────────────

describe('GameRoomManager.remove', () => {
  it('removes room and cleans up socket mappings', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-remove' }));
    GameRoomManager.remove('game-remove');
    expect(GameRoomManager.get('game-remove')).toBeUndefined();
    expect(GameRoomManager.getBySocketId('socket-1')).toBeUndefined();
    expect(GameRoomManager.getBySocketId('socket-2')).toBeUndefined();
  });

  it('does nothing for unknown gameId', () => {
    expect(() => GameRoomManager.remove('nonexistent')).not.toThrow();
  });

  it('handles room with null socket IDs', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-remove-2', player1SocketId: null, player2SocketId: null }));
    expect(() => GameRoomManager.remove('game-remove-2')).not.toThrow();
    expect(GameRoomManager.get('game-remove-2')).toBeUndefined();
  });
});

// ─── removeSocket ─────────────────────────────────────────────────────────────

describe('GameRoomManager.removeSocket', () => {
  it('nullifies player1 socket without removing room', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-removeSocket' }));
    GameRoomManager.removeSocket('socket-1');
    const room = GameRoomManager.get('game-removeSocket');
    expect(room).toBeDefined(); // room still exists
    expect(room?.player1SocketId).toBeNull();
    expect(GameRoomManager.getBySocketId('socket-1')).toBeUndefined();
  });

  it('nullifies player2 socket without removing room', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-removeSocket' }));
    GameRoomManager.removeSocket('socket-2');
    const room = GameRoomManager.get('game-removeSocket');
    expect(room?.player2SocketId).toBeNull();
  });

  it('does nothing for unknown socket', () => {
    expect(() => GameRoomManager.removeSocket('unknown')).not.toThrow();
  });
});

// ─── getSockets ───────────────────────────────────────────────────────────────

describe('GameRoomManager.getSockets', () => {
  it('returns both socket IDs when both connected', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-getSockets' }));
    const sockets = GameRoomManager.getSockets('game-getSockets');
    expect(sockets).toHaveLength(2);
    expect(sockets).toContain('socket-1');
    expect(sockets).toContain('socket-2');
  });

  it('returns only connected sockets when one is null', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-getSockets-2', player2SocketId: null }));
    const sockets = GameRoomManager.getSockets('game-getSockets-2');
    expect(sockets).toHaveLength(1);
    expect(sockets).toContain('socket-1');
  });

  it('returns empty array for unknown gameId', () => {
    expect(GameRoomManager.getSockets('nonexistent')).toHaveLength(0);
  });

  it('returns empty array when both sockets are null', () => {
    GameRoomManager.create(makeRoom({ gameId: 'game-getSockets-3', player1SocketId: null, player2SocketId: null }));
    expect(GameRoomManager.getSockets('game-getSockets-3')).toHaveLength(0);
  });
});
