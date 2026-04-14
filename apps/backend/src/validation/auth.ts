import { z } from 'zod';

const walletAddress = z.string().min(10).max(128);

// POST /auth/connect — TonConnect proof from frontend
export const ConnectWalletSchema = z.object({
  proof: z.object({
    timestamp:  z.number(),
    domain:     z.object({ value: z.string(), lengthBytes: z.number().optional() }),
    signature:  z.string(),
    payload:    z.string(),
    stateInit:  z.string().optional(),
    publicKey:  z.string().optional(),
  }),
  walletAddress,
  initData: z.string().min(1),
});

export type ConnectWalletInput = z.infer<typeof ConnectWalletSchema>;

// POST /auth/verify — initData-only re-auth on app resume
export const VerifyInitDataSchema = z.object({
  initData:      z.string().min(1),
  walletAddress,
});

export type VerifyInitDataInput = z.infer<typeof VerifyInitDataSchema>;

// POST /auth/refresh
export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(10),
});

export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
