/**
 * Home.tsx — Home screen
 * Balance card + mode selection grid (PvP / AI / Tournaments)
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { balanceApi } from '../services/api';

export function Home() {
  const { hideBackButton, hideMainButton } = useTelegram();
  const { user, balance, setBalance } = useStore();
  const navigate = useNavigate();

  useEffect(() => {
    hideBackButton();
    hideMainButton();
    balanceApi.get().then(r => setBalance(r.data.balance)).catch(() => null);
  }, []);

  return (
    <div style={styles.container}>
      {/* Header with profile button */}
      <div style={styles.topBar}>
        <p style={styles.greeting}>Hey, {user?.username ?? 'Player'} 👋</p>
        <button style={styles.profileBtn} onClick={() => navigate('/profile')}>👤</button>
      </div>

      {/* Balance Card */}
      <div style={styles.balanceCard}>
        <div style={styles.balanceRow}>
          <span style={styles.balanceLabel}>Balance</span>
          <span style={styles.balanceValue}>{parseFloat(balance?.available ?? '0').toFixed(2)} TON</span>
        </div>
        {parseFloat(balance?.locked ?? '0') > 0 && (
          <p style={styles.lockedText}>{parseFloat(balance!.locked).toFixed(2)} TON locked in game</p>
        )}
        <div style={styles.eloRow}>
          <span style={styles.eloLabel}>ELO</span>
          <span style={styles.eloValue}>{user?.elo ?? 1200}</span>
        </div>
      </div>

      {/* Mode Grid */}
      <div style={styles.grid}>
        <ModeCard emoji="⚔️" title="Online Match (PVP)"          subtitle="play and Earn Ton"       onClick={() => navigate('/pvp')}         primary />
        <ModeCard emoji="🤖" title="Play Vs AI"     subtitle="AI opponent"           onClick={() => navigate('/ai')} />
        <ModeCard emoji="🏆" title="Tournaments"  subtitle="Compete for prize pool" onClick={() => navigate('/tournaments')} />
        <ModeCard emoji="📊" title="Leaderboard"  subtitle="Global rankings"       onClick={() => navigate('/leaderboard')} />
        <ModeCard emoji="👤" title="Profile"      subtitle="Stats & settings"      onClick={() => navigate('/profile')} />
      </div>

      {/* Wallet actions */}
      <div style={styles.walletRow}>
        <button style={styles.walletBtn} onClick={() => navigate('/deposit')}>Deposit</button>
        <button style={styles.walletBtn} onClick={() => navigate('/withdraw')}>Withdraw</button>
      </div>

      {/* Community action */}
      <button
        type="button"
        style={styles.communityBtn}
        onClick={() => window.open('https://t.me/toncheckersApp', '_blank', 'noopener,noreferrer')}
      >
        <span style={styles.tgIcon}>✈️</span>
        <span>Join TonCheckers Channel</span>
      </button>
    </div>
  );
}

function ModeCard({ emoji, title, subtitle, onClick, primary }: {
  emoji: string; title: string; subtitle: string; onClick: () => void; primary?: boolean;
}) {
  return (
    <button style={{ ...styles.modeCard, ...(primary ? styles.primaryCard : {}) }} onClick={onClick}>
      <span style={styles.modeEmoji}>{emoji}</span>
      <span style={styles.modeTitle}>{title}</span>
      <span style={styles.modeSubtitle}>{subtitle}</span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:    { padding:'16px', background:'var(--tg-theme-bg-color)', minHeight:'100vh' },
  topBar:       { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 },
  greeting:     { color:'var(--tg-theme-hint-color)', fontSize:13, margin:0 },
  profileBtn:   { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:'50%', width:36, height:36, fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  balanceCard:  { background:'var(--tg-theme-secondary-bg-color)', borderRadius:16, padding:20, marginBottom:20 },
  balanceRow:   { display:'flex', justifyContent:'space-between', alignItems:'center' },
  balanceLabel: { color:'var(--tg-theme-hint-color)', fontSize:14 },
  balanceValue: { color:'var(--tg-theme-text-color)', fontSize:28, fontWeight:700 },
  lockedText:   { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'4px 0 0' },
  eloRow:       { display:'flex', justifyContent:'space-between', marginTop:12 },
  eloLabel:     { color:'var(--tg-theme-hint-color)', fontSize:13 },
  eloValue:     { color:'#2AABEE', fontSize:16, fontWeight:600 },
  grid:         { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 },
  modeCard:     { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:16, padding:'12px 8px', display:'flex', flexDirection:'column', alignItems:'center', gap:4, cursor:'pointer', textAlign:'center' },
  primaryCard:  { background:''#2AABEE', gridColumn:'1 / -1' },
  modeEmoji:    { fontSize:28 },
  modeTitle:    { color:'var(--tg-theme-text-color)', fontWeight:600, fontSize:15 },
  modeSubtitle: { color:'var(--tg-theme-hint-color)', fontSize:12 },
  walletRow:    { display:'flex', gap:12, marginBottom:12 },
  walletBtn:    { flex:1, background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'14px', color:'var(--tg-theme-text-color)', fontSize:15, fontWeight:500, cursor:'pointer' },
  communityBtn: { width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:8, background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'12px 14px', color:'#f1f5f7ff', fontSize:14, fontWeight:600, cursor:'pointer' },
  tgIcon:       { fontSize:16 },
};
