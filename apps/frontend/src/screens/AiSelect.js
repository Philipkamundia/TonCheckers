import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AiSelect.tsx — AI difficulty selection (PRD §8)
 * No wagering, no ELO impact. Practice sandbox.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useWebSocket } from '../hooks/useWebSocket';
import { useStore } from '../store';
const DIFFICULTIES = [
    { id: 'beginner', label: 'Beginner', emoji: '🟢', desc: 'Plays randomly — great for learning' },
    { id: 'intermediate', label: 'Intermediate', emoji: '🟡', desc: 'Greedy strategy — picks best capture' },
    { id: 'hard', label: 'Hard', emoji: '🟠', desc: 'Minimax depth 4 — thinks ahead' },
    { id: 'master', label: 'Master', emoji: '🔴', desc: 'Alpha-beta depth 8 — plays competitively' },
];
export function AiSelect() {
    const { showBackButton, showMainButton, haptic } = useTelegram();
    const { emit, on } = useWebSocket();
    const { setActiveGame } = useStore();
    const navigate = useNavigate();
    const [selected, setSelected] = useState('intermediate');
    const [starting, setStarting] = useState(false);
    useEffect(() => { return showBackButton(() => navigate('/')); }, []);
    useEffect(() => {
        return showMainButton('Start Practice', handleStart, { disabled: starting });
    }, [selected, starting]);
    useEffect(() => {
        const unsub = on('ai.state', ({ gameId }) => {
            setActiveGame(gameId, 1);
            navigate(`/ai-game/${gameId}`);
        });
        return unsub;
    }, [on]);
    function handleStart() {
        setStarting(true);
        haptic.impact('medium');
        emit('ai.start', { difficulty: selected });
    }
    return (_jsxs("div", { style: styles.container, children: [_jsx("h2", { style: styles.title, children: "Practice vs AI" }), _jsx("p", { style: styles.subtitle, children: "No wagering \u00B7 No ELO change \u00B7 Full rules enforced" }), _jsx("div", { style: styles.cards, children: DIFFICULTIES.map(d => (_jsxs("button", { style: { ...styles.card, ...(selected === d.id ? styles.cardSelected : {}) }, onClick: () => { setSelected(d.id); haptic.selection(); }, children: [_jsx("span", { style: styles.emoji, children: d.emoji }), _jsxs("div", { children: [_jsx("p", { style: styles.label, children: d.label }), _jsx("p", { style: styles.desc, children: d.desc })] })] }, d.id))) }), starting && _jsx("p", { style: styles.hint, children: "Starting game\u2026" })] }));
}
const styles = {
    container: { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
    title: { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
    subtitle: { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '0 0 24px' },
    cards: { display: 'flex', flexDirection: 'column', gap: 10 },
    card: { background: 'var(--tg-theme-secondary-bg-color)', border: '2px solid transparent', borderRadius: 14, padding: '16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', textAlign: 'left' },
    cardSelected: { borderColor: '#2AABEE' },
    emoji: { fontSize: 28 },
    label: { color: 'var(--tg-theme-text-color)', fontWeight: 600, fontSize: 16, margin: 0 },
    desc: { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '2px 0 0' },
    hint: { color: 'var(--tg-theme-hint-color)', fontSize: 13, textAlign: 'center', marginTop: 16 },
};
