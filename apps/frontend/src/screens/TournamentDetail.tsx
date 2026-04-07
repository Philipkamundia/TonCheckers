import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useWebSocket } from '../hooks/useWebSocket';
import { useStore } from '../store';
import { tournamentApi } from '../services/api';
import type { TournamentLobbyPayload } from '../store';

interface Match {
  round: number; matchNumber: number;
  player1Id: string | null; player2Id: string | null;
  winnerId: string | null; isBye: boolean;
}
interface Participant {
  userId: string; username: string; elo: number;
  isEliminated: boolean; receivedBye: boolean;
}
interface TournamentData {
  id: string; name: string; status: string; bracketSize: number;
  entryFee: string; prizePool: string; currentRound: number;
  startsAt: string; creatorUsername: string; winnerId?: string; winnerPayout?: string;
  participants: Participant[]; matches: Match[];
}

export function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const { showBackButton, showMainButton, hideMainButton, setMainButtonLoading, haptic } = useTelegram();
  const { on, emit } = useWebSocket();
  const { user, setPendingTournamentLobby } = useStore();
  const navigate = useNavigate();

  const [tournament,       setTournament]       = useState<TournamentData | null>(null);
  const [joined,           setJoined]           = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [statusMsg,        setStatusMsg]        = useState<string | null>(null);
  const [bracketCountdown, setBracketCountdown] = useState<number | null>(null);

  const refresh = () =>
    tournamentApi.get(id!).then(r => setTournament(r.data.tournament)).catch(() => null);

  useEffect(() => { return showBackButton(() => navigate('/tournaments')); }, []);
  useEffect(() => { refresh(); }, [id]);

  // Signal bracket presence as soon as we land here
  useEffect(() => {
    if (!id) return;
    emit('tournament.bracket_join', { tournamentId: id });
  }, [id]);

  // 30s countdown — active when tournament is in_progress but currentRound=0 (window open)
  useEffect(() => {
    if (!tournament || tournament.status !== 'in_progress' || tournament.currentRound !== 0) return;
    setBracketCountdown(30);
    const timer = setInterval(() => {
      setBracketCountdown(prev => {
        if (prev === null || prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [tournament?.status, tournament?.currentRound]);

  // Live WS events
  useEffect(() => {
    const unsubs = [
      on<TournamentLobbyPayload>('tournament.lobby_ready', (data) => {
        if (data.tournamentId !== id) return;
        setPendingTournamentLobby(data);
        navigate(`/tournament-lobby/${data.gameId}`);
      }),
      on<{ tournamentId: string }>('tournament.bye_advance', (data) => {
        if (data.tournamentId !== id) return;
        setStatusMsg('You have a bye — waiting for your next opponent…');
        refresh();
      }),
      on<{ tournamentId: string }>('tournament.completed', (data) => {
        if (data.tournamentId !== id) return;
        refresh();
      }),
      on<{ tournamentId: string; reason: string }>('tournament.cancelled', (data) => {
        if (data.tournamentId !== id) return;
        setError(`Tournament cancelled: ${data.reason}`);
        setTournament(prev => prev ? { ...prev, status: 'cancelled' } : prev);
        hideMainButton();
      }),
      on<{ tournamentId: string }>('tournament.bracket_forfeit', (data) => {
        if (data.tournamentId !== id) return;
        setError('You were forfeited — did not join bracket in time');
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [on, id]);

  // Join button — only when open and not yet joined
  useEffect(() => {
    if (!tournament || tournament.status !== 'open' || joined) { hideMainButton(); return; }
    return showMainButton(`Join · ${parseFloat(tournament.entryFee).toFixed(2)} TON`, handleJoin, { color: '#2AABEE' });
  }, [tournament, joined]);

  async function handleJoin() {
    setMainButtonLoading(true);
    try {
      await tournamentApi.join(id!);
      setJoined(true);
      haptic.success();
      refresh();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to join');
      haptic.error();
    } finally {
      setMainButtonLoading(false);
    }
  }

  if (!tournament) return <div style={styles.loading}>Loading…</div>;

  const isInProgress    = tournament.status === 'in_progress';
  const isCompleted     = tournament.status === 'completed';
  const isBracketWindow = isInProgress && tournament.currentRound === 0;
  const myId            = user?.id;

  const startsDate  = tournament.startsAt ? new Date(tournament.startsAt) : null;
  const startsLabel = startsDate && !isNaN(startsDate.getTime())
    ? startsDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const maxRound = tournament.matches.length
    ? Math.max(...tournament.matches.map(m => m.round))
    : 0;

  const myActiveMatch = isInProgress && tournament.currentRound > 0
    ? tournament.matches.find(m =>
        m.round === tournament.currentRound && !m.isBye && !m.winnerId &&
        (m.player1Id === myId || m.player2Id === myId),
      )
    : null;

  const myOpponentId = myActiveMatch
    ? (myActiveMatch.player1Id === myId ? myActiveMatch.player2Id : myActiveMatch.player1Id)
    : null;

  const me           = tournament.participants.find(p => p.userId === myId);
  const isEliminated = me?.isEliminated ?? false;
  const isWinner     = isCompleted && tournament.winnerId === myId;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>{tournament.name}</h2>

      <div style={styles.infoRow}>
        <Stat label="Players" value={`${tournament.participants.length}/${tournament.bracketSize}`} />
        <Stat label="Entry"   value={`${parseFloat(tournament.entryFee).toFixed(2)} TON`} />
        <Stat label="Prize"   value={`${parseFloat(tournament.prizePool).toFixed(2)} TON`} />
      </div>

      {tournament.status === 'open' && startsLabel && (
        <p style={styles.starts}>Starts {startsLabel}</p>
      )}
      {error     && <p style={styles.error}>{error}</p>}
      {joined    && <p style={styles.success}>✅ Registered! You'll be notified before start.</p>}
      {statusMsg && <p style={styles.statusMsg}>{statusMsg}</p>}

      {/* Bracket presence countdown */}
      {isBracketWindow && (
        <div style={styles.bracketWindow}>
          <p style={styles.bracketWindowTitle}>🏆 Tournament Starting!</p>
          <p style={styles.bracketWindowSub}>Pairs are being determined — stay on this screen</p>
          <div style={{
            ...styles.countdownCircle,
            background: (bracketCountdown ?? 30) <= 10 ? '#E53935' : '#2AABEE',
          }}>
            <span style={styles.countdownNum}>{bracketCountdown ?? 30}</span>
          </div>
          <p style={styles.bracketWindowHint}>Players not here will be forfeited</p>
        </div>
      )}

      {/* My active match callout */}
      {myActiveMatch && myOpponentId && (() => {
        const opp = tournament.participants.find(p => p.userId === myOpponentId);
        return (
          <div style={styles.myMatchBanner}>
            <p style={styles.myMatchLabel}>Your match · Round {tournament.currentRound}</p>
            <div style={styles.myMatchRow}>
              <span style={styles.myMatchMe}>★ You ({me?.elo ?? '?'})</span>
              <span style={styles.myMatchVs}>VS</span>
              <span style={styles.myMatchOpp}>{opp?.username ?? '?'} ({opp?.elo ?? '?'})</span>
            </div>
          </div>
        );
      })()}

      {/* Completed banner */}
      {isCompleted && (
        <div style={styles.completedBanner}>
          <p style={styles.completedEmoji}>{isWinner ? '🏆' : '🎖️'}</p>
          <p style={styles.completedTitle}>
            {isWinner
              ? 'You won the tournament!'
              : `Winner: ${tournament.participants.find(p => p.userId === tournament.winnerId)?.username ?? '?'}`}
          </p>
          {isWinner && <p style={styles.completedSub}>+{tournament.winnerPayout} TON</p>}
          {isEliminated && !isWinner && <p style={styles.completedSub}>You were eliminated</p>}
        </div>
      )}

      {/* Bracket */}
      {maxRound > 0 && (
        <div style={styles.section}>
          <p style={styles.sectionTitle}>
            {isInProgress && tournament.currentRound > 0
              ? `Bracket · Round ${tournament.currentRound}`
              : 'Bracket'}
          </p>
          {Array.from({ length: maxRound }, (_, i) => i + 1).map(round => (
            <div key={round}>
              <p style={styles.roundLabel}>Round {round}</p>
              {tournament.matches.filter(m => m.round === round).map(m => {
                const p1     = tournament.participants.find(p => p.userId === m.player1Id);
                const p2     = tournament.participants.find(p => p.userId === m.player2Id);
                const isMine = m.player1Id === myId || m.player2Id === myId;
                const active = !m.winnerId && !m.isBye;
                return (
                  <div key={m.matchNumber} style={{
                    ...styles.matchCard,
                    ...(isMine ? styles.matchCardMine : {}),
                    ...(active && isMine ? styles.matchCardActive : {}),
                  }}>
                    <PlayerSlot
                      name={p1?.username ?? 'TBD'} elo={p1?.elo}
                      isMe={p1?.userId === myId}
                      isWinner={m.winnerId === m.player1Id}
                      isEliminated={!!p1?.isEliminated && !!m.winnerId && m.winnerId !== m.player1Id}
                    />
                    <span style={styles.vs}>{m.isBye ? 'BYE' : 'vs'}</span>
                    <PlayerSlot
                      name={m.isBye ? '—' : (p2?.username ?? 'TBD')}
                      elo={m.isBye ? undefined : p2?.elo}
                      isMe={p2?.userId === myId}
                      isWinner={m.winnerId === m.player2Id}
                      isEliminated={!!p2?.isEliminated && !!m.winnerId && m.winnerId !== m.player2Id}
                      alignRight
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Prize breakdown — only when open */}
      {tournament.status === 'open' && (
        <div style={styles.section}>
          <p style={styles.sectionTitle}>Prize Distribution</p>
          <PrizeRow label="🥇 Winner (70%)" value={`${(parseFloat(tournament.prizePool) * 0.70).toFixed(2)} TON`} />
          <PrizeRow label="👤 Creator (5%)"  value={`${(parseFloat(tournament.prizePool) * 0.05).toFixed(2)} TON`} />
          <PrizeRow label="🏦 Platform (25%)" value={`${(parseFloat(tournament.prizePool) * 0.25).toFixed(2)} TON`} />
        </div>
      )}
    </div>
  );
}

function PlayerSlot({ name, elo, isMe, isWinner, isEliminated, alignRight }: {
  name: string; elo?: number; isMe?: boolean;
  isWinner?: boolean; isEliminated?: boolean; alignRight?: boolean;
}) {
  const color = isWinner ? '#4CAF50' : isEliminated ? 'var(--tg-theme-hint-color)' : 'var(--tg-theme-text-color)';
  return (
    <div style={{ flex: 1, textAlign: alignRight ? 'right' : 'left' }}>
      <span style={{ fontSize: 13, fontWeight: isMe ? 700 : 400, color, textDecoration: isEliminated ? 'line-through' : 'none' }}>
        {isMe ? `★ ${name}` : name}
      </span>
      {elo !== undefined && (
        <span style={{ display: 'block', fontSize: 11, color: 'var(--tg-theme-hint-color)' }}>{elo} ELO</span>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{ color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: 0 }}>{label}</p>
      <p style={{ color: 'var(--tg-theme-text-color)', fontWeight: 700, fontSize: 16, margin: 0 }}>{value}</p>
    </div>
  );
}

function PrizeRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: 'var(--tg-theme-text-color)', fontSize: 14 }}>{label}</span>
      <span style={{ color: '#2AABEE', fontWeight: 600, fontSize: 14 }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:          { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh', paddingBottom: 80 },
  loading:            { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--tg-theme-hint-color)', background: 'var(--tg-theme-bg-color)' },
  title:              { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 12px' },
  infoRow:            { display: 'flex', justifyContent: 'space-around', background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: 14, marginBottom: 12 },
  starts:             { color: '#4CAF50', fontSize: 13, marginBottom: 8 },
  error:              { color: 'var(--tg-theme-destructive-text-color)', fontSize: 13 },
  success:            { color: '#4CAF50', fontSize: 13 },
  statusMsg:          { color: '#2AABEE', fontSize: 13, textAlign: 'center', padding: '8px 0' },
  bracketWindow:      { background: 'rgba(42,171,238,0.1)', border: '1px solid #2AABEE', borderRadius: 16, padding: '20px 16px', textAlign: 'center', marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  bracketWindowTitle: { color: 'var(--tg-theme-text-color)', fontSize: 18, fontWeight: 700, margin: 0 },
  bracketWindowSub:   { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: 0 },
  bracketWindowHint:  { color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: 0 },
  countdownCircle:    { width: 72, height: 72, borderRadius: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  countdownNum:       { color: '#fff', fontSize: 32, fontWeight: 700 },
  myMatchBanner:      { background: 'rgba(42,171,238,0.12)', border: '1px solid #2AABEE', borderRadius: 14, padding: '12px 16px', marginBottom: 12 },
  myMatchLabel:       { color: '#2AABEE', fontSize: 12, fontWeight: 600, margin: '0 0 8px', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  myMatchRow:         { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  myMatchMe:          { color: 'var(--tg-theme-text-color)', fontWeight: 700, fontSize: 15 },
  myMatchVs:          { color: 'var(--tg-theme-hint-color)', fontSize: 13, padding: '0 12px' },
  myMatchOpp:         { color: 'var(--tg-theme-text-color)', fontSize: 15 },
  completedBanner:    { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 20, padding: '20px 16px', textAlign: 'center', marginBottom: 12 },
  completedEmoji:     { fontSize: 44, margin: '0 0 6px' },
  completedTitle:     { color: 'var(--tg-theme-text-color)', fontSize: 18, fontWeight: 700, margin: '0 0 4px' },
  completedSub:       { color: 'var(--tg-theme-hint-color)', fontSize: 14, margin: 0 },
  section:            { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: 14, marginTop: 12 },
  sectionTitle:       { color: 'var(--tg-theme-text-color)', fontWeight: 600, fontSize: 15, margin: '0 0 10px' },
  roundLabel:         { color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: '8px 0 4px', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  matchCard:          { display: 'flex', alignItems: 'center', background: 'var(--tg-theme-bg-color)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 },
  matchCardMine:      { border: '1px solid rgba(42,171,238,0.3)' },
  matchCardActive:    { border: '1px solid #2AABEE', background: 'rgba(42,171,238,0.06)' },
  vs:                 { color: 'var(--tg-theme-hint-color)', fontSize: 12, padding: '0 10px', flexShrink: 0 },
};
