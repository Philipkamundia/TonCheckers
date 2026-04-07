/**
 * TournamentLobbyRoom.tsx
 *
 * 10-second window for both players to confirm presence before a tournament match.
 * Emits tournament.lobby_join on mount.
 * - Both join  → tournament.game_start → navigate to /game/:gameId
 * - Opponent no-show → tournament.lobby_win (forfeit win) → TournamentPostRound
 * - Self no-show (shouldn't happen here) → tournament.lobby_forfeit
 */
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useWebSocket } from '../hooks/useWebSocket';
import { useStore } from '../store';

export function TournamentLobbyRoom() {
  const { gameId } = useParams<{ gameId: string }>();
  const { haptic } = useTelegram();
  const { on, emit } = useWebSocket();
  const { pendingTournamentLobby, setActiveGame, setActiveTournamentId, setPendingTournamentLobby } = useStore();
  const navigate = useNavigate();

  const [countdown, setCountdown] = useState(10);
  const [status, setStatus] = useState<'waiting' | 'both_ready' | 'forfeit_win' | 'forfeit_loss'>('waiting');

  const lobby = pendingTournamentLobby;

  // Signal presence as soon as we land here, countdown from server expiresAt
  useEffect(() => {
    if (!gameId) return;
    emit('tournament.lobby_join', { gameId });

    const expiresAt = lobby?.expiresAt ?? (Date.now() + 10_000);
    const initialRemaining = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    setCountdown(initialRemaining);

    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) clearInterval(timer);
    }, 500); // tick every 500ms for accuracy

    return () => clearInterval(timer);
  }, [gameId]);

  useEffect(() => {
    const unsubs = [
      on<{ gameId: string; tournamentId: string; playerNumber: 1 | 2 }>('tournament.game_start', (data) => {
        if (data.gameId !== gameId) return;
        haptic.success();
        setActiveGame(data.gameId, data.playerNumber);
        setActiveTournamentId(data.tournamentId);
        setPendingTournamentLobby(null);
        navigate(`/game/${data.gameId}`, { replace: true });
      }),

      on<{ gameId: string; tournamentId: string }>('tournament.lobby_win', (data) => {
        if (data.gameId !== gameId) return;
        haptic.success();
        setStatus('forfeit_win');
        setTimeout(() => {
          setPendingTournamentLobby(null);
          navigate(`/tournaments/${data.tournamentId}`, { replace: true });
        }, 2_000);
      }),

      on<{ gameId: string; tournamentId: string }>('tournament.lobby_forfeit', (data) => {
        if (data.gameId !== gameId) return;
        haptic.error();
        setStatus('forfeit_loss');
        setTimeout(() => {
          setPendingTournamentLobby(null);
          navigate(`/tournaments/${data.tournamentId}`, { replace: true });
        }, 2_000);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [on, gameId]);

  if (status === 'forfeit_win') {
    return (
      <div style={styles.centred}>
        <p style={styles.bigEmoji}>🏆</p>
        <p style={styles.title}>Opponent forfeited</p>
        <p style={styles.hint}>You advance to the next round</p>
      </div>
    );
  }

  if (status === 'forfeit_loss') {
    return (
      <div style={styles.centred}>
        <p style={styles.bigEmoji}>❌</p>
        <p style={styles.title}>You were forfeited</p>
        <p style={styles.hint}>You didn't join in time</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <p style={styles.roundLabel}>Round {lobby?.round ?? '?'}</p>
      <h2 style={styles.title}>Match Found</h2>

      <div style={styles.playersRow}>
        <div style={styles.playerCard}>
          <span style={styles.playerLabel}>You</span>
          <span style={styles.playerElo}>—</span>
        </div>
        <span style={styles.vs}>VS</span>
        <div style={styles.playerCard}>
          <span style={styles.playerLabel}>{lobby?.opponentUsername ?? 'Opponent'}</span>
          <span style={styles.playerElo}>{lobby?.opponentElo ?? '?'} ELO</span>
        </div>
      </div>

      <div style={styles.countdownCircle}>
        <span style={{ ...styles.countdownNum, color: countdown <= 3 ? '#E53935' : '#fff' }}>
          {countdown}
        </span>
      </div>

      <p style={styles.hint}>
        {countdown > 0
          ? `Waiting for opponent… ${countdown}s`
          : 'Checking opponent status…'}
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:      { padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, minHeight: '100vh', background: 'var(--tg-theme-bg-color)' },
  centred:        { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, background: 'var(--tg-theme-bg-color)' },
  roundLabel:     { color: '#2AABEE', fontSize: 13, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', margin: 0 },
  title:          { color: 'var(--tg-theme-text-color)', fontSize: 24, fontWeight: 700, margin: 0 },
  bigEmoji:       { fontSize: 56, margin: 0 },
  playersRow:     { display: 'flex', alignItems: 'center', gap: 16, width: '100%', justifyContent: 'center' },
  playerCard:     { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  playerLabel:    { color: 'var(--tg-theme-hint-color)', fontSize: 12 },
  playerElo:      { color: '#2AABEE', fontWeight: 700, fontSize: 18 },
  vs:             { color: 'var(--tg-theme-hint-color)', fontSize: 18, fontWeight: 700 },
  countdownCircle:{ width: 80, height: 80, borderRadius: 40, background: '#2AABEE', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  countdownNum:   { fontSize: 36, fontWeight: 700 },
  hint:           { color: 'var(--tg-theme-hint-color)', fontSize: 13 },
};
