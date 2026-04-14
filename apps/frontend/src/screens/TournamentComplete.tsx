/**
 * TournamentComplete.tsx — Final result screen after tournament ends.
 * Shown after the bracket 10s display when tournament.completed fires.
 */
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { balanceApi } from '../services/api';
import { useStore } from '../store';

interface CompleteState {
  tournamentName: string;
  isWinner:       boolean;
  winnerUsername: string;
  winnerPayout:   string;
  prizePool:      string;
}

export function TournamentComplete() {
  const { showMainButton, haptic } = useTelegram();
  const { setBalance } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as CompleteState | null;

  useEffect(() => {
    if (!state) navigate('/tournaments', { replace: true });
  }, [state, navigate]);

  useEffect(() => {
    balanceApi.get().then(r => setBalance(r.data.balance)).catch(() => null);
    if (state?.isWinner) haptic.success();
  }, []);

  useEffect(() => {
    return showMainButton('Back to Home', () => navigate('/', { replace: true }), { color: '#2AABEE' });
  }, []);

  if (!state) return null;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <p style={styles.emoji}>{state.isWinner ? '🏆' : '🎖️'}</p>
        <h1 style={styles.title}>
          {state.isWinner ? 'You won the tournament!' : 'Tournament Complete'}
        </h1>
        <p style={styles.sub}>
          {state.isWinner
            ? `+${state.winnerPayout} TON added to your balance`
            : `Winner: ${state.winnerUsername}`}
        </p>

        {state.isWinner && (
          <div style={styles.breakdown}>
            <Row label="Prize pool" value={`${parseFloat(state.prizePool).toFixed(2)} TON`} />
            <Row label="Your payout (70%)" value={`${parseFloat(state.winnerPayout).toFixed(2)} TON`} highlight />
          </div>
        )}

        <button style={styles.shareBtn} onClick={() => {
          haptic.impact('light');
          const text = state.isWinner
            ? `I just won a tournament on CheckTON! 🏆 +${state.winnerPayout} TON`
            : `Just played in a tournament on CheckTON! ♟️`;
          window.open(`https://t.me/share/url?url=t.me/CheckTONBot&text=${encodeURIComponent(text)}`, '_blank');
        }}>
          Share Result
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ color: 'var(--tg-theme-hint-color)', fontSize: 14 }}>{label}</span>
      <span style={{ color: highlight ? '#4CAF50' : 'var(--tg-theme-text-color)', fontWeight: highlight ? 700 : 400, fontSize: 14 }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', background: 'var(--tg-theme-bg-color)', paddingBottom: 80 },
  card:      { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 20, padding: '28px 20px', width: '100%', maxWidth: 360, textAlign: 'center' },
  emoji:     { fontSize: 64, margin: '0 0 12px' },
  title:     { color: 'var(--tg-theme-text-color)', fontSize: 24, fontWeight: 800, margin: '0 0 8px' },
  sub:       { color: 'var(--tg-theme-hint-color)', fontSize: 15, margin: '0 0 20px' },
  breakdown: { borderTop: '1px solid var(--tg-theme-bg-color)', paddingTop: 12, marginBottom: 20 },
  shareBtn:  { background: 'var(--tg-theme-bg-color)', border: 'none', borderRadius: 12, padding: '12px 28px', color: '#2AABEE', fontSize: 15, fontWeight: 500, cursor: 'pointer' },
};
