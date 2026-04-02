/**
 * AiGameRoom.tsx — AI practice game (PRD §8)
 * Same board as PvP but ai.* events, no wagering display.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Board } from '../hooks/useGame';

const CELL_SIZE = Math.floor((Math.min(window.innerWidth, 400) - 32) / 8);
const PIECE_COLORS: Record<number, string> = {
  1: '#E53935', 2: '#1565C0', 3: '#FF8F00', 4: '#00838F',
};

export function AiGameRoom() {
  const { gameId } = useParams<{ gameId: string }>();
  const { showBackButton, haptic } = useTelegram();
  const { on, emit } = useWebSocket();
  const navigate = useNavigate();

  const [board,       setBoard]       = useState<Board | null>(null);
  const [remainingMs, setRemainingMs] = useState(30_000);
  const [selected,    setSelected]    = useState<{ row: number; col: number } | null>(null);
  const [gameOver,    setGameOver]    = useState<{ result: string; winner?: number; reason?: string } | null>(null);
  const [invalid,     setInvalid]     = useState<string | null>(null);
  const [aiThinking,  setAiThinking]  = useState(false);

  useEffect(() => { return showBackButton(() => navigate('/ai')); }, []);

  // Request current game state on mount in case ai.state already fired
  useEffect(() => {
    if (gameId) emit('ai.state.request', { gameId });
  }, [gameId]);

  useEffect(() => {
    const unsubs = [
      on<{ board: Board; activePlayer: number; remainingMs: number }>('ai.move_ok', (data) => {
        setBoard(data.board);
        setRemainingMs(data.remainingMs);
        setSelected(null);
        setAiThinking(false);
        haptic.impact('light');
      }),
      on<{ reason: string }>('ai.move_invalid', ({ reason }) => {
        setInvalid(reason);
        setAiThinking(false);
        setTimeout(() => setInvalid(null), 2000);
        haptic.error();
      }),
      on<{ result: string; winner?: number; reason?: string; board: Board }>('ai.end', (data) => {
        setBoard(data.board);
        setGameOver(data);
        haptic[data.winner === 1 ? 'success' : 'warning']();
      }),
      on<{ board: Board; gameId: string }>('ai.state', (data) => setBoard(data.board)),
      on<{ remainingMs: number }>('game.tick', ({ remainingMs }) => setRemainingMs(remainingMs)),
    ];
    return () => unsubs.forEach(u => u());
  }, [on]);

  function handleCell(row: number, col: number) {
    if (aiThinking || gameOver || !board) return;
    const piece = board[row][col];

    if (selected) {
      if (selected.row === row && selected.col === col) { setSelected(null); return; }
      setAiThinking(true);
      emit('ai.move', { gameId, from: selected, to: { row, col } });
      setSelected(null);
    } else if (piece === 1 || piece === 3) {
      setSelected({ row, col });
      haptic.selection();
    }
  }

  if (gameOver) {
    const msg = gameOver.winner === 1 ? '🎉 You Win!' : gameOver.result === 'draw' ? '🤝 Draw!' : '🤖 AI Wins!';
    return (
      <div style={styles.overContainer}>
        <h2 style={styles.overTitle}>{msg}</h2>
        <p style={styles.overHint}>Practice game — no ELO change, no wagering</p>
        <button style={styles.homeBtn} onClick={() => navigate('/')}>Home</button>
        <button style={styles.retryBtn} onClick={() => navigate('/ai')}>Play Again</button>
      </div>
    );
  }

  const secs = Math.ceil(remainingMs / 1000);
  return (
    <div style={styles.container}>
      <div style={styles.timerRow}>
        <span style={styles.turnLabel}>{aiThinking ? '🤖 AI thinking…' : '🟢 Your turn'}</span>
        <span style={{ ...styles.timer, color: secs <= 5 ? '#E53935' : 'var(--tg-theme-text-color)' }}>{secs}s</span>
      </div>
      <div style={{ ...styles.board, width: CELL_SIZE * 8, height: CELL_SIZE * 8 }}>
        {board && [...Array(8).keys()].flatMap(row =>
          [...Array(8).keys()].map(col => {
            const dark = (row + col) % 2 !== 0;
            const p    = board[row][col];
            const sel  = selected?.row === row && selected?.col === col;
            return (
              <div key={`${row}-${col}`} style={{ position:'absolute', left: col*CELL_SIZE, top: row*CELL_SIZE, width: CELL_SIZE, height: CELL_SIZE, background: sel ? '#FFF9C4' : dark ? '#795548' : '#EFEBE9', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }} onClick={() => handleCell(row, col)}>
                {p !== 0 && <div style={{ width: CELL_SIZE*0.75, height: CELL_SIZE*0.75, borderRadius:'50%', background: PIECE_COLORS[p], border: p >= 3 ? '3px solid gold' : 'none', boxShadow:'0 2px 4px rgba(0,0,0,0.3)' }} />}
              </div>
            );
          })
        )}
      </div>
      {invalid && <p style={styles.invalid}>{invalid}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:     { padding:'16px', display:'flex', flexDirection:'column', alignItems:'center', gap:16, background:'var(--tg-theme-bg-color)', minHeight:'100vh' },
  timerRow:      { display:'flex', justifyContent:'space-between', width:'100%', maxWidth:400 },
  turnLabel:     { color:'var(--tg-theme-text-color)', fontSize:14 },
  timer:         { fontSize:20, fontWeight:700 },
  board:         { position:'relative', border:'2px solid var(--tg-theme-secondary-bg-color)', borderRadius:4 },
  invalid:       { color:'var(--tg-theme-destructive-text-color)', fontSize:13 },
  overContainer: { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:16, padding:24, background:'var(--tg-theme-bg-color)' },
  overTitle:     { color:'var(--tg-theme-text-color)', fontSize:30, fontWeight:800 },
  overHint:      { color:'var(--tg-theme-hint-color)', fontSize:13, textAlign:'center' },
  homeBtn:       { background:'#2AABEE', border:'none', borderRadius:12, padding:'14px 32px', color:'#fff', fontSize:16, fontWeight:600, cursor:'pointer', width:'100%', maxWidth:280 },
  retryBtn:      { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'14px 32px', color:'var(--tg-theme-text-color)', fontSize:16, cursor:'pointer', width:'100%', maxWidth:280 },
};
