import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Address } from '@ton/core';
import pool from '../config/db.js';
import { generateUniqueUsername } from '../utils/usernameGenerator.js';
import { validateInitData } from '../utils/validateInitData.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import type { ConnectWalletInput } from '../validation/auth.js';

export interface AuthPayload {
  userId:        string;
  walletAddress: string;
}

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
}

export interface UserProfile {
  id:            string;
  walletAddress: string;
  username:      string;
  elo:           number;
  gamesPlayed:   number;
  gamesWon:      number;
  gamesLost:     number;
  gamesDrawn:    number;
  totalWon:      string;
  createdAt:     string;
}

export class AuthService {

  // ─── Token helpers ────────────────────────────────────────────────────────

  static issueTokens(userId: string, walletAddress: string): AuthTokens {
    const payload: AuthPayload = { userId, walletAddress };
    const expiresIn = 60 * 60 * 24; // 24h in seconds

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn });
    const refreshToken = jwt.sign(
      { userId, walletAddress, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: '7d' },
    );

    return { accessToken, refreshToken, expiresIn };
  }

  static verifyAccessToken(token: string): AuthPayload {
    try {
      return jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    } catch {
      throw new AppError(401, 'Invalid or expired token', 'TOKEN_INVALID');
    }
  }

  static verifyRefreshToken(token: string): AuthPayload {
    try {
      const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as AuthPayload & { type: string };
      if (payload.type !== 'refresh') throw new AppError(401, 'Not a refresh token', 'TOKEN_INVALID');
      return { userId: payload.userId, walletAddress: payload.walletAddress };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(401, 'Invalid or expired refresh token', 'TOKEN_INVALID');
    }
  }

  // ─── TonConnect proof verification ───────────────────────────────────────

  /**
   * Verifies TonConnect proof signature per TonConnect v2 spec.
   * Performs full Ed25519 signature verification using the wallet's public key
   * extracted from the stateInit provided by TonConnect.
   *
   * Message structure:
   *   sha256( 0xff 0x00 || sha256("ton-connect") || sha256(message) )
   * where message = "ton-proof-item-v2/" || addr_wc || addr_hash || domain_len || domain || ts || payload
   */
  static async verifyTonConnectProof(
    walletAddress: string,
    proof: ConnectWalletInput['proof'],
  ): Promise<boolean> {
    // Must not be older than 5 minutes
    const age = Math.floor(Date.now() / 1000) - proof.timestamp;
    if (age > 300) {
      logger.warn(`TonConnect proof expired: ${age}s old for ${walletAddress}`);
      return false;
    }

    if (process.env.NODE_ENV === 'development') {
      logger.warn('DEV MODE: Skipping TonConnect signature verification');
      return true;
    }

    try {
      // Parse wallet address to get workchain + hash
      const addr = Address.parse(walletAddress);

      // Encode workchain as int32 BE and address hash (32 bytes)
      const wcBuf = Buffer.allocUnsafe(4);
      wcBuf.writeInt32BE(addr.workChain);
      const addrHashBuf = Buffer.from(addr.hash);

      // Domain
      const domainBuf = Buffer.from(proof.domain.value);
      const domainLen = Buffer.allocUnsafe(4);
      domainLen.writeUInt32LE(domainBuf.length);

      // Timestamp as LE uint64
      const tsBuf = Buffer.allocUnsafe(8);
      tsBuf.writeBigUInt64LE(BigInt(proof.timestamp));

      // Inner message hash
      const message = Buffer.concat([
        Buffer.from('ton-proof-item-v2/'),
        wcBuf,
        addrHashBuf,
        domainLen,
        domainBuf,
        tsBuf,
        Buffer.from(proof.payload),
      ]);
      const msgHash = crypto.createHash('sha256').update(message).digest();

      // Final signed payload
      const finalMsg = Buffer.concat([
        Buffer.from([0xff, 0x00]),
        crypto.createHash('sha256').update('ton-connect').digest(),
        msgHash,
      ]);
      const finalHash = crypto.createHash('sha256').update(finalMsg).digest();

      // Decode signature
      const sigBuf = Buffer.from(proof.signature, 'base64');
      if (sigBuf.length !== 64) {
        logger.warn(`Invalid signature length ${sigBuf.length} for ${walletAddress}`);
        return false;
      }

      // Extract public key from stateInit
      if (!proof.stateInit) {
        logger.warn(`Missing stateInit for ${walletAddress}`);
        return false;
      }
      const stateInitBuf = Buffer.from(proof.stateInit, 'base64');
      // Public key is the last 32 bytes of the stateInit data cell for standard wallet contracts
      if (stateInitBuf.length < 32) {
        logger.warn(`stateInit too short for ${walletAddress}`);
        return false;
      }
      const pubKey = stateInitBuf.slice(-32);

      const { signVerify } = await import('@ton/crypto');
      const valid = await signVerify(finalHash, sigBuf, pubKey);
      if (!valid) {
        logger.warn(`TonConnect signature invalid for ${walletAddress}`);
        return false;
      }

      logger.info(`TonConnect proof verified for ${walletAddress}`);
      return true;
    } catch (err) {
      logger.error('TonConnect proof error:', err);
      return false;
    }
  }

  // ─── User lookup / creation ───────────────────────────────────────────────

  static async findByWallet(walletAddress: string): Promise<UserProfile | null> {
    const { rows } = await pool.query(
      `SELECT id, wallet_address AS "walletAddress", username, elo,
              games_played  AS "gamesPlayed",  games_won  AS "gamesWon",
              games_lost    AS "gamesLost",    games_drawn AS "gamesDrawn",
              total_won::text AS "totalWon",   created_at  AS "createdAt"
       FROM users WHERE wallet_address = $1`,
      [walletAddress],
    );
    return (rows[0] as UserProfile) ?? null;
  }

  static async findById(userId: string): Promise<UserProfile | null> {
    const { rows } = await pool.query(
      `SELECT id, wallet_address AS "walletAddress", username, elo,
              games_played  AS "gamesPlayed",  games_won  AS "gamesWon",
              games_lost    AS "gamesLost",    games_drawn AS "gamesDrawn",
              total_won::text AS "totalWon",   created_at  AS "createdAt"
       FROM users WHERE id = $1`,
      [userId],
    );
    return (rows[0] as UserProfile) ?? null;
  }

  static async createUser(walletAddress: string, telegramId?: string): Promise<UserProfile> {
    const username = await generateUniqueUsername(async (candidate) => {
      const { rows } = await pool.query(
        'SELECT 1 FROM users WHERE username = $1', [candidate],
      );
      return rows.length > 0;
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [user] } = await client.query(
        `INSERT INTO users (wallet_address, username, elo, telegram_id)
         VALUES ($1, $2, 1200, $3)
         RETURNING id, wallet_address AS "walletAddress", username, elo,
                   games_played AS "gamesPlayed", games_won AS "gamesWon",
                   games_lost AS "gamesLost", games_drawn AS "gamesDrawn",
                   total_won::text AS "totalWon", created_at AS "createdAt"`,
        [walletAddress, username, telegramId],
      );

      // Create balance row simultaneously
      await client.query(
        'INSERT INTO balances (user_id, available, locked) VALUES ($1, 0, 0)',
        [user.id],
      );

      await client.query('COMMIT');
      logger.info(`New user: ${username} wallet=${walletAddress}`);
      return user as UserProfile;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Main auth flows ──────────────────────────────────────────────────────

  /** POST /auth/connect — verify proof + initData, create or find user, return JWT */
  static async connect(
    walletAddress: string,
    proof: ConnectWalletInput['proof'],
    initDataRaw: string,
  ): Promise<{ user: UserProfile; tokens: AuthTokens; isNew: boolean }> {
    const initResult = validateInitData(initDataRaw);
    if (!initResult.valid) {
      throw new AppError(401, `Invalid initData: ${initResult.error}`, 'INIT_DATA_INVALID');
    }

    const proofValid = await AuthService.verifyTonConnectProof(walletAddress, proof);
    if (!proofValid) {
      throw new AppError(401, 'Invalid TonConnect proof', 'PROOF_INVALID');
    }

    let user = await AuthService.findByWallet(walletAddress);
    const isNew = !user;
    if (!user) user = await AuthService.createUser(walletAddress, initResult.telegramId);

    const tokens = AuthService.issueTokens(user.id, walletAddress);
    return { user, tokens, isNew };
  }

  /** POST /auth/verify — re-auth on app resume (initData only, no proof needed) */
  static async verify(
    walletAddress: string,
    initDataRaw: string,
  ): Promise<{ user: UserProfile; tokens: AuthTokens; isNew: boolean }> {
    const initResult = validateInitData(initDataRaw);
    if (!initResult.valid) {
      throw new AppError(401, `Invalid initData: ${initResult.error}`, 'INIT_DATA_INVALID');
    }

    let user = await AuthService.findByWallet(walletAddress);
    const isNew = !user;
    if (!user) user = await AuthService.createUser(walletAddress, initResult.telegramId);

    const tokens = AuthService.issueTokens(user.id, walletAddress);
    return { user, tokens, isNew };
  }

  /** POST /auth/refresh — new access token from refresh token */
  static async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const payload = AuthService.verifyRefreshToken(refreshToken);

    const user = await AuthService.findById(payload.userId);
    if (!user) throw new AppError(401, 'User no longer exists', 'USER_NOT_FOUND');

    const tokens = AuthService.issueTokens(payload.userId, payload.walletAddress);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }
}
