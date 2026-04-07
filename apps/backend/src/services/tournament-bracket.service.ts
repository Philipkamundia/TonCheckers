/**
 * TournamentBracketService — 30s bracket presence window
 *
 * Flow:
 *   1. Tournament starts → notify all participants → open 30s presence window
 *   2. Players emit tournament.bracket_join → recorded as present
 *   3. After 30s → resolve: present players get paired, absent = forfeit
 *
 * Redis keys:
 *   t:bracket:meta:{tournamentId}    → JSON BracketWindowMeta
 *   t:bracket:present:{tournamentId} → Set of present userIds
 *   t:bracket:active_set             → Set of active tournamentIds
 */
import redis from '../config/redis.js';
import { logger } from '../utils/logger.js';

const WINDOW_MS    = 60_000;
const META_PREFIX  = 't:bracket:meta:';
const PRES_PREFIX  = 't:bracket:present:';
const ACTIVE_SET   = 't:bracket:active_set';

export interface BracketWindowMeta {
  tournamentId:  string;
  expiresAt:     number;
  participants:  Array<{ userId: string; seedElo: number }>;
}

export class TournamentBracketService {

  static async openWindow(
    tournamentId: string,
    participants: Array<{ userId: string; seedElo: number }>,
  ): Promise<BracketWindowMeta> {
    const expiresAt = Date.now() + WINDOW_MS;
    const meta: BracketWindowMeta = { tournamentId, expiresAt, participants };
    const ttlMs = WINDOW_MS + 10_000;

    await Promise.all([
      redis.set(`${META_PREFIX}${tournamentId}`, JSON.stringify(meta), 'PX', ttlMs),
      redis.del(`${PRES_PREFIX}${tournamentId}`),
      redis.sadd(ACTIVE_SET, tournamentId),
    ]);

    logger.info(`Bracket window opened: tournament=${tournamentId} participants=${participants.length}`);
    return meta;
  }

  static async playerJoined(tournamentId: string, userId: string): Promise<boolean> {
    const exists = await redis.exists(`${META_PREFIX}${tournamentId}`);
    if (!exists) return false;
    await redis.sadd(`${PRES_PREFIX}${tournamentId}`, userId);
    return true;
  }

  static async getMeta(tournamentId: string): Promise<BracketWindowMeta | null> {
    const raw = await redis.get(`${META_PREFIX}${tournamentId}`);
    return raw ? JSON.parse(raw) : null;
  }

  static async getPresentPlayers(tournamentId: string): Promise<string[]> {
    return redis.smembers(`${PRES_PREFIX}${tournamentId}`);
  }

  static async clearWindow(tournamentId: string): Promise<void> {
    await Promise.all([
      redis.del(`${META_PREFIX}${tournamentId}`),
      redis.del(`${PRES_PREFIX}${tournamentId}`),
      redis.srem(ACTIVE_SET, tournamentId),
    ]);
  }

  /** Returns all tournamentIds whose 30s window has expired */
  static async getExpiredWindows(): Promise<Array<{ tournamentId: string; meta: BracketWindowMeta }>> {
    const ids = await redis.smembers(ACTIVE_SET);
    const expired: Array<{ tournamentId: string; meta: BracketWindowMeta }> = [];

    for (const tournamentId of ids) {
      const raw = await redis.get(`${META_PREFIX}${tournamentId}`);
      if (!raw) { await redis.srem(ACTIVE_SET, tournamentId); continue; }
      const meta: BracketWindowMeta = JSON.parse(raw);
      if (Date.now() >= meta.expiresAt) expired.push({ tournamentId, meta });
    }

    return expired;
  }
}
