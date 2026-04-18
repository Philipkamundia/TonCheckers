/**
 * Withdraw.tsx — Withdrawal screen as per(PRD §4)
 * Destination locked to connected wallet — no overrides.
 * PRD §16: Confirm Stake button = MainButton
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTonWallet } from '@tonconnect/ui-react';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { balanceApi } from '../services/api';

interface RecentTx { id: string; status: string; amount: string; createdAt: string; }

function RecentWithdrawals({ navigate }: { navigate: (path: string) => void }) {
  const [txs, setTxs] = useState<RecentTx[]>([]);
  useEffect(() => {
    balanceApi.history(1)
      .then(r => {
        const withdrawals = ((r.data.transactions ?? []) as Array<RecentTx & { type: string }>)
          .filter(t => t.type === 'withdrawal')
          .slice(0, 3);
        setTxs(withdrawals);
      })
      .catch(() => {});
  }, []);
  if (!txs.length) return null;
  const statusColor: Record<string, string> = { confirmed: '#4CAF50', processing: '#FF8F00', pending: '#2AABEE', failed: 'var(--tg-theme-destructive-text-color)', rejected: 'var(--tg-theme-hint-color)' };
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <p style={{ color: 'var(--tg-theme-hint-color)', fontSize: 13, fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent Withdrawals</p>
        <button onClick={() => navigate('/history?tab=withdrawals')} style={{ background: 'none', border: 'none', color: '#2AABEE', fontSize: 13, cursor: 'pointer', padding: 0 }}>View all</button>
      </div>
      {txs.map(tx => (
        <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
          <div>
            <p style={{ color: 'var(--tg-theme-text-color)', fontSize: 13, fontWeight: 500, margin: 0 }}>
              {new Date(tx.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </p>
            <p style={{ color: statusColor[tx.status] ?? 'var(--tg-theme-hint-color)', fontSize: 11, margin: '2px 0 0' }}>{tx.status}</p>
          </div>
          <p style={{ color: 'var(--tg-theme-text-color)', fontWeight: 700, fontSize: 14, margin: 0 }}>−{parseFloat(tx.amount).toFixed(2)} TON</p>
        </div>
      ))}
    </div>
  );
}

export function Withdraw() {
  const { showBackButton, showMainButton, setMainButtonLoading, hideMainButton, haptic } = useTelegram();
  const { balance, setBalance, user } = useStore();
  const wallet = useTonWallet();
  const navigate = useNavigate();
  const [amount,    setAmount]    = useState('');
  const [result,    setResult]    = useState<{ success: boolean; message: string } | null>(null);
  const [countdown, setCountdown] = useState(0);
  // Use the registered wallet address from the user profile, not the currently connected wallet
  // This prevents Wallet B from redirecting funds when logged into a Wallet A account
  const walletAddress             = user?.walletAddress ?? wallet?.account?.address ?? null;
  const available                 = parseFloat(balance?.available ?? '0');
  const MIN_WITHDRAW              = 0.1;

  // Tick countdown down every second
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  useEffect(() => { return showBackButton(() => navigate('/')); }, []);

  useEffect(() => {
    if (result?.success) {
      hideMainButton();
      return;
    }
    const val = parseFloat(amount);
    const valid = !isNaN(val) && val >= MIN_WITHDRAW && val <= available && !!walletAddress;
    return showMainButton(`Withdraw ${amount || '0'} TON`, handleWithdraw, { disabled: !valid });
  }, [amount, available, walletAddress, result]);

  async function handleWithdraw() {
    if (!walletAddress) return;
    setMainButtonLoading(true);
    try {
      const res = await balanceApi.withdraw(amount, walletAddress);
      balanceApi.get().then(r => setBalance(r.data.balance));
      const msg = res.data?.message ?? `Withdrawal of ${amount} TON submitted. Funds arriving shortly.`;
      setResult({ success: true, message: msg });
      setCountdown(30 * 60); // 30 min cooldown starts now
      haptic.success();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Withdrawal failed';
      setResult({ success: false, message: msg });
      haptic.error();
    } finally {
      setMainButtonLoading(false);
    }
  }

  if (result?.success) {
    const mins = Math.floor(countdown / 60);
    const secs = countdown % 60;
    const cooldownLabel = countdown > 0
      ? `${mins}:${String(secs).padStart(2, '0')} remaining`
      : 'Available now';
    return (
      <div style={styles.container}>
        <div style={styles.successBox}>
          <p style={styles.successIcon}>✅</p>
          <p style={styles.successTitle}>Withdrawal Submitted</p>
          <p style={styles.successDesc}>{result.message}</p>
          <div style={styles.successDetail}>
            <Row label="Amount"           value={`${amount} TON`} />
            <Row label="Destination"      value={`${walletAddress?.slice(0,10)}…${walletAddress?.slice(-6)}`} />
            <Row label="Next withdrawal"  value={cooldownLabel} />
          </div>
          <button style={styles.btn} onClick={() => navigate('/')}>Back to Home</button>
          <button style={styles.outlineBtn} onClick={() => { setResult(null); setAmount(''); }}>Withdraw More</button>
        </div>
      </div>
    );
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
        min={MIN_WITHDRAW}
        step="0.1"
        max={available}
      />
      {amount !== '' && parseFloat(amount) < MIN_WITHDRAW && (
        <p style={styles.validationMsg}>Minimum withdrawal is {MIN_WITHDRAW} TON</p>
      )}
      {amount !== '' && parseFloat(amount) > available && (
        <p style={styles.validationMsg}>Insufficient balance</p>
      )}

      <div style={styles.destinationCard}>
        <p style={styles.destLabel}>Destination (your connected wallet)</p>
        <p style={styles.destAddress}>{walletAddress ?? 'No wallet connected'}</p>
        <p style={styles.destHint}>⚠️ Destination is locked to your connected wallet. Cannot be changed.</p>
      </div>

      <div style={styles.limits}>
        <p style={styles.limitText}>Daily limit: 100 TON · Above 100 TON requires admin approval</p>
        <p style={styles.limitText}>30-minute cooldown between withdrawals</p>
      </div>

      {result && !result.success && (
        <div style={{ ...styles.result, background: '#FFEBEE' }}>
          <p style={{ color: '#C62828', margin: 0 }}>{result.message}</p>
        </div>
      )}

      <RecentWithdrawals navigate={navigate} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid rgba(128,128,128,0.1)' }}>
      <span style={{ color:'var(--tg-theme-hint-color)', fontSize:13 }}>{label}</span>
      <span style={{ color:'var(--tg-theme-text-color)', fontSize:13, fontWeight:500 }}>{value}</span>
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
  input:           { width:'100%', background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'14px', fontSize:20, color:'var(--tg-theme-text-color)', boxSizing:'border-box', marginBottom:8 },
  validationMsg:   { color:'#ff3b30', fontSize:12, margin:'0 0 12px' },
  destinationCard: { background:'var(--tg-theme-secondary-bg-color)', borderRadius:12, padding:14, marginBottom:12 },
  destLabel:       { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'0 0 4px' },
  destAddress:     { color:'var(--tg-theme-text-color)', fontSize:13, wordBreak:'break-all', margin:'0 0 6px' },
  destHint:        { color:'#FF8F00', fontSize:12, margin:0 },
  limits:          { marginBottom:16 },
  limitText:       { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'2px 0' },
  result:          { borderRadius:12, padding:14 },
  successBox:      { display:'flex', flexDirection:'column', alignItems:'center', padding:'40px 16px', gap:12 },
  successIcon:     { fontSize:56, margin:0 },
  successTitle:    { color:'var(--tg-theme-text-color)', fontSize:22, fontWeight:700, margin:0 },
  successDesc:     { color:'var(--tg-theme-hint-color)', fontSize:14, textAlign:'center', lineHeight:1.6, margin:0 },
  successDetail:   { background:'var(--tg-theme-secondary-bg-color)', borderRadius:14, padding:'4px 14px', width:'100%', maxWidth:360 },
  btn:             { width:'100%', maxWidth:360, background:'#2AABEE', border:'none', borderRadius:14, padding:'16px', color:'#fff', fontSize:16, fontWeight:600, cursor:'pointer' },
  outlineBtn:      { width:'100%', maxWidth:360, background:'none', border:'1.5px solid #2AABEE', borderRadius:14, padding:'14px', color:'#2AABEE', fontSize:15, fontWeight:600, cursor:'pointer' },
};
