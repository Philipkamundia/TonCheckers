/**
 * AdminDashboard.tsx — Admin dashboard (PRD §15)
 */
import { useEffect, useState } from 'react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { useTelegram } from '../hooks/useTelegram';
import { api } from '../services/api';

type AdminTab = 'summary' | 'withdrawals' | 'treasury' | 'users' | 'games' | 'tournaments' | 'fees' | 'crashes';

const TABS: { id: AdminTab; emoji: string; label: string; sub: string }[] = [
  { id: 'withdrawals', emoji: '💸', label: 'Withdrawals', sub: 'Pending queue'    },
  { id: 'treasury',   emoji: '🏦', label: 'Treasury',    sub: 'Fund health'      },
  { id: 'users',      emoji: '👥', label: 'Users',       sub: 'Manage accounts'  },
  { id: 'games',      emoji: '♟️', label: 'Games',       sub: 'Game log'         },
  { id: 'tournaments',emoji: '🏆', label: 'Tournaments', sub: 'Overview'         },
  { id: 'fees',       emoji: '💰', label: 'Fees',        sub: 'Fee breakdown'    },
  { id: 'crashes',    emoji: '🔴', label: 'Crashes',     sub: 'Crash log'        },
];

const ENDPOINTS: Record<AdminTab, string> = {
  summary:     '/api/admin/summary',
  withdrawals: '/api/admin/withdrawals/pending',
  treasury:    '/api/admin/treasury',
  users:       '/api/admin/users',
  games:       '/api/admin/games',
  tournaments: '/api/admin/tournaments',
  fees:        '/api/admin/fees',
  crashes:     '/api/admin/crashes',
};

export function AdminDashboard() {
  const { haptic, showBackButton, hideBackButton, hideMainButton } = useTelegram();
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();

  const [step,      setStep]      = useState<'wallet' | 'passcode' | 'dashboard'>('wallet');
  const [passcode,  setPasscode]  = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [tab,       setTab]       = useState<AdminTab | null>(null);
  const [summary,   setSummary]   = useState<Record<string, number> | null>(null);
  const [data,      setData]      = useState<Record<string, unknown> | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actingTxId, setActingTxId] = useState<string | null>(null);
  const [actingKind, setActingKind] = useState<'approve' | 'reject' | null>(null);

  const authed = step === 'dashboard';

  // Clear admin headers when component unmounts (navigating away from admin)
  useEffect(() => {
    return () => {
      delete api.defaults.headers.common['X-Admin-Wallet'];
      delete api.defaults.headers.common['X-Admin-Passcode'];
    };
  }, []);

  // When wallet connects, move to passcode step automatically
  useEffect(() => {
    if (wallet && step === 'wallet') setStep('passcode');
    if (!wallet && step !== 'wallet') { setStep('wallet'); setPasscode(''); setAuthError(null); }
  }, [wallet]);

  // Auto-submit when 8 digits entered
  useEffect(() => {
    if (passcode.length === 8) handlePasscodeSubmit();
  }, [passcode]);

  useEffect(() => {
    hideMainButton();
    if (tab) return showBackButton(() => { setTab(null); setData(null); });
    else hideBackButton();
  }, [tab]);

  async function handlePasscodeSubmit() {
    if (!wallet || passcode.length !== 8) return;
    try {
      api.defaults.headers.common['X-Admin-Wallet']   = wallet.account.address;
      api.defaults.headers.common['X-Admin-Passcode'] = passcode;
      const res = await api.get('/api/admin/summary');
      setSummary(res.data.summary as Record<string, number>);
      setStep('dashboard');
      setAuthError(null);
      haptic.success();
    } catch {
      delete api.defaults.headers.common['X-Admin-Wallet'];
      delete api.defaults.headers.common['X-Admin-Passcode'];
      setPasscode('');
      setAuthError('Wrong passcode');
      haptic.error();
    }
  }

  function handleDigit(d: string) {
    if (passcode.length < 8) setPasscode(p => p + d);
  }

  function handleDelete() {
    setPasscode(p => p.slice(0, -1));
  }

  useEffect(() => {
    if (!authed || !tab) return;
    setLoading(true);
    setData(null);
    api.get(ENDPOINTS[tab])
      .then(r => setData(r.data))
      .catch(() => setData({ error: 'Failed to load' }))
      .finally(() => setLoading(false));
  }, [tab, authed, refreshKey]);

  function openTab(t: AdminTab) {
    setTab(t);
    setRefreshKey(k => k + 1);
    haptic.selection();
  }

  // ── Step 1: Connect wallet ─────────────────────────────────────────────────
  if (step === 'wallet') {
    return (
      <div style={s.authContainer}>
        <div style={s.authLogo}>🔐</div>
        <p style={s.authTitle}>Admin Dashboard</p>
        <p style={s.authHint}>Connect your treasury wallet to continue</p>
        <div style={s.authCard}>
          <button style={s.primaryBtn} onClick={() => tonConnectUI.openModal()}>
            Connect Treasury Wallet
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: Passcode ───────────────────────────────────────────────────────
  if (step === 'passcode') {
    const dots = Array.from({ length: 8 }, (_, i) => i < passcode.length);
    return (
      <div style={s.authContainer}>
        <div style={s.authLogo}>🔑</div>
        <p style={s.authTitle}>Enter Passcode</p>
        <p style={s.authHint}>
          {wallet?.account.address.slice(0,8)}…{wallet?.account.address.slice(-6)}
        </p>

        {/* Dots */}
        <div style={s.dotsRow}>
          {dots.map((filled, i) => (
            <div key={i} style={{ ...s.dot, ...(filled ? s.dotFilled : {}) }} />
          ))}
        </div>

        {authError && <p style={s.error}>{authError}</p>}

        {/* Numpad */}
        <div style={s.numpad}>
          {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
            <button
              key={i}
              style={{ ...s.numKey, ...(k === '' ? s.numKeyEmpty : {}) }}
              onClick={() => k === '⌫' ? handleDelete() : k !== '' ? handleDigit(k) : undefined}
              disabled={k === ''}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Tab detail view ────────────────────────────────────────────────────────
  if (tab) {
    const current = TABS.find(t2 => t2.id === tab);
    return (
      <div style={s.container}>
        <div style={s.topBar}>
          <p style={s.greeting}>{current?.emoji} {current?.label}</p>
          <button style={s.refreshBtn} onClick={() => setRefreshKey(k => k + 1)}>↻ Refresh</button>
        </div>
        <div style={s.content}>
          {loading && <p style={s.hint}>Loading…</p>}
          {!loading && data && <TabContent tab={tab} data={data} onRefresh={() => setRefreshKey(k => k + 1)} actingTxId={actingTxId} actingKind={actingKind} setActingTxId={setActingTxId} setActingKind={setActingKind} />}
        </div>
      </div>
    );
  }

  // ── Home / summary view ────────────────────────────────────────────────────
  return (
    <div style={s.container}>
      {/* Top bar */}
      <div style={s.topBar}>
        <p style={s.greeting}>Admin Panel 🛡️</p>
        <div style={s.badge}>Treasury</div>
      </div>

      {/* Summary card */}
      {summary && (
        <div style={s.summaryCard}>
          <p style={s.sectionLabel}>Overview</p>
          <div style={s.statsGrid}>
            <Stat label="Users"       value={summary.total_users}          />
            <Stat label="New Today"   value={summary.new_users_today}       />
            <Stat label="Active Games"value={summary.active_games}          />
            <Stat label="Queue"       value={summary.queue_size}            />
            <Stat label="Tournaments" value={summary.open_tournaments}      />
            <Stat label="Withdrawals" value={summary.pending_withdrawals}
                  highlight={summary.pending_withdrawals > 0}               />
          </div>
        </div>
      )}

      {/* Section grid */}
      <div style={s.grid}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            style={{ ...s.card, ...(i === 0 ? s.cardPrimary : {}) }}
            onClick={() => openTab(t.id)}
          >
            <span style={s.cardEmoji}>{t.emoji}</span>
            <span style={s.cardTitle}>{t.label}</span>
            <span style={s.cardSub}>{t.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────
function TabContent({ tab, data, onRefresh, actingTxId, actingKind, setActingTxId, setActingKind }: {
  tab: AdminTab;
  data: Record<string, unknown>;
  onRefresh: () => void;
  actingTxId: string | null;
  actingKind: 'approve' | 'reject' | null;
  setActingTxId: (id: string | null) => void;
  setActingKind: (kind: 'approve' | 'reject' | null) => void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);

  if (tab === 'treasury' && data.treasury) {
    const t = data.treasury as Record<string, string | null>;
    return (
      <div style={s.grid}>
        <StatCard label="Obligations"    value={`${fmt(t.totalObligations)} TON`}   />
        <StatCard label="Available"      value={`${fmt(t.totalAvailable)} TON`}      />
        <StatCard label="Locked"         value={`${fmt(t.totalLocked)} TON`}         />
        <StatCard label="Platform Fees"  value={`${fmt(t.platformFeesEarned)} TON`}  />
      </div>
    );
  }

  if (tab === 'withdrawals') {
    const ws = (data.withdrawals ?? []) as Array<Record<string, string>>;
    if (!ws.length) return <EmptyState icon="✅" text="No pending withdrawals" />;
    const runAction = async (id: string, kind: 'approve' | 'reject', username: string, amount: string) => {
      if (actingTxId) return;
      setActionError(null);
      setActingTxId(id);
      setActingKind(kind);
      try {
        if (kind === 'approve') {
          // Approval broadcasts a TON transfer and polls for the hash — can take up to 25s.
          // Use a per-request timeout well above the polling window.
          await api.post(`/api/admin/withdrawals/${id}/approve`, {}, { timeout: 60_000 });
          setActionError(`✅ Approved — ${parseFloat(amount).toFixed(2)} TON sent to ${username}`);
        } else {
          await api.post(`/api/admin/withdrawals/${id}/reject`, { reason: 'Rejected by admin' });
          setActionError(`↩️ Rejected — ${parseFloat(amount).toFixed(2)} TON refunded to ${username}`);
        }
        onRefresh();
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setActionError(`❌ ${msg ?? `Failed to ${kind} withdrawal`}`);
      } finally {
        setActingTxId(null);
        setActingKind(null);
      }
    };
    return (
      <div>
        {actionError && (
          <p style={actionError.startsWith('✅') || actionError.startsWith('↩️') ? s.success : s.error}>
            {actionError}
          </p>
        )}
        {ws.map(w => (
          <div key={w.id} style={s.itemCard}>
            <div style={s.itemRow}>
              <span style={s.itemTitle}>{w.username}</span>
              <span style={s.itemAmount}>{parseFloat(w.amount).toFixed(2)} TON</span>
            </div>
            <p style={s.itemSub}>{w.destination}</p>
            <p style={s.itemSub}>{new Date(w.created_at).toLocaleString()}</p>
            <div style={s.btnRow}>
              <button
                style={{ ...s.approveBtn, ...(actingTxId ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
                disabled={Boolean(actingTxId)}
                onClick={() => runAction(w.id, 'approve', w.username, w.amount)}
              >
                {actingTxId === w.id && actingKind === 'approve' ? 'Sending…' : '✅ Approve'}
              </button>
              <button
                style={{ ...s.rejectBtn, ...(actingTxId ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
                disabled={Boolean(actingTxId)}
                onClick={() => runAction(w.id, 'reject', w.username, w.amount)}
              >
                {actingTxId === w.id && actingKind === 'reject' ? 'Rejecting…' : '❌ Reject'}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (tab === 'users') {
    const users = (data.users ?? []) as Array<Record<string, string | number>>;
    if (!users.length) return <EmptyState icon="👥" text="No users found" />;
    return (
      <div>
        {users.map((u) => (
          <div key={u.id as string} style={s.itemCard}>
            <div style={s.itemRow}>
              <span style={s.itemTitle}>{u.username as string}</span>
              <span style={s.itemBadge}>ELO {u.elo}</span>
            </div>
            <p style={s.itemSub}>{(u.walletAddress as string)?.slice(0,12)}…</p>
            <p style={s.itemSub}>Games: {u.gamesPlayed} · Won: {u.gamesWon}</p>
          </div>
        ))}
      </div>
    );
  }

  if (tab === 'games') {
    const games = (data.games ?? []) as Array<Record<string, string>>;
    if (!games.length) return <EmptyState icon="♟️" text="No games found" />;
    return (
      <div>
        {games.map(g => (
          <div key={g.id} style={s.itemCard}>
            <div style={s.itemRow}>
              <span style={s.itemTitle}>{g.mode?.toUpperCase()} · {g.status}</span>
              <span style={s.itemBadge}>{parseFloat(g.stake ?? '0').toFixed(2)} TON</span>
            </div>
            <p style={s.itemSub}>{new Date(g.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    );
  }

  if (tab === 'tournaments') {
    const ts = (data.tournaments ?? []) as Array<Record<string, string | number>>;
    if (!ts.length) return <EmptyState icon="🏆" text="No tournaments found" />;
    return (
      <div>
        {ts.map(t => (
          <div key={t.id as string} style={s.itemCard}>
            <div style={s.itemRow}>
              <span style={s.itemTitle}>{t.name as string}</span>
              <span style={s.itemBadge}>{t.status as string}</span>
            </div>
            <p style={s.itemSub}>Players: {t.participant_count} · Prize: {parseFloat(String(t.prize_pool ?? 0)).toFixed(2)} TON</p>
          </div>
        ))}
      </div>
    );
  }

  if (tab === 'fees') {
    const fees = data.fees as Record<string, string | number> | null;
    if (!fees) return <EmptyState icon="💰" text="No fee data" />;
    return (
      <div style={s.grid}>
        <StatCard label="Total Collected" value={`${fmt(String(fees.totalFees))} TON`} />
        <StatCard label="This Month"      value={`${fmt(String(fees.thisMonth))} TON`} />
        <StatCard label="This Week"       value={`${fmt(String(fees.thisWeek))} TON`}  />
        <StatCard label="Today"           value={`${fmt(String(fees.today))} TON`}     />
      </div>
    );
  }

  if (tab === 'crashes') {
    const crashes = (data.crashes ?? []) as Array<Record<string, string>>;
    if (!crashes.length) return <EmptyState icon="✅" text="No crashes recorded" />;
    return (
      <div>
        {crashes.map(c => (
          <div key={c.id} style={{ ...s.itemCard, borderLeft: '3px solid #E53935' }}>
            <div style={s.itemRow}>
              <span style={s.itemTitle}>Game {c.game_id?.slice(0,8)}…</span>
              <span style={{ ...s.itemBadge, background: 'rgba(229,57,53,0.15)', color: '#E53935' }}>{parseFloat(c.stake ?? '0').toFixed(2)} TON</span>
            </div>
            <p style={s.itemSub}>{new Date(c.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    );
  }

  return <pre style={s.json}>{JSON.stringify(data, null, 2)}</pre>;
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div style={{ ...s.statCard, ...(highlight ? s.statHighlight : {}) }}>
      <p style={s.statLabel}>{label}</p>
      <p style={s.statValue}>{value}</p>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={s.statItem}>
      <p style={{ ...s.statItemValue, ...(highlight ? { color: '#FF8F00' } : {}) }}>{value ?? 0}</p>
      <p style={s.statItemLabel}>{label}</p>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={s.empty}>
      <span style={s.emptyIcon}>{icon}</span>
      <p style={s.emptyText}>{text}</p>
    </div>
  );
}

function fmt(v: string | null | undefined): string {
  return parseFloat(String(v ?? 0)).toFixed(2);
}

const s: Record<string, React.CSSProperties> = {
  // layout
  container:      { padding:'16px', background:'var(--tg-theme-bg-color)', minHeight:'100vh' },
  authContainer:  { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', padding:24, gap:12, background:'var(--tg-theme-bg-color)' },
  content:        { paddingBottom:40 },

  // auth
  authLogo:       { fontSize:56 },
  authTitle:      { color:'var(--tg-theme-text-color)', fontSize:24, fontWeight:700, margin:0 },
  authHint:       { color:'var(--tg-theme-hint-color)', fontSize:13, textAlign:'center', margin:0, fontFamily:'monospace' },
  authCard:       { background:'var(--tg-theme-secondary-bg-color)', borderRadius:16, padding:20, width:'100%', maxWidth:320, display:'flex', flexDirection:'column', gap:12 },
  primaryBtn:     { background:'#2AABEE', border:'none', borderRadius:12, padding:'14px', color:'#fff', fontSize:16, fontWeight:600, cursor:'pointer', width:'100%' },
  error:          { color:'var(--tg-theme-destructive-text-color)', fontSize:13, textAlign:'center', margin:0 },
  success:        { color:'#4CAF50', fontSize:13, textAlign:'center', margin:'0 0 10px', fontWeight:600 },
  // passcode
  dotsRow:        { display:'flex', gap:12, margin:'8px 0' },
  dot:            { width:14, height:14, borderRadius:'50%', border:'2px solid var(--tg-theme-hint-color)', background:'transparent' },
  dotFilled:      { background:'#2AABEE', borderColor:'#2AABEE' },
  numpad:         { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, width:'100%', maxWidth:280 },
  numKey:         { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:14, padding:'18px 0', fontSize:22, fontWeight:600, color:'var(--tg-theme-text-color)', cursor:'pointer' },
  numKeyEmpty:    { background:'transparent', cursor:'default' },

  // top bar
  topBar:         { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 },
  greeting:       { color:'var(--tg-theme-hint-color)', fontSize:13, margin:0 },
  badge:          { background:'rgba(42,171,238,0.15)', color:'#2AABEE', fontSize:11, fontWeight:600, padding:'4px 10px', borderRadius:20 },
  refreshBtn:     { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:8, padding:'6px 12px', fontSize:13, cursor:'pointer', color:'var(--tg-theme-text-color)' },

  // summary card
  summaryCard:    { background:'var(--tg-theme-secondary-bg-color)', borderRadius:16, padding:16, marginBottom:16 },
  sectionLabel:   { color:'var(--tg-theme-hint-color)', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, margin:'0 0 12px' },
  statsGrid:      { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 },
  statItem:       { textAlign:'center' },
  statItemValue:  { color:'var(--tg-theme-text-color)', fontSize:20, fontWeight:700, margin:0 },
  statItemLabel:  { color:'var(--tg-theme-hint-color)', fontSize:11, margin:'2px 0 0' },

  // nav grid
  grid:           { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 },
  card:           { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:16, padding:'18px 12px', display:'flex', flexDirection:'column', alignItems:'center', gap:4, cursor:'pointer', textAlign:'center' },
  cardPrimary:    { background:'#2AABEE', gridColumn:'1 / -1' },
  cardEmoji:      { fontSize:28 },
  cardTitle:      { color:'var(--tg-theme-text-color)', fontWeight:600, fontSize:15, margin:0 },
  cardSub:        { color:'var(--tg-theme-hint-color)', fontSize:12, margin:0 },

  // stat cards (treasury / fees)
  statCard:       { background:'var(--tg-theme-secondary-bg-color)', borderRadius:12, padding:'14px 12px' },
  statHighlight:  { background:'rgba(255,143,0,0.1)', border:'1px solid #FF8F00' },
  statLabel:      { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'0 0 4px' },
  statValue:      { color:'var(--tg-theme-text-color)', fontWeight:700, fontSize:18, margin:0 },

  // list item cards
  itemCard:       { background:'var(--tg-theme-secondary-bg-color)', borderRadius:12, padding:14, marginBottom:10 },
  itemRow:        { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 },
  itemTitle:      { color:'var(--tg-theme-text-color)', fontWeight:600, fontSize:14 },
  itemAmount:     { color:'#4CAF50', fontWeight:700, fontSize:14 },
  itemBadge:      { background:'rgba(42,171,238,0.15)', color:'#2AABEE', fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:20 },
  itemSub:        { color:'var(--tg-theme-hint-color)', fontSize:12, margin:'2px 0' },
  btnRow:         { display:'flex', gap:8, marginTop:10 },
  approveBtn:     { flex:1, background:'rgba(76,175,80,0.15)', border:'1px solid #4CAF50', borderRadius:10, padding:'10px', color:'#4CAF50', fontSize:13, fontWeight:600, cursor:'pointer' },
  rejectBtn:      { flex:1, background:'rgba(229,57,53,0.1)', border:'1px solid #E53935', borderRadius:10, padding:'10px', color:'#E53935', fontSize:13, fontWeight:600, cursor:'pointer' },

  // misc
  hint:           { color:'var(--tg-theme-hint-color)', fontSize:14, textAlign:'center' },
  empty:          { display:'flex', flexDirection:'column', alignItems:'center', gap:8, padding:'40px 0' },
  emptyIcon:      { fontSize:40 },
  emptyText:      { color:'var(--tg-theme-hint-color)', fontSize:14, margin:0 },
  json:           { background:'var(--tg-theme-secondary-bg-color)', borderRadius:12, padding:12, fontSize:11, color:'var(--tg-theme-text-color)', overflowX:'auto', whiteSpace:'pre-wrap' },
};
