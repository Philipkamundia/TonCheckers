import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useWebSocket, onReconnect } from '../hooks/useWebSocket';
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

// Phase the bracket screen can be in
type BracketPhase =
  | 'open'           // tournament not started yet
  | 'presence'       // 30s bracket/pairing window before lobby starts
  | 'waiting'        // waiting for next opponent to finish their game
  | 'complete_preview' // 10s showing final bracket before complete screen
  | 'done';          // tournament over, navigating away

export function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const routeState = location.state as { startingExpiresAt?: number } | null;
  const { showBackButton, showMainButton, hideMainButton, setMainButtonLoading, haptic } = useTelegram();
  const { on, emit } = useWebSocket();
  const {
    user,
    setPendingTournamentLobby,
    addParticipatingTournament,
    removeParticipatingTournament,
  } = useStore();
  const navigate = useNavigate();

  const [tournament,       setTournament]       = useState<TournamentData | null>(null);
  const [joined,           setJoined]           = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [statusMsg,        setStatusMsg]        = useState<string | null>(null);
  const [phase,            setPhase]            = useState<BracketPhase>('open');
  const [phaseCountdown,   setPhaseCountdown]   = useState<number>(0);
  const [bracketExpiresAt, setBracketExpiresAt] = useState<number | null>(null);
  const [presenceKind, setPresenceKind] = useState<'start_wait' | 'round_preview'>('start_wait');
  const hasActiveStartWindow = presenceKind === 'start_wait' && Boolean(bracketExpiresAt && bracketExpiresAt > Date.now());

  // Pending complete data — held during complete_preview phase
  const pendingCompleteRef = useRef<{
    isWinner: boolean; winnerUsername: string; winnerPayout: string; prizePool: string;
  } | null>(null);

  const refresh = async (): Promise<TournamentData | null> => {
    try {
      const r = await tournamentApi.get(id!);
      const t = r.data.tournament as TournamentData;
      setTournament(t);
      return t;
    } catch {
      return null;
    }
  };

  useEffect(() => { return showBackButton(() => navigate('/tournaments')); }, []);
  useEffect(() => { refresh(); }, [id]);
  useEffect(() => {
    const persisted = id ? Number(sessionStorage.getItem(`tournamentStarting:${id}`) ?? '') : NaN;
    const persistedExpiresAt = Number.isFinite(persisted) ? persisted : null;
    const sourceExpiresAt = routeState?.startingExpiresAt ?? persistedExpiresAt;
    if (sourceExpiresAt && sourceExpiresAt > Date.now()) {
      setBracketExpiresAt(sourceExpiresAt);
      setPresenceKind('start_wait');
      const remaining = Math.max(0, Math.ceil((sourceExpiresAt - Date.now()) / 1000));
      setPhase('presence');
      setPhaseCountdown(remaining);
      setStatusMsg('Waiting for players to join/accept…');
    }
  }, [routeState?.startingExpiresAt, id]);

  // Signal bracket presence on mount + after every reconnect (same screen)
  useEffect(() => {
    if (!id) return;
    const send = () => emit('tournament.bracket_join', { tournamentId: id });
    send();
    return onReconnect(send);
  }, [id, emit]);

  // Track participation for mid-game tournament prompts (GameRoom)
  useEffect(() => {
    if (!tournament || !user?.id) return;
    const me = tournament.participants.find(p => p.userId === user.id);
    if (me && !me.isEliminated) addParticipatingTournament(tournament.id);
  }, [tournament, user?.id, addParticipatingTournament]);

  // Detect presence window — set countdown from server expiresAt
  useEffect(() => {
    if (!tournament) return;
    if (tournament.status === 'in_progress' && tournament.currentRound === 0) {
      setPhase('presence');
      setPresenceKind('start_wait');
      if (!bracketExpiresAt) setStatusMsg('Waiting for start timer sync…');
    } else if (tournament.status === 'open' && !hasActiveStartWindow) {
      setPhase('open');
    }
  }, [tournament?.status, tournament?.currentRound, hasActiveStartWindow, bracketExpiresAt]);

  // Presence countdown — always derived from server/propagated expiresAt only.
  useEffect(() => {
    if (phase !== 'presence') return;
    if (!bracketExpiresAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((bracketExpiresAt - Date.now()) / 1000));
      setPhaseCountdown(remaining);
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [phase, bracketExpiresAt]);

  // Complete preview — fixed 1s ticks
  useEffect(() => {
    if (phase !== 'complete_preview') return;
    const timer = setInterval(() => {
      setPhaseCountdown(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // When complete_preview countdown hits 0 → go to complete screen
  useEffect(() => {
    if (phase !== 'complete_preview' || phaseCountdown !== 0) return;
    const data = pendingCompleteRef.current;
    if (!data) return;
    setPhase('done');
    if (id) removeParticipatingTournament(id);
    navigate(`/tournaments/${id}/complete`, {
      replace: true,
      state: { tournamentName: tournament?.name ?? '', ...data },
    });
  }, [phase, phaseCountdown, navigate, id, tournament?.name, removeParticipatingTournament]);

  // Live WS events
  useEffect(() => {
    const unsubs = [
      on<{ tournamentId: string; expiresAt: number }>('tournament.starting', (data) => {
        if (data.tournamentId !== id) return;
        try {
          sessionStorage.setItem(`tournamentStarting:${data.tournamentId}`, String(data.expiresAt));
        } catch { /* */ }
        setBracketExpiresAt(data.expiresAt);
        const remaining = Math.max(0, Math.ceil((data.expiresAt - Date.now()) / 1000));
        setPhase('presence');
        setPresenceKind('start_wait');
        setStatusMsg('Waiting for players to join/accept…');
        setPhaseCountdown(remaining);
      }),

      on<{ tournamentId: string; round: number; expiresAt: number }>('tournament.round_preview', (data) => {
        if (data.tournamentId !== id) return;
        try {
          sessionStorage.removeItem(`tournamentStarting:${data.tournamentId}`);
        } catch { /* */ }
        setBracketExpiresAt(data.expiresAt);
        const remaining = Math.max(0, Math.ceil((data.expiresAt - Date.now()) / 1000));
        setPhase('presence');
        setPresenceKind('round_preview');
        setPhaseCountdown(remaining);
        setStatusMsg(`Round ${data.round} bracket is locked — lobby opens when timer ends`);
        void refresh();
      }),

      on<TournamentLobbyPayload>('tournament.lobby_ready', (data) => {
        if (data.tournamentId !== id) return;
        haptic.impact('medium');
        setPendingTournamentLobby(data);
        setStatusMsg(null);
        navigate(`/tournament-lobby/${data.gameId}`);
      }),

      on<{ tournamentId: string }>('tournament.bye_advance', (data) => {
        if (data.tournamentId !== id) return;
        setPhase('waiting');
        setStatusMsg('You have a bye — waiting for your next opponent…');
        refresh();
      }),

      on<{ tournamentId: string; winnerId: string; winnerPayout: string }>('tournament.completed', (data) => {
        if (data.tournamentId !== id) return;
        void refresh().then((updated) => {
          if (!updated) return;
          const myId = user?.id;
          const isWinner = data.winnerId === myId;
          const winnerParticipant = updated.participants.find((p: Participant) => p.userId === data.winnerId);
          pendingCompleteRef.current = {
            isWinner,
            winnerUsername: winnerParticipant?.username ?? '?',
            winnerPayout:   data.winnerPayout,
            prizePool:      updated.prizePool ?? '0',
          };
          setPhase('complete_preview');
          setPhaseCountdown(10);
        });
      }),

      on<{ tournamentId: string; reason: string }>('tournament.cancelled', (data) => {
        if (data.tournamentId !== id) return;
        if (id) removeParticipatingTournament(id);
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
  }, [on, id, user?.id, removeParticipatingTournament, navigate, setPendingTournamentLobby, haptic]);

  // Join button
  useEffect(() => {
    if (!tournament || tournament.status !== 'open' || joined) { hideMainButton(); return; }
    return showMainButton(`Join · ${parseFloat(tournament.entryFee).toFixed(2)} TON`, handleJoin, { color: '#2AABEE' });
  }, [tournament, joined]);

  async function handleJoin() {
    setMainButtonLoading(true);
    try {
      await tournamentApi.join(id!);
      setJoined(true);
      addParticipatingTournament(id!);
      haptic.success();
      await refresh();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to join');
      haptic.error();
    } finally {
      setMainButtonLoading(false);
    }
  }

  if (!tournament) return <div style={styles.loading}>Loading…</div>;

  const isInProgress = tournament.status === 'in_progress';
  const myId         = user?.id;

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

  const me = tournament.participants.find(p => p.userId === myId);

  // Phase banner content
  const phaseBanner = (() => {
    if (phase === 'presence') return {
      title: presenceKind === 'start_wait' ? '🏆 Tournament Starting' : '🏆 Bracket Stage',
      sub: presenceKind === 'start_wait'
        ? 'Waiting for players to join/accept'
        : 'Bracket is visible and locked before lobby starts',
      hint: presenceKind === 'start_wait'
        ? 'Pairs are formed when this timer reaches zero'
        : 'Lobby opens automatically when timer ends',
      countdown: phaseCountdown,
      color: phaseCountdown <= 10 ? '#E53935' : '#2AABEE',
    };
    if (phase === 'complete_preview') return {
      title: '🏁 Tournament Complete!',
      sub: pendingCompleteRef.current?.isWinner ? '🏆 You won!' : `Winner: ${pendingCompleteRef.current?.winnerUsername}`,
      hint: 'Showing results in…',
      countdown: phaseCountdown,
      color: '#2AABEE',
    };
    return null;
  })();

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
      {statusMsg && phase === 'waiting' && <p style={styles.statusMsg}>{statusMsg}</p>}

      {/* Phase countdown banner */}
      {phaseBanner && (
        <div style={{ ...styles.phaseBanner, borderColor: phaseBanner.color }}>
          <p style={styles.phaseBannerTitle}>{phaseBanner.title}</p>
          <p style={styles.phaseBannerSub}>{phaseBanner.sub}</p>
          <div style={{ ...styles.countdownCircle, background: phaseBanner.color }}>
            <span style={styles.countdownNum}>{phaseBanner.countdown}</span>
          </div>
          <p style={styles.phaseBannerHint}>{phaseBanner.hint}</p>
        </div>
      )}

      {/* My active match callout */}
      {myActiveMatch && myOpponentId && phase === 'waiting' && (() => {
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
  container:        { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh', paddingBottom: 80 },
  loading:          { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--tg-theme-hint-color)', background: 'var(--tg-theme-bg-color)' },
  title:            { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 12px' },
  infoRow:          { display: 'flex', justifyContent: 'space-around', background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: 14, marginBottom: 12 },
  starts:           { color: '#4CAF50', fontSize: 13, marginBottom: 8 },
  error:            { color: 'var(--tg-theme-destructive-text-color)', fontSize: 13 },
  success:          { color: '#4CAF50', fontSize: 13 },
  statusMsg:        { color: '#2AABEE', fontSize: 13, textAlign: 'center', padding: '8px 0' },
  phaseBanner:      { background: 'rgba(42,171,238,0.08)', border: '1px solid #2AABEE', borderRadius: 16, padding: '20px 16px', textAlign: 'center', marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  phaseBannerTitle: { color: 'var(--tg-theme-text-color)', fontSize: 18, fontWeight: 700, margin: 0 },
  phaseBannerSub:   { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: 0 },
  phaseBannerHint:  { color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: 0 },
  countdownCircle:  { width: 72, height: 72, borderRadius: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  countdownNum:     { color: '#fff', fontSize: 32, fontWeight: 700 },
  myMatchBanner:    { background: 'rgba(42,171,238,0.12)', border: '1px solid #2AABEE', borderRadius: 14, padding: '12px 16px', marginBottom: 12 },
  myMatchLabel:     { color: '#2AABEE', fontSize: 12, fontWeight: 600, margin: '0 0 8px', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  myMatchRow:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  myMatchMe:        { color: 'var(--tg-theme-text-color)', fontWeight: 700, fontSize: 15 },
  myMatchVs:        { color: 'var(--tg-theme-hint-color)', fontSize: 13, padding: '0 12px' },
  myMatchOpp:       { color: 'var(--tg-theme-text-color)', fontSize: 15 },
  section:          { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: 14, marginTop: 12 },
  sectionTitle:     { color: 'var(--tg-theme-text-color)', fontWeight: 600, fontSize: 15, margin: '0 0 10px' },
  roundLabel:       { color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: '8px 0 4px', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  matchCard:        { display: 'flex', alignItems: 'center', background: 'var(--tg-theme-bg-color)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 },
  matchCardMine:    { border: '1px solid rgba(42,171,238,0.3)' },
  matchCardActive:  { border: '1px solid #2AABEE', background: 'rgba(42,171,238,0.06)' },
  vs:               { color: 'var(--tg-theme-hint-color)', fontSize: 12, padding: '0 10px', flexShrink: 0 },
};
