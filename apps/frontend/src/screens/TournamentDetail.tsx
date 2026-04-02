import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { tournamentApi } from '../services/api';

interface Match { round: number; matchNumber: number; player1Id: string | null; player2Id: string | null; winnerId: string | null; isBye: boolean; }
interface Participant { userId: string; username: string; elo: number; isEliminated: boolean; receivedBye: boolean; }
interface TournamentDetail {
  id: string; name: string; status: string; bracketSize: number;
  entryFee: string; prizePool: string; currentRound: number;
  startsAt: string; creatorUsername: string;
  participants: Participant[]; matches: Match[];
}

export function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const { showBackButton, showMainButton, hideMainButton, setMainButtonLoading, haptic } = useTelegram();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [joined,     setJoined]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => { return showBackButton(() => navigate('/tournaments')); }, []);

  useEffect(() => {
    tournamentApi.get(id!).then(r => setTournament(r.data.tournament)).catch(() => null);
  }, [id]);

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
      tournamentApi.get(id!).then(r => setTournament(r.data.tournament));
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to join');
      haptic.error();
    } finally {
      setMainButtonLoading(false);
    }
  }

  if (!tournament) return <div style={styles.loading}>Loading…</div>;

  const maxRound = Math.max(...tournament.matches.map(m => m.round), 1);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>{tournament.name}</h2>

      <div style={styles.infoRow}>
        <Stat label="Players" value={`${tournament.participants.length}/${tournament.bracketSize}`} />
        <Stat label="Entry"   value={`${parseFloat(tournament.entryFee).toFixed(2)} TON`} />
        <Stat label="Prize"   value={`${parseFloat(tournament.prizePool).toFixed(2)} TON`} />
      </div>

      {tournament.status === 'open' && (
        <p style={styles.starts}>Starts {new Date(tournament.startsAt).toLocaleString()}</p>
      )}

      {error && <p style={styles.error}>{error}</p>}
      {joined && <p style={styles.success}>✅ Registered! You'll be notified before start.</p>}

      {/* Prize breakdown */}
      <div style={styles.section}>
        <p style={styles.sectionTitle}>Prize Distribution</p>
        <div style={styles.prizeRow}>
          <span style={styles.prizeLabel}>🥇 Winner (70%)</span>
          <span style={styles.prizeVal}>{(parseFloat(tournament.prizePool) * 0.70).toFixed(2)} TON</span>
        </div>
        <div style={styles.prizeRow}>
          <span style={styles.prizeLabel}>👤 Creator (5%)</span>
          <span style={styles.prizeVal}>{(parseFloat(tournament.prizePool) * 0.05).toFixed(2)} TON</span>
        </div>
        <div style={styles.prizeRow}>
          <span style={styles.prizeLabel}>🏦 Platform (25%)</span>
          <span style={styles.prizeVal}>{(parseFloat(tournament.prizePool) * 0.25).toFixed(2)} TON</span>
        </div>
      </div>

      {/* Bracket (if started) */}
      {tournament.matches.length > 0 && (
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
                    <span style={{ ...styles.matchPlayer, ...(m.winnerId === m.player1Id ? styles.winner : {}) }}>{p1?.username ?? 'TBD'} ({p1?.elo ?? '?'})</span>
                    <span style={styles.vs}>{m.isBye ? 'BYE' : 'vs'}</span>
                    <span style={{ ...styles.matchPlayer, ...(m.winnerId === m.player2Id ? styles.winner : {}) }}>{m.isBye ? '—' : (p2?.username ?? 'TBD')}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Participants list */}
      <div style={styles.section}>
        <p style={styles.sectionTitle}>Players ({tournament.participants.length})</p>
        {tournament.participants.map(p => (
          <div key={p.userId} style={styles.participantRow}>
            <span style={{ ...styles.participantName, ...(p.isEliminated ? styles.eliminated : {}) }}>{p.username}</span>
            <span style={styles.participantElo}>{p.elo} ELO {p.receivedBye ? '(bye)' : ''}</span>
          </div>
        ))}
      </div>
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

const styles: Record<string, React.CSSProperties> = {
  container:       { padding:'16px', background:'var(--tg-theme-bg-color)', minHeight:'100vh', paddingBottom:80 },
  title:           { color:'var(--tg-theme-text-color)', fontSize:22, fontWeight:700, margin:'0 0 12px' },
  infoRow:         { display:'flex', justifyContent:'space-around', background:'var(--tg-theme-secondary-bg-color)', borderRadius:14, padding:'14px', marginBottom:12 },
  starts:          { color:'#4CAF50', fontSize:13, marginBottom:12 },
  error:           { color:'var(--tg-theme-destructive-text-color)', fontSize:13 },
  success:         { color:'#4CAF50', fontSize:13 },
  section:         { background:'var(--tg-theme-secondary-bg-color)', borderRadius:14, padding:14, marginTop:12 },
  sectionTitle:    { color:'var(--tg-theme-text-color)', fontWeight:600, fontSize:15, margin:'0 0 10px' },
  prizeRow:        { display:'flex', justifyContent:'space-between', padding:'4px 0' },
  prizeLabel:      { color:'var(--tg-theme-text-color)', fontSize:14 },
  prizeVal:        { color:'#2AABEE', fontWeight:600, fontSize:14 },
  roundLabel:      { color:'var(--tg-theme-hint-color)', fontSize:13, margin:'8px 0 4px' },
  matchCard:       { display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--tg-theme-bg-color)', borderRadius:10, padding:'10px 12px', marginBottom:6 },
  matchPlayer:     { color:'var(--tg-theme-text-color)', fontSize:13, flex:1 },
  winner:          { color:'#4CAF50', fontWeight:700 },
  vs:              { color:'var(--tg-theme-hint-color)', fontSize:12, padding:'0 8px' },
  participantRow:  { display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid var(--tg-theme-bg-color)' },
  participantName: { color:'var(--tg-theme-text-color)', fontSize:14 },
  participantElo:  { color:'var(--tg-theme-hint-color)', fontSize:13 },
  eliminated:      { textDecoration:'line-through', color:'var(--tg-theme-hint-color)' },
  loading:         { display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--tg-theme-hint-color)', background:'var(--tg-theme-bg-color)' },
};
