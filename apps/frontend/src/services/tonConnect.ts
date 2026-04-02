/**
 * tonConnect.ts — TonConnect wallet integration (PRD §2, §16)
 *
 * Supports: Tonkeeper, Telegram Wallet, WalletConnect
 * Auth method: wallet signature via TonConnect proof
 * No email/password — wallet is the sole identity
 */
import { TonConnectUI, type ConnectedWallet } from '@tonconnect/ui-react';

// Manifest must be hosted on your domain — tells Telegram which app is connecting
const MANIFEST_URL = `${import.meta.env.VITE_APP_URL ?? 'https://checkton.app'}/tonconnect-manifest.json`;

export const tonConnectUI = new TonConnectUI({ manifestUrl: MANIFEST_URL });

export async function requestWalletConnection(): Promise<ConnectedWallet | null> {
  try {
    await tonConnectUI.openModal();
    return new Promise((resolve) => {
      const unsubscribe = tonConnectUI.onStatusChange((wallet) => {
        if (wallet) {
          unsubscribe();
          resolve(wallet);
        }
      });
      // Resolve with null if modal is closed without connecting
      tonConnectUI.onModalStateChange((state) => {
        if (state.status === 'closed' && !tonConnectUI.connected) {
          unsubscribe();
          resolve(null);
        }
      });
    });
  } catch {
    return null;
  }
}

export function getConnectedWallet(): ConnectedWallet | null {
  return tonConnectUI.wallet;
}

export function getWalletAddress(): string | null {
  return tonConnectUI.wallet?.account?.address ?? null;
}

export async function disconnectWallet(): Promise<void> {
  await tonConnectUI.disconnect();
}

/** Build TonConnect proof for POST /auth/connect */
export async function buildProof(nonce: string): Promise<unknown | null> {
  try {
    const result = await tonConnectUI.sendTransaction({
      // This triggers TonConnect proof generation in the wallet app
      validUntil: Math.floor(Date.now() / 1000) + 300,
      messages:   [],
    } as Parameters<typeof tonConnectUI.sendTransaction>[0]);
    return result;
  } catch {
    return null;
  }
}
