/**
 * WithdrawalService — Full withdrawal flow (PRD §4)
 *
 * Rules:
 * - Destination locked to connected wallet only
 * - Balance deducted immediately on approval
 * - Daily limit: 100 TON per UTC day
 * - Above 100 TON: held in admin review queue
 * - Cooldown: 30 min between withdrawals (Redis TTL key)
 * - TON transfer signed and broadcast from hot wallet via TON SDK
 * - Telegram bot notification on sent
 *
 * Redis keys:
 *   withdrawal:cooldown:{userId}   → TTL 1800s (30 min)
 *   withdrawal:daily:{userId}:{utcDate} → sum of today's withdrawals
 */

import pool from '../config/db.js';
import redis from '../config/redis.js';
import { BalanceService } from './balance.service.js';
import { NotificationService } from './notification.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const MAX_DAILY_TON     = parseFloat(process.env.MAX_DAILY_WITHDRAWAL_TON || '100');
const COOLDOWN_SECS     = 1800;   // 30 minutes (PRD §4)
const COOLDOWN_PREFIX   = 'withdrawal:cooldown:';
const DAILY_PREFIX      = 'withdrawal:daily:';

export interface WithdrawalRequest {
  userId:            string;
  walletAddress:     string;  // user's connected wallet
  amount:            string;
  requiresReview:    boolean;
  transactionId:     string;
}

export class WithdrawalService {

  /**
   * POST /balance/withdraw
   *
   * Full validation + immediate balance deduction.
   * Under 100 TON: deduct and process immediately.
   * 100 TON or above: deduct and queue for admin approval.
   */
  static async requestWithdrawal(
    userId:        string,
    amount:        string,
    destination:   string,  // wallet address from frontend (must match connected wallet)
  ): Promise<WithdrawalRequest> {
    const amountNum = parseFloat(amount);
    if (amountNum <= 0) throw new AppError(400, 'Amount must be positive', 'INVALID_AMOUNT');

    // 1. Verify destination matches connected wallet
    const { rows: [user] } = await pool.query(
      'SELECT wallet_address FROM users WHERE id = $1', [userId],
    );
    if (!user) throw new AppError(404, 'User not found', 'NOT_FOUND');

    if (user.wallet_address.toLowerCase() !== destination.toLowerCase()) {
      throw new AppError(400, 'Withdrawal destination must match your connected wallet', 'INVALID_DESTINATION');
    }

    // 2. Cooldown check (PRD §4: 30-minute cooldown)
    const cooldownKey = `${COOLDOWN_PREFIX}${userId}`;
    const onCooldown  = await redis.get(cooldownKey);
    if (onCooldown) {
      const ttl = await redis.ttl(cooldownKey);
      throw new AppError(429, `Withdrawal cooldown active. Try again in ${Math.ceil(ttl / 60)} minutes.`, 'COOLDOWN_ACTIVE');
    }

    // 3. Daily limit check (PRD §4: 100 TON per UTC day)
    const utcDate  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dailyKey = `${DAILY_PREFIX}${userId}:${utcDate}`;
    const dailyStr = await redis.get(dailyKey);
    const dailyUsed = parseFloat(dailyStr || '0');

    const requiresReview = amountNum >= MAX_DAILY_TON;

    if (!requiresReview && (dailyUsed + amountNum) > MAX_DAILY_TON) {
      const remaining = MAX_DAILY_TON - dailyUsed;
      throw new AppError(400, `Daily limit reached. You can withdraw up to ${remaining.toFixed(2)} TON today.`, 'DAILY_LIMIT_EXCEEDED');
    }

    // 4. Balance check + immediate deduction
    await BalanceService.deductBalance(userId, amount); // throws if insufficient

    // 5. Create transaction record
    const client = await pool.connect();
    let transactionId: string;
    try {
      await client.query('BEGIN');
      const { rows: [tx] } = await client.query(
        `INSERT INTO transactions
           (user_id, type, status, amount, destination, requires_review)
         VALUES ($1, 'withdrawal', $2, $3, $4, $5)
         RETURNING id`,
        [userId, requiresReview ? 'pending' : 'processing', amount, destination, requiresReview],
      );
      transactionId = tx.id;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // Refund the balance deduction on DB failure
      await BalanceService.creditBalance(userId, amount);
      throw err;
    } finally {
      client.release();
    }

    // 6. Set cooldown in Redis (only for normal withdrawals, not admin-queued ones)
    if (!requiresReview) {
      await redis.set(cooldownKey, '1', 'EX', COOLDOWN_SECS);
      // Update daily total
      const secsUntilMidnight = WithdrawalService.secsUntilUtcMidnight();
      await redis.set(dailyKey, (dailyUsed + amountNum).toFixed(9), 'EX', secsUntilMidnight);
    }

    logger.info(`Withdrawal requested: user=${userId} amount=${amount} TON dest=${destination} review=${requiresReview}`);

    // 7. Process immediately if under limit — fire and forget
    if (!requiresReview) {
      WithdrawalService.processWithdrawal(transactionId, userId, destination, amount)
        .catch(err => logger.error(`Withdrawal processing failed: ${err.message}`));
    }

    return { userId, walletAddress: destination, amount, requiresReview, transactionId };
  }

  /**
   * Sign and broadcast TON transfer from hot wallet.
   * Updates transaction status: processing → sent.
   * Notifies user via Telegram bot.
   */
  static async processWithdrawal(
    transactionId: string,
    userId:        string,
    destination:   string,
    amount:        string,
  ): Promise<void> {
    try {
      await pool.query(
        `UPDATE transactions SET status='processing', updated_at=NOW() WHERE id=$1`,
        [transactionId],
      );

      // TON SDK transfer
      const txHash = await WithdrawalService.sendTonTransfer(destination, amount);

      await pool.query(
        `UPDATE transactions SET status='sent', ton_tx_hash=$1, updated_at=NOW() WHERE id=$2`,
        [txHash, transactionId],
      );

      // Notify user (PRD §11)
      await NotificationService.send(userId, 'withdrawal_processed', { amount, txHash });

      logger.info(`Withdrawal sent: user=${userId} amount=${amount} TON hash=${txHash}`);
    } catch (err) {
      await pool.query(
        `UPDATE transactions SET status='failed', updated_at=NOW() WHERE id=$1`,
        [transactionId],
      );
      // Refund on failure
      await BalanceService.creditBalance(userId, amount).catch(refundErr => {
        logger.error(`CRITICAL: withdrawal refund failed user=${userId} amount=${amount}: ${(refundErr as Error).message}`);
      });
      logger.error(`Withdrawal failed: txId=${transactionId} err=${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Sign and broadcast a TON transfer from the hot wallet.
   *
   * Uses @ton/ton SDK:
   * 1. Load wallet from HOT_WALLET_MNEMONIC (24-word seed phrase)
   * 2. Build internal message with amount + destination
   * 3. Sign and send via TonClient connected to TON network
   * 4. Return transaction hash
   */
  static async sendTonTransfer(destination: string, amount: string): Promise<string> {
    const mnemonic = process.env.HOT_WALLET_MNEMONIC;
    const network  = process.env.TON_NETWORK || 'testnet';
    const apiKey   = process.env.TON_API_KEY;

    if (!mnemonic) throw new Error('HOT_WALLET_MNEMONIC not configured');

    // Dynamic import — @ton/ton is a large package, only loaded when needed
    const { TonClient, WalletContractV4, internal } = await import('@ton/ton');
    const { mnemonicToPrivateKey }                  = await import('@ton/crypto');

    const endpoint = network === 'mainnet'
      ? 'https://toncenter.com/api/v2/jsonRPC'
      : 'https://testnet.toncenter.com/api/v2/jsonRPC';

    const client = new TonClient({ endpoint, apiKey });

    // Derive keypair from mnemonic
    const words  = mnemonic.trim().split(/\s+/);
    const keyPair = await mnemonicToPrivateKey(words);

    // Open wallet contract
    const wallet   = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
    const contract = client.open(wallet);
    const seqno    = await contract.getSeqno();

    // Parse destination address
    const { Address } = await import('@ton/core');
    const toAddress    = Address.parse(destination);

    // Convert TON amount to nanoTON
    const { toNano } = await import('@ton/core');
    const nanoAmount  = toNano(amount);

    // Send transfer
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [
        internal({
          to:    toAddress,
          value: nanoAmount,
          body:  'CheckTON withdrawal',
        }),
      ],
    });

    // The real on-chain hash is only available after confirmation.
    // Store a deterministic pending identifier: address + seqno.
    // The deposit poller will match the confirmed tx and update it.
    const txHash = `pending:${wallet.address.toString({ bounceable: false })}:seq${seqno}`;
    logger.info(`TON transfer sent: ${amount} TON → ${destination} seqno=${seqno}`);
    return txHash;
  }

  /**
   * Admin approval: process a held withdrawal (above 100 TON).
   * Called from admin dashboard (Phase 12).
   */
  static async approveWithdrawal(transactionId: string, adminNote?: string): Promise<void> {
    const { rows: [tx] } = await pool.query(
      `SELECT id, user_id, amount::text, destination FROM transactions
       WHERE id=$1 AND requires_review=true AND status='pending'`,
      [transactionId],
    );
    if (!tx) throw new AppError(404, 'Pending withdrawal not found', 'NOT_FOUND');

    if (adminNote) {
      await pool.query(
        `UPDATE transactions SET admin_note=$1, updated_at=NOW() WHERE id=$2`,
        [adminNote, transactionId],
      );
    }

    // Set cooldown for large withdrawal too
    const cooldownKey = `${COOLDOWN_PREFIX}${tx.user_id}`;
    await redis.set(cooldownKey, '1', 'EX', COOLDOWN_SECS);

    await WithdrawalService.processWithdrawal(transactionId, tx.user_id, tx.destination, tx.amount);
    logger.info(`Admin approved withdrawal: txId=${transactionId} amount=${tx.amount} TON`);
  }

  /**
   * Admin rejection: cancel a held withdrawal and return funds.
   */
  static async rejectWithdrawal(transactionId: string, reason: string): Promise<void> {
    const { rows: [tx] } = await pool.query(
      `SELECT id, user_id, amount::text FROM transactions
       WHERE id=$1 AND requires_review=true AND status='pending'`,
      [transactionId],
    );
    if (!tx) throw new AppError(404, 'Pending withdrawal not found', 'NOT_FOUND');

    await pool.query(
      `UPDATE transactions SET status='rejected', admin_note=$1, updated_at=NOW() WHERE id=$2`,
      [reason, transactionId],
    );

    await BalanceService.creditBalance(tx.user_id, tx.amount);
    logger.info(`Admin rejected withdrawal: txId=${transactionId} reason=${reason}`);
  }

  /** Get all pending withdrawals awaiting admin review */
  static async getPendingReviewWithdrawals(): Promise<unknown[]> {
    const { rows } = await pool.query(
      `SELECT t.id, t.user_id, u.username, t.amount::text, t.destination, t.created_at
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       WHERE t.requires_review=true AND t.status='pending'
       ORDER BY t.created_at ASC`,
    );
    return rows;
  }

  /** Seconds until UTC midnight — used for daily limit key TTL */
  private static secsUntilUtcMidnight(): number {
    const now      = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  }
}
