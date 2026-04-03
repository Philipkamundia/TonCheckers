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
    if (isNaN(amountNum) || amountNum <= 0) throw new AppError(400, 'Amount must be positive', 'INVALID_AMOUNT');
    if (amountNum < 0.1) throw new AppError(400, 'Minimum withdrawal is 0.1 TON', 'INVALID_AMOUNT');

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
      // Update daily total immediately — counts the attempt against the limit
      const secsUntilMidnight = WithdrawalService.secsUntilUtcMidnight();
      await redis.set(dailyKey, (dailyUsed + amountNum).toFixed(9), 'EX', secsUntilMidnight);
      // Cooldown is set only after successful on-chain send (inside processWithdrawal)
    }

    logger.info(`Withdrawal requested: user=${userId} amount=${amount} TON dest=${destination} review=${requiresReview}`);

    // 7. Process immediately if under limit — fire and forget
    if (!requiresReview) {
      WithdrawalService.processWithdrawal(transactionId, userId, destination, amount, cooldownKey)
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
    cooldownKey?:  string,
  ): Promise<void> {
    try {
      await pool.query(
        `UPDATE transactions SET status='processing', updated_at=NOW() WHERE id=$1`,
        [transactionId],
      );

      const txHash = await WithdrawalService.sendTonTransfer(destination, amount);

      await pool.query(
        `UPDATE transactions SET status='sent', ton_tx_hash=$1, updated_at=NOW() WHERE id=$2`,
        [txHash, transactionId],
      );

      // Set cooldown only after successful send
      if (cooldownKey) {
        await redis.set(cooldownKey, '1', 'EX', COOLDOWN_SECS);
      }

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

    const words = mnemonic.trim().split(/\s+/);
    if (words.length < 12) throw new Error('HOT_WALLET_MNEMONIC appears invalid — expected 24 words');

    const { TonClient, WalletContractV5R1, internal } = await import('@ton/ton');
    const { mnemonicToPrivateKey }                    = await import('@ton/crypto');

    const endpoint = network === 'mainnet'
      ? 'https://toncenter.com/api/v2/jsonRPC'
      : 'https://testnet.toncenter.com/api/v2/jsonRPC';

    const client  = new TonClient({ endpoint, apiKey });
    const keyPair = await mnemonicToPrivateKey(words);

    // W5 wallet — networkGlobalId: -3 = testnet, -239 = mainnet
    const networkGlobalId = network === 'mainnet' ? -239 : -3;
    const wallet   = WalletContractV5R1.create({ publicKey: keyPair.publicKey, workchain: 0, walletId: { networkGlobalId } });
    const contract = client.open(wallet);

    let seqno: number;
    try {
      seqno = await contract.getSeqno();
    } catch (err) {
      const msg = (err as Error).message;
      throw new Error(`TON API error getting seqno (network=${network} endpoint=${endpoint}): ${msg}`);
    }

    const { Address, toNano } = await import('@ton/core');
    const toAddress  = Address.parse(destination);
    const nanoAmount = toNano(amount);

    try {
      await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [
          internal({ to: toAddress, value: nanoAmount, body: 'CheckTON withdrawal' }),
        ],
      });
    } catch (err) {
      const msg = (err as Error).message;
      throw new Error(`TON transfer failed (network=${network} dest=${destination} amount=${amount}): ${msg}`);
    }

    // Wait then fetch real tx hash
    await new Promise(r => setTimeout(r, 8_000));
    try {
      const base        = network === 'mainnet' ? 'https://toncenter.com/api/v2' : 'https://testnet.toncenter.com/api/v2';
      const apiKeyParam = apiKey ? `&api_key=${apiKey}` : '';
      const hotAddr     = wallet.address.toString({ bounceable: false });
      const res  = await fetch(`${base}/getTransactions?address=${hotAddr}&limit=5${apiKeyParam}`);
      const data = await res.json() as { ok: boolean; result: Array<Record<string, unknown>> };
      if (data.ok && data.result.length) {
        const txHash = String(
          (data.result[0].transaction_id as Record<string, unknown>)?.hash ?? data.result[0].hash ?? '',
        );
        if (txHash) {
          logger.info(`TON transfer confirmed: ${amount} TON → ${destination} hash=${txHash}`);
          return txHash;
        }
      }
    } catch (pollErr) {
      logger.warn(`Could not fetch tx hash after send: ${(pollErr as Error).message}`);
    }

    const txHash = `sent:${wallet.address.toString({ bounceable: false })}:seq${seqno}:${Date.now()}`;
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

    // Set cooldown after successful processing (passed into processWithdrawal)
    const cooldownKey = `${COOLDOWN_PREFIX}${tx.user_id}`;
    await WithdrawalService.processWithdrawal(transactionId, tx.user_id, tx.destination, tx.amount, cooldownKey);
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
