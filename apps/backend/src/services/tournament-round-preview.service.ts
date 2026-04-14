import redis from '../config/redis.js';
import { logger } from '../utils/logger.js';

const PREVIEW_TIMEOUT_MS = 30_000;
const META_PREFIX = 't:round_preview:meta:';
const ACTIVE_SET = 't:round_preview:active_set';

export interface RoundPreviewMatch {
  gameId: string;
  matchId: string;
  player1Id: string;
  player2Id: string;
}

export interface RoundPreviewMeta {
  tournamentId: string;
  round: number;
  expiresAt: number;
  matches: RoundPreviewMatch[];
}

export class TournamentRoundPreviewService {
  static async openWindow(
    tournamentId: string,
    round: number,
    matches: RoundPreviewMatch[],
  ): Promise<RoundPreviewMeta> {
    const expiresAt = Date.now() + PREVIEW_TIMEOUT_MS;
    const meta: RoundPreviewMeta = { tournamentId, round, expiresAt, matches };
    const ttlMs = PREVIEW_TIMEOUT_MS + 10_000;

    await Promise.all([
      redis.set(`${META_PREFIX}${tournamentId}`, JSON.stringify(meta), 'PX', ttlMs),
      redis.sadd(ACTIVE_SET, tournamentId),
    ]);

    logger.info(`Round preview opened: tournament=${tournamentId} round=${round} matches=${matches.length}`);
    return meta;
  }

  static async clearWindow(tournamentId: string): Promise<void> {
    await Promise.all([
      redis.del(`${META_PREFIX}${tournamentId}`),
      redis.srem(ACTIVE_SET, tournamentId),
    ]);
  }

  static async getExpiredWindows(): Promise<RoundPreviewMeta[]> {
    const tournamentIds = await redis.smembers(ACTIVE_SET);
    const expired: RoundPreviewMeta[] = [];

    for (const tournamentId of tournamentIds) {
      const raw = await redis.get(`${META_PREFIX}${tournamentId}`);
      if (!raw) {
        await redis.srem(ACTIVE_SET, tournamentId);
        continue;
      }
      const meta: RoundPreviewMeta = JSON.parse(raw);
      if (Date.now() >= meta.expiresAt) expired.push(meta);
    }
    return expired;
  }
}
