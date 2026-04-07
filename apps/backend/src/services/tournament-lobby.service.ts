/**
 * TournamentLobbyService — 10-second lobby presence tracking
 *
 * When a tournament match is created, both players have 10s to join the lobby.
 * Redis keys:
 *   t:lobby:{gameId}:players  → Set of userIds who joined
 *   t:lobby:{gameId}:meta     → JSON { tournamentId, matchId, player1Id, player2Id, expiresAt }
 *   t:lobby:active_set        → Set of all active lobby gameIds
 */
import redis from '../config/redis.js';
import { logger } from '../utils/logger.js';

const LOBBY_TIMEOUT_MS = 10_000;
const META_PREFIX      = 't:lobby:meta:';
const PLAYERS_PREFIX   = 't:lobby:players:';
const ACTIVE_SET       = 't:lobby:active_set';

export interface LobbyMeta {
  tournamentId: string;
  matchId:      string;
  player1Id:    string;
  player2Id:    string;
  expiresAt:    number;
}

export class TournamentLobbyService {

  static async createLobby(
    gameId:       string,
    tournamentId: string,
    matchId:      string,
    player1Id:    string,
    player2Id:    string,
  ): Promise<{ expiresAt: number }> {
    const expiresAt = Date.now() + LOBBY_TIMEOUT_MS;
    const meta: LobbyMeta = { tournamentId, matchId, player1Id, player2Id, expiresAt };
    const ttlMs = LOBBY_TIMEOUT_MS + 5_000;

    await Promise.all([
      redis.set(`${META_PREFIX}${gameId}`, JSON.stringify(meta), 'PX', ttlMs),
      redis.del(`${PLAYERS_PREFIX}${gameId}`),
      redis.sadd(ACTIVE_SET, gameId),
    ]);

    logger.info(`Tournament lobby created: game=${gameId} tournament=${tournamentId}`);
    return { expiresAt };
  }

  /** Player signals they are in the lobby. Returns true if both players are now present. */
  static async playerJoined(gameId: string, userId: string): Promise<{
    bothPresent: boolean;
    meta: LobbyMeta | null;
  }> {
    const metaRaw = await redis.get(`${META_PREFIX}${gameId}`);
    if (!metaRaw) return { bothPresent: false, meta: null };

    const meta: LobbyMeta = JSON.parse(metaRaw);
    await redis.sadd(`${PLAYERS_PREFIX}${gameId}`, userId);

    const count = await redis.scard(`${PLAYERS_PREFIX}${gameId}`);
    return { bothPresent: count >= 2, meta };
  }

  static async getMeta(gameId: string): Promise<LobbyMeta | null> {
    const raw = await redis.get(`${META_PREFIX}${gameId}`);
    return raw ? JSON.parse(raw) : null;
  }

  static async getJoinedPlayers(gameId: string): Promise<string[]> {
    return redis.smembers(`${PLAYERS_PREFIX}${gameId}`);
  }

  static async clearLobby(gameId: string): Promise<void> {
    await Promise.all([
      redis.del(`${META_PREFIX}${gameId}`),
      redis.del(`${PLAYERS_PREFIX}${gameId}`),
      redis.srem(ACTIVE_SET, gameId),
    ]);
  }

  /** Returns all lobby gameIds whose 10s window has expired */
  static async getExpiredLobbies(): Promise<Array<{ gameId: string; meta: LobbyMeta }>> {
    const gameIds = await redis.smembers(ACTIVE_SET);
    const expired: Array<{ gameId: string; meta: LobbyMeta }> = [];

    for (const gameId of gameIds) {
      const raw = await redis.get(`${META_PREFIX}${gameId}`);
      if (!raw) {
        await redis.srem(ACTIVE_SET, gameId);
        continue;
      }
      const meta: LobbyMeta = JSON.parse(raw);
      if (Date.now() >= meta.expiresAt) {
        expired.push({ gameId, meta });
      }
    }

    return expired;
  }
}
