/**
 * GameRoom.tsx — Live game board (PRD §6 Step 7–9)
 * Client is render-only — all moves validated server-side.
 * Resign button available at any point.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { useGame, type Board } from '../hooks/useGame';
import { getAvailableMoves } from '../engine/moves';
import { PostGame } from './PostGame';
import { useWebSocket } from '../hooks/useWebSocket';
import type { TournamentLobbyPayload } from '../store';

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
  const { myPlayerNum, activeTournamentId, setPendingTournamentLobby, setActiveTournamentId } = useStore();
  const { on } = useWebSocket();
  const navigate = useNavigate();

  // Tournament interrupt — shown when tournament.lobby_ready fires mid-PvP game
  const [tournamentPrompt, setTournamentPrompt] = useState<TournamentLobbyPayload | null>(null);

  const {
    gameState, selectedPiece, setSelectedPiece, invalidMove, makeMove, resign,
    offerDraw, acceptDraw, declineDraw, drawOffer,
  } = useGame(gameId ?? null, myPlayerNum);

  // Listen for tournament lobby_ready while in a PvP game
  useEffect(() => {
    return on<TournamentLobbyPayload>('tournament.lobby_ready', (data) => {
      // Only prompt if we're in an active non-tournament game
      if (!activeTournamentId) {
        haptic.warning();
        setTournamentPrompt(data);
      }
    });
  }, [on, activeTournamentId]);

  // Compute legal moves for highlighting — same engine as AI game
  const legalMoves = useMemo(() => {
    if (!gameState.board || gameState.activePlayer !== myPlayerNum) return [];
    return getAvailableMoves(gameState.board as any, myPlayerNum);
  }, [gameState.board, gameState.activePlayer, myPlayerNum]);

  const movablePieces = useMemo(() =>
    new Set(legalMoves.map(m => `${m.from.row},${m.from.col}`)),
  [legalMoves]);

  const validDests = useMemo(() => {
    if (!selectedPiece) return new Set<string>();
    return new Set(
      legalMoves
        .filter(m => m.from.row === selectedPiece.row && m.from.col === selectedPiece.col)
        .map(m => `${m.to.row},${m.to.col}`)
    );
  }, [selectedPiece, legalMoves]);

  // Hide back button during game — resign to exit (PRD §16: no custom back)
  useEffect(() => {
    return showBackButton(() => {
      if (confirm('Resign the game?')) resign();
    });
  }, [resign]);

  // Route to tournament bracket after game ends in a tournament
  useEffect(() => {
    if ((gameState.status === 'completed' || gameState.status === 'crashed') && activeTournamentId) {
      setActiveTournamentId(null);
      navigate(`/tournaments/${activeTournamentId}`, { replace: true });
    }
  }, [gameState.status, activeTournamentId]);

  if (gameState.status === 'completed' || gameState.status === 'crashed') {
    if (activeTournamentId) return null; // useEffect above handles navigation
    return <PostGame gameId={gameId!} result={gameState.result} myPlayerNum={myPlayerNum} />;
  }

  // Don't render board until we know which player we are — prevents one-frame flip
  if (!myPlayerNum || gameState.status === 'waiting') {
    return (
      <div style={{ ...styles.container, justifyContent: 'center' }}>
        <p style={{ color: 'var(--tg-theme-hint-color)' }}>Connecting…</p>
      </div>
    );
  }

  const isMyTurn    = gameState.activePlayer === myPlayerNum;
  const remainingSecs = Math.ceil((gameState.remainingMs ?? 0) / 1000);
  const timerColor   = remainingSecs <= 5 ? '#E53935' : 'var(--tg-theme-text-color)'; // PRD §6: red at 5s

  function handleTournamentAccept() {
    if (!tournamentPrompt) return;
    resign();
    setPendingTournamentLobby(tournamentPrompt);
    navigate(`/tournament-lobby/${tournamentPrompt.gameId}`, { replace: true });
  }

  function handleCellPress(row: number, col: number) {
    if (!isMyTurn || !gameState.board) return;
    const key = `${row},${col}`;

    if (selectedPiece) {
      if (selectedPiece.row === row && selectedPiece.col === col) {
        setSelectedPiece(null);
      } else if (validDests.has(key)) {
        makeMove(selectedPiece, { row, col });
      } else if (movablePieces.has(key)) {
        setSelectedPiece({ row, col });
        haptic.selection();
      } else {
        setSelectedPiece(null);
      }
    } else if (movablePieces.has(key)) {
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
        {gameState.board && renderBoard(gameState.board, selectedPiece, myPlayerNum, handleCellPress, movablePieces, validDests)}
      </div>

      {invalidMove && <p style={styles.invalidMove}>{invalidMove}</p>}

      {/* Tournament interrupt overlay */}
      {tournamentPrompt && (
        <div style={styles.drawOfferBox}>
          <p style={styles.drawOfferText}>🏆 Tournament match ready! Round {tournamentPrompt.round}</p>
          <p style={{ color: 'var(--tg-theme-hint-color)', fontSize: 13, textAlign: 'center', margin: '0 0 10px' }}>
            vs {tournamentPrompt.opponentUsername} ({tournamentPrompt.opponentElo} ELO)
          </p>
          <p style={{ color: 'var(--tg-theme-destructive-text-color)', fontSize: 12, textAlign: 'center', margin: '0 0 10px' }}>
            Accepting will resign this PvP game
          </p>
          <div style={styles.drawOfferBtns}>
            <button style={styles.acceptBtn} onClick={handleTournamentAccept}>Play Tournament</button>
            <button style={styles.declineBtn} onClick={() => setTournamentPrompt(null)}>Ignore</button>
          </div>
        </div>
      )}

      {/* Draw offer notification */}
      {drawOffer && (
        <div style={styles.drawOfferBox}>
          <p style={styles.drawOfferText}>🤝 {drawOffer} offers a draw</p>
          <div style={styles.drawOfferBtns}>
            <button style={styles.acceptBtn} onClick={acceptDraw}>Accept</button>
            <button style={styles.declineBtn} onClick={declineDraw}>Decline</button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={styles.actionRow}>
        <button style={styles.offerDrawBtn} onClick={() => {
          haptic.impact('light');
          offerDraw();
        }} disabled={!isMyTurn}>
          🤝 Offer Draw
        </button>
        <button style={styles.resignBtn} onClick={() => {
          haptic.impact('heavy');
          if (confirm('Resign this game?')) resign();
        }}>
          🏳 Resign
        </button>
      </div>
    </div>
  );
}

function renderBoard(
  board: Board,
  selected: { row: number; col: number } | null,
  myPlayerNum: 1 | 2 | null,
  onPress: (r: number, c: number) => void,
  movablePieces: Set<string>,
  validDests: Set<string>,
) {
  const rows = myPlayerNum === 2 ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  return rows.flatMap(row =>
    [...Array(8).keys()].map(col => {
      const isDark     = (row + col) % 2 !== 0;
      const piece      = board[row][col];
      const isSelected = selected?.row === row && selected?.col === col;
      const key        = `${row},${col}`;
      const isDest     = validDests.has(key);
      const canMove    = movablePieces.has(key);

      let bg = isDark ? '#795548' : '#EFEBE9';
      if (isSelected)       bg = '#FFF9C4';
      else if (isDest)      bg = '#A5D6A7';
      else if (isDark && canMove && !selected) bg = '#8D6E63';

      return (
        <div
          key={`${row}-${col}`}
          style={{
            position:       'absolute',
            left:           col * CELL_SIZE,
            top:            (myPlayerNum === 2 ? (7 - row) : row) * CELL_SIZE,
            width:          CELL_SIZE,
            height:         CELL_SIZE,
            background:     bg,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            cursor:         (isSelected || isDest || canMove) ? 'pointer' : 'default',
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
              outline:      canMove ? '2px solid rgba(255,255,255,0.5)' : 'none',
            }} />
          )}
          {isDest && piece === 0 && (
            <div style={{ width: CELL_SIZE * 0.3, height: CELL_SIZE * 0.3, borderRadius: '50%', background: 'rgba(76,175,80,0.7)' }} />
          )}
        </div>
      );
    })
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:      { padding:'16px', display:'flex', flexDirection:'column', alignItems:'center', gap:16, background:'var(--tg-theme-bg-color)', minHeight:'100vh' },
  timerRow:       { display:'flex', justifyContent:'space-between', width:'100%', maxWidth:400 },
  turnLabel:      { color:'var(--tg-theme-text-color)', fontSize:14 },
  timer:          { fontSize:20, fontWeight:700 },
  board:          { position:'relative', border:'2px solid var(--tg-theme-secondary-bg-color)', borderRadius:4 },
  invalidMove:    { color:'var(--tg-theme-destructive-text-color)', fontSize:13 },
  drawOfferBox:   { background:'var(--tg-theme-secondary-bg-color)', borderRadius:14, padding:'14px 16px', width:'100%', maxWidth:400 },
  drawOfferText:  { color:'var(--tg-theme-text-color)', fontSize:14, fontWeight:600, margin:'0 0 10px', textAlign:'center' },
  drawOfferBtns:  { display:'flex', gap:10 },
  acceptBtn:      { flex:1, background:'rgba(76,175,80,0.15)', border:'1px solid #4CAF50', borderRadius:10, padding:'10px', color:'#4CAF50', fontSize:14, fontWeight:600, cursor:'pointer' },
  declineBtn:     { flex:1, background:'rgba(229,57,53,0.1)', border:'1px solid #E53935', borderRadius:10, padding:'10px', color:'#E53935', fontSize:14, fontWeight:600, cursor:'pointer' },
  actionRow:      { display:'flex', gap:12, width:'100%', maxWidth:400 },
  offerDrawBtn:   { flex:1, background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'12px', color:'var(--tg-theme-text-color)', fontSize:14, cursor:'pointer' },
  resignBtn:      { flex:1, background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'12px', color:'var(--tg-theme-destructive-text-color)', fontSize:14, cursor:'pointer' },
};
