/**
 * Profile.tsx — User profile, stats, preferences, disconnect
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { balanceApi } from '../services/api';

type Theme = 'system' | 'light' | 'dark';

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.style.setProperty('--tg-theme-bg-color',           '#1c1c1e');
    root.style.setProperty('--tg-theme-secondary-bg-color', '#2c2c2e');
    root.style.setProperty('--tg-theme-text-color',         '#ffffff');
    root.style.setProperty('--tg-theme-hint-color',         '#8e8e93');
  } else if (theme === 'light') {
    root.style.setProperty('--tg-theme-bg-color',           '#f2f2f7');
    root.style.setProperty('--tg-theme-secondary-bg-color', '#ffffff');
    root.style.setProperty('--tg-theme-text-color',         '#000000');
    root.style.setProperty('--tg-theme-hint-color',         '#6d6d72');
  }
  // 'system' — Telegram's theme vars take over; clear overrides
  if (theme === 'system') {
    root.style.removeProperty('--tg-theme-bg-color');
    root.style.removeProperty('--tg-theme-secondary-bg-color');
    root.style.removeProperty('--tg-theme-text-color');
    root.style.removeProperty('--tg-theme-hint-color');
  }
}

export function Profile() {
  const { showBackButton, hideMainButton, haptic } = useTelegram();
  const { user, balance, setBalance, logout } = useStore();
  const [tonConnectUI] = useTonConnectUI();
  const navigate = useNavigate();

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('app_theme') as Theme) ?? 'system'
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    hideMainButton();
    return showBackButton(() => navigate('/'));
  }, []);

  useEffect(() => {
    balanceApi.get().then(r => setBalance(r.data.balance)).catch(() => null);
  }, []);

  // Apply theme override
  useEffect(() => {
    localStorage.setItem('app_theme', theme);
    applyTheme(theme);
  }, [theme]);

  function copyAddress() {
    const addr = user?.walletAddress ?? '';
    navigator.clipboard.writeText(addr).then(() => {
      setCopied(true);
      haptic.success();
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleDisconnect() {
    haptic.impact('medium');
    await tonConnectUI.disconnect();
    logout();
    navigate('/connect', { replace: true });
  }

  const winRate = user && user.gamesPlayed > 0
    ? Math.round((user.gamesWon / user.gamesPlayed) * 100)
    : 0;

  const addr = user?.walletAddress ?? '';
  const shortAddr = addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : '—';

  return (
    <div style={s.container}>

      {/* Avatar + name */}
      <div style={s.header}>
        <div style={s.avatar}>{user?.username?.[0]?.toUpperCase() ?? '?'}</div>
        <p style={s.username}>{user?.username ?? 'Player'}</p>
        <p style={s.elo}>⚡ {user?.elo ?? 1200} ELO</p>
      </div>

      {/* Balance */}
      <div style={s.card}>
        <Row label="Available" value={`${parseFloat(balance?.available ?? '0').toFixed(3)} TON`} />
        {parseFloat(balance?.locked ?? '0') > 0 &&
          <Row label="Locked in game" value={`${parseFloat(balance!.locked).toFixed(3)} TON`} dim />}
        <Row label="Total won" value={`${parseFloat(user?.totalWon ?? '0').toFixed(3)} TON`} highlight />
      </div>

      {/* Stats */}
      <div style={s.card}>
        <p style={s.sectionTitle}>Stats</p>
        <div style={s.statsGrid}>
          <Stat label="Played"  value={user?.gamesPlayed ?? 0} />
          <Stat label="Won"     value={user?.gamesWon    ?? 0} color="#4CAF50" />
          <Stat label="Lost"    value={user?.gamesLost   ?? 0} color="#ff3b30" />
          <Stat label="Drawn"   value={user?.gamesDrawn  ?? 0} color="#FF9500" />
          <Stat label="Win rate" value={`${winRate}%`}         color="#2AABEE" />
          <Stat label="ELO"     value={user?.elo ?? 1200}      color="#2AABEE" />
        </div>
      </div>

      {/* Wallet */}
      <div style={s.card}>
        <p style={s.sectionTitle}>Wallet</p>
        <button style={s.addrRow} onClick={copyAddress}>
          <span style={s.addrText}>{shortAddr}</span>
          <span style={s.addrCopy}>{copied ? '✅ Copied' : '📋 Copy'}</span>
        </button>
        <div style={s.walletBtns}>
          <button style={s.outlineBtn} onClick={() => navigate('/deposit')}>Deposit</button>
          <button style={s.outlineBtn} onClick={() => navigate('/withdraw')}>Withdraw</button>
        </div>
      </div>

      {/* Theme */}
      <div style={s.card}>
        <p style={s.sectionTitle}>Theme</p>
        <div style={s.themeRow}>
          {(['system', 'light', 'dark'] as Theme[]).map(t => (
            <button
              key={t}
              style={{ ...s.themeBtn, ...(theme === t ? s.themeBtnActive : {}) }}
              onClick={() => { setTheme(t); haptic.selection(); }}
            >
              {t === 'system' ? '🌐 System' : t === 'light' ? '☀️ Light' : '🌙 Dark'}
            </button>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div style={s.card}>
        <p style={s.sectionTitle}>Quick Links</p>
        <LinkRow label="🏆 Tournaments"  onClick={() => navigate('/tournaments')} />
        <LinkRow label="📊 Leaderboard"  onClick={() => navigate('/leaderboard')} />
        <LinkRow label="⚔️  Play PvP"     onClick={() => navigate('/pvp')} />
        <LinkRow label="🤖 Practice AI"  onClick={() => navigate('/ai')} />
      </div>

      {/* Disconnect */}
      <button style={s.disconnectBtn} onClick={handleDisconnect}>
        Disconnect Wallet
      </button>

      <p style={s.footer}>CheckTON · Wager. Play. Win.</p>
    </div>
  );
}

function Row({ label, value, highlight, dim }: { label: string; value: string; highlight?: boolean; dim?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(128,128,128,0.1)' }}>
      <span style={{ color: 'var(--tg-theme-hint-color)', fontSize: 14 }}>{label}</span>
      <span style={{ color: highlight ? '#4CAF50' : dim ? 'var(--tg-theme-hint-color)' : 'var(--tg-theme-text-color)', fontSize: 14, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 4px' }}>
      <p style={{ color: color ?? 'var(--tg-theme-text-color)', fontSize: 20, fontWeight: 700, margin: 0 }}>{value}</p>
      <p style={{ color: 'var(--tg-theme-hint-color)', fontSize: 11, margin: '2px 0 0' }}>{label}</p>
    </div>
  );
}

function LinkRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid rgba(128,128,128,0.1)', padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', color: 'var(--tg-theme-text-color)', fontSize: 15 }}
      onClick={onClick}>
      <span>{label}</span>
      <span style={{ color: 'var(--tg-theme-hint-color)' }}>›</span>
    </button>
  );
}

const s: Record<string, React.CSSProperties> = {
  container:      { padding: '16px 16px 40px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
  header:         { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0 20px' },
  avatar:         { width: 72, height: 72, borderRadius: '50%', background: '#2AABEE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700, color: '#fff', marginBottom: 12 },
  username:       { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: 0 },
  elo:            { color: '#2AABEE', fontSize: 14, fontWeight: 600, margin: '4px 0 0' },
  card:           { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 16, padding: '16px', marginBottom: 12 },
  sectionTitle:   { color: 'var(--tg-theme-hint-color)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px' },
  statsGrid:      { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 },
  addrRow:        { width: '100%', background: 'rgba(128,128,128,0.1)', border: 'none', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: 10 },
  addrText:       { color: 'var(--tg-theme-text-color)', fontSize: 13, fontFamily: 'monospace' },
  addrCopy:       { color: '#2AABEE', fontSize: 12 },
  walletBtns:     { display: 'flex', gap: 8 },
  outlineBtn:     { flex: 1, background: 'none', border: '1.5px solid #2AABEE', borderRadius: 10, padding: '10px', color: '#2AABEE', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  themeRow:       { display: 'flex', gap: 8 },
  themeBtn:       { flex: 1, background: 'rgba(128,128,128,0.1)', border: '2px solid transparent', borderRadius: 10, padding: '10px 4px', color: 'var(--tg-theme-text-color)', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  themeBtnActive: { borderColor: '#2AABEE', background: 'rgba(42,171,238,0.1)' },
  disconnectBtn:  { width: '100%', background: 'rgba(255,59,48,0.1)', border: '1.5px solid #ff3b30', borderRadius: 12, padding: '14px', color: '#ff3b30', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
  footer:         { color: 'var(--tg-theme-hint-color)', fontSize: 11, textAlign: 'center', marginTop: 20 },
};
