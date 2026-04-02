/**
 * LobbyRoom.tsx — 10-second lobby countdown (PRD §6 Step 5–6)
 * Either player can cancel. Stakes locked.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { lobbyApi } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';

export function LobbyRoom() {
  const { gameId } = useParams<{ gameId: string }>();
  const { showBackButton, haptic } = useTelegram();
  const { pendingLobby, setActiveGame } = useStore();
  const { on } = useWebSocket();
  const navigate = useNavigate();

  const [countdown,  setCountdown]  = useState(10);
  const [cancelled,  setCancelled]  = useState(false);
  const [cancelledBy,setCancelledBy]= useState<string | null>(null);

  // Back button cancels lobby (PRD §16)
  useEffect(() => {
    return showBackButton(handleCancel);
  }, []);

  // Countdown ticks
  useEffect(() => {
    const unsubs = [
      on<{ gameId: string; remaining: number }>('mm.countdown', ({ remaining }) => {
        setCountdown(remaining);
        if (remaining <= 3) haptic.impact('light');
      }),
      on<{ gameId: string; playerNumber: 1 | 2 }>('mm.game_start', ({ playerNumber }) => {
        haptic.success();
        setActiveGame(gameId!, playerNumber);
        navigate(`/game/${gameId}`);
      }),
      on<{ gameId: string; cancelledBy: string }>('mm.cancelled', ({ cancelledBy }) => {
        setCancelled(true);
        setCancelledBy(cancelledBy);
        haptic.warning();
        setTimeout(() => navigate('/pvp'), 2_000);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [on, gameId]);

  async function handleCancel() {
    if (!gameId) return;
    await lobbyApi.cancel(gameId).catch(() => null);
  }

  if (cancelled) {
    return (
      <div style={styles.centred}>
        <p style={styles.cancelledText}>❌ Lobby cancelled</p>
        <p style={styles.hint}>
          {cancelledBy === 'server_error'
            ? 'Server error — stake returned'
            : 'Returning to matchmaking…'}
        </p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Match Found!</h2>

      <div style={styles.playersRow}>
        <div style={styles.playerCard}>
          <span style={styles.playerLabel}>You</span>
          <span style={styles.playerElo}>—</span>
        </div>
        <span style={styles.vs}>VS</span>
        <div style={styles.playerCard}>
          <span style={styles.playerLabel}>Opponent</span>
          <span style={styles.playerElo}>{pendingLobby?.opponentElo ?? '?'} ELO</span>
        </div>
      </div>

      <div style={styles.stakeInfo}>
        <span style={styles.stakeLabel}>Stake</span>
        <span style={styles.stakeValue}>{pendingLobby?.stake ?? '?'} TON</span>
      </div>

      <div style={styles.countdownCircle}>
        <span style={styles.countdownNum}>{countdown}</span>
      </div>

      <p style={styles.hint}>Game starts automatically in {countdown}s</p>

      <button style={styles.cancelBtn} onClick={handleCancel}>
        Cancel (stake returned)
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:      { padding:'24px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:20, minHeight:'100vh', background:'var(--tg-theme-bg-color)' },
  title:          { color:'var(--tg-theme-text-color)', fontSize:24, fontWeight:700, margin:0 },
  playersRow:     { display:'flex', alignItems:'center', gap:16, width:'100%', justifyContent:'center' },
  playerCard:     { background:'var(--tg-theme-secondary-bg-color)', borderRadius:14, padding:'16px 20px', display:'flex', flexDirection:'column', alignItems:'center', gap:4 },
  playerLabel:    { color:'var(--tg-theme-hint-color)', fontSize:12 },
  playerElo:      { color:'#2AABEE', fontWeight:700, fontSize:18 },
  vs:             { color:'var(--tg-theme-hint-color)', fontSize:18, fontWeight:700 },
  stakeInfo:      { display:'flex', gap:8, alignItems:'center' },
  stakeLabel:     { color:'var(--tg-theme-hint-color)', fontSize:14 },
  stakeValue:     { color:'var(--tg-theme-text-color)', fontWeight:700, fontSize:18 },
  countdownCircle:{ width:80, height:80, borderRadius:40, background:'#2AABEE', display:'flex', alignItems:'center', justifyContent:'center' },
  countdownNum:   { color:'#fff', fontSize:36, fontWeight:700 },
  hint:           { color:'var(--tg-theme-hint-color)', fontSize:13 },
  cancelBtn:      { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'14px 28px', color:'var(--tg-theme-destructive-text-color)', fontSize:15, cursor:'pointer' },
  centred:        { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:12 },
  cancelledText:  { color:'var(--tg-theme-text-color)', fontSize:22, fontWeight:600 },
};
