/**
 * WalletGate.tsx — Wallet connection screen
 */
import { useState, useEffect } from 'react';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { authApi } from '../services/api';
import { tonConnectUI } from '../services/tonConnect';

export function WalletGate({ onConnected }: { onConnected: () => void }) {
  const { initData, haptic, showMainButton, hideMainButton } = useTelegram();
  const { setUser, setTokens } = useStore();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [wallet,  setWallet]  = useState(tonConnectUI.wallet);

  // Track wallet connection state
  useEffect(() => {
    return tonConnectUI.onStatusChange((w) => setWallet(w));
  }, []);

  // Auto-authenticate when wallet connects
  useEffect(() => {
    if (!wallet) {
      hideMainButton();
      return;
    }
    // Try to show MainButton as well, but also auto-trigger auth
    showMainButton('Continue', handleAuth, { color: '#2AABEE' });
    handleAuth();
  }, [wallet]);

  async function handleAuth() {
    if (!wallet || !initData) return;
    setLoading(true);
    setError(null);
    try {
      const address = wallet.account.address;
      const proof   = wallet.connectItems?.tonProof;
      let res;
      if (proof && 'proof' in proof) {
        res = await authApi.connect({ walletAddress: address, proof: proof.proof, initData });
      } else {
        try {
          res = await authApi.verify({ walletAddress: address, initData });
        } catch (verifyErr: unknown) {
          const status = (verifyErr as { response?: { status?: number } })?.response?.status;
          if (status === 404) {
            setError('Please disconnect and reconnect your wallet to complete registration.');
            haptic.error();
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
    } catch {
      setError('Connection failed. Please try again.');
      haptic.error();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.logo}>♟️</div>
      <h1 style={styles.title}>CheckTON</h1>
      <p style={styles.subtitle}>Wager TON. Challenge Opponents. Climb the Ranks.</p>

      <div style={styles.card}>
        {!wallet ? (
          <>
            <p style={styles.cardText}>Connect your TON wallet to start playing</p>
            {/* Single custom button — no TonConnectButton component to avoid double rendering */}
            <button
              style={styles.connectBtn}
              onClick={() => tonConnectUI.openModal()}
              disabled={loading}
            >
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
              <button
                style={styles.connectBtn}
                onClick={handleAuth}
                disabled={loading}
              >
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
