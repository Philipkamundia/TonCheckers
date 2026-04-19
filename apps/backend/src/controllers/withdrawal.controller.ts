import { Request, Response, NextFunction } from 'express';
import { WithdrawalService } from '../services/withdrawal.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { z } from 'zod';

const WithdrawSchema = z.object({
  amount:      z.string().regex(/^\d+(\.\d{1,9})?$/, 'Invalid amount'),
  destination: z.string().min(10).max(100),
});

export const withdrawalController = {

  /** POST /api/balance/withdraw */
  async requestWithdrawal(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = WithdrawSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new AppError(400, parsed.error?.errors?.[0]?.message ?? 'Validation error', 'VALIDATION_ERROR'));
      }

      const { amount, destination } = parsed.data;
      const result = await WithdrawalService.requestWithdrawal(
        req.user!.userId, amount, destination,
      );

      return res.json({
        ok:             true,
        transactionId:  result.transactionId,
        amount:         result.amount,
        destination:    result.walletAddress,
        requiresReview: result.requiresReview,
        message:        result.requiresReview
          ? 'Withdrawal queued for admin review (above 100 TON limit)'
          : 'Withdrawal processing — funds will arrive shortly',
      });
    } catch (err) { return next(err); }
  },
};
