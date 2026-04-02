/**
 * AiSelect.tsx — AI difficulty selection (PRD §8)
 * No wagering, no ELO impact. Practice sandbox.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useWebSocket } from '../hooks/useWebSocket';
import { useStore } from '../store';

type Difficulty = 'beginner' | 'intermediate' | 'hard' | 'master';

const DIFFICULTIES: { id: Difficulty; label: string; desc: string; emoji: string }[] = [
  { id: 'beginner',     label: 'Beginner',     emoji: '🟢', desc: 'Plays randomly — great for learning' },
  { id: 'intermediate', label: 'Intermediate', emoji: '🟡', desc: 'Greedy strategy — picks best capture' },
  { id: 'hard',         label: 'Hard',         emoji: '🟠', desc: 'Minimax depth 4 — thinks ahead' },
  { id: 'master',       label: 'Master',       emoji: '🔴', desc: 'Alpha-beta depth 8 — plays competitively' },
];

export function AiSelect() {
  const { showBackButton, showMainButton, haptic } = useTelegram();
  const { emit, on } = useWebSocket();
  const { setActiveGame } = useStore();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Difficulty>('intermediate');
  const [starting, setStarting] = useState(false);
  const [wsError,  setWsError]  = useState(false);

  useEffect(() => { return showBackButton(() => navigate('/')); }, []);

  useEffect(() => {
    return showMainButton('Start Practice', handleStart, { disabled: starting });
  }, [selected, starting]);

  useEffect(() => {
    const unsub = on<{ gameId: string; difficulty: Difficulty }>('ai.state', ({ gameId }) => {
      setActiveGame(gameId, 1);
      navigate(`/ai-game/${gameId}`);
    });
    const unsubErr = on<{ message: string }>('error', () => {
      setStarting(false);
      setWsError(true);
    });
    return () => { unsub(); unsubErr(); };
  }, [on]);

  function handleStart() {
    setWsError(false);
    setStarting(true);
    haptic.impact('medium');
    emit('ai.start', { difficulty: selected });

    // If no response in 8s, surface an error
    setTimeout(() => {
      setStarting(prev => {
        if (prev) setWsError(true);
        return false;
      });
    }, 8_000);
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Practice vs AI</h2>
      <p style={styles.subtitle}>No wagering · No ELO change · Full rules enforced</p>

      <div style={styles.cards}>
        {DIFFICULTIES.map(d => (
          <button
            key={d.id}
            style={{ ...styles.card, ...(selected === d.id ? styles.cardSelected : {}) }}
            onClick={() => { setSelected(d.id); haptic.selection(); }}
          >
            <span style={styles.emoji}>{d.emoji}</span>
            <div>
              <p style={styles.label}>{d.label}</p>
              <p style={styles.desc}>{d.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {starting && <p style={styles.hint}>Starting game…</p>}
      {wsError  && <p style={styles.error}>Connection failed. Check your connection and try again.</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
  title:     { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
  subtitle:  { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '0 0 24px' },
  cards:     { display: 'flex', flexDirection: 'column', gap: 10 },
  card:      { background: 'var(--tg-theme-secondary-bg-color)', border: '2px solid transparent', borderRadius: 14, padding: '16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', textAlign: 'left' },
  cardSelected: { borderColor: '#2AABEE' },
  emoji:     { fontSize: 28 },
  label:     { color: 'var(--tg-theme-text-color)', fontWeight: 600, fontSize: 16, margin: 0 },
  desc:      { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '2px 0 0' },
  hint:      { color: 'var(--tg-theme-hint-color)', fontSize: 13, textAlign: 'center', marginTop: 16 },
  error:     { color: 'var(--tg-theme-destructive-text-color, #ff3b30)', fontSize: 13, textAlign: 'center', marginTop: 16 },
};
