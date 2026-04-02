/**
 * MatchmakingService — Queue + pairing
 *
 * PRD §6 / §7:
 * - ELO ±100 initial, expands ±50 every 30s
 * - Stake mismatch → lower stake wins, higher-stake player notified
 * - Balance locked on join, unlocked on cancel
 * - Redis SETNX lock prevents double-pairing
 */
import redis from '../config/redis.js';
import pool from '../config/db.js';
import { BalanceService } from './balance.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const QUEUE_KEY          = 'mm:queue';
const ENTRY_PREFIX       = 'mm:entry:';
const LOCK_PREFIX        = 'mm:lock:';
const INITIAL_ELO_RANGE  = 100;
const ELO_EXPAND_EVERY   = 30_000;
const ELO_EXPAND_BY      = 50;
const MIN_STAKE          = parseFloat(process.env.MIN_STAKE_TON || '0.1');

export interface QueueEntry {
  userId:   string;
  elo:      number;
  stake:    string;
  joinedAt: number;
}

export class MatchmakingService {

  static async joinQueue(userId: string, stake: string): Promise<void> {
    const stakeNum = parseFloat(stake);
    if (stakeNum < MIN_STAKE) throw new AppError(400, `Minimum stake is ${MIN_STAKE} TON`, 'STAKE_TOO_LOW');

    if (await redis.zscore(QUEUE_KEY, userId)) {
      throw new AppError(409, 'Already in queue', 'ALREADY_QUEUED');
    }

    const balance = await BalanceService.getBalance(userId);
    if (parseFloat(balance.available) < stakeNum) {
      throw new AppError(400, 'Insufficient balance', 'INSUFFICIENT_BALANCE');
    }

    const { rows: [user] } = await pool.query('SELECT elo, is_banned FROM users WHERE id=$1', [userId]);
    if (!user) throw new AppError(404, 'User not found', 'NOT_FOUND');
    if (user.is_banned) throw new AppError(403, 'Account is banned', 'BANNED');

    await BalanceService.lockBalance(userId, stake);

    const now = Date.now();
    await Promise.all([
      redis.zadd(QUEUE_KEY, now, userId),
      redis.hset(`${ENTRY_PREFIX}${userId}`, { userId, elo: user.elo, stake, joinedAt: now }),
    ]);

    await pool.query(
      `INSERT INTO matchmaking_queue (user_id, elo, stake, status) VALUES ($1,$2,$3,'waiting')
       ON CONFLICT (user_id) WHERE status = 'waiting' DO NOTHING`,
      [userId, user.elo, stake],
    );

    logger.info(`Queue join: user=${userId} elo=${user.elo} stake=${stake}`);
  }

  static async cancelQueue(userId: string): Promise<void> {
    const entry = await MatchmakingService.getEntry(userId);
    if (!entry) throw new AppError(400, 'Not in queue', 'NOT_IN_QUEUE');
    await MatchmakingService.removeFromQueue(userId, entry.stake, true);
    logger.info(`Queue cancel: user=${userId}`);
  }

  static async getEntry(userId: string): Promise<QueueEntry | null> {
    const data = await redis.hgetall(`${ENTRY_PREFIX}${userId}`);
    if (!data?.userId) return null;
    return {
      userId:   data.userId,
      elo:      parseInt(data.elo, 10),
      stake:    data.stake,
      joinedAt: parseInt(data.joinedAt, 10),
    };
  }

  static async removeFromQueue(userId: string, stake: string, unlock: boolean): Promise<void> {
    await Promise.all([
      redis.zrem(QUEUE_KEY, userId),
      redis.del(`${ENTRY_PREFIX}${userId}`),
      redis.del(`${LOCK_PREFIX}${userId}`),
    ]);
    await pool.query(
      `UPDATE matchmaking_queue SET status='cancelled' WHERE user_id=$1 AND status='waiting'`,
      [userId],
    );
    if (unlock) await BalanceService.unlockBalance(userId, stake);
  }

  static async getAllEntries(): Promise<QueueEntry[]> {
    const userIds = await redis.zrange(QUEUE_KEY, 0, -1);
    const entries: QueueEntry[] = [];
    for (const uid of userIds) {
      const e = await MatchmakingService.getEntry(uid);
      if (e) entries.push(e);
    }
    return entries;
  }

  /** ELO range expands ±50 every 30s of waiting (PRD §7) */
  static getEloRange(entry: QueueEntry): number {
    const expansions = Math.floor((Date.now() - entry.joinedAt) / ELO_EXPAND_EVERY);
    return INITIAL_ELO_RANGE + (expansions * ELO_EXPAND_BY);
  }

  static findMatch(
    seeker: QueueEntry,
    candidates: QueueEntry[],
  ): { match: QueueEntry; resolvedStake: string; stakeMismatch: boolean } | null {
    const range      = MatchmakingService.getEloRange(seeker);
    const compatible = candidates.filter(
      c => c.userId !== seeker.userId && Math.abs(c.elo - seeker.elo) <= range,
    );
    if (!compatible.length) return null;

    // Prefer exact stake
    const exactStake  = compatible.filter(c => parseFloat(c.stake) === parseFloat(seeker.stake));
    const candidates_ = exactStake.length ? exactStake : compatible;
    const best        = candidates_.reduce((a, b) =>
      Math.abs(a.elo - seeker.elo) <= Math.abs(b.elo - seeker.elo) ? a : b,
    );

    const resolvedStake = exactStake.length
      ? seeker.stake
      : Math.min(parseFloat(seeker.stake), parseFloat(best.stake)).toFixed(9);

    return { match: best, resolvedStake, stakeMismatch: !exactStake.length };
  }

  static async acquireLock(userId: string): Promise<boolean> {
    return (await redis.set(`${LOCK_PREFIX}${userId}`, '1', 'PX', 10_000, 'NX')) === 'OK';
  }

  static async releaseLock(userId: string): Promise<void> {
    await redis.del(`${LOCK_PREFIX}${userId}`);
  }
}
