/**
 * AiGameRoom.tsx — AI practice game (PRD §8)
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Board } from '../hooks/useGame';
import { getAvailableMoves } from '../engine/moves';

const CELL_SIZE = Math.floor((Math.min(window.innerWidth, 400) - 32) / 8);
const PIECE_COLORS: Record<number, string> = {
  1: '#E53935', 2: '#1565C0', 3: '#FF8F00', 4: '#00838F',
};

export function AiGameRoom() {
  const { gameId } = useParams<{ gameId: string }>();
  const { showBackButton, haptic } = useTelegram();
  const { on, emit } = useWebSocket();
  const navigate = useNavigate();

  const [board,      setBoard]      = useState<Board | null>(null);
  const [remainingMs,setRemainingMs]= useState(30_000);
  const [selected,   setSelected]   = useState<{ row: number; col: number } | null>(null);
  const [gameOver,   setGameOver]   = useState<{ result: string; winner?: number; reason?: string } | null>(null);
  const [invalid,    setInvalid]    = useState<string | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [tip,        setTip]        = useState<{ from: { row: number; col: number }; to: { row: number; col: number } } | null>(null);
  const [aiPiece,    setAiPiece]    = useState<{ from: { row: number; col: number }; to: { row: number; col: number }; pieceType: number } | null>(null);
  const [humanPiece, setHumanPiece] = useState<{ from: { row: number; col: number }; to: { row: number; col: number }; pieceType: number } | null>(null);

  // Client-side countdown — ticks every second when it's the human's turn
  useEffect(() => {
    if (aiThinking || gameOver) return;
    const interval = setInterval(() => {
      setRemainingMs(prev => {
        const next = Math.max(0, prev - 1000);
        if (next === 0) {
          setGameOver({ result: 'loss', winner: 2, reason: 'timeout' });
          haptic.warning();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [aiThinking, gameOver]);

  useEffect(() => { return showBackButton(() => navigate('/ai')); }, []);

  useEffect(() => {
    if (gameId) emit('ai.state.request', { gameId });
  }, [gameId]);

  useEffect(() => {
    const unsubs = [
      on<{ board: Board; remainingMs: number; aiMove?: { from: { row: number; col: number }; to: { row: number; col: number } } }>('ai.move_ok', (data) => {
        if (data.aiMove && board) {
          const pieceType = board[data.aiMove.from.row][data.aiMove.from.col];
          setAiPiece({ ...data.aiMove, pieceType });
          setTimeout(() => {
            setBoard(data.board);
            setAiPiece(null);
          }, 500);
        } else {
          setBoard(data.board);
        }
        setRemainingMs(data.remainingMs ?? 30_000);
        setSelected(null);
        setTip(null);
        setAiThinking(false);
        haptic.impact('light');
      }),
      on<{ reason: string }>('ai.move_invalid', ({ reason }) => {
        setInvalid(reason);
        setSelected(null);
        setAiThinking(false);
        setTimeout(() => setInvalid(null), 2000);
        haptic.error();
      }),
      on<{ result: string; winner?: number; reason?: string; board: Board }>('ai.end', (data) => {
        setBoard(data.board);
        setGameOver(data);
        haptic[data.winner === 1 ? 'success' : 'warning']();
      }),
      on<{ board: Board }>('ai.state', (data) => { setBoard(data.board); setSelected(null); setTip(null); }),
      on<{ remainingMs: number }>('game.tick', ({ remainingMs }) => {
        setRemainingMs(remainingMs);
        // Timer ran out — AI wins (same rule as PvP)
        if (remainingMs === 0 && !aiThinking && !gameOver) {
          setGameOver({ result: 'loss', winner: 2, reason: 'timeout' });
          haptic.warning();
        }
      }),
      on<{ ok: boolean; from?: { row: number; col: number }; to?: { row: number; col: number }; reason?: string }>('ai.tip_result', (data) => {
        if (data.ok && data.from && data.to) setTip({ from: data.from, to: data.to });
        else setInvalid(data.reason ?? 'No tip available');
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [on]);

  // Compute all legal moves for player 1 from current board
  const legalMoves = useMemo(() => {
    if (!board || aiThinking || gameOver) return [];
    return getAvailableMoves(board as any, 1);
  }, [board, aiThinking, gameOver]);

  const movablePieces = useMemo(() =>
    new Set(legalMoves.map(m => `${m.from.row},${m.from.col}`)),
  [legalMoves]);

  // Valid destinations for the selected piece
  const validDests = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(
      legalMoves
        .filter(m => m.from.row === selected.row && m.from.col === selected.col)
        .map(m => `${m.to.row},${m.to.col}`)
    );
  }, [selected, legalMoves]);

  function handleCell(row: number, col: number) {
    if (aiThinking || gameOver || !board) return;
    const key = `${row},${col}`;

    if (selected) {
      if (selected.row === row && selected.col === col) {
        setSelected(null);
        return;
      }
      // Only send if it's a valid destination
      if (validDests.has(key)) {
        if (board) {
          // Optimistically apply human move including captures
          const newBoard = board.map(r => [...r]) as typeof board;
          const piece = newBoard[selected.row][selected.col];
          newBoard[selected.row][selected.col] = 0;
          newBoard[row][col] = piece;
          // Remove captured pieces
          const matchedMove = legalMoves.find(
            m => m.from.row === selected.row && m.from.col === selected.col &&
                 m.to.row === row && m.to.col === col
          );
          if (matchedMove) {
            for (const cap of matchedMove.captures) {
              newBoard[cap.row][cap.col] = 0;
            }
          }
          const pieceType = piece;
          setHumanPiece({ from: selected, to: { row, col }, pieceType });
          setTimeout(() => {
            setBoard(newBoard);
            setHumanPiece(null);
          }, 350);
        }
        setAiThinking(true);
        emit('ai.move', { gameId, from: selected, to: { row, col } });
        setSelected(null);
      } else if (movablePieces.has(key)) {
        // Clicked another own piece — switch selection
        setSelected({ row, col });
        haptic.selection();
      } else {
        // Invalid destination — deselect
        setSelected(null);
      }
    } else if (movablePieces.has(key)) {
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
            const dark    = (row + col) % 2 !== 0;
            // Hide the piece at 'from' position during animation
            const isAiMovingFrom   = aiPiece?.from.row === row && aiPiece?.from.col === col;
            const isHumanMovingFrom = humanPiece?.from.row === row && humanPiece?.from.col === col;
            const p = (isAiMovingFrom || isHumanMovingFrom) ? 0 : board[row][col];
            const key     = `${row},${col}`;
            const isSel   = selected?.row === row && selected?.col === col;
            const isDest  = validDests.has(key);
            const canMove = movablePieces.has(key);
            const isTipFrom = tip?.from.row === row && tip?.from.col === col;
            const isTipTo   = tip?.to.row   === row && tip?.to.col   === col;
            const isAiFrom  = aiPiece?.from.row === row && aiPiece?.from.col === col;
            const isAiTo    = aiPiece?.to.row   === row && aiPiece?.to.col   === col;

            let bg = dark ? '#795548' : '#EFEBE9';
            if (isSel)           bg = '#FFF9C4';
            else if (isDest)     bg = '#A5D6A7';
            else if (isTipFrom)  bg = '#FFE082';
            else if (isTipTo)    bg = '#80DEEA';
            else if (isAiFrom)   bg = '#EF9A9A';
            else if (isAiTo)     bg = '#CE93D8';
            else if (dark && canMove && !selected) bg = '#8D6E63';

            return (
              <div
                key={key}
                style={{ position:'absolute', left:col*CELL_SIZE, top:row*CELL_SIZE, width:CELL_SIZE, height:CELL_SIZE, background:bg, display:'flex', alignItems:'center', justifyContent:'center', cursor: (isSel || isDest || canMove) ? 'pointer' : 'default' }}
                onClick={() => handleCell(row, col)}
              >
                {p !== 0 && (
                  <div style={{ width:CELL_SIZE*0.75, height:CELL_SIZE*0.75, borderRadius:'50%', background:PIECE_COLORS[p], border:p >= 3 ? '3px solid gold' : 'none', boxShadow:'0 2px 4px rgba(0,0,0,0.3)', outline: canMove && !aiThinking ? '2px solid rgba(255,255,255,0.5)' : 'none' }} />
                )}
                {isDest && p === 0 && (
                  <div style={{ width:CELL_SIZE*0.3, height:CELL_SIZE*0.3, borderRadius:'50%', background:'rgba(76,175,80,0.7)' }} />
                )}
              </div>
            );
          })
        )}

        {/* Animated AI piece overlay */}
        {aiPiece && (
          <div style={{
            position: 'absolute',
            width: CELL_SIZE * 0.75,
            height: CELL_SIZE * 0.75,
            borderRadius: '50%',
            background: PIECE_COLORS[aiPiece.pieceType],
            border: aiPiece.pieceType >= 3 ? '3px solid gold' : 'none',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            left: aiPiece.from.col * CELL_SIZE + CELL_SIZE * 0.125,
            top:  aiPiece.from.row * CELL_SIZE + CELL_SIZE * 0.125,
            transform: `translate(${(aiPiece.to.col - aiPiece.from.col) * CELL_SIZE}px, ${(aiPiece.to.row - aiPiece.from.row) * CELL_SIZE}px)`,
            transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 10,
            pointerEvents: 'none',
          }} />
        )}

        {/* Animated human piece overlay */}
        {humanPiece && (
          <div style={{
            position: 'absolute',
            width: CELL_SIZE * 0.75,
            height: CELL_SIZE * 0.75,
            borderRadius: '50%',
            background: PIECE_COLORS[humanPiece.pieceType],
            border: humanPiece.pieceType >= 3 ? '3px solid gold' : 'none',
            boxShadow: '0 4px 8px rgba(0,0,0,0.4)',
            left: humanPiece.from.col * CELL_SIZE + CELL_SIZE * 0.125,
            top:  humanPiece.from.row * CELL_SIZE + CELL_SIZE * 0.125,
            transform: `translate(${(humanPiece.to.col - humanPiece.from.col) * CELL_SIZE}px, ${(humanPiece.to.row - humanPiece.from.row) * CELL_SIZE}px)`,
            transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 10,
            pointerEvents: 'none',
          }} />
        )}
      </div>
      {invalid && <p style={styles.invalid}>{invalid}</p>}
      <div style={styles.actions}>
        <button style={styles.actionBtn} onClick={() => { haptic.impact('light'); setTip(null); emit('ai.undo', { gameId }); }} disabled={aiThinking} title="Undo">
          <span style={styles.actionIcon}>↩️</span>
          <span style={styles.actionLabel}>Undo</span>
        </button>
        <button style={styles.actionBtn} onClick={() => { haptic.impact('medium'); setTip(null); setSelected(null); setGameOver(null); emit('ai.restart', { gameId }); }} title="Restart">
          <span style={styles.actionIcon}>🔄</span>
          <span style={styles.actionLabel}>Restart</span>
        </button>
        <button style={styles.actionBtn} onClick={() => { haptic.impact('light'); setTip(null); emit('ai.tip', { gameId }); }} disabled={aiThinking} title="Tip">
          <span style={styles.actionIcon}>💡</span>
          <span style={styles.actionLabel}>Tip</span>
        </button>
      </div>
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
  actions:       { display:'flex', gap:24, justifyContent:'center', width:'100%', maxWidth:400 },
  actionBtn:     { display:'flex', flexDirection:'column', alignItems:'center', gap:4, background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'10px 20px', cursor:'pointer', opacity:1 },
  actionIcon:    { fontSize:22 },
  actionLabel:   { color:'var(--tg-theme-text-color)', fontSize:11, fontWeight:500 },
  overContainer: { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:16, padding:24, background:'var(--tg-theme-bg-color)' },
  overTitle:     { color:'var(--tg-theme-text-color)', fontSize:30, fontWeight:800 },
  overHint:      { color:'var(--tg-theme-hint-color)', fontSize:13, textAlign:'center' },
  homeBtn:       { background:'#2AABEE', border:'none', borderRadius:12, padding:'14px 32px', color:'#fff', fontSize:16, fontWeight:600, cursor:'pointer', width:'100%', maxWidth:280 },
  retryBtn:      { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'14px 32px', color:'var(--tg-theme-text-color)', fontSize:16, cursor:'pointer', width:'100%', maxWidth:280 },
};
