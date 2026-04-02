import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { tournamentApi } from '../services/api';
const TABS = ['open', 'in_progress', 'completed'];
export function TournamentList() {
    const { showBackButton, showMainButton } = useTelegram();
    const navigate = useNavigate();
    const [tab, setTab] = useState('open');
    const [tournaments, setTournaments] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => { return showBackButton(() => navigate('/')); }, []);
    useEffect(() => { return showMainButton('Create Tournament', () => navigate('/tournaments/create'), { color: '#2AABEE' }); }, []);
    useEffect(() => {
        setLoading(true);
        tournamentApi.list(tab)
            .then(r => setTournaments(r.data.tournaments))
            .catch(() => null)
            .finally(() => setLoading(false));
    }, [tab]);
    return (_jsxs("div", { style: styles.container, children: [_jsx("h2", { style: styles.title, children: "Tournaments" }), _jsx("div", { style: styles.tabs, children: TABS.map(t => (_jsx("button", { style: { ...styles.tab, ...(tab === t ? styles.tabActive : {}) }, onClick: () => setTab(t), children: t === 'open' ? 'Open' : t === 'in_progress' ? 'Live' : 'Ended' }, t))) }), loading ? (_jsx("p", { style: styles.hint, children: "Loading\u2026" })) : tournaments.length === 0 ? (_jsxs("p", { style: styles.hint, children: ["No ", tab, " tournaments"] })) : (_jsx("div", { style: styles.list, children: tournaments.map(t => (_jsxs("button", { style: styles.card, onClick: () => navigate(`/tournaments/${t.id}`), children: [_jsxs("div", { style: styles.cardTop, children: [_jsx("span", { style: styles.cardName, children: t.name }), _jsxs("span", { style: styles.cardBracket, children: [t.bracketSize, "P"] })] }), _jsxs("div", { style: styles.cardRow, children: [_jsxs("span", { style: styles.cardHint, children: ["Entry: ", parseFloat(t.entryFee).toFixed(2), " TON"] }), _jsxs("span", { style: styles.cardHint, children: ["Pool: ", parseFloat(t.prizePool).toFixed(2), " TON"] })] }), _jsxs("div", { style: styles.cardRow, children: [_jsxs("span", { style: styles.cardHint, children: [t.participantCount, "/", t.bracketSize, " players"] }), _jsxs("span", { style: styles.cardHint, children: ["by ", t.creatorUsername] })] }), t.status === 'open' && (_jsxs("p", { style: styles.startsAt, children: ["Starts ", new Date(t.startsAt).toLocaleString()] }))] }, t.id))) }))] }));
}
const styles = {
    container: { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
    title: { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 16px' },
    tabs: { display: 'flex', gap: 8, marginBottom: 16 },
    tab: { flex: 1, background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 10, padding: '10px 0', color: 'var(--tg-theme-hint-color)', fontSize: 14, cursor: 'pointer' },
    tabActive: { background: '#2AABEE', color: '#fff' },
    list: { display: 'flex', flexDirection: 'column', gap: 10 },
    card: { background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 14, padding: 16, cursor: 'pointer', textAlign: 'left', width: '100%' },
    cardTop: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },
    cardName: { color: 'var(--tg-theme-text-color)', fontWeight: 600, fontSize: 16 },
    cardBracket: { color: '#2AABEE', fontWeight: 700, fontSize: 14 },
    cardRow: { display: 'flex', justifyContent: 'space-between' },
    cardHint: { color: 'var(--tg-theme-hint-color)', fontSize: 13 },
    startsAt: { color: '#4CAF50', fontSize: 12, margin: '6px 0 0' },
    hint: { color: 'var(--tg-theme-hint-color)', textAlign: 'center', marginTop: 40, fontSize: 14 },
};
