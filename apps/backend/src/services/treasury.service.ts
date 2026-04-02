import { logger } from '../utils/logger.js';

/**
 * TreasuryService — hot/cold wallet architecture (PRD §3)
 * Hot wallet: receives deposits, signs withdrawals
 * Cold wallet: long-term storage, auto-refills hot wallet when
 *              balance falls below 50% of total virtual obligations
 */
export class TreasuryService {

  static getHotWalletAddress(): string {
    const addr = process.env.HOT_WALLET_ADDRESS;
    if (!addr) throw new Error('HOT_WALLET_ADDRESS not configured');
    return addr;
  }

  /**
   * Return deposit target for a user.
   * PRD §4: All users send to the hot wallet address.
   * The memo (user_id) is how the poller attributes each deposit.
   */
  static getDepositTarget(userId: string): { address: string; memo: string } {
    return {
      address: TreasuryService.getHotWalletAddress(),
      memo: userId,
    };
  }

  /**
   * Sign and broadcast a TON withdrawal from the hot wallet.
   * Stub — fully implemented in Phase 8 with @ton/ton SDK.
   */
  static async sendWithdrawal(
    _destinationAddress: string,
    _amount: string,
    _userId: string,
  ): Promise<{ txHash: string }> {
    throw new Error('Withdrawal signing implemented in Phase 8');
  }

  /**
   * PRD §3: Refill hot wallet from cold when hot < 50% of total obligations.
   * Stub — wired in Phase 8.
   */
  static async checkRefillNeeded(totalObligations: number): Promise<boolean> {
    logger.debug(`Treasury refill check: obligations=${totalObligations} TON`);
    return false;
  }
}
