/**
 * requireAdmin.ts — Admin authentication middleware
 *
 * Simple check: connected wallet address must match TREASURY_WALLET_ADDRESS.
 * No signature, no challenge — you own the wallet, that's enough.
 */
import { Request, Response, NextFunction } from 'express';
import { Address } from '@ton/core';
import { AppError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

function normalizeAddress(addr: string): string {
  try {
    return Address.parse(addr).toRawString().toLowerCase();
  } catch {
    return addr.toLowerCase();
  }
}

const TREASURY_WALLET = process.env.TREASURY_WALLET_ADDRESS
  ? normalizeAddress(process.env.TREASURY_WALLET_ADDRESS)
  : undefined;

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!TREASURY_WALLET) {
    logger.error('TREASURY_WALLET_ADDRESS not configured — admin access blocked');
    return next(new AppError(503, 'Admin access not configured', 'ADMIN_NOT_CONFIGURED'));
  }

  const adminWallet  = req.headers['x-admin-wallet']   as string | undefined;
  const adminPasscode = req.headers['x-admin-passcode'] as string | undefined;

  if (!adminWallet) {
    return next(new AppError(403, 'Admin wallet header required', 'FORBIDDEN'));
  }

  if (normalizeAddress(adminWallet) !== TREASURY_WALLET) {
    logger.warn(`Admin access denied for wallet: ${adminWallet}`);
    return next(new AppError(403, 'Not authorised — treasury wallet required', 'FORBIDDEN'));
  }

  // Passcode check — required, not optional
  const expectedPasscode = process.env.ADMIN_PASSCODE;
  if (!expectedPasscode) {
    logger.error('ADMIN_PASSCODE not configured — admin access blocked');
    return next(new AppError(503, 'Admin access not configured', 'ADMIN_NOT_CONFIGURED'));
  }

  if (!adminPasscode || adminPasscode !== expectedPasscode) {
    logger.warn(`Admin passcode incorrect for wallet: ${adminWallet}`);
    return next(new AppError(403, 'Invalid admin passcode', 'FORBIDDEN'));
  }

  logger.info(`Admin access granted: wallet=${adminWallet}`);
  next();
}

/** Still exported for any existing imports — no longer used for challenge flow */
export function generateAdminChallenge(): string {
  return `checkton-admin:${Math.floor(Date.now() / 1000)}`;
}
