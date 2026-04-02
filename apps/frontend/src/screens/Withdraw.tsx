/**
 * Withdraw.tsx — Withdrawal screen as per(PRD §4)
 * Destination locked to connected wallet — no overrides.
 * PRD §16: Confirm Stake button = MainButton
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { balanceApi } from '../services/api';
import { getWalletAddress } from '../services/tonConnect';

export function Withdraw() {
  const { showBackButton, showMainButton, setMainButtonLoading, haptic } = useTelegram();
  const { balance, setBalance } = useStore();
  const navigate = useNavigate();

  const [amount,  setAmount]  = useState('');
  const [result,  setResult]  = useState<{ success: boolean; message: string } | null>(null);
  const walletAddress         = getWalletAddress();
  const available             = parseFloat(balance?.available ?? '0');

  useEffect(() => { return showBackButton(() => navigate('/')); }, []);

  useEffect(() => {
    const valid = parseFloat(amount) > 0 && parseFloat(amount) <= available;
    return showMainButton(`Withdraw ${amount || '0'} TON`, handleWithdraw, { disabled: !valid });
  }, [amount, available]);

  async function handleWithdraw() {
    if (!walletAddress) return;
    setMainButtonLoading(true);
    try {
      const res = await balanceApi.withdraw(amount, walletAddress);
      balanceApi.get().then(r => setBalance(r.data.balance));
      const msg = res.data?.message ?? `Withdrawal of ${amount} TON submitted. Funds arriving shortly.`;
      setResult({ success: true, message: msg });
      haptic.success();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Withdrawal failed';
      setResult({ success: false, message: msg });
      haptic.error();
    } finally {
      setMainButtonLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Withdraw TON</h2>

      <div style={styles.balanceCard}>
        <span style={styles.balanceLabel}>Available</span>
        <span style={styles.balanceValue}>{available.toFixed(2)} TON</span>
      </div>

      <p style={styles.label}>Amount (TON)</p>
      <input
        style={styles.input}
        type="number"
        placeholder="0.00"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        min="0.1"
        step="0.1"
        max={available}
      />

      <div style={styles.destinationCard}>
        <p style={styles.destLabel}>Destination (your connected wallet)</p>
        <p style={styles.destAddress}>{walletAddress ?? 'No wallet connected'}</p>
        <p style={styles.destHint}>⚠️ Destination is locked to your connected wallet. Cannot be changed.</p>
      </div>

      <div style={styles.limits}>
        <p style={styles.limitText}>Daily limit: 100 TON · Above 100 TON requires admin approval</p>
        <p style={styles.limitText}>30-minute cooldown between withdrawals</p>
      </div>

      {result && (
        <div style={{ ...styles.result, background: result.success ? '#E8F5E9' : '#FFEBEE' }}>
          <p style={{ color: result.success ? '#2E7D32' : '#C62828', margin: 0 }}>{result.message}</p>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:       { padding:'16px', background:'var(--tg-theme-bg-color)', minHeight:'100vh', paddingBottom:80 },
  title:           { color:'var(--tg-theme-text-color)', fontSize:22, fontWeight:700, margin:'0 0 16px' },
  balanceCard:     { display:'flex', justifyContent:'space-between', alignItems:'center', background:'var(--tg-theme-secondary-bg-color)', borderRadius:14, padding:'16px', marginBottom:20 },
  balanceLabel:    { color:'var(--tg-theme-hint-color)', fontSize:14 },
  balanceValue:    { color:'var(--tg-theme-text-color)', fontWeight:700, fontSize:22 },
  label:           { color:'var(--tg-theme-hint-color)', fontSize:13, margin:'0 0 6px' },
  input:           { width:'100%', background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'14px', fontSize:20, color:'var(--tg-theme-text-color)', boxSizing:'border-box', marginBottom:16 },
  destinationCard: { background:'var(--tg-theme-secondary-bg-color)', borderRadius:12, padding:14, marginBottom:12 },
  destLabel:       { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'0 0 4px' },
  destAddress:     { color:'var(--tg-theme-text-color)', fontSize:13, wordBreak:'break-all', margin:'0 0 6px' },
  destHint:        { color:'#FF8F00', fontSize:12, margin:0 },
  limits:          { marginBottom:16 },
  limitText:       { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'2px 0' },
  result:          { borderRadius:12, padding:14 },
};
