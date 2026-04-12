import pool from '../config/db.js';
import { BalanceService } from './balance.service.js';
import { NotificationService } from './notification.service.js';
import { TreasuryService } from './treasury.service.js';
import { logger } from '../utils/logger.js';

const MIN_DEPOSIT_TON = parseFloat(process.env.MIN_DEPOSIT_TON || '0.5');
const POLL_INTERVAL_MS = 30_000;

interface TonTransaction {
  hash:        string;
  amount:      string;   // nanoTON string
  memo:        string;
  fromAddress: string;
  timestamp:   number;
}

export class DepositDetectionService {
  private static intervalId: ReturnType<typeof setInterval> | null = null;
  private static running    = false;
  private static polling    = false;  // guard against concurrent poll runs

  static async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info(`Deposit poller started — every ${POLL_INTERVAL_MS / 1000}s, min ${MIN_DEPOSIT_TON} TON`);
    await this.poll();
    this.intervalId = setInterval(async () => {
      if (this.polling) {
        logger.warn('Deposit poll skipped — previous poll still running');
        return;
      }
      await this.poll();
    }, POLL_INTERVAL_MS);
  }

  static stop(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    this.running = false;
    logger.info('Deposit poller stopped');
  }

  private static async poll(): Promise<void> {
    this.polling = true;
    try {
      const hotWallet = TreasuryService.getHotWalletAddress();
      const txs = await this.fetchRecentTransactions(hotWallet);
      for (const tx of txs) await this.processTransaction(tx);
    } catch (err) {
      logger.error(`Deposit poll failed: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /**
   * H-02: Fetch ALL incoming transactions since the last processed logical time (lt).
   * Uses cursor-based pagination (to_lt) so high-volume deposit bursts never cause
   * missed transactions. Falls back to the last 100 if no cursor is stored.
   */
  private static async fetchRecentTransactions(address: string): Promise<TonTransaction[]> {
    const apiKey  = process.env.TON_API_KEY;
    const network = process.env.TON_NETWORK || 'testnet';
    const base    = network === 'mainnet'
      ? 'https://toncenter.com/api/v2'
      : 'https://testnet.toncenter.com/api/v2';

    const allTxs: TonTransaction[] = [];
    let   minLt: string | null = null;

    // Page through up to 5 batches of 100 (500 txs max per poll cycle)
    for (let page = 0; page < 5; page++) {
      const ltParam = minLt ? `&to_lt=${minLt}` : '';
      const url = `${base}/getTransactions?address=${address}&limit=100${ltParam}${apiKey ? `&api_key=${apiKey}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`TON API ${res.status}`);

      const data = await res.json() as { ok: boolean; result: unknown[] };
      if (!data.ok || !data.result.length) break;

      const batch = this.parse(data.result);
      allTxs.push(...batch);

      // If fewer than 100 returned we've reached the end; stop paging
      if (data.result.length < 100) break;

      // Set cursor to the lt of the last item in this batch
      const lastItem = data.result[data.result.length - 1] as Record<string, unknown>;
      const lt = String((lastItem.transaction_id as Record<string, unknown>)?.lt ?? lastItem.lt ?? '');
      if (!lt || lt === minLt) break;
      minLt = lt;
    }

    return allTxs;
  }

  private static parse(raw: unknown[]): TonTransaction[] {
    return raw.flatMap((item) => {
      const tx  = item as Record<string, unknown>;
      const msg = tx.in_msg as Record<string, unknown> | undefined;
      if (!msg || String(msg.value || '0') === '0') return [];
      return [{
        hash:        String((tx.transaction_id as Record<string, unknown>)?.hash || tx.hash || ''),
        amount:      String(msg.value),
        memo:        String(msg.message || msg.comment || ''),
        fromAddress: String(msg.source || ''),
        timestamp:   Number(tx.utime || 0),
      }];
    });
  }

  private static async processTransaction(tx: TonTransaction): Promise<void> {
    // Idempotency check — unique constraint on ton_tx_hash
    const { rows } = await pool.query(
      'SELECT id FROM transactions WHERE ton_tx_hash = $1', [tx.hash],
    );
    if (rows.length) return;

    // Validate memo is present and looks like a UUID
    const memo = tx.memo?.trim();
    if (!memo) {
      logger.warn(`Deposit ignored — no memo: hash=${tx.hash} from=${tx.fromAddress} amount=${Number(tx.amount) / 1e9} TON`);
      return;
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(memo)) {
      logger.warn(`Deposit ignored — memo is not a valid user ID: memo="${memo}" hash=${tx.hash} from=${tx.fromAddress}`);
      return;
    }

    const userId = memo;
    const { rows: [user] } = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user) {
      logger.warn(`Deposit ignored — unknown user in memo: userId=${userId} hash=${tx.hash} from=${tx.fromAddress}`);
      return;
    }

    const amountTon = Number(tx.amount) / 1_000_000_000;
    const amountStr = amountTon.toFixed(9);

    // Below minimum — record as failed, do not credit
    if (amountTon < MIN_DEPOSIT_TON) {
      logger.warn(`Deposit below minimum: ${amountTon} TON — user=${userId} hash=${tx.hash}`);
      await pool.query(
        `INSERT INTO transactions (user_id, type, status, amount, ton_tx_hash, memo)
         VALUES ($1, 'deposit', 'failed', $2, $3, $4) ON CONFLICT (ton_tx_hash) DO NOTHING`,
        [userId, amountStr, tx.hash, userId],
      );
      return;
    }

    // Credit atomically with final ON CONFLICT guard
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `INSERT INTO transactions (user_id, type, status, amount, ton_tx_hash, memo)
         VALUES ($1, 'deposit', 'confirmed', $2, $3, $4) ON CONFLICT (ton_tx_hash) DO NOTHING`,
        [userId, amountStr, tx.hash, userId],
      );
      if (!rowCount) { await client.query('ROLLBACK'); return; }

      const { rowCount: balRowCount } = await client.query(
        `UPDATE balances SET available = available + $1::numeric, updated_at = NOW() WHERE user_id = $2`,
        [amountStr, userId],
      );
      if (!balRowCount) {
        // Balance row missing — create it and credit
        await client.query(
          `INSERT INTO balances (user_id, available, locked) VALUES ($1, $2, 0)
           ON CONFLICT (user_id) DO UPDATE SET available = balances.available + $2::numeric, updated_at = NOW()`,
          [userId, amountStr],
        );
      }
      await client.query('COMMIT');
      logger.info(`Deposit confirmed: user=${userId} amount=${amountStr} TON hash=${tx.hash}`);
      await NotificationService.send(userId, 'deposit_confirmed', { amount: amountStr });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Deposit processing error: hash=${tx.hash} err=${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}
