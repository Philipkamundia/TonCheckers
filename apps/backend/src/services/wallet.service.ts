import pool from '../config/db.js';
import { BalanceService } from './balance.service.js';
import { TreasuryService } from './treasury.service.js';

const MIN_DEPOSIT_TON = parseFloat(process.env.MIN_DEPOSIT_TON || '0.5');

export class WalletService {

  static getBalance(userId: string) {
    return BalanceService.getBalance(userId);
  }

  static getHistory(userId: string, page?: number, limit?: number) {
    return BalanceService.getHistory(userId, page, limit);
  }

  /**
   * POST /balance/deposit/init
   * Returns the hot wallet address + user_id memo.
   * PRD §4: all deposits go to one hot wallet, memo identifies the user.
   */
  static initDeposit(userId: string): { address: string; memo: string; minimumAmount: number } {
    const target = TreasuryService.getDepositTarget(userId);
    return { address: target.address, memo: target.memo, minimumAmount: MIN_DEPOSIT_TON };
  }

  /** Total of all user virtual balances — used for treasury health checks */
  static async getTotalObligations(): Promise<number> {
    const { rows } = await pool.query(
      'SELECT COALESCE(SUM(available + locked), 0)::float AS total FROM balances',
    );
    return rows[0].total;
  }
}
