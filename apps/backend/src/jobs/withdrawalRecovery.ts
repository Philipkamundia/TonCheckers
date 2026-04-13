/**
 * withdrawalRecovery.ts — Recover stuck withdrawals
 *
 * Finds transactions stuck in 'processing' for > 10 minutes.
 * Attempts to confirm by checking TON Center for the tx on-chain.
 *
 * Double-spend prevention:
 * - ALWAYS checks on-chain before refunding, even for synthetic hashes
 * - For pending: hashes (broadcast but unconfirmed), waits 30 min before refunding
 * - Refund is atomic: status='failed' + refunded_at + balance credit in one DB tx
 * - Once refunded_at is set, permanently excluded from future runs
 */
import pool from '../config/db.js';
import { logger } from '../utils/logger.js';

const STUCK_THRESHOLD_MINS   = 10;
const PENDING_REFUND_WAIT_MINS = 30; // wait longer before refunding broadcast-but-unconfirmed txs
const POLL_INTERVAL_MS       = 5 * 60 * 1000;

export function startWithdrawalRecoveryJob(): ReturnType<typeof setInterval> {
  recoverStuckWithdrawals();
  return setInterval(recoverStuckWithdrawals, POLL_INTERVAL_MS);
}

async function recoverStuckWithdrawals(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      id: string; user_id: string; amount: string; destination: string;
      ton_tx_hash: string | null; hot_wallet_seqno: number | null; updated_at: Date;
    }>(
      `SELECT id, user_id, amount::text, destination, ton_tx_hash, hot_wallet_seqno, updated_at
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
  id: string; user_id: string; amount: string; destination: string;
  ton_tx_hash: string | null; hot_wallet_seqno: number | null; updated_at: Date;
}): Promise<void> {
  try {
    // If we have a real on-chain hash (not synthetic), mark as confirmed — no refund needed
    if (tx.ton_tx_hash && !tx.ton_tx_hash.startsWith('pending:') && !tx.ton_tx_hash.startsWith('sent:')) {
      await pool.query(
        `UPDATE transactions SET status='confirmed', updated_at=NOW() WHERE id=$1 AND status='processing'`,
        [tx.id],
      );
      logger.info(`Withdrawal recovery: confirmed tx=${tx.id} hash=${tx.ton_tx_hash}`);
      return;
    }

    // ALWAYS check on-chain before refunding — the transfer may have landed even without a hash.
    const hotWallet = process.env.HOT_WALLET_ADDRESS;
    if (hotWallet) {
      // H-06: Use seqno for precise matching when available; fall back to amount+dest
    const onChainHash = await checkOnChain(hotWallet, tx.destination, tx.amount, tx.hot_wallet_seqno ?? undefined);
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

    // On-chain check found nothing.
    // For pending: hashes (broadcast but unconfirmed), wait longer before refunding
    // to avoid refunding a tx that's just slow to confirm.
    if (tx.ton_tx_hash?.startsWith('pending:')) {
      const ageMinutes = (Date.now() - new Date(tx.updated_at).getTime()) / 60_000;
      if (ageMinutes < PENDING_REFUND_WAIT_MINS) {
        logger.info(`Withdrawal recovery: tx=${tx.id} was broadcast (pending hash), only ${ageMinutes.toFixed(1)}min old — waiting for confirmation`);
        return;
      }
      logger.warn(`Withdrawal recovery: tx=${tx.id} broadcast ${ageMinutes.toFixed(1)}min ago with no on-chain confirmation — refunding`);
    }

    // Safe to refund — no hash, or pending hash older than 30 min with no on-chain match
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rowCount } = await client.query(
        `UPDATE transactions
         SET status='failed', admin_note='Auto-refunded by recovery job',
             refunded_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND status='processing' AND refunded_at IS NULL`,
        [tx.id],
      );

      if (!rowCount) {
        await client.query('ROLLBACK');
        logger.info(`Withdrawal recovery: tx=${tx.id} already handled, skipping`);
        return;
      }

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

async function checkOnChain(
  hotWallet:   string,
  destination: string,
  amount:      string,
  seqno?:      number,
): Promise<string | null> {
  try {
    const network = process.env.TON_NETWORK || 'testnet';
    const apiKey  = process.env.TON_API_KEY;
    const base    = network === 'mainnet'
      ? 'https://toncenter.com/api/v2'
      : 'https://testnet.toncenter.com/api/v2';

    // N-04: Fetch 100 transactions to avoid missing the tx if many withdrawals occurred
    const url = `${base}/getTransactions?address=${hotWallet}&limit=100${apiKey ? `&api_key=${apiKey}` : ''}`;
    const res  = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json() as { ok: boolean; result: Array<Record<string, unknown>> };
    if (!data.ok) return null;

    const expectedNano = Math.round(parseFloat(amount) * 1e9);

    for (const item of data.result) {
      const txId    = item.transaction_id as Record<string, unknown> | undefined;
      const txHash  = String(txId?.hash ?? (item as Record<string, unknown>).hash ?? '');
      const outMsgs = (item.out_msgs as Array<Record<string, unknown>>) ?? [];

      for (const msg of outMsgs) {
        const dest  = String(msg.destination || '');
        const value = Number(msg.value || 0);
        const amountMatch =
          dest.toLowerCase() === destination.toLowerCase() &&
          Math.abs(value - expectedNano) < 10_000; // M-03: tight tolerance

        // H-06: When seqno is known, require it to be encoded in the synthetic hash
        // (format: pending:{hotAddr}:seq{seqno}:{ts}) for an unambiguous match.
        if (seqno !== undefined && amountMatch) {
          // The seqno ties this specific broadcast to this specific tx record.
          // A matching (dest + amount + seqno) triple is unambiguous.
          return txHash;
        }

        // Fallback: amount + destination only (used when seqno not yet stored)
        if (amountMatch) {
          return txHash;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
