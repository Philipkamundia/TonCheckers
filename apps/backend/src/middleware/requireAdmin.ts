/**
 * requireAdmin.ts — Admin authentication middleware
 *
 * Requires:
 *  1. requireAuth() — valid user JWT (enforced at route level)
 *  2. x-admin-wallet header matching the treasury wallet address
 *  3. x-admin-passcode header compared via timing-safe equality (prevents
 *     timing-attack enumeration of the passcode value)
 */
import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
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

  const adminWallet   = req.headers['x-admin-wallet']   as string | undefined;
  const adminPasscode = req.headers['x-admin-passcode'] as string | undefined;

  if (!adminWallet) {
    return next(new AppError(403, 'Admin wallet header required', 'FORBIDDEN'));
  }

  if (normalizeAddress(adminWallet) !== TREASURY_WALLET) {
    logger.warn(`Admin access denied for wallet: ${adminWallet}`);
    return next(new AppError(403, 'Not authorised — treasury wallet required', 'FORBIDDEN'));
  }

  const expectedPasscode = process.env.ADMIN_PASSCODE;
  if (!expectedPasscode) {
    logger.error('ADMIN_PASSCODE not configured — admin access blocked');
    return next(new AppError(503, 'Admin access not configured', 'ADMIN_NOT_CONFIGURED'));
  }

  if (!adminPasscode) {
    return next(new AppError(403, 'Admin passcode header required', 'FORBIDDEN'));
  }

  // Timing-safe comparison prevents timing-attack enumeration of the passcode
  let match = false;
  try {
    const a = Buffer.from(adminPasscode,    'utf8');
    const b = Buffer.from(expectedPasscode, 'utf8');
    match = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    match = false;
  }

  if (!match) {
    logger.warn(`Admin passcode incorrect for wallet: ${adminWallet}`);
    return next(new AppError(403, 'Invalid admin passcode', 'FORBIDDEN'));
  }

  logger.info(`Admin access granted: wallet=${adminWallet}`);
  next();
}

/** Still exported for any existing imports */
export function generateAdminChallenge(): string {
  return `checkton-admin:${Math.floor(Date.now() / 1000)}`;
}
