import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { tournamentApi } from '../services/api';
export function TournamentCreate() {
    const { showBackButton, showMainButton, setMainButtonLoading, haptic } = useTelegram();
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [bracketSize, setBracketSize] = useState(8);
    const [entryFee, setEntryFee] = useState('1');
    const [startsAt, setStartsAt] = useState('');
    const [error, setError] = useState(null);
    useEffect(() => { return showBackButton(() => navigate('/tournaments')); }, []);
    useEffect(() => {
        const valid = name.length >= 3 && parseFloat(entryFee) >= 0 && startsAt;
        return showMainButton('Create Tournament', handleCreate, { disabled: !valid });
    }, [name, entryFee, startsAt]);
    async function handleCreate() {
        setError(null);
        setMainButtonLoading(true);
        try {
            const r = await tournamentApi.create({ name, bracketSize, entryFee, startsAt });
            haptic.success();
            navigate(`/tournaments/${r.data.tournament.id}`);
        }
        catch (e) {
            setError(e?.response?.data?.error ?? 'Creation failed');
            haptic.error();
        }
        finally {
            setMainButtonLoading(false);
        }
    }
    return (_jsxs("div", { style: styles.container, children: [_jsx("h2", { style: styles.title, children: "Create Tournament" }), _jsx("p", { style: styles.label, children: "Tournament Name" }), _jsx("input", { style: styles.input, placeholder: "e.g. Sunday Showdown", value: name, onChange: e => setName(e.target.value), maxLength: 128 }), _jsx("p", { style: styles.label, children: "Bracket Size" }), _jsx("div", { style: styles.sizeRow, children: [8, 16, 32, 64].map(s => (_jsxs("button", { style: { ...styles.sizeBtn, ...(bracketSize === s ? styles.sizeBtnActive : {}) }, onClick: () => setBracketSize(s), children: [s, "P"] }, s))) }), _jsx("p", { style: styles.label, children: "Entry Fee (TON)" }), _jsx("input", { style: styles.input, type: "number", placeholder: "0.00", value: entryFee, onChange: e => setEntryFee(e.target.value), min: "0", step: "0.1" }), _jsx("p", { style: styles.label, children: "Start Date & Time" }), _jsx("input", { style: styles.input, type: "datetime-local", value: startsAt, onChange: e => setStartsAt(e.target.value) }), entryFee && bracketSize && (_jsxs("div", { style: styles.preview, children: [_jsxs("p", { style: styles.previewText, children: ["Prize pool: ", (parseFloat(entryFee || '0') * bracketSize).toFixed(2), " TON"] }), _jsxs("p", { style: styles.previewText, children: ["Winner gets: ", (parseFloat(entryFee || '0') * bracketSize * 0.70).toFixed(2), " TON (70%)"] }), _jsxs("p", { style: styles.previewText, children: ["You earn: ", (parseFloat(entryFee || '0') * bracketSize * 0.05).toFixed(2), " TON (5% creator fee)"] })] })), error && _jsx("p", { style: styles.error, children: error })] }));
}
const styles = {
    container: { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh', paddingBottom: 80 },
    title: { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 16px' },
    label: { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '12px 0 4px' },
    input: { width: '100%', background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 12, padding: '13px', fontSize: 15, color: 'var(--tg-theme-text-color)', boxSizing: 'border-box' },
    sizeRow: { display: 'flex', gap: 8 },
    sizeBtn: { flex: 1, background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 10, padding: '12px 0', color: 'var(--tg-theme-text-color)', fontSize: 15, cursor: 'pointer' },
    sizeBtnActive: { background: '#2AABEE', color: '#fff' },
    preview: { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 12, padding: 14, marginTop: 16 },
    previewText: { color: 'var(--tg-theme-text-color)', fontSize: 14, margin: '3px 0' },
    error: { color: 'var(--tg-theme-destructive-text-color)', fontSize: 13, marginTop: 8 },
};
