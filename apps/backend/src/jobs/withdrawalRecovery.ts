/**
 * withdrawalRecovery.ts — Recover stuck withdrawals
 *
 * Finds transactions stuck in 'processing' for > 10 minutes.
 * Attempts to confirm by checking TON Center for the tx on-chain.
 * If unconfirmable, refunds atomically — status + balance update in one DB transaction.
 *
 * Idempotency:
 * - Query filters status='processing' AND refunded_at IS NULL
 * - Refund sets status='failed' AND refunded_at=NOW() in the same DB transaction as the balance credit
 * - If the server crashes mid-refund, the next run will retry only if refunded_at is still NULL
 * - Once refunded_at is set, the row is permanently excluded from recovery
 */
import pool from '../config/db.js';
import { logger } from '../utils/logger.js';

const STUCK_THRESHOLD_MINS = 10;
const POLL_INTERVAL_MS     = 5 * 60 * 1000;

export function startWithdrawalRecoveryJob(): ReturnType<typeof setInterval> {
  recoverStuckWithdrawals();
  return setInterval(recoverStuckWithdrawals, POLL_INTERVAL_MS);
}

async function recoverStuckWithdrawals(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      id: string; user_id: string; amount: string; destination: string; ton_tx_hash: string | null;
    }>(
      `SELECT id, user_id, amount::text, destination, ton_tx_hash
       FROM transactions
       WHERE type        = 'withdrawal'
         AND status      = 'processing'
         AND refunded_at IS NULL
         AND updated_at  < NOW() - INTERVAL '${STUCK_THRESHOLD_MINS} minutes'`,
    );

    if (!rows.length) return;
    logger.warn(`Withdrawal recovery: found ${rows.length} stuck transaction(s)`);

    for (const tx of rows) {
      await recoverTransaction(tx);
    }
  } catch (err) {
    logger.error(`Withdrawal recovery job error: ${(err as Error).message}`);
  }
}

async function recoverTransaction(tx: {
  id: string; user_id: string; amount: string; destination: string; ton_tx_hash: string | null;
}): Promise<void> {
  try {
    // If we have a real on-chain hash, mark as sent — no refund needed
    if (tx.ton_tx_hash && !tx.ton_tx_hash.startsWith('pending:') && !tx.ton_tx_hash.startsWith('sent:')) {
      await pool.query(
        `UPDATE transactions SET status='confirmed', updated_at=NOW() WHERE id=$1 AND status='processing'`,
        [tx.id],
      );
      logger.info(`Withdrawal recovery: confirmed tx=${tx.id} hash=${tx.ton_tx_hash}`);
      return;
    }

    // Try to find the tx on-chain
    const hotWallet = process.env.HOT_WALLET_ADDRESS;
    if (hotWallet) {
      const onChainHash = await checkOnChain(hotWallet, tx.destination, tx.amount);
      if (onChainHash) {
        await pool.query(
          `UPDATE transactions SET status='confirmed', ton_tx_hash=$1, updated_at=NOW()
           WHERE id=$2 AND status='processing'`,
          [onChainHash, tx.id],
        );
        logger.info(`Withdrawal recovery: found on-chain tx=${tx.id} hash=${onChainHash}`);
        return;
      }
    }

    // Cannot confirm on-chain — refund atomically
    // Both the status update and balance credit happen in one transaction.
    // refunded_at is set here — if this succeeds, the row is permanently excluded from future runs.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Use status='processing' AND refunded_at IS NULL as the guard —
      // if another process already refunded this, rowCount will be 0 and we abort.
      const { rowCount } = await client.query(
        `UPDATE transactions
         SET status='failed', admin_note='Auto-refunded by recovery job',
             refunded_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND status='processing' AND refunded_at IS NULL`,
        [tx.id],
      );

      if (!rowCount) {
        // Already handled by another process — safe to skip
        await client.query('ROLLBACK');
        logger.info(`Withdrawal recovery: tx=${tx.id} already handled, skipping`);
        return;
      }

      // Credit balance in the same transaction
      await client.query(
        `UPDATE balances SET available = available + $1::numeric, updated_at=NOW()
         WHERE user_id = $2`,
        [tx.amount, tx.user_id],
      );

      await client.query('COMMIT');
      logger.warn(`Withdrawal recovery: refunded tx=${tx.id} user=${tx.user_id} amount=${tx.amount} TON`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    logger.error(`Withdrawal recovery failed for tx=${tx.id}: ${(err as Error).message}`);
  }
}

async function checkOnChain(hotWallet: string, destination: string, amount: string): Promise<string | null> {
  try {
    const network = process.env.TON_NETWORK || 'testnet';
    const apiKey  = process.env.TON_API_KEY;
    const base    = network === 'mainnet'
      ? 'https://toncenter.com/api/v2'
      : 'https://testnet.toncenter.com/api/v2';

    const url = `${base}/getTransactions?address=${hotWallet}&limit=20${apiKey ? `&api_key=${apiKey}` : ''}`;
    const res  = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json() as { ok: boolean; result: Array<Record<string, unknown>> };
    if (!data.ok) return null;

    const expectedNano = Math.round(parseFloat(amount) * 1e9);

    for (const item of data.result) {
      const outMsgs = (item.out_msgs as Array<Record<string, unknown>>) ?? [];
      for (const msg of outMsgs) {
        const dest  = String(msg.destination || '');
        const value = Number(msg.value || 0);
        if (
          dest.toLowerCase() === destination.toLowerCase() &&
          Math.abs(value - expectedNano) < 10_000_000  // within 0.01 TON tolerance for fees
        ) {
          return String((item.transaction_id as Record<string, unknown>)?.hash ?? item.hash ?? '');
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
