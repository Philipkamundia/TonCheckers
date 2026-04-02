/**
 * requireAdmin.ts — Admin authentication middleware (PRD §15)
 *
 * Admin identity is verified cryptographically:
 * - User must connect the treasury wallet
 * - Sign a challenge string
 * - If connected wallet === TREASURY_WALLET_ADDRESS → admin mode unlocked
 * - No other authentication method exists (PRD §15)
 *
 * Request must include:
 *   Authorization: Bearer <jwt>           (regular user JWT)
 *   X-Admin-Wallet:    <wallet-address>   (must match treasury wallet)
 *   X-Admin-Signature: <ed25519-sig>      (signs challenge)
 *   X-Admin-Challenge: <challenge-string> (sent to frontend via admin bot)
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AppError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

const TREASURY_WALLET = process.env.TREASURY_WALLET_ADDRESS?.toLowerCase();

export async function requireAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!TREASURY_WALLET) {
    logger.error('TREASURY_WALLET_ADDRESS not configured — admin access blocked');
    return next(new AppError(503, 'Admin access not configured', 'ADMIN_NOT_CONFIGURED'));
  }

  const adminWallet    = req.headers['x-admin-wallet']    as string | undefined;
  const adminSig       = req.headers['x-admin-signature'] as string | undefined;
  const adminChallenge = req.headers['x-admin-challenge'] as string | undefined;

  // 1. Wallet address must be present and match treasury wallet
  if (!adminWallet) {
    return next(new AppError(403, 'Admin wallet header required', 'FORBIDDEN'));
  }

  if (adminWallet.toLowerCase() !== TREASURY_WALLET) {
    logger.warn(`Admin access attempt with wrong wallet: ${adminWallet}`);
    return next(new AppError(403, 'Not authorised — treasury wallet required', 'FORBIDDEN'));
  }

  // 2. Signature and challenge must be present
  if (!adminSig || !adminChallenge) {
    return next(new AppError(403, 'Admin signature and challenge required', 'FORBIDDEN'));
  }

  // 3. Verify challenge is recent (max 5 minutes old)
  // Challenge format: "checkton-admin:{timestamp}"
  const parts     = adminChallenge.split(':');
  const timestamp = parseInt(parts[1] ?? '0', 10);
  const age       = Math.floor(Date.now() / 1000) - timestamp;

  if (age > 300) {
    return next(new AppError(403, 'Admin challenge expired — request a new one', 'CHALLENGE_EXPIRED'));
  }

  // 4. Verify Ed25519 signature of the challenge against wallet public key
  //    Requires stateInit to extract the public key — same pattern as TonConnect proof.
  //    The frontend must send X-Admin-State-Init alongside the signature.
  const stateInitHeader = req.headers['x-admin-state-init'] as string | undefined;
  if (!stateInitHeader) {
    return next(new AppError(403, 'Admin stateInit header required', 'FORBIDDEN'));
  }

  try {
    const stateInitBuf = Buffer.from(stateInitHeader, 'base64');
    if (stateInitBuf.length < 32) {
      return next(new AppError(403, 'Invalid stateInit', 'FORBIDDEN'));
    }
    const pubKey = stateInitBuf.slice(-32);

    const sigBuf = Buffer.from(adminSig, 'base64');
    if (sigBuf.length !== 64) {
      return next(new AppError(403, 'Invalid signature format', 'FORBIDDEN'));
    }

    const { signVerify } = await import('@ton/crypto');
    const challengeHash = crypto.createHash('sha256').update(adminChallenge).digest();
    const valid = await signVerify(challengeHash, sigBuf, pubKey);
    if (!valid) {
      logger.warn(`Admin signature invalid for wallet=${adminWallet}`);
      return next(new AppError(403, 'Invalid admin signature', 'FORBIDDEN'));
    }
  } catch (err) {
    logger.error('Admin signature verification error:', err);
    return next(new AppError(403, 'Signature verification failed', 'FORBIDDEN'));
  }

  logger.info(`Admin access granted: wallet=${adminWallet}`);
  next();
}

/** Generate a fresh admin challenge string for the frontend */
export function generateAdminChallenge(): string {
  return `checkton-admin:${Math.floor(Date.now() / 1000)}`;
}
