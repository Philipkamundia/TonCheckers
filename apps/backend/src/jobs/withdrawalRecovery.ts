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

const STUCK_THRESHOLD_MINS   = 10 / 60; // 10 seconds
const PENDING_REFUND_WAIT_MINS = 30; // wait longer before refunding broadcast-but-unconfirmed txs
const POLL_INTERVAL_MS       = 60 * 1000; // every 60 seconds

export function startWithdrawalRecoveryJob(): ReturnType<typeof setInterval> {
  recoverStuckWithdrawals();
  return setInterval(recoverStuckWithdrawals, POLL_INTERVAL_MS);
}

/** Exported for on-demand admin trigger */
export async function runWithdrawalRecovery(): Promise<void> {
  return recoverStuckWithdrawals();
}

async function recoverStuckWithdrawals(): Promise<void> {
  try {
    // Recover both 'processing' (stuck) and 'failed' transactions that have a
    // hot_wallet_seqno — seqno presence means sendTonTransfer was called and the
    // transfer was broadcast before the failure/timeout occurred.
    const { rows } = await pool.query<{
      id: string; user_id: string; amount: string; destination: string;
      ton_tx_hash: string | null; hot_wallet_seqno: number | null; updated_at: Date; status: string;
    }>(
      `SELECT id, user_id, amount::text, destination, ton_tx_hash, hot_wallet_seqno, updated_at, status
       FROM transactions
       WHERE type = 'withdrawal'
         AND refunded_at IS NULL
         AND (
           -- Stuck in processing for > 10 min
           (status = 'processing' AND updated_at < NOW() - INTERVAL '${STUCK_THRESHOLD_MINS} minutes')
           OR
           -- Marked failed but seqno exists — transfer was broadcast before the error
           (status = 'failed' AND hot_wallet_seqno IS NOT NULL)
         )`,
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
  ton_tx_hash: string | null; hot_wallet_seqno: number | null; updated_at: Date; status: string;
}): Promise<void> {
  try {
    // If we have a real on-chain hash (not synthetic), mark as confirmed immediately
    if (tx.ton_tx_hash && !tx.ton_tx_hash.startsWith('pending:') && !tx.ton_tx_hash.startsWith('sent:')) {
      await pool.query(
        `UPDATE transactions SET status='confirmed', updated_at=NOW()
         WHERE id=$1 AND status IN ('processing','failed')`,
        [tx.id],
      );
      logger.info(`Withdrawal recovery: confirmed tx=${tx.id} hash=${tx.ton_tx_hash}`);
      return;
    }

    // ALWAYS check on-chain before refunding — the transfer may have landed even without a hash.
    // If HOT_WALLET_ADDRESS is missing, recover from synthetic pending hash format:
    // pending:{hotAddr}:seq{seqno}:{timestamp}
    const pendingParts = tx.ton_tx_hash?.startsWith('pending:') ? tx.ton_tx_hash.split(':') : null;
    const hotWallet = process.env.HOT_WALLET_ADDRESS || (pendingParts?.[1] ?? null);
    if (!hotWallet) {
      logger.error(`Withdrawal recovery: cannot verify on-chain for tx=${tx.id} (missing HOT_WALLET_ADDRESS and no pending hot-wallet hint); skipping refund`);
      return;
    }

    const seqnoFromPending = extractSeqnoFromPendingHash(tx.ton_tx_hash);
    const onChain = await checkOnChain(hotWallet, tx.destination, tx.amount, {
      seqno: tx.hot_wallet_seqno ?? seqnoFromPending,
      withdrawalId: tx.id,
      updatedAt: tx.updated_at,
    });
    if (!onChain.queried) {
      logger.warn(`Withdrawal recovery: TON API unavailable for tx=${tx.id}; skipping auto-refund this run`);
      return;
    }
    if (onChain.hash) {
      await pool.query(
        `UPDATE transactions SET status='confirmed', ton_tx_hash=$1, updated_at=NOW()
         WHERE id=$2 AND status IN ('processing','failed')`,
        [onChain.hash, tx.id],
      );
      logger.info(`Withdrawal recovery: found on-chain tx=${tx.id} hash=${onChain.hash} (was ${tx.status})`);
      return;
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

    // SECURITY: Never auto-refund from this job.
    // Automatic credits can be abused if chain verification is delayed/ambiguous.
    // Leave funds deducted and mark for manual admin review.
    await pool.query(
      `UPDATE transactions
       SET admin_note = COALESCE(admin_note, 'Stuck withdrawal: manual review required (auto-refund disabled)'),
           updated_at = NOW()
       WHERE id=$1 AND status='processing'`,
      [tx.id],
    );
    logger.error(
      `Withdrawal recovery: tx=${tx.id} remains processing with no confirmed on-chain match; manual review required (auto-refund disabled)`,
    );
    return;

  } catch (err) {
    logger.error(`Withdrawal recovery failed for tx=${tx.id}: ${(err as Error).message}`);
  }
}

function extractSeqnoFromPendingHash(hash: string | null): number | undefined {
  if (!hash?.startsWith('pending:')) return undefined;
  const parts = hash.split(':');
  const seqPart = parts.find(p => p.startsWith('seq'));
  if (!seqPart) return undefined;
  const n = Number(seqPart.replace('seq', ''));
  return Number.isFinite(n) ? n : undefined;
}

function extractCommentText(msg: Record<string, unknown>): string {
  const direct = String(msg.message ?? msg.comment ?? msg.body ?? '').trim();
  if (direct) return direct;
  const msgData = msg.msg_data as Record<string, unknown> | undefined;
  return String(msgData?.text ?? msgData?.comment ?? '').trim();
}

function extractTxSeqno(item: Record<string, unknown>): number | undefined {
  const direct = Number(item.seqno ?? item.account_seqno);
  if (Number.isFinite(direct)) return direct;
  const desc = item.description as Record<string, unknown> | undefined;
  const fromDesc = Number(desc?.seqno ?? desc?.account_seqno);
  return Number.isFinite(fromDesc) ? fromDesc : undefined;
}

async function checkOnChain(
  hotWallet:   string,
  destination: string,
  amount:      string,
  options: { seqno?: number; withdrawalId: string; updatedAt: Date },
): Promise<{ hash: string | null; queried: boolean }> {
  try {
    const network = process.env.TON_NETWORK || 'testnet';
    const apiKey  = process.env.TON_API_KEY;
    const base    = network === 'mainnet'
      ? 'https://toncenter.com/api/v2'
      : 'https://testnet.toncenter.com/api/v2';

    const expectedNano = Math.round(parseFloat(amount) * 1e9);

    // Fetch up to 20 pages of 100 txs (2000 total) to cover high-volume wallets.
    // Stop early if we find a match.
    let lastLt: string | undefined;
    const updatedAtMs = new Date(options.updatedAt).getTime();
    const timeWindowMs = 2 * 60 * 60 * 1000; // tight fallback: +/- 2h around tx update time
    const withdrawalRef = `wd:${options.withdrawalId}`;
    const encodedHotWallet = encodeURIComponent(hotWallet);
    for (let page = 0; page < 20; page++) {
      const ltParam = lastLt ? `&to_lt=${lastLt}` : '';
      const url = `${base}/getTransactions?address=${encodedHotWallet}&limit=100${ltParam}${apiKey ? `&api_key=${apiKey}` : ''}`;
      const res  = await fetch(url);
      if (!res.ok) {
        let bodySnippet = '';
        try {
          bodySnippet = (await res.text()).slice(0, 200);
        } catch {
          bodySnippet = '';
        }
        logger.warn(
          `Withdrawal recovery TON API non-OK: status=${res.status} network=${network} page=${page + 1} ` +
          `wallet=${hotWallet} url=${url.split('&api_key=')[0]} body=${bodySnippet || '<empty>'}`,
        );
        return { hash: null, queried: false };
      }

      const data = await res.json() as { ok: boolean; result: Array<Record<string, unknown>> };
      if (!data.ok || !data.result.length) break;

      for (const item of data.result) {
        const txRecord = item as Record<string, unknown>;
        const txId    = txRecord.transaction_id as Record<string, unknown> | undefined;
        const txHash  = String(txId?.hash ?? txRecord.hash ?? '');
        const txSeqno = extractTxSeqno(txRecord);
        const txTimestamp = Number(txRecord.utime ?? 0) * 1000;
        const outMsgs = (txRecord.out_msgs as Array<Record<string, unknown>>) ?? [];

        for (const msg of outMsgs) {
          const dest  = String(msg.destination || '');
          const value = Number(msg.value || 0);
          const comment = extractCommentText(msg);
          const amountMatch =
            dest.toLowerCase() === destination.toLowerCase() &&
            Math.abs(value - expectedNano) < 10_000;

          // Best: deterministic withdrawal reference embedded in outbound comment/body.
          if (comment && comment.includes(withdrawalRef)) {
            return { hash: txHash, queried: true };
          }

          // Next best: seqno + destination + amount.
          if (options.seqno !== undefined && txSeqno === options.seqno && amountMatch) {
            return { hash: txHash, queried: true };
          }

          // Last resort: destination + amount + tight time window.
          if (amountMatch && txTimestamp > 0 && Math.abs(txTimestamp - updatedAtMs) <= timeWindowMs) {
            return { hash: txHash, queried: true };
          }
        }
      }

      // Advance cursor for next page using the lt of the last item
      const last = data.result[data.result.length - 1];
      const lastTxId = last?.transaction_id as Record<string, unknown> | undefined;
      lastLt = String(lastTxId?.lt ?? '');
      if (!lastLt) break;
    }

    return { hash: null, queried: true };
  } catch {
    return { hash: null, queried: false };
  }
}
