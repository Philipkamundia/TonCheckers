import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AiGameRoom.tsx — AI practice game (PRD §8)
 * Same board as PvP but ai.* events, no wagering display.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useWebSocket } from '../hooks/useWebSocket';
const CELL_SIZE = Math.floor((Math.min(window.innerWidth, 400) - 32) / 8);
const PIECE_COLORS = {
    1: '#E53935', 2: '#1565C0', 3: '#FF8F00', 4: '#00838F',
};
export function AiGameRoom() {
    const { gameId } = useParams();
    const { showBackButton, haptic } = useTelegram();
    const { on, emit } = useWebSocket();
    const navigate = useNavigate();
    const [board, setBoard] = useState(null);
    const [remainingMs, setRemainingMs] = useState(30000);
    const [selected, setSelected] = useState(null);
    const [gameOver, setGameOver] = useState(null);
    const [invalid, setInvalid] = useState(null);
    const [aiThinking, setAiThinking] = useState(false);
    useEffect(() => { return showBackButton(() => navigate('/ai')); }, []);
    useEffect(() => {
        const unsubs = [
            on('ai.move_ok', (data) => {
                setBoard(data.board);
                setRemainingMs(data.remainingMs);
                setSelected(null);
                setAiThinking(false);
                haptic.impact('light');
            }),
            on('ai.move_invalid', ({ reason }) => {
                setInvalid(reason);
                setAiThinking(false);
                setTimeout(() => setInvalid(null), 2000);
                haptic.error();
            }),
            on('ai.end', (data) => {
                setBoard(data.board);
                setGameOver(data);
                haptic[data.winner === 1 ? 'success' : 'warning']();
            }),
            on('ai.state', (data) => setBoard(data.board)),
            on('game.tick', ({ remainingMs }) => setRemainingMs(remainingMs)),
        ];
        return () => unsubs.forEach(u => u());
    }, [on]);
    function handleCell(row, col) {
        if (aiThinking || gameOver || !board)
            return;
        const piece = board[row][col];
        if (selected) {
            if (selected.row === row && selected.col === col) {
                setSelected(null);
                return;
            }
            setAiThinking(true);
            emit('ai.move', { gameId, from: selected, to: { row, col } });
            setSelected(null);
        }
        else if (piece === 1 || piece === 3) {
            setSelected({ row, col });
            haptic.selection();
        }
    }
    if (gameOver) {
        const msg = gameOver.winner === 1 ? '🎉 You Win!' : gameOver.result === 'draw' ? '🤝 Draw!' : '🤖 AI Wins!';
        return (_jsxs("div", { style: styles.overContainer, children: [_jsx("h2", { style: styles.overTitle, children: msg }), _jsx("p", { style: styles.overHint, children: "Practice game \u2014 no ELO change, no wagering" }), _jsx("button", { style: styles.homeBtn, onClick: () => navigate('/'), children: "Home" }), _jsx("button", { style: styles.retryBtn, onClick: () => navigate('/ai'), children: "Play Again" })] }));
    }
    const secs = Math.ceil(remainingMs / 1000);
    return (_jsxs("div", { style: styles.container, children: [_jsxs("div", { style: styles.timerRow, children: [_jsx("span", { style: styles.turnLabel, children: aiThinking ? '🤖 AI thinking…' : '🟢 Your turn' }), _jsxs("span", { style: { ...styles.timer, color: secs <= 5 ? '#E53935' : 'var(--tg-theme-text-color)' }, children: [secs, "s"] })] }), _jsx("div", { style: { ...styles.board, width: CELL_SIZE * 8, height: CELL_SIZE * 8 }, children: board && [...Array(8).keys()].flatMap(row => [...Array(8).keys()].map(col => {
                    const dark = (row + col) % 2 !== 0;
                    const p = board[row][col];
                    const sel = selected?.row === row && selected?.col === col;
                    return (_jsx("div", { style: { position: 'absolute', left: col * CELL_SIZE, top: row * CELL_SIZE, width: CELL_SIZE, height: CELL_SIZE, background: sel ? '#FFF9C4' : dark ? '#795548' : '#EFEBE9', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }, onClick: () => handleCell(row, col), children: p !== 0 && _jsx("div", { style: { width: CELL_SIZE * 0.75, height: CELL_SIZE * 0.75, borderRadius: '50%', background: PIECE_COLORS[p], border: p >= 3 ? '3px solid gold' : 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' } }) }, `${row}-${col}`));
                })) }), invalid && _jsx("p", { style: styles.invalid, children: invalid })] }));
}
const styles = {
    container: { padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
    timerRow: { display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 400 },
    turnLabel: { color: 'var(--tg-theme-text-color)', fontSize: 14 },
    timer: { fontSize: 20, fontWeight: 700 },
    board: { position: 'relative', border: '2px solid var(--tg-theme-secondary-bg-color)', borderRadius: 4 },
    invalid: { color: 'var(--tg-theme-destructive-text-color)', fontSize: 13 },
    overContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, padding: 24, background: 'var(--tg-theme-bg-color)' },
    overTitle: { color: 'var(--tg-theme-text-color)', fontSize: 30, fontWeight: 800 },
    overHint: { color: 'var(--tg-theme-hint-color)', fontSize: 13, textAlign: 'center' },
    homeBtn: { background: '#2AABEE', border: 'none', borderRadius: 12, padding: '14px 32px', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', width: '100%', maxWidth: 280 },
    retryBtn: { background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 12, padding: '14px 32px', color: 'var(--tg-theme-text-color)', fontSize: 16, cursor: 'pointer', width: '100%', maxWidth: 280 },
};
