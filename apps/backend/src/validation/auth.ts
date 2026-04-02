import { z } from 'zod';

// POST /auth/connect — TonConnect proof from frontend
export const ConnectWalletSchema = z.object({
  // TonConnect proof object
  proof: z.object({
    timestamp:  z.number(),
    domain:     z.object({ value: z.string() }),
    signature:  z.string(),
    payload:    z.string(),
    stateInit:  z.string().optional(),
  }),
  // Wallet address in any TON format
  walletAddress: z.string().min(10).max(100),
  // Telegram initData string from window.Telegram.WebApp.initData
  initData: z.string().min(1),
});

export type ConnectWalletInput = z.infer<typeof ConnectWalletSchema>;

// POST /auth/verify — initData-only re-auth on app resume
export const VerifyInitDataSchema = z.object({
  initData:      z.string().min(1),
  walletAddress: z.string().min(10).max(100),
});

export type VerifyInitDataInput = z.infer<typeof VerifyInitDataSchema>;

// POST /auth/refresh
export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(10),
});

export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
