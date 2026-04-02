import { Request, Response, NextFunction } from 'express';
import { WalletService } from '../services/wallet.service.js';
import { AppError } from '../middleware/errorHandler.js';

export const walletController = {

  /** GET /api/balance */
  async getBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const balance = await WalletService.getBalance(req.user!.userId);
      return res.json({ ok: true, balance });
    } catch (err) { return next(err); }
  },

  /** GET /api/balance/history?page=1&limit=20 */
  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const page  = Math.max(1, parseInt(String(req.query.page  || '1'),  10));
      const limit = Math.min(50, parseInt(String(req.query.limit || '20'), 10));
      const result = await WalletService.getHistory(req.user!.userId, page, limit);
      return res.json({ ok: true, ...result });
    } catch (err) { return next(err); }
  },

  /** POST /api/balance/deposit/init */
  async initDeposit(req: Request, res: Response, next: NextFunction) {
    try {
      const deposit = WalletService.initDeposit(req.user!.userId);
      return res.json({
        ok: true,
        ...deposit,
        instructions: `Send at least ${deposit.minimumAmount} TON to the address below. Include the memo exactly as shown so your deposit is attributed correctly.`,
      });
    } catch (err) { return next(err); }
  },
};
