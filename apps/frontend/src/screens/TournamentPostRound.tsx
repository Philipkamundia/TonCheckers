/**
 * TournamentPostRound.tsx
 *
 * Shown after a tournament game ends (win/loss/forfeit).
 * Displays result + bracket snapshot.
 * Listens for tournament.lobby_ready to route to next match,
 * or tournament.completed to show the winner screen.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useWebSocket } from '../hooks/useWebSocket';
import { useStore } from '../store';
import { tournamentApi } from '../services/api';
import { debugIngest } from '../utils/debugIngest';
import type { TournamentLobbyPayload } from '../store';

interface TournamentDetail {
  id: string; name: string; status: string; currentRound: number;
  prizePool: string; bracketSize: number;
  participants: { userId: string; username: string; elo: number; isEliminated: boolean }[];
  matches: { round: number; matchNumber: number; player1Id: string | null; player2Id: string | null; winnerId: string | null; isBye: boolean }[];
  winnerId?: string;
  winnerPayout?: string;
}

export function TournamentPostRound() {
  const { id: tournamentId } = useParams<{ id: string }>();
  const { showBackButton } = useTelegram();
  const { on } = useWebSocket();
  const { user, setPendingTournamentLobby } = useStore();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [nextMatchMsg, setNextMatchMsg] = useState<string>('Waiting for next match…');
  const [roundPreviewExpiresAt, setRoundPreviewExpiresAt] = useState<number | null>(null);
  const [roundPreviewCountdown, setRoundPreviewCountdown] = useState<number>(0);

  // #region agent log
  useEffect(() => {
    debugIngest({ location: 'TournamentPostRound.tsx:mount', message: 'post_round_mounted', data: { tournamentId: tournamentId ?? null }, hypothesisId: 'H3', runId: 'post-fix' });
  }, [tournamentId]);
  // #endregion

  useEffect(() => {
    return showBackButton(() => navigate('/tournaments'));
  }, []);

  useEffect(() => {
    if (!tournamentId) return;
    tournamentApi.get(tournamentId).then(r => setTournament(r.data.tournament)).catch(() => null);
  }, [tournamentId]);

  useEffect(() => {
    const unsubs = [
      on<{ tournamentId: string; round: number; expiresAt: number }>('tournament.round_preview', (data) => {
        if (data.tournamentId !== tournamentId) return;
        setRoundPreviewExpiresAt(data.expiresAt);
        setNextMatchMsg(`Round ${data.round} bracket is visible. Lobby opens in ${Math.max(0, Math.ceil((data.expiresAt - Date.now()) / 1000))}s`);
        tournamentApi.get(tournamentId!).then(r => setTournament(r.data.tournament)).catch(() => null);
      }),

      on<TournamentLobbyPayload>('tournament.lobby_ready', (data) => {
        if (data.tournamentId !== tournamentId) return;
        setPendingTournamentLobby(data);
        navigate(`/tournament-lobby/${data.gameId}`, { replace: true });
      }),

      on<{ tournamentId: string; winnerId: string; winnerPayout: string }>('tournament.completed', (data) => {
        if (data.tournamentId !== tournamentId) return;
        tournamentApi.get(tournamentId!).then(r => setTournament(r.data.tournament)).catch(() => null);
        setNextMatchMsg('');
      }),

      on<{ tournamentId: string }>('tournament.bye_advance', (data) => {
        if (data.tournamentId !== tournamentId) return;
        setNextMatchMsg('You have a bye — waiting for your next opponent…');
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [on, tournamentId]);

  useEffect(() => {
    if (!roundPreviewExpiresAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((roundPreviewExpiresAt - Date.now()) / 1000));
      setRoundPreviewCountdown(remaining);
      if (remaining === 0) setRoundPreviewExpiresAt(null);
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [roundPreviewExpiresAt]);

  if (!tournament) {
    return <div style={styles.loading}>Loading…</div>;
  }

  const me = tournament.participants.find(p => p.userId === user?.id);
  const iEliminated = me?.isEliminated ?? false;
  const isWinner = tournament.status === 'completed' && tournament.winnerId === user?.id;

  const maxRound = Math.max(...tournament.matches.map(m => m.round), 1);

  return (
    <div style={styles.container}>
      {/* Result banner */}
      {tournament.status === 'completed' ? (
        <div style={styles.banner}>
          <p style={styles.bannerEmoji}>{isWinner ? '🏆' : '🎖️'}</p>
          <p style={styles.bannerTitle}>{isWinner ? 'You won the tournament!' : 'Tournament complete'}</p>
          {isWinner && <p style={styles.bannerSub}>+{tournament.winnerPayout} TON</p>}
        </div>
      ) : iEliminated ? (
        <div style={styles.banner}>
          <p style={styles.bannerEmoji}>💔</p>
          <p style={styles.bannerTitle}>Eliminated</p>
          <p style={styles.bannerSub}>Better luck next time</p>
        </div>
      ) : (
        <div style={styles.banner}>
          <p style={styles.bannerEmoji}>✅</p>
          <p style={styles.bannerTitle}>Round {tournament.currentRound - 1} complete</p>
          <p style={styles.bannerSub}>{nextMatchMsg}</p>
          {roundPreviewCountdown > 0 && <p style={styles.bannerSub}>Next lobby in {roundPreviewCountdown}s</p>}
        </div>
      )}

      {/* Bracket */}
      <div style={styles.section}>
        <p style={styles.sectionTitle}>Bracket · Round {tournament.currentRound}</p>
        {Array.from({ length: maxRound }, (_, i) => i + 1).map(round => (
          <div key={round}>
            <p style={styles.roundLabel}>Round {round}</p>
            {tournament.matches.filter(m => m.round === round).map(m => {
              const p1 = tournament.participants.find(p => p.userId === m.player1Id);
              const p2 = tournament.participants.find(p => p.userId === m.player2Id);
              return (
                <div key={m.matchNumber} style={styles.matchCard}>
                  <span style={{ ...styles.matchPlayer, ...(m.winnerId === m.player1Id ? styles.winner : {}) }}>
                    {p1?.username ?? 'TBD'}
                  </span>
                  <span style={styles.vs}>{m.isBye ? 'BYE' : 'vs'}</span>
                  <span style={{ ...styles.matchPlayer, ...(m.winnerId === m.player2Id ? styles.winner : {}) }}>
                    {m.isBye ? '—' : (p2?.username ?? 'TBD')}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:    { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh', paddingBottom: 80 },
  loading:      { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--tg-theme-hint-color)', background: 'var(--tg-theme-bg-color)' },
  banner:       { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 20, padding: '24px 16px', textAlign: 'center', marginBottom: 16 },
  bannerEmoji:  { fontSize: 48, margin: '0 0 8px' },
  bannerTitle:  { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
  bannerSub:    { color: 'var(--tg-theme-hint-color)', fontSize: 14, margin: 0 },
  section:      { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: 14, marginTop: 12 },
  sectionTitle: { color: 'var(--tg-theme-text-color)', fontWeight: 600, fontSize: 15, margin: '0 0 10px' },
  roundLabel:   { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '8px 0 4px' },
  matchCard:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--tg-theme-bg-color)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 },
  matchPlayer:  { color: 'var(--tg-theme-text-color)', fontSize: 13, flex: 1 },
  winner:       { color: '#4CAF50', fontWeight: 700 },
  vs:           { color: 'var(--tg-theme-hint-color)', fontSize: 12, padding: '0 8px' },
};
