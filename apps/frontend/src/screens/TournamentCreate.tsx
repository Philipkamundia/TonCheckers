import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { tournamentApi } from '../services/api';

export function TournamentCreate() {
  const { showBackButton, showMainButton, setMainButtonLoading, haptic } = useTelegram();
  const navigate = useNavigate();

  const [name,        setName]        = useState('');
  const [bracketSize, setBracketSize] = useState(8);
  const [entryFee,    setEntryFee]    = useState('1');
  const [startsAt,    setStartsAt]    = useState('');
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => { return showBackButton(() => navigate('/tournaments')); }, []);
  useEffect(() => {
    const valid = name.length >= 3 && parseFloat(entryFee) >= 0 && startsAt && new Date(startsAt) > new Date();
    return showMainButton('Create Tournament', handleCreate, { disabled: !valid });
  }, [name, entryFee, startsAt]);

  async function handleCreate() {
    setError(null);
    setMainButtonLoading(true);
    try {
      // Convert local datetime to UTC ISO string so the backend stores the correct time
      // regardless of the user's timezone
      const startsAtUtc = new Date(startsAt).toISOString();
      const r = await tournamentApi.create({ name, bracketSize, entryFee, startsAt: startsAtUtc });
      haptic.success();
      navigate(`/tournaments/${r.data.tournament.id}`);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Creation failed');
      haptic.error();
    } finally {
      setMainButtonLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Create Tournament</h2>

      <p style={styles.label}>Tournament Name</p>
      <input style={styles.input} placeholder="e.g. Sunday Showdown" value={name} onChange={e => setName(e.target.value)} maxLength={128} />

      <p style={styles.label}>Bracket Size</p>
      <div style={styles.sizeRow}>
        {[8, 16, 32, 64].map(s => (
          <button key={s} style={{ ...styles.sizeBtn, ...(bracketSize === s ? styles.sizeBtnActive : {}) }} onClick={() => setBracketSize(s)}>{s}P</button>
        ))}
      </div>

      <p style={styles.label}>Entry Fee (TON)</p>
      <input style={styles.input} type="number" placeholder="0.00" value={entryFee} onChange={e => setEntryFee(e.target.value)} min="0" step="0.1" />

      <p style={styles.label}>Start Date & Time</p>
      <input
        style={styles.input}
        type="datetime-local"
        value={startsAt}
        min={new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16)}
        onChange={e => setStartsAt(e.target.value)}
      />
      <p style={styles.tzHint}>🕐 Your timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>

      {entryFee && bracketSize && (
        <div style={styles.preview}>
          <p style={styles.previewText}>Prize pool: {(parseFloat(entryFee || '0') * bracketSize).toFixed(2)} TON</p>
          <p style={styles.previewText}>Winner gets: {(parseFloat(entryFee || '0') * bracketSize * 0.70).toFixed(2)} TON (70%)</p>
          <p style={styles.previewText}>You earn: {(parseFloat(entryFee || '0') * bracketSize * 0.05).toFixed(2)} TON (5% creator fee)</p>
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:    { padding:'16px', background:'var(--tg-theme-bg-color)', minHeight:'100vh', paddingBottom:80 },
  title:        { color:'var(--tg-theme-text-color)', fontSize:22, fontWeight:700, margin:'0 0 16px' },
  label:        { color:'var(--tg-theme-hint-color)', fontSize:13, margin:'12px 0 4px' },
  input:        { width:'100%', background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'13px', fontSize:15, color:'var(--tg-theme-text-color)', boxSizing:'border-box' },
  sizeRow:      { display:'flex', gap:8 },
  sizeBtn:      { flex:1, background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:10, padding:'12px 0', color:'var(--tg-theme-text-color)', fontSize:15, cursor:'pointer' },
  sizeBtnActive:{ background:'#2AABEE', color:'#fff' },
  preview:      { background:'var(--tg-theme-secondary-bg-color)', borderRadius:12, padding:14, marginTop:16 },
  previewText:  { color:'var(--tg-theme-text-color)', fontSize:14, margin:'3px 0' },
  tzHint:       { color:'var(--tg-theme-hint-color)', fontSize:11, margin:'3px 0 0' },
  error:        { color:'var(--tg-theme-destructive-text-color)', fontSize:13, marginTop:8 },
};
