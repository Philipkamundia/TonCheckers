/**
 * GameTimerService — 30-second move timers in Redis (PRD §6)
 *
 * Redis keys:
 *   game:timer:{gameId}  → expiry timestamp (unix ms)
 *   game:active:{gameId} → activePlayer (1 or 2)
 *   game:active_set      → Set of all active gameIds (avoids KEYS scan)
 */
import redis from '../config/redis.js';
import { logger } from '../utils/logger.js';

const MOVE_TIMEOUT_MS = 30_000;
const TIMER_PREFIX    = 'game:timer:';
const ACTIVE_PREFIX   = 'game:active:';
const ACTIVE_SET      = 'game:active_set';

export class GameTimerService {

  /** Start (or reset) timer on each turn change */
  static async startTimer(gameId: string, activePlayer: 1 | 2): Promise<void> {
    const expiresAt = Date.now() + MOVE_TIMEOUT_MS;
    const ttlMs     = MOVE_TIMEOUT_MS + 5_000;
    await Promise.all([
      redis.set(`${TIMER_PREFIX}${gameId}`,  String(expiresAt),    'PX', ttlMs),
      redis.set(`${ACTIVE_PREFIX}${gameId}`, String(activePlayer), 'PX', ttlMs),
      redis.sadd(ACTIVE_SET, gameId),
    ]);
  }

  /** Clear when game ends */
  static async clearTimer(gameId: string): Promise<void> {
    await Promise.all([
      redis.del(`${TIMER_PREFIX}${gameId}`),
      redis.del(`${ACTIVE_PREFIX}${gameId}`),
      redis.srem(ACTIVE_SET, gameId),
    ]);
  }

  /** Remaining ms — 0 if expired, null if no timer */
  static async getRemainingMs(gameId: string): Promise<number | null> {
    const val = await redis.get(`${TIMER_PREFIX}${gameId}`);
    if (!val) return null;
    return Math.max(0, parseInt(val, 10) - Date.now());
  }

  static async getActivePlayer(gameId: string): Promise<1 | 2 | null> {
    const val = await redis.get(`${ACTIVE_PREFIX}${gameId}`);
    if (!val) return null;
    return parseInt(val, 10) as 1 | 2;
  }

  /**
   * Return all expired game timers — called every 1s by gameTimerCheck job.
   * Uses a Redis Set instead of KEYS scan to avoid O(N) blocking.
   */
  static async getExpiredGames(): Promise<Array<{ gameId: string; timedOutPlayer: 1 | 2 }>> {
    const gameIds = await redis.smembers(ACTIVE_SET);
    const expired: Array<{ gameId: string; timedOutPlayer: 1 | 2 }> = [];

    for (const gameId of gameIds) {
      const remaining = await GameTimerService.getRemainingMs(gameId);

      if (remaining === null) {
        // Key expired naturally — remove stale set entry
        await redis.srem(ACTIVE_SET, gameId);
        continue;
      }

      if (remaining === 0) {
        const player = await GameTimerService.getActivePlayer(gameId);
        if (player) {
          expired.push({ gameId, timedOutPlayer: player });
          logger.info(`Timer expired: game=${gameId} player=${player}`);
        }
      }
    }

    return expired;
  }
}
