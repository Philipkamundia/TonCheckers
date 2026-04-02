import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { tournamentApi } from '../services/api';

interface Tournament {
  id: string; name: string; status: string; bracketSize: number;
  entryFee: string; prizePool: string; participantCount: number;
  startsAt: string; creatorUsername: string;
}

const TABS = ['open', 'in_progress', 'completed'] as const;
type Tab = typeof TABS[number];

export function TournamentList() {
  const { showBackButton, showMainButton } = useTelegram();
  const navigate = useNavigate();

  const [tab,          setTab]          = useState<Tab>('open');
  const [tournaments,  setTournaments]  = useState<Tournament[]>([]);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => { return showBackButton(() => navigate('/')); }, []);
  useEffect(() => { return showMainButton('Create Tournament', () => navigate('/tournaments/create'), { color: '#2AABEE' }); }, []);

  useEffect(() => {
    setLoading(true);
    tournamentApi.list(tab)
      .then(r => setTournaments(r.data.tournaments))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Tournaments</h2>

      <div style={styles.tabs}>
        {TABS.map(t => (
          <button key={t} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }} onClick={() => setTab(t)}>
            {t === 'open' ? 'Open' : t === 'in_progress' ? 'Live' : 'Ended'}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={styles.hint}>Loading…</p>
      ) : tournaments.length === 0 ? (
        <p style={styles.hint}>No {tab} tournaments</p>
      ) : (
        <div style={styles.list}>
          {tournaments.map(t => (
            <button key={t.id} style={styles.card} onClick={() => navigate(`/tournaments/${t.id}`)}>
              <div style={styles.cardTop}>
                <span style={styles.cardName}>{t.name}</span>
                <span style={styles.cardBracket}>{t.bracketSize}P</span>
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardHint}>Entry: {parseFloat(t.entryFee).toFixed(2)} TON</span>
                <span style={styles.cardHint}>Pool: {parseFloat(t.prizePool).toFixed(2)} TON</span>
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardHint}>{t.participantCount}/{t.bracketSize} players</span>
                <span style={styles.cardHint}>by {t.creatorUsername}</span>
              </div>
              {t.status === 'open' && (
                <p style={styles.startsAt}>Starts {new Date(t.startsAt).toLocaleString()}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding:'16px', background:'var(--tg-theme-bg-color)', minHeight:'100vh' },
  title:     { color:'var(--tg-theme-text-color)', fontSize:22, fontWeight:700, margin:'0 0 16px' },
  tabs:      { display:'flex', gap:8, marginBottom:16 },
  tab:       { flex:1, background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:10, padding:'10px 0', color:'var(--tg-theme-hint-color)', fontSize:14, cursor:'pointer' },
  tabActive: { background:'#2AABEE', color:'#fff' },
  list:      { display:'flex', flexDirection:'column', gap:10 },
  card:      { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:14, padding:16, cursor:'pointer', textAlign:'left', width:'100%' },
  cardTop:   { display:'flex', justifyContent:'space-between', marginBottom:6 },
  cardName:  { color:'var(--tg-theme-text-color)', fontWeight:600, fontSize:16 },
  cardBracket:{ color:'#2AABEE', fontWeight:700, fontSize:14 },
  cardRow:   { display:'flex', justifyContent:'space-between' },
  cardHint:  { color:'var(--tg-theme-hint-color)', fontSize:13 },
  startsAt:  { color:'#4CAF50', fontSize:12, margin:'6px 0 0' },
  hint:      { color:'var(--tg-theme-hint-color)', textAlign:'center', marginTop:40, fontSize:14 },
};
