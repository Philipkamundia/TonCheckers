/**
 * WalletGate.tsx — Wallet connection screen
 *
 * Auth flow:
 * - New wallet: requests tonProof on connect → POST /auth/connect (proof verified server-side)
 * - Returning wallet: no proof needed → POST /auth/verify (JWT session)
 * - If proof unavailable (wallet already connected before app opened): falls back to verify
 *   which is safe for returning users since they proved ownership on first connect
 */
import { useState, useEffect, useRef } from 'react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { authApi } from '../services/api';

export function WalletGate({ onConnected }: { onConnected: () => void }) {
  const { initData, haptic, hideMainButton } = useTelegram();
  const { setUser, setTokens, accessToken } = useStore();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const latestWalletRef = useRef(wallet);

  useEffect(() => {
    latestWalletRef.current = wallet;
  }, [wallet]);

  // Auto-authenticate when wallet connects — but only if not in a logged-out state
  useEffect(() => {
    if (!wallet) { hideMainButton(); return; }
    if (accessToken) return;
    // Small delay to allow tonProof to be attached to the wallet object
    // TonConnect fires the connection event before proof is fully populated
    const timer = setTimeout(() => doAuth(wallet, initData), 300);
    return () => clearTimeout(timer);
  }, [wallet]);

  function openWalletModal() {
    // Request tonProof to prove wallet ownership for new account creation
    tonConnectUI.setConnectRequestParameters({
      state: 'ready',
      value: { tonProof: `checkers-${Date.now()}` },
    });
    tonConnectUI.openModal();
  }

  async function handleAuth() {
    if (!wallet) return;
    await doAuth(wallet, initData);
  }

  async function waitForTonProof(timeoutMs = 5_000, tickMs = 150) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const p = latestWalletRef.current?.connectItems?.tonProof;
      if (p && 'proof' in p) return p.proof;
      await new Promise(r => setTimeout(r, tickMs));
    }
    return null;
  }

  async function doAuth(connectedWallet: NonNullable<typeof wallet>, currentInitData: string) {
    if (!currentInitData) {
      setError('Telegram session not found. Please reopen the app from Telegram.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const address = connectedWallet.account.address;
      const proof = await waitForTonProof();

      let res;
      if (proof) {
        // tonProof available — use connect (verifies ownership, handles new + returning)
        res = await authApi.connect({
          walletAddress: address,
          proof: {
            ...proof,
            publicKey: connectedWallet.account.publicKey,
          },
          initData: currentInitData,
        });
      } else {
        // No proof — wallet was already connected before app opened.
        // Safe for returning users (already proved ownership on first connect).
        // New users will be rejected by the server and prompted to reconnect.
        try {
          res = await authApi.verify({ walletAddress: address, initData: currentInitData });
        } catch (verifyErr: unknown) {
          const code = (verifyErr as { response?: { data?: { code?: string } } })?.response?.data?.code;
          if (code === 'USER_NOT_FOUND') {
            // New user with no proof yet — disconnect first so TonConnect fires
            // a fresh connection event with tonProof attached on reconnect.
            setError('Please tap "Connect Wallet" again to verify wallet ownership.');
            await tonConnectUI.disconnect();
            openWalletModal();
            haptic.error();
            setLoading(false);
            return;
          }
          throw verifyErr;
        }
      }

      setTokens(res.data.accessToken, res.data.refreshToken);
      setUser(res.data.user);
      haptic.success();
      hideMainButton();
      onConnected();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string }; status?: number } };
      const msg = axiosErr?.response?.data?.error;
      if (msg?.includes('proof') || msg?.includes('not registered')) {
        // Proof failed or new user without proof — disconnect so reconnect gets fresh proof
        setError('Please disconnect and reconnect your wallet to verify ownership.');
        await tonConnectUI.disconnect();
      } else {
        setError(msg ?? 'Connection failed. Please try again.');
      }
      haptic.error();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.logo}>♟️</div>
      <h1 style={styles.title}>TonCheckers</h1>
      <p style={styles.subtitle}>Wager TON. Challenge Opponents. Climb the Ranks.</p>

      <div style={styles.card}>
        {!wallet ? (
          <>
            <p style={styles.cardText}>Connect your TON wallet to start playing</p>
            <button style={styles.connectBtn} onClick={openWalletModal} disabled={loading}>
              Connect Wallet
            </button>
          </>
        ) : (
          <>
            <p style={styles.cardText}>✅ Wallet connected</p>
            <p style={styles.connectedText}>
              {wallet.account.address.slice(0, 8)}...{wallet.account.address.slice(-6)}
            </p>
            {loading ? (
              <p style={styles.loading}>Authenticating…</p>
            ) : (
              <button style={styles.connectBtn} onClick={handleAuth} disabled={loading}>
                Continue
              </button>
            )}
          </>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:    { display:'flex', flexDirection:'column', alignItems:'center', padding:'40px 24px', minHeight:'100vh', background:'var(--tg-theme-bg-color)' },
  logo:         { fontSize:64, marginBottom:16 },
  title:        { fontSize:32, fontWeight:700, color:'var(--tg-theme-text-color)', margin:0 },
  subtitle:     { fontSize:14, color:'var(--tg-theme-hint-color)', textAlign:'center', marginBottom:32 },
  card:         { background:'var(--tg-theme-secondary-bg-color)', borderRadius:16, padding:24, width:'100%', maxWidth:320, display:'flex', flexDirection:'column', alignItems:'center', gap:12 },
  cardText:     { color:'var(--tg-theme-text-color)', textAlign:'center', margin:0 },
  connectBtn:   { width:'100%', background:'#2AABEE', border:'none', borderRadius:12, padding:'14px', color:'#fff', fontSize:16, fontWeight:600, cursor:'pointer' },
  connectedText:{ color:'#4CAF50', textAlign:'center', fontSize:13, margin:0 },
  error:        { color:'var(--tg-theme-destructive-text-color)', fontSize:13, marginTop:12 },
  loading:      { color:'var(--tg-theme-hint-color)', fontSize:13, margin:0 },
};
