import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { ConnectWalletSchema, VerifyInitDataSchema, RefreshTokenSchema } from '../validation/auth.js';
import { AppError } from '../middleware/errorHandler.js';

export const authController = {

  /**
   * POST /api/auth/connect
   * First-time wallet connection — verifies TonConnect proof + initData.
   * Creates new user if wallet is new, returns JWT pair.
   */
  async connect(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = ConnectWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new AppError(400, parsed.error.errors[0].message, 'VALIDATION_ERROR'));
      }

      const { walletAddress, proof, initData } = parsed.data;
      const { user, tokens, isNew } = await AuthService.connect(walletAddress, proof, initData);

      return res.status(isNew ? 201 : 200).json({
        ok: true,
        isNew,
        user,
        ...tokens,
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * POST /api/auth/verify
   * Re-authenticate on app resume using initData (no proof required).
   * Returns fresh JWT pair for existing users.
   */
  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = VerifyInitDataSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new AppError(400, parsed.error.errors[0].message, 'VALIDATION_ERROR'));
      }

      const { walletAddress, initData } = parsed.data;
      const { user, tokens, isNew } = await AuthService.verify(walletAddress, initData);

      return res.status(isNew ? 201 : 200).json({ ok: true, isNew, user, ...tokens });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * POST /api/auth/refresh
   * Issue new access token from a valid refresh token.
   */
  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = RefreshTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new AppError(400, parsed.error.errors[0].message, 'VALIDATION_ERROR'));
      }

      const result = await AuthService.refresh(parsed.data.refreshToken);
      return res.json({ ok: true, ...result });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * GET /api/auth/me
   * Returns the authenticated user's profile.
   * Protected by requireAuth middleware.
   */
  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await AuthService.findById(req.user!.userId);
      if (!user) {
        return next(new AppError(404, 'User not found', 'USER_NOT_FOUND'));
      }
      return res.json({ ok: true, user });
    } catch (err) {
      return next(err);
    }
  },
};
