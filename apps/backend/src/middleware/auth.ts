import { Request, Response, NextFunction } from 'express';
import { AuthService, AuthPayload } from '../services/auth.service.js';
import { AppError } from './errorHandler.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * requireAuth — validates Bearer JWT on every protected route.
 * Attaches req.user = { userId, walletAddress } on success.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Missing authorization header', 'UNAUTHORIZED'));
  }

  try {
    const token = authHeader.slice(7);
    req.user = AuthService.verifyAccessToken(token);
    return next();
  } catch (err) {
    return next(err);
  }
}
