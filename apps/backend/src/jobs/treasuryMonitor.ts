/**
 * treasuryMonitor.ts — Hot wallet balance monitoring
 *
 * PRD §3: Hot wallet refill trigger:
 *   When hot wallet balance falls below 50% of total virtual balance obligations,
 *   cold wallet automatically tops up hot wallet.
 *
 * Runs every 5 minutes.
 */

import { TreasuryService } from '../services/treasury.service.js';
import { WalletService } from '../services/wallet.service.js';
import { logger } from '../utils/logger.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1_000;  // 5 minutes

export function startTreasuryMonitor(): ReturnType<typeof setInterval> {
  logger.info('Treasury monitor started — checking every 5 minutes');

  const run = async () => {
    try {
      const obligations    = await WalletService.getTotalObligations();
      const refillNeeded   = await TreasuryService.checkRefillNeeded(obligations);

      if (refillNeeded) {
        logger.warn(`Treasury refill needed: obligations=${obligations.toFixed(2)} TON`);
        // Phase 8 note: actual cold→hot transfer requires treasury wallet keys.
        // In production this triggers an admin alert and/or auto-refill via TON SDK.
        // The checkRefillNeeded() stub will be wired fully when hot wallet monitoring
        // is added in Phase 12 admin dashboard.
      } else {
        logger.debug(`Treasury healthy: obligations=${obligations.toFixed(2)} TON`);
      }
    } catch (err) {
      logger.error(`Treasury monitor error: ${(err as Error).message}`);
    }
  };

  // Run immediately, then every 5 minutes
  run();
  return setInterval(run, CHECK_INTERVAL_MS);
}
