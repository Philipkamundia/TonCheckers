/**
 * AdminDashboard.tsx — Admin dashboard (PRD §15)
 *
 * Access: only via admin bot URL (?mode=admin)
 * Auth: treasury wallet must be connected and signed
 * Hidden from regular users — route only renders in admin mode
 */
import { useEffect, useState } from 'react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { useTelegram } from '../hooks/useTelegram';
import { api } from '../services/api';

type AdminTab = 'summary' | 'withdrawals' | 'treasury' | 'users' | 'games' | 'tournaments' | 'fees' | 'crashes';
const TABS: { id: AdminTab; label: string; emoji: string }[] = [
  { id: 'summary',     label: 'Overview',    emoji: '📊' },
  { id: 'withdrawals', label: 'Withdrawals', emoji: '💸' },
  { id: 'treasury',    label: 'Treasury',    emoji: '🏦' },
  { id: 'users',       label: 'Users',       emoji: '👥' },
  { id: 'games',       label: 'Games',       emoji: '♟️' },
  { id: 'tournaments', label: 'Tournaments', emoji: '🏆' },
  { id: 'fees',        label: 'Fees',        emoji: '💰' },
  { id: 'crashes',     label: 'Crashes',     emoji: '🔴' },
];

export function AdminDashboard() {
  const { haptic } = useTelegram();
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [tab,       setTab]       = useState<AdminTab>('summary');
  const [authed,    setAuthed]    = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [data,      setData]      = useState<Record<string, unknown> | null>(null);
  const [loading,   setLoading]   = useState(false);

  async function handleAdminAuth() {
    if (!wallet) {
      setAuthError('Connect your treasury wallet first');
      return;
    }
    try {
      api.defaults.headers.common['X-Admin-Wallet'] = wallet.account.address;
      await api.get('/api/admin/summary');
      setAuthed(true);
      setAuthError(null);
      haptic.success();
    } catch {
      delete api.defaults.headers.common['X-Admin-Wallet'];
      setAuthError('Authentication failed — make sure this is the treasury wallet');
      haptic.error();
    }
  }

  // Load data for active tab
  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    setData(null);

    const endpoints: Record<AdminTab, string> = {
      summary:     '/api/admin/summary',
      withdrawals: '/api/admin/withdrawals/pending',
      treasury:    '/api/admin/treasury',
      users:       '/api/admin/users',
      games:       '/api/admin/games',
      tournaments: '/api/admin/tournaments',
      fees:        '/api/admin/fees',
      crashes:     '/api/admin/crashes',
    };

    api.get(endpoints[tab])
      .then(r => setData(r.data))
      .catch(() => setData({ error: 'Failed to load' }))
      .finally(() => setLoading(false));
  }, [tab, authed]);

  if (!authed) {
    return (
      <div style={styles.authContainer}>
        <h2 style={styles.title}>🔐 Admin Dashboard</h2>
        <p style={styles.hint}>Connect your treasury wallet to authenticate</p>
        {!wallet ? (
          <button style={styles.authBtn} onClick={() => tonConnectUI.openModal()}>
            Connect Treasury Wallet
          </button>
        ) : (
          <button style={styles.authBtn} onClick={handleAdminAuth}>
            Authenticate with Treasury Wallet
          </button>
        )}
        {authError && <p style={styles.error}>{authError}</p>}
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Admin Dashboard</h2>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        {TABS.map(t => (
          <button key={t.id}
            style={{ ...styles.tabBtn, ...(tab === t.id ? styles.tabBtnActive : {}) }}
            onClick={() => { setTab(t.id); haptic.selection(); }}
          >
            <span>{t.emoji}</span>
            <span style={styles.tabLabel}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={styles.content}>
        {loading && <p style={styles.hint}>Loading…</p>}
        {!loading && data && <AdminTabContent tab={tab} data={data} onRefresh={() => setTab(tab)} />}
      </div>
    </div>
  );
}

function AdminTabContent({ tab, data, onRefresh }: { tab: AdminTab; data: Record<string, unknown>; onRefresh: () => void }) {
  const d = data;

  if (tab === 'summary' && d.summary) {
    const s = d.summary as Record<string, number>;
    return (
      <div style={styles.grid}>
        <StatCard label="Total Users"       value={s.total_users} />
        <StatCard label="New Today"         value={s.new_users_today} />
        <StatCard label="Active Games"      value={s.active_games} />
        <StatCard label="Queue Size"        value={s.queue_size} />
        <StatCard label="Open Tournaments"  value={s.open_tournaments} />
        <StatCard label="Pending Withdrawals" value={s.pending_withdrawals} highlight={s.pending_withdrawals > 0} />
      </div>
    );
  }

  if (tab === 'withdrawals') {
    const ws = (d.withdrawals ?? []) as Array<Record<string, string>>;
    if (!ws.length) return <p style={styles.hint}>No pending withdrawals ✅</p>;
    return (
      <div>
        {ws.map(w => (
          <div key={w.id} style={styles.card}>
            <p style={styles.cardTitle}>{w.username} — {parseFloat(w.amount).toFixed(2)} TON</p>
            <p style={styles.cardSub}>{w.destination}</p>
            <p style={styles.cardSub}>{new Date(w.created_at).toLocaleString()}</p>
            <div style={styles.btnRow}>
              <button style={styles.approveBtn} onClick={async () => {
                await api.post(`/api/admin/withdrawals/${w.id}/approve`);
                onRefresh();
              }}>Approve</button>
              <button style={styles.rejectBtn} onClick={async () => {
                await api.post(`/api/admin/withdrawals/${w.id}/reject`, { reason: 'Rejected by admin' });
                onRefresh();
              }}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (tab === 'treasury' && d.treasury) {
    const t = d.treasury as Record<string, string | null>;
    return (
      <div style={styles.grid}>
        <StatCard label="Total Obligations" value={`${parseFloat(String(t.totalObligations ?? 0)).toFixed(2)} TON`} />
        <StatCard label="Available Balances" value={`${parseFloat(String(t.totalAvailable ?? 0)).toFixed(2)} TON`} />
        <StatCard label="Locked in Games"   value={`${parseFloat(String(t.totalLocked ?? 0)).toFixed(2)} TON`} />
        <StatCard label="Platform Fees"     value={`${parseFloat(String(t.platformFeesEarned ?? 0)).toFixed(2)} TON`} />
      </div>
    );
  }

  // Generic JSON display for other tabs
  return (
    <pre style={styles.json}>{JSON.stringify(data, null, 2)}</pre>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div style={{ ...styles.statCard, ...(highlight ? styles.statCardHighlight : {}) }}>
      <p style={styles.statLabel}>{label}</p>
      <p style={styles.statValue}>{value}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:       { padding:'16px', background:'var(--tg-theme-bg-color)', minHeight:'100vh' },
  authContainer:   { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', padding:24, gap:16, background:'var(--tg-theme-bg-color)' },
  title:           { color:'var(--tg-theme-text-color)', fontSize:20, fontWeight:700, margin:'0 0 12px' },
  hint:            { color:'var(--tg-theme-hint-color)', fontSize:14, textAlign:'center' },
  authBtn:         { background:'#2AABEE', border:'none', borderRadius:14, padding:'16px 32px', color:'#fff', fontSize:16, fontWeight:600, cursor:'pointer', width:'100%', maxWidth:320 },
  error:           { color:'var(--tg-theme-destructive-text-color)', fontSize:13 },
  tabBar:          { display:'flex', overflowX:'auto', gap:6, marginBottom:16, paddingBottom:4 },
  tabBtn:          { flex:'none', background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:10, padding:'8px 10px', display:'flex', flexDirection:'column', alignItems:'center', gap:2, cursor:'pointer', minWidth:64 },
  tabBtnActive:    { background:'#2AABEE' },
  tabLabel:        { color:'var(--tg-theme-text-color)', fontSize:10 },
  content:         { paddingBottom:40 },
  grid:            { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 },
  statCard:        { background:'var(--tg-theme-secondary-bg-color)', borderRadius:12, padding:'14px 12px' },
  statCardHighlight:{ background:'#FFF3E0', borderColor:'#FF8F00', border:'1px solid' },
  statLabel:       { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'0 0 4px' },
  statValue:       { color:'var(--tg-theme-text-color)', fontWeight:700, fontSize:18, margin:0 },
  card:            { background:'var(--tg-theme-secondary-bg-color)', borderRadius:12, padding:14, marginBottom:10 },
  cardTitle:       { color:'var(--tg-theme-text-color)', fontWeight:600, margin:'0 0 4px' },
  cardSub:         { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'2px 0' },
  btnRow:          { display:'flex', gap:8, marginTop:10 },
  approveBtn:      { flex:1, background:'#4CAF50', border:'none', borderRadius:10, padding:'10px', color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer' },
  rejectBtn:       { flex:1, background:'var(--tg-theme-destructive-text-color)', border:'none', borderRadius:10, padding:'10px', color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer' },
  json:            { background:'var(--tg-theme-secondary-bg-color)', borderRadius:12, padding:12, fontSize:11, color:'var(--tg-theme-text-color)', overflowX:'auto', whiteSpace:'pre-wrap' },
};
