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
    // Store expiry + activePlayer in one key: "timestamp:player"
    // This ensures both values expire together and are read atomically
    const ttlMs = MOVE_TIMEOUT_MS + 10_000; // extra buffer for slow job runs
    await Promise.all([
      redis.set(`${TIMER_PREFIX}${gameId}`,  `${expiresAt}:${activePlayer}`, 'PX', ttlMs),
      redis.sadd(ACTIVE_SET, gameId),
    ]);
  }

  /** Clear when game ends */
  static async clearTimer(gameId: string): Promise<void> {
    await Promise.all([
      redis.del(`${TIMER_PREFIX}${gameId}`),
      redis.srem(ACTIVE_SET, gameId),
    ]);
  }

  /** Remaining ms — 0 if expired, null if no timer */
  static async getRemainingMs(gameId: string): Promise<number | null> {
    const val = await redis.get(`${TIMER_PREFIX}${gameId}`);
    if (!val) return null;
    const expiresAt = parseInt(val.split(':')[0], 10);
    return Math.max(0, expiresAt - Date.now());
  }

  static async getActivePlayer(gameId: string): Promise<1 | 2 | null> {
    const val = await redis.get(`${TIMER_PREFIX}${gameId}`);
    if (!val) return null;
    const parts = val.split(':');
    return parseInt(parts[1], 10) as 1 | 2;
  }

  static async getExpiredGames(): Promise<Array<{ gameId: string; timedOutPlayer: 1 | 2 }>> {
    const gameIds = await redis.smembers(ACTIVE_SET);
    const expired: Array<{ gameId: string; timedOutPlayer: 1 | 2 }> = [];

    for (const gameId of gameIds) {
      const val = await redis.get(`${TIMER_PREFIX}${gameId}`);

      if (!val) {
        // Key expired naturally — remove stale set entry
        await redis.srem(ACTIVE_SET, gameId);
        continue;
      }

      const parts     = val.split(':');
      const expiresAt = parseInt(parts[0], 10);
      const player    = parseInt(parts[1], 10) as 1 | 2;
      const remaining = Math.max(0, expiresAt - Date.now());

      if (remaining === 0) {
        expired.push({ gameId, timedOutPlayer: player });
        logger.info(`Timer expired: game=${gameId} player=${player}`);
      }
    }

    return expired;
  }
}
