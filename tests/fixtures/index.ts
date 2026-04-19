/**
 * fixtures/index.ts — Reusable test data factories
 *
 * These produce plain objects (not DB-persisted) that can be passed into
 * service functions, used as mock return values, or stored via test helpers.
 */

import crypto from 'crypto';
import type { QueueEntry } from '../../apps/backend/src/services/matchmaking.service.js';
import type { Balance }    from '../../apps/backend/src/services/balance.service.js';
import type { GameState }  from '../../apps/backend/src/engine/board.js';
import { initialGameState } from '../../apps/backend/src/engine/board.js';

// ─── Users ────────────────────────────────────────────────────────────────────

export function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id:           overrides.id           ?? crypto.randomUUID(),
    walletAddress: overrides.walletAddress ?? `EQD${crypto.randomBytes(32).toString('hex').slice(0,32)}`,
    username:     overrides.username     ?? `TestUser_${Math.floor(Math.random() * 9999)}`,
    elo:          overrides.elo          ?? 1200,
    gamesPlayed:  overrides.gamesPlayed  ?? 0,
    gamesWon:     overrides.gamesWon     ?? 0,
    gamesLost:    overrides.gamesLost    ?? 0,
    gamesDrawn:   overrides.gamesDrawn   ?? 0,
    totalWon:     overrides.totalWon     ?? '0',
    isBanned:     overrides.isBanned     ?? false,
    telegramId:   overrides.telegramId   ?? undefined,
    createdAt:    overrides.createdAt    ?? new Date().toISOString(),
  };
}

export interface UserRow {
  id:            string;
  walletAddress: string;
  username:      string;
  elo:           number;
  gamesPlayed:   number;
  gamesWon:      number;
  gamesLost:     number;
  gamesDrawn:    number;
  totalWon:      string;
  isBanned:      boolean;
  telegramId?:   string;
  createdAt:     string;
}

// ─── Balances ─────────────────────────────────────────────────────────────────

export function makeBalance(overrides: Partial<Balance> = {}): Balance {
  return {
    available: overrides.available ?? '10.000000000',
    locked:    overrides.locked    ?? '0.000000000',
    total:     overrides.total     ?? '10.000000000',
  };
}

// ─── Queue entries ────────────────────────────────────────────────────────────

export function makeQueueEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    userId:   overrides.userId   ?? crypto.randomUUID(),
    elo:      overrides.elo      ?? 1200,
    stake:    overrides.stake    ?? '1.000000000',
    joinedAt: overrides.joinedAt ?? Date.now(),
  };
}

// ─── Game rows ────────────────────────────────────────────────────────────────

export function makeGame(overrides: Partial<GameRow> = {}): GameRow {
  const p1 = overrides.player1Id ?? crypto.randomUUID();
  const p2 = overrides.player2Id ?? crypto.randomUUID();
  return {
    id:         overrides.id         ?? crypto.randomUUID(),
    player1Id:  p1,
    player2Id:  p2,
    stake:      overrides.stake      ?? '1.000000000',
    status:     overrides.status     ?? 'active',
    result:     overrides.result     ?? null,
    winnerId:   overrides.winnerId   ?? null,
    platformFee:overrides.platformFee ?? null,
    winnerPayout:overrides.winnerPayout ?? null,
    createdAt:  overrides.createdAt  ?? new Date().toISOString(),
    endedAt:    overrides.endedAt    ?? null,
  };
}

export interface GameRow {
  id:           string;
  player1Id:    string;
  player2Id:    string;
  stake:        string;
  status:       'waiting' | 'active' | 'completed' | 'cancelled';
  result:       string | null;
  winnerId:     string | null;
  platformFee:  string | null;
  winnerPayout: string | null;
  createdAt:    string;
  endedAt:      string | null;
}

// ─── Game state ───────────────────────────────────────────────────────────────

export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return { ...initialGameState(), ...overrides };
}

// ─── Telegram initData ────────────────────────────────────────────────────────

/**
 * Generates a valid signed Telegram initData string using the test bot token.
 * Use in tests for auth service validation.
 */
export function makeTelegramInitData(
  userId = '123456789',
  botToken = process.env.TELEGRAM_BOT_TOKEN!,
  ageOffsetSecs = 0,
): string {
  const authDate = Math.floor(Date.now() / 1000) - ageOffsetSecs;
  const user = JSON.stringify({ id: parseInt(userId), first_name: 'Test', username: 'testuser' });

  const pairs: Array<[string, string]> = [
    ['auth_date', String(authDate)],
    ['user', user],
    ['query_id', 'test_query_id'],
  ];

  // Sort and build data_check_string
  const sorted = [...pairs].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join('\n');

  // Compute hash using the Telegram spec
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Build query string (all pairs + hash)
  const allPairs = [...pairs, ['hash', hash]];
  return allPairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

// ─── JWT tokens ───────────────────────────────────────────────────────────────

import jwt from 'jsonwebtoken';

export function makeAccessToken(userId: string, walletAddress: string): string {
  return jwt.sign(
    { userId, walletAddress },
    process.env.JWT_SECRET!,
    { expiresIn: 86400 },
  );
}

export function makeExpiredToken(userId: string, walletAddress: string): string {
  return jwt.sign(
    { userId, walletAddress },
    process.env.JWT_SECRET!,
    { expiresIn: -1 }, // already expired
  );
}
