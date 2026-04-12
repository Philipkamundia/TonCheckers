import pool from '../config/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export interface Balance {
  available: string;
  locked:    string;
  total:     string;
}

export interface TransactionRecord {
  id:             string;
  type:           'deposit' | 'withdrawal';
  status:         string;
  amount:         string;
  tonTxHash?:     string;
  requiresReview: boolean;
  createdAt:      string;
}

export class BalanceService {

  /** GET /balance — return available, locked, total */
  static async getBalance(userId: string): Promise<Balance> {
    const { rows } = await pool.query(
      `SELECT
         available::text,
         locked::text,
         (available + locked)::text AS total
       FROM balances WHERE user_id = $1`,
      [userId],
    );
    if (!rows[0]) throw new AppError(404, 'Balance record not found', 'NOT_FOUND');
    return rows[0] as Balance;
  }

  /** GET /balance/history — paginated transaction log */
  static async getHistory(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ transactions: TransactionRecord[]; total: number; page: number; totalPages: number }> {
    const offset = (page - 1) * limit;

    const [{ rows: transactions }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT id, type, status, amount::text,
                ton_tx_hash AS "tonTxHash",
                requires_review AS "requiresReview",
                created_at AS "createdAt"
         FROM transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      pool.query(
        'SELECT COUNT(*)::int AS total FROM transactions WHERE user_id = $1',
        [userId],
      ),
    ]);

    const total = countRows[0].total;
    return {
      transactions: transactions as TransactionRecord[],
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Credit available balance — used on confirmed deposit or refund.
   */
  static async creditBalance(
    userId: string,
    amount: string,
    client?: typeof pool extends { connect: () => Promise<infer C> } ? C : never,
  ): Promise<void> {
    const db = client ?? pool;
    await (db as typeof pool).query(
      `UPDATE balances
       SET available = available + $1::numeric,
           updated_at = NOW()
       WHERE user_id = $2`,
      [amount, userId],
    );
    logger.info(`Balance credited: user=${userId} amount=${amount}`);
  }

  /**
   * Deduct available balance — used on withdrawal or game stake.
   * Throws if balance would go negative.
   */
  static async deductBalance(userId: string, amount: string): Promise<void> {
    const { rowCount } = await pool.query(
      `UPDATE balances
       SET available = available - $1::numeric,
           updated_at = NOW()
       WHERE user_id = $2
         AND available >= $1::numeric`,
      [amount, userId],
    );
    if (!rowCount) {
      throw new AppError(400, 'Insufficient balance', 'INSUFFICIENT_BALANCE');
    }
    logger.info(`Balance deducted: user=${userId} amount=${amount}`);
  }

  /**
   * Lock balance for active game stake — moves available → locked.
   * Called when a game starts and stakes are committed.
   */
  static async lockBalance(userId: string, amount: string): Promise<void> {
    const { rowCount } = await pool.query(
      `UPDATE balances
       SET available  = available  - $1::numeric,
           locked     = locked     + $1::numeric,
           locked_at  = COALESCE(locked_at, NOW()),  -- M-06: set on first lock
           updated_at = NOW()
       WHERE user_id  = $2
         AND available >= $1::numeric`,
      [amount, userId],
    );
    if (!rowCount) {
      throw new AppError(400, 'Insufficient balance to lock', 'INSUFFICIENT_BALANCE');
    }
    logger.info(`Balance locked: user=${userId} amount=${amount}`);
  }

  /**
   * Unlock balance — moves locked → available.
   * Called on game cancellation, draw, or crash refund.
   */
  static async unlockBalance(userId: string, amount: string): Promise<void> {
    await pool.query(
      `UPDATE balances
       SET locked     = locked     - $1::numeric,
           available  = available  + $1::numeric,
           -- M-06: clear locked_at when the balance is fully unlocked
           locked_at  = CASE WHEN (locked - $1::numeric) <= 0 THEN NULL ELSE locked_at END,
           updated_at = NOW()
       WHERE user_id  = $2`,
      [amount, userId],
    );
    logger.info(`Balance unlocked: user=${userId} amount=${amount}`);
  }

  /**
   * Atomic balance lock — combines the availability check and the lock
   * in a single UPDATE … WHERE … RETURNING, eliminating the TOCTOU race
   * that exists when check and lock are two separate round-trips.
   *
   * Replaces the joinQueue pattern of:  getBalance() → check → lockBalance()
   * Use this everywhere a check-then-lock is needed.
   */
  static async atomicLockBalance(userId: string, amount: string): Promise<void> {
    const { rowCount } = await pool.query(
      `UPDATE balances
       SET available  = available  - $1::numeric,
           locked     = locked     + $1::numeric,
           locked_at  = COALESCE(locked_at, NOW()),  -- M-06: set on first lock
           updated_at = NOW()
       WHERE user_id  = $2
         AND available >= $1::numeric`,
      [amount, userId],
    );
    if (!rowCount) {
      throw new AppError(400, 'Insufficient balance to lock', 'INSUFFICIENT_BALANCE');
    }
    logger.info(`Balance atomically locked: user=${userId} amount=${amount}`);
  }
}
