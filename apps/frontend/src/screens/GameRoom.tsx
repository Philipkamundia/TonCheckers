/**
 * GameRoom.tsx — Live game board (PRD §6 Step 7–9)
 * Client is render-only — all moves validated server-side.
 * Resign button available at any point.
 */
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { useGame, type Board } from '../hooks/useGame';
import { PostGame } from './PostGame';

const CELL_SIZE = Math.floor((Math.min(window.innerWidth, 400) - 32) / 8);

const PIECE_COLORS: Record<number, string> = {
  1: '#E53935',      // P1 regular — red
  2: '#1565C0',      // P2 regular — blue
  3: '#FF8F00',      // P1 king — gold
  4: '#00838F',      // P2 king — teal
};

export function GameRoom() {
  const { gameId } = useParams<{ gameId: string }>();
  const { showBackButton, haptic } = useTelegram();
  const { myPlayerNum } = useStore();

  const {
    gameState, selectedPiece, setSelectedPiece, invalidMove, makeMove, resign,
  } = useGame(gameId ?? null, myPlayerNum);

  // Hide back button during game — resign to exit (PRD §16: no custom back)
  useEffect(() => {
    return showBackButton(() => {
      // Confirm before resigning via back
      if (confirm('Resign the game?')) resign();
    });
  }, [resign]);

  if (gameState.status === 'completed' || gameState.status === 'crashed') {
    return <PostGame gameId={gameId!} result={gameState.result} myPlayerNum={myPlayerNum} />;
  }

  const isMyTurn    = gameState.activePlayer === myPlayerNum;
  const remainingSecs = Math.ceil((gameState.remainingMs ?? 0) / 1000);
  const timerColor   = remainingSecs <= 5 ? '#E53935' : 'var(--tg-theme-text-color)'; // PRD §6: red at 5s

  function handleCellPress(row: number, col: number) {
    if (!isMyTurn || !gameState.board) return;
    const cell = gameState.board[row][col];

    if (selectedPiece) {
      // Attempt move
      if (selectedPiece.row === row && selectedPiece.col === col) {
        setSelectedPiece(null); // Deselect
      } else {
        makeMove(selectedPiece, { row, col });
      }
    } else if (cell === myPlayerNum || cell === myPlayerNum! + 2) {
      // Select own piece
      setSelectedPiece({ row, col });
      haptic.selection();
    }
  }

  return (
    <div style={styles.container}>
      {/* Timer bar */}
      <div style={styles.timerRow}>
        <span style={styles.turnLabel}>
          {isMyTurn ? '🟢 Your turn' : '⏳ Opponent\'s turn'}
        </span>
        <span style={{ ...styles.timer, color: timerColor }}>
          {remainingSecs}s
        </span>
      </div>

      {/* Board */}
      <div style={{ ...styles.board, width: CELL_SIZE * 8, height: CELL_SIZE * 8 }}>
        {gameState.board && renderBoard(gameState.board, selectedPiece, myPlayerNum, handleCellPress)}
      </div>

      {invalidMove && <p style={styles.invalidMove}>{invalidMove}</p>}

      {/* Resign button */}
      <button style={styles.resignBtn} onClick={() => {
        haptic.impact('heavy');
        if (confirm('Resign this game?')) resign();
      }}>
        Resign
      </button>
    </div>
  );
}

function renderBoard(
  board: Board,
  selected: { row: number; col: number } | null,
  myPlayerNum: 1 | 2 | null,
  onPress: (r: number, c: number) => void,
) {
  // Flip board for player 2 so their pieces are at the bottom
  const rows = myPlayerNum === 2 ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  return rows.flatMap(row =>
    [...Array(8).keys()].map(col => {
      const isDark      = (row + col) % 2 !== 0;
      const piece       = board[row][col];
      const isSelected  = selected?.row === row && selected?.col === col;

      return (
        <div
          key={`${row}-${col}`}
          style={{
            position:        'absolute',
            left:            col * CELL_SIZE,
            top:             (myPlayerNum === 2 ? (7 - row) : row) * CELL_SIZE,
            width:           CELL_SIZE,
            height:          CELL_SIZE,
            background:      isSelected ? '#FFF9C4' : (isDark ? '#795548' : '#EFEBE9'),
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            cursor:          'pointer',
          }}
          onClick={() => onPress(row, col)}
        >
          {piece !== 0 && (
            <div style={{
              width:        CELL_SIZE * 0.75,
              height:       CELL_SIZE * 0.75,
              borderRadius: '50%',
              background:   PIECE_COLORS[piece],
              border:       piece >= 3 ? '3px solid gold' : 'none',
              boxShadow:    '0 2px 4px rgba(0,0,0,0.3)',
            }} />
          )}
        </div>
      );
    })
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:   { padding:'16px', display:'flex', flexDirection:'column', alignItems:'center', gap:16, background:'var(--tg-theme-bg-color)', minHeight:'100vh' },
  timerRow:    { display:'flex', justifyContent:'space-between', width:'100%', maxWidth:400 },
  turnLabel:   { color:'var(--tg-theme-text-color)', fontSize:14 },
  timer:       { fontSize:20, fontWeight:700 },
  board:       { position:'relative', border:'2px solid var(--tg-theme-secondary-bg-color)', borderRadius:4 },
  invalidMove: { color:'var(--tg-theme-destructive-text-color)', fontSize:13 },
  resignBtn:   { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'12px 32px', color:'var(--tg-theme-destructive-text-color)', fontSize:15, cursor:'pointer' },
};
