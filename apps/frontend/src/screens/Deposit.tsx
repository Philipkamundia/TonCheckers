/**
 * Deposit.tsx — Deposit initiation screen (PRD §4)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { balanceApi } from '../services/api';

export function Deposit() {
  const { showBackButton, hideMainButton } = useTelegram();
  const navigate = useNavigate();
  const [depositInfo, setDepositInfo] = useState<{ address: string; memo: string; minimumAmount: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { return showBackButton(() => navigate('/')); }, []);
  useEffect(() => { hideMainButton(); }, []);

  async function getDepositAddress() {
    setLoading(true);
    try {
      const r = await balanceApi.depositInit();
      setDepositInfo(r.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Deposit TON</h2>
      <p style={styles.hint}>Minimum deposit: 0.5 TON</p>
      <p style={styles.desc}>Send TON from your wallet to the address below. Your balance will update automatically within 60 seconds of confirmation.</p>

      {!depositInfo ? (
        <button style={styles.btn} onClick={getDepositAddress} disabled={loading}>
          {loading ? 'Loading…' : 'Get Deposit Address'}
        </button>
      ) : (
        <div style={styles.infoCard}>
          <p style={styles.label}>Wallet Address</p>
          <p style={styles.value}>{depositInfo.address}</p>
          <p style={styles.label}>Memo (required)</p>
          <p style={styles.value}>{depositInfo.memo}</p>
          <p style={styles.warning}>⚠️ You MUST include the memo above, or your deposit cannot be credited.</p>
          <button style={styles.copyBtn} onClick={() => navigator.clipboard?.writeText(depositInfo.memo)}>
            Copy Memo
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding:'16px', background:'var(--tg-theme-bg-color)', minHeight:'100vh' },
  title:     { color:'var(--tg-theme-text-color)', fontSize:22, fontWeight:700, margin:'0 0 4px' },
  hint:      { color:'#4CAF50', fontSize:13, margin:'0 0 12px' },
  desc:      { color:'var(--tg-theme-hint-color)', fontSize:14, lineHeight:1.5, marginBottom:20 },
  btn:       { width:'100%', background:'#2AABEE', border:'none', borderRadius:14, padding:'16px', color:'#fff', fontSize:16, fontWeight:600, cursor:'pointer' },
  infoCard:  { background:'var(--tg-theme-secondary-bg-color)', borderRadius:14, padding:16 },
  label:     { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'8px 0 2px' },
  value:     { color:'var(--tg-theme-text-color)', fontSize:14, fontWeight:500, wordBreak:'break-all', margin:0 },
  warning:   { color:'#FF8F00', fontSize:13, margin:'12px 0' },
  copyBtn:   { background:'var(--tg-theme-bg-color)', border:'none', borderRadius:10, padding:'10px 20px', color:'#2AABEE', fontSize:14, cursor:'pointer' },
};
