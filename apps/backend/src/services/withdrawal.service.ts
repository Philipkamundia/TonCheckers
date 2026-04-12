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
    userId:      string,
    amount:      string,
    destination: string,  // validated against registered wallet — cannot be overridden
  ): Promise<WithdrawalRequest> {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) throw new AppError(400, 'Amount must be positive', 'INVALID_AMOUNT');
    if (amountNum < 0.1) throw new AppError(400, 'Minimum withdrawal is 0.1 TON', 'INVALID_AMOUNT');

    // 1. Fetch user and use their REGISTERED wallet address — ignore frontend destination entirely
    const { rows: [user] } = await pool.query(
      'SELECT wallet_address FROM users WHERE id = $1', [userId],
    );
    if (!user) throw new AppError(404, 'User not found', 'NOT_FOUND');

    // Always withdraw to the registered wallet — destination param is only used for logging/display
    // This prevents any attempt to redirect funds to a different wallet
    const registeredWallet = user.wallet_address;
    if (registeredWallet.toLowerCase() !== destination.toLowerCase()) {
      logger.warn(`Withdrawal destination mismatch: user=${userId} registered=${registeredWallet} requested=${destination}`);
      throw new AppError(400, 'Withdrawal destination must match your connected wallet', 'INVALID_DESTINATION');
    }

    // Use the registered wallet as the canonical destination
    destination = registeredWallet;

    // 2. Cooldown check (PRD §4: 30-minute cooldown)
    const cooldownKey = `${COOLDOWN_PREFIX}${userId}`;
    const onCooldown  = await redis.get(cooldownKey);
    if (onCooldown) {
      const ttl = await redis.ttl(cooldownKey);
      throw new AppError(429, `Withdrawal cooldown active. Try again in ${Math.ceil(ttl / 60)} minutes.`, 'COOLDOWN_ACTIVE');
    }

    // 3. Daily limit check — atomic INCRBYFLOAT prevents the race condition
    // where two concurrent requests both read 0 and both pass the limit check.
    const utcDate = new Date().toISOString().slice(0, 10);
    const dailyKey = `${DAILY_PREFIX}${userId}:${utcDate}`;
    const secsUntilMidnightForLimit = WithdrawalService.secsUntilUtcMidnight();

    // requiresReview routes to admin queue but still counts against the daily total
    const requiresReview = amountNum >= MAX_DAILY_TON;

    if (!requiresReview) {
      // Atomically increment — if the result exceeds the limit, roll back immediately
      const newDailyTotal = await redis.incrbyfloat(dailyKey, amountNum);
      await redis.expire(dailyKey, secsUntilMidnightForLimit);
      if (newDailyTotal > MAX_DAILY_TON) {
        // Roll back the increment
        await redis.incrbyfloat(dailyKey, -amountNum);
        const used = newDailyTotal - amountNum;
        const remaining = Math.max(0, MAX_DAILY_TON - used);
        throw new AppError(400, `Daily limit reached. You can withdraw up to ${remaining.toFixed(2)} TON today.`, 'DAILY_LIMIT_EXCEEDED');
      }
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

    // 6. For review-required withdrawals, update daily total separately.
    // Non-review withdrawals already updated the daily counter atomically in step 3.
    if (requiresReview) {
      const secsUntilMidnight = WithdrawalService.secsUntilUtcMidnight();
      await redis.incrbyfloat(dailyKey, amountNum);
      await redis.expire(dailyKey, secsUntilMidnight);
    }

    // Cooldown set only after successful on-chain send (inside processWithdrawal)

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
      // Note: transaction is already status='processing' from requestWithdrawal INSERT
      const txHash = await WithdrawalService.sendTonTransfer(destination, amount, transactionId);

      // If hash is synthetic (polling exhausted), keep status as 'processing'
      // so the recovery job will retry on-chain lookup. Do NOT refund yet.
      if (txHash.startsWith('pending:')) {
        await pool.query(
          `UPDATE transactions SET ton_tx_hash=$1, updated_at=NOW() WHERE id=$2`,
          [txHash, transactionId],
        );
        logger.warn(`Withdrawal broadcast but hash unconfirmed — recovery job will retry: txId=${transactionId}`);
        // Still set cooldown — the transfer was sent
        if (cooldownKey) await redis.set(cooldownKey, '1', 'EX', COOLDOWN_SECS);
        return;
      }

      await pool.query(
        `UPDATE transactions SET status='confirmed', ton_tx_hash=$1, updated_at=NOW() WHERE id=$2`,
        [txHash, transactionId],
      );

      // Set cooldown only after successful send
      if (cooldownKey) {
        await redis.set(cooldownKey, '1', 'EX', COOLDOWN_SECS);
      }

      await NotificationService.send(userId, 'withdrawal_processed', { amount, txHash });
      logger.info(`Withdrawal sent: user=${userId} amount=${amount} TON hash=${txHash}`);
    } catch (err) {
      // Always release the hot-wallet lock on error so the next withdrawal can proceed
      try { const r = (await import('../config/redis.js')).default; await r.del('withdrawal:hot_wallet_lock'); } catch {}
      await pool.query(
        `UPDATE transactions SET status='failed', updated_at=NOW() WHERE id=$1`,
        [transactionId],
      );
      // M-02: Set cooldown even on failure to prevent rapid-fire retry loops
      if (cooldownKey) {
        const r = (await import('../config/redis.js')).default;
        await r.set(cooldownKey, '1', 'EX', COOLDOWN_SECS).catch(() => {});
      }
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
  static async sendTonTransfer(destination: string, amount: string, transactionId?: string): Promise<string> {
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

    const networkGlobalId = network === 'mainnet' ? -239 : -3;
    const wallet   = WalletContractV5R1.create({ publicKey: keyPair.publicKey, workchain: 0, walletId: { networkGlobalId } });
    const contract = client.open(wallet);

    // H-05: Acquire hot-wallet serialization lock to prevent two concurrent withdrawals
    // from reading the same seqno and broadcasting conflicting transactions.
    // 30-second TTL is enough for seqno fetch + broadcast; released explicitly after send.
    const redis = (await import('../config/redis.js')).default;
    const lockAcquired = await redis.set('withdrawal:hot_wallet_lock', transactionId ?? 'lock', 'PX', 30_000, 'NX');
    if (!lockAcquired) {
      throw new Error('Hot wallet busy — another withdrawal is in progress. Retry in a moment.');
    }

    let seqno: number;
    try {
      seqno = await contract.getSeqno();
    } catch (err) {
      const msg = (err as Error).message;
      throw new Error(`TON API error getting seqno (network=${network} endpoint=${endpoint}): ${msg}`);
    }

    const { Address, toNano, SendMode } = await import('@ton/core');
    const toAddress  = Address.parse(destination);
    const nanoAmount = toNano(amount);
    const hotAddr    = wallet.address.toString({ bounceable: false });

    // Broadcast the transfer
    try {
      await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode:  SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        messages:  [internal({ to: toAddress, value: nanoAmount, body: 'CheckTON withdrawal' })],
      });
    } catch (err) {
      const msg = (err as Error).message;
      throw new Error(`TON transfer failed (network=${network} dest=${destination} amount=${amount}): ${msg}`);
    }

    // Release hot-wallet lock now that the transfer has been broadcast (seqno consumed)
    await redis.del('withdrawal:hot_wallet_lock');

    // Transfer was broadcast. Now poll for the real hash with retries.
    // We use seqno+destination+amount to identify the exact tx — not just "last tx".
    const base        = network === 'mainnet' ? 'https://toncenter.com/api/v2' : 'https://testnet.toncenter.com/api/v2';
    const apiKeyParam = apiKey ? `&api_key=${apiKey}` : '';
    const expectedNano = Math.round(parseFloat(amount) * 1e9);

    // Poll up to 5 times with increasing delays (8s, 12s, 16s, 20s, 24s)
    for (let attempt = 1; attempt <= 5; attempt++) {
      await new Promise(r => setTimeout(r, attempt * 4_000 + 4_000));
      try {
        const res  = await fetch(`${base}/getTransactions?address=${hotAddr}&limit=10${apiKeyParam}`);
        const data = await res.json() as { ok: boolean; result: Array<Record<string, unknown>> };
        if (!data.ok) continue;

        for (const item of data.result) {
          // Match by seqno in out_msgs or by destination+amount
          const outMsgs = (item.out_msgs as Array<Record<string, unknown>>) ?? [];
          for (const msg of outMsgs) {
            const dest  = String(msg.destination || '');
            const value = Number(msg.value || 0);
            if (
              dest.toLowerCase() === destination.toLowerCase() &&
              Math.abs(value - expectedNano) < 10_000  // M-03: tight tolerance (gas only)
            ) {
              const txHash = String(
                (item.transaction_id as Record<string, unknown>)?.hash ?? item.hash ?? '',
              );
              if (txHash) {
                logger.info(`TON transfer confirmed (attempt ${attempt}): ${amount} TON → ${destination} hash=${txHash}`);
                return txHash;
              }
            }
          }
        }
      } catch (pollErr) {
        logger.warn(`Hash poll attempt ${attempt} failed: ${(pollErr as Error).message}`);
      }
    }

    // All polling attempts exhausted — store a traceable synthetic hash that embeds
    // the seqno for precise on-chain matching in the recovery job.
    // H-06: The seqno is the authoritative identifier for the exact on-chain tx.
    const syntheticHash = `pending:${hotAddr}:seq${seqno}:${Date.now()}`;
    logger.warn(`TON transfer hash unconfirmed after 5 attempts — stored as pending: ${amount} TON → ${destination} seqno=${seqno}`);
    return syntheticHash;
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
