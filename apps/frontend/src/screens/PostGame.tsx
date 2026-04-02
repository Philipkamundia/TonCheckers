/**
 * PostGame.tsx — Post-game results screen (PRD §13)
 * Winner, loser, ELO changes, payout, rematch/home buttons
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { balanceApi } from '../services/api';

interface GameResult {
  winner?:      1 | 2;
  reason:       string;
  winnerPayout?: string;
  platformFee?:  string;
  prizePool?:    string;
  stake?:        string;
  eloChanges?: {
    winner: { before: number; after: number; delta: number };
    loser:  { before: number; after: number; delta: number };
  };
}

export function PostGame({ gameId, result, myPlayerNum }: {
  gameId:      string;
  result?:     GameResult;
  myPlayerNum: 1 | 2 | null;
}) {
  const { showMainButton, showBackButton, haptic } = useTelegram();
  const { setBalance } = useStore();
  const navigate = useNavigate();

  const isDraw = result?.reason === 'draw';
  const iWon   = !isDraw && result?.winner === myPlayerNum;
  const myElo  = myPlayerNum === result?.winner
    ? result?.eloChanges?.winner
    : result?.eloChanges?.loser;

  // Refresh balance after game
  useEffect(() => {
    balanceApi.get().then(r => setBalance(r.data.balance)).catch(() => null);
  }, []);

  // Back goes home (PRD §16)
  useEffect(() => {
    return showBackButton(() => navigate('/'));
  }, []);

  // MainButton = Home
  useEffect(() => {
    return showMainButton('Home', () => navigate('/'), { color: '#2AABEE' });
  }, []);

  const headline = isDraw ? '🤝 Draw!'
    : iWon ? '🏆 You Win!'
    : '💔 You Lost';

  const subtext = isDraw
    ? `Stake returned in full — no fee`
    : iWon
    ? `+${result?.winnerPayout} TON`
    : `Better luck next time`;

  return (
    <div style={styles.container}>
      <div style={styles.resultCard}>
        <h1 style={styles.headline}>{headline}</h1>
        <p style={styles.subtext}>{subtext}</p>

        {/* ELO Change */}
        {myElo && (
          <div style={styles.eloBox}>
            <span style={styles.eloLabel}>ELO</span>
            <span style={styles.eloValue}>{myElo.before}</span>
            <span style={styles.eloArrow}>→</span>
            <span style={styles.eloValue}>{myElo.after}</span>
            <span style={{ ...styles.eloDelta, color: myElo.delta >= 0 ? '#4CAF50' : '#E53935' }}>
              {myElo.delta >= 0 ? '+' : ''}{myElo.delta}
            </span>
          </div>
        )}

        {/* Payout breakdown */}
        {!isDraw && result?.winnerPayout && (
          <div style={styles.breakdown}>
            <Row label="Prize pool" value={`${result.prizePool ?? '?'} TON`} />
            <Row label="Platform fee (15%)" value={`-${result.platformFee ?? '?'} TON`} dim />
            {iWon && <Row label="You receive" value={`${result.winnerPayout} TON`} highlight />}
          </div>
        )}
        {isDraw && (
          <div style={styles.breakdown}>
            <Row label="Stake returned" value={`${result?.stake ?? '?'} TON`} />
            <Row label="Platform fee" value="0 TON" dim />
          </div>
        )}
      </div>

      {/* Reason label */}
      <p style={styles.reason}>
        {result?.reason === 'timeout' ? '⏱ Opponent timed out'
          : result?.reason === 'resign' ? '🏳 Opponent resigned'
          : result?.reason === 'disconnect' ? '🔌 Opponent disconnected'
          : result?.reason === 'no_pieces' ? 'All pieces captured'
          : result?.reason === 'no_moves' ? 'No legal moves left'
          : ''}
      </p>

      {/* Share button — PRD §13 native Telegram share */}
      <button style={styles.shareBtn} onClick={() => {
        haptic.impact('light');
        const text = iWon
          ? `I just won ${result?.winnerPayout} TON on CheckTON! 🏆`
          : 'Just played a match on CheckTON! ♟️';
        const url = `https://t.me/share/url?url=t.me/CheckTONBot&text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
      }}>
        Share Result
      </button>
    </div>
  );
}

function Row({ label, value, dim, highlight }: {
  label: string; value: string; dim?: boolean; highlight?: boolean;
}) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0' }}>
      <span style={{ color: dim ? 'var(--tg-theme-hint-color)' : 'var(--tg-theme-text-color)', fontSize:14 }}>{label}</span>
      <span style={{ color: highlight ? '#4CAF50' : dim ? 'var(--tg-theme-hint-color)' : 'var(--tg-theme-text-color)', fontSize:14, fontWeight: highlight ? 700 : 400 }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:  { padding:'24px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:20, minHeight:'100vh', background:'var(--tg-theme-bg-color)' },
  resultCard: { background:'var(--tg-theme-secondary-bg-color)', borderRadius:20, padding:24, width:'100%', maxWidth:360 },
  headline:   { color:'var(--tg-theme-text-color)', fontSize:32, fontWeight:800, margin:'0 0 8px', textAlign:'center' },
  subtext:    { color:'var(--tg-theme-hint-color)', fontSize:16, textAlign:'center', marginBottom:20 },
  eloBox:     { display:'flex', alignItems:'center', gap:8, justifyContent:'center', marginBottom:16 },
  eloLabel:   { color:'var(--tg-theme-hint-color)', fontSize:13 },
  eloValue:   { color:'var(--tg-theme-text-color)', fontWeight:700, fontSize:16 },
  eloArrow:   { color:'var(--tg-theme-hint-color)' },
  eloDelta:   { fontWeight:700, fontSize:16 },
  breakdown:  { borderTop:'1px solid var(--tg-theme-bg-color)', paddingTop:12 },
  reason:     { color:'var(--tg-theme-hint-color)', fontSize:13 },
  shareBtn:   { background:'var(--tg-theme-secondary-bg-color)', border:'none', borderRadius:12, padding:'14px 32px', color:'#2AABEE', fontSize:15, fontWeight:500, cursor:'pointer' },
};
