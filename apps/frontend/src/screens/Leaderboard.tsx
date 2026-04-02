import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { leaderboardApi } from '../services/api';

interface Entry {
  rank: number; userId: string; username: string;
  elo: number; totalWon: string; winRate: number; gamesPlayed: number;
}

type Sort = 'elo' | 'ton_won' | 'win_rate' | 'games_played';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'elo',          label: 'ELO' },
  { id: 'ton_won',      label: 'TON Won' },
  { id: 'win_rate',     label: 'Win %' },
  { id: 'games_played', label: 'Games' },
];

export function Leaderboard() {
  const { showBackButton, hideMainButton } = useTelegram();
  const navigate = useNavigate();

  const [sort,    setSort]    = useState<Sort>('elo');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [myRanks, setMyRanks] = useState<Record<Sort, { rank: number | null; total: number }> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { return showBackButton(() => navigate('/')); }, []);
  useEffect(() => { hideMainButton(); }, []);

  useEffect(() => {
    setLoading(true);
    leaderboardApi.get(sort).then(r => setEntries(r.data.entries)).finally(() => setLoading(false));
  }, [sort]);

  useEffect(() => {
    leaderboardApi.me().then(r => setMyRanks(r.data.ranks)).catch(() => null);
  }, []);

  function valueFor(e: Entry): string {
    switch (sort) {
      case 'elo':          return `${e.elo}`;
      case 'ton_won':      return `${parseFloat(e.totalWon).toFixed(2)} TON`;
      case 'win_rate':     return `${e.winRate}%`;
      case 'games_played': return `${e.gamesPlayed}`;
    }
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Leaderboard</h2>

      {myRanks && (
        <div style={styles.myRankRow}>
          {SORTS.map(s => (
            <div key={s.id} style={styles.myRankCard}>
              <span style={styles.myRankLabel}>{s.label}</span>
              <span style={styles.myRankVal}>
                {myRanks[s.id].rank ? `#${myRanks[s.id].rank}` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={styles.tabs}>
        {SORTS.map(s => (
          <button key={s.id} style={{ ...styles.tab, ...(sort === s.id ? styles.tabActive : {}) }} onClick={() => setSort(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={styles.hint}>Loading…</p>
      ) : (
        <div style={styles.list}>
          {entries.map(e => (
            <div key={e.userId} style={styles.row}>
              <span style={styles.rank}>
                {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`}
              </span>
              <span style={styles.username}>{e.username}</span>
              <span style={styles.value}>{valueFor(e)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:    { padding:'16px', background:'var(--tg-theme-bg-color)', minHeight:'100vh' },
  title:        { color:'var(--tg-theme-text-color)', fontSize:22, fontWeight:700, margin:'0 0 12px' },
  myRankRow:    { display:'flex', gap:8, marginBottom:16 },
  myRankCard:   { flex:1, background:'var(--tg-theme-secondary-bg-color)', borderRadius:10, padding:'10px 6px', display:'flex', flexDirection:'column', alignItems:'center', gap:2 },
  myRankLabel:  { color:'var(--tg-theme-hint-color)', fontSize:11 },
  myRankVal:    { color:'#2AABEE', fontWeight:700, fontSize:15 },
  tabs:         { display:'flex', gap:6, marginBottom:14, overflowX:'auto' },
  tab:          { flex:'none', background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:10, padding:'8px 14px', color:'var(--tg-theme-hint-color)', fontSize:13, cursor:'pointer', whiteSpace:'nowrap' },
  tabActive:    { background:'#2AABEE', color:'#fff' },
  list:         { display:'flex', flexDirection:'column', gap:2 },
  row:          { display:'flex', alignItems:'center', padding:'12px 10px', background:'var(--tg-theme-secondary-bg-color)', borderRadius:10 },
  rank:         { width:36, color:'var(--tg-theme-text-color)', fontSize:14, fontWeight:700 },
  username:     { flex:1, color:'var(--tg-theme-text-color)', fontSize:14 },
  value:        { color:'#2AABEE', fontWeight:600, fontSize:14 },
  hint:         { color:'var(--tg-theme-hint-color)', textAlign:'center', marginTop:40 },
};
