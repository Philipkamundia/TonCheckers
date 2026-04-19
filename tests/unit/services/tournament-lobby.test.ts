/**
 * tests/unit/services/tournament-lobby.test.ts
 *
 * TournamentLobbyService — 10s lobby presence tracking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TournamentLobbyService } from '../../../apps/backend/src/services/tournament-lobby.service.js';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    set:      vi.fn(),
    get:      vi.fn(),
    del:      vi.fn(),
    sadd:     vi.fn(),
    srem:     vi.fn(),
    scard:    vi.fn(),
    smembers: vi.fn(),
  },
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({ default: mockRedis }));

const T_ID   = 'tournament-001';
const M_ID   = 'match-001';
const G_ID   = 'game-001';
const P1     = 'player-1';
const P2     = 'player-2';

beforeEach(() => vi.resetAllMocks());

describe('TournamentLobbyService.createLobby', () => {
  it('stores meta, clears players, adds to active set', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.sadd.mockResolvedValue(1);

    const { expiresAt } = await TournamentLobbyService.createLobby(G_ID, T_ID, M_ID, P1, P2);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(mockRedis.set).toHaveBeenCalledWith(
      `t:lobby:meta:${G_ID}`,
      expect.stringContaining(P1),
      'PX',
      expect.any(Number),
    );
    expect(mockRedis.del).toHaveBeenCalledWith(`t:lobby:players:${G_ID}`);
    expect(mockRedis.sadd).toHaveBeenCalledWith('t:lobby:active_set', G_ID);
  });
});

describe('TournamentLobbyService.playerJoined', () => {
  it('returns false and null meta when lobby does not exist', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await TournamentLobbyService.playerJoined(G_ID, P1);
    expect(result.bothPresent).toBe(false);
    expect(result.meta).toBeNull();
  });

  it('returns bothPresent=false when only one player joined', async () => {
    const meta = { tournamentId: T_ID, matchId: M_ID, player1Id: P1, player2Id: P2, expiresAt: Date.now() + 10_000 };
    mockRedis.get.mockResolvedValue(JSON.stringify(meta));
    mockRedis.sadd.mockResolvedValue(1);
    mockRedis.scard.mockResolvedValue(1);
    const result = await TournamentLobbyService.playerJoined(G_ID, P1);
    expect(result.bothPresent).toBe(false);
    expect(result.meta?.player1Id).toBe(P1);
  });

  it('returns bothPresent=true when both players joined', async () => {
    const meta = { tournamentId: T_ID, matchId: M_ID, player1Id: P1, player2Id: P2, expiresAt: Date.now() + 10_000 };
    mockRedis.get.mockResolvedValue(JSON.stringify(meta));
    mockRedis.sadd.mockResolvedValue(1);
    mockRedis.scard.mockResolvedValue(2);
    const result = await TournamentLobbyService.playerJoined(G_ID, P2);
    expect(result.bothPresent).toBe(true);
  });
});

describe('TournamentLobbyService.getJoinedPlayers', () => {
  it('returns list of joined players', async () => {
    mockRedis.smembers.mockResolvedValue([P1, P2]);
    const players = await TournamentLobbyService.getJoinedPlayers(G_ID);
    expect(players).toContain(P1);
    expect(players).toContain(P2);
  });
});

describe('TournamentLobbyService.clearLobby', () => {
  it('deletes meta, players, and removes from active set', async () => {
    mockRedis.del.mockResolvedValue(1);
    mockRedis.srem.mockResolvedValue(1);
    await TournamentLobbyService.clearLobby(G_ID);
    expect(mockRedis.del).toHaveBeenCalledWith(`t:lobby:meta:${G_ID}`);
    expect(mockRedis.del).toHaveBeenCalledWith(`t:lobby:players:${G_ID}`);
    expect(mockRedis.srem).toHaveBeenCalledWith('t:lobby:active_set', G_ID);
  });
});

describe('TournamentLobbyService.getExpiredLobbies', () => {
  it('returns empty array when no active lobbies', async () => {
    mockRedis.smembers.mockResolvedValue([]);
    expect(await TournamentLobbyService.getExpiredLobbies()).toEqual([]);
  });

  it('returns expired lobbies', async () => {
    mockRedis.smembers.mockResolvedValue([G_ID]);
    const meta = { tournamentId: T_ID, matchId: M_ID, player1Id: P1, player2Id: P2, expiresAt: Date.now() - 1_000 };
    mockRedis.get.mockResolvedValue(JSON.stringify(meta));
    const expired = await TournamentLobbyService.getExpiredLobbies();
    expect(expired).toHaveLength(1);
    expect(expired[0].gameId).toBe(G_ID);
  });

  it('skips non-expired lobbies', async () => {
    mockRedis.smembers.mockResolvedValue([G_ID]);
    const meta = { tournamentId: T_ID, matchId: M_ID, player1Id: P1, player2Id: P2, expiresAt: Date.now() + 10_000 };
    mockRedis.get.mockResolvedValue(JSON.stringify(meta));
    expect(await TournamentLobbyService.getExpiredLobbies()).toHaveLength(0);
  });

  it('removes stale entries when meta key is missing', async () => {
    mockRedis.smembers.mockResolvedValue([G_ID]);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.srem.mockResolvedValue(1);
    await TournamentLobbyService.getExpiredLobbies();
    expect(mockRedis.srem).toHaveBeenCalledWith('t:lobby:active_set', G_ID);
  });
});
