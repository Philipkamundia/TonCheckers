import { z } from 'zod';

/**
 * Transaction types used throughout the system
 * Database constraint should match these values
 * 
 * Standardized transaction types align with backend usage:
 * - deposit, withdraw (wallet operations)
 * - stake, prize (game operations)
 * - tournament_* (tournament operations)
 * - fee, platform_fee (system operations)
 */
export enum TransactionType {
  // Wallet operations
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  
  // Game operations
  STAKE = 'stake',
  PRIZE = 'prize',
  
  // Tournament operations
  TOURNAMENT_ENTRY = 'tournament_entry',
  TOURNAMENT_PRIZE = 'tournament_prize',
  TOURNAMENT_REFUND = 'tournament_refund',
  TOURNAMENT_CREATOR_FEE = 'tournament_creator_fee',
  TOURNAMENT_PLATFORM_FEE = 'tournament_platform_fee',
  
  // System operations
  FEE = 'fee',
  PLATFORM_FEE = 'platform_fee',
  VIRTUAL_TRANSFER = 'virtual_transfer'
}

// Transaction status
export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

/**
 * Helper to check if transaction is game-related
 */
export function isGameTransaction(type: TransactionType | string): boolean {
  return type === TransactionType.STAKE || type === TransactionType.PRIZE || 
         type === 'stake' || type === 'prize';
}

/**
 * Helper to check if transaction is tournament-related
 */
export function isTournamentTransaction(type: TransactionType | string): boolean {
  const typeStr = typeof type === 'string' ? type : String(type);
  return typeStr.startsWith('tournament_');
}

/**
 * Map old transaction types to new standardized types (for migration)
 */
export const TRANSACTION_TYPE_MIGRATION_MAP: Record<string, string> = {
  'withdrawal': 'withdraw',
  'game_stake': 'stake',
  'game_reward': 'prize',
  'tournament_reward': 'tournament_prize'
}

// Wallet transaction
export const WalletTransactionSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  type: z.nativeEnum(TransactionType),
  status: z.nativeEnum(TransactionStatus),
  amount: z.string(), // TON amount as string
  balanceBefore: z.string(), // TON amount as string
  balanceAfter: z.string(), // TON amount as string
  transactionHash: z.string().optional(), // Blockchain transaction hash
  gameId: z.string().optional(),
  tournamentId: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional()
});

export type WalletTransaction = z.infer<typeof WalletTransactionSchema>;

// Deposit request
export const DepositRequestSchema = z.object({
  amount: z.string(), // TON amount as string
  fromAddress: z.string(),
  memo: z.string().optional()
});

export type DepositRequest = z.infer<typeof DepositRequestSchema>;

// Withdrawal request
export const WithdrawalRequestSchema = z.object({
  amount: z.string(), // TON amount as string
  toAddress: z.string(),
  memo: z.string().optional()
});

export type WithdrawalRequest = z.infer<typeof WithdrawalRequestSchema>;

// Balance update
export const BalanceUpdateSchema = z.object({
  playerId: z.string(),
  previousBalance: z.string(),
  newBalance: z.string(),
  change: z.string(),
  reason: z.string(),
  transactionId: z.string().optional()
});

export type BalanceUpdate = z.infer<typeof BalanceUpdateSchema>;
