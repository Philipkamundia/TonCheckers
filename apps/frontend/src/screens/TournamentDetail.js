import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { tournamentApi } from '../services/api';
export function TournamentDetail() {
    const { id } = useParams();
    const { showBackButton, showMainButton, hideMainButton, setMainButtonLoading, haptic } = useTelegram();
    const navigate = useNavigate();
    const [tournament, setTournament] = useState(null);
    const [joined, setJoined] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => { return showBackButton(() => navigate('/tournaments')); }, []);
    useEffect(() => {
        tournamentApi.get(id).then(r => setTournament(r.data.tournament)).catch(() => null);
    }, [id]);
    useEffect(() => {
        if (!tournament || tournament.status !== 'open' || joined) {
            hideMainButton();
            return;
        }
        return showMainButton(`Join · ${parseFloat(tournament.entryFee).toFixed(2)} TON`, handleJoin, { color: '#2AABEE' });
    }, [tournament, joined]);
    async function handleJoin() {
        setMainButtonLoading(true);
        try {
            await tournamentApi.join(id);
            setJoined(true);
            haptic.success();
            tournamentApi.get(id).then(r => setTournament(r.data.tournament));
        }
        catch (e) {
            setError(e?.response?.data?.error ?? 'Failed to join');
            haptic.error();
        }
        finally {
            setMainButtonLoading(false);
        }
    }
    if (!tournament)
        return _jsx("div", { style: styles.loading, children: "Loading\u2026" });
    const maxRound = Math.max(...tournament.matches.map(m => m.round), 1);
    return (_jsxs("div", { style: styles.container, children: [_jsx("h2", { style: styles.title, children: tournament.name }), _jsxs("div", { style: styles.infoRow, children: [_jsx(Stat, { label: "Players", value: `${tournament.participants.length}/${tournament.bracketSize}` }), _jsx(Stat, { label: "Entry", value: `${parseFloat(tournament.entryFee).toFixed(2)} TON` }), _jsx(Stat, { label: "Prize", value: `${parseFloat(tournament.prizePool).toFixed(2)} TON` })] }), tournament.status === 'open' && (_jsxs("p", { style: styles.starts, children: ["Starts ", new Date(tournament.startsAt).toLocaleString()] })), error && _jsx("p", { style: styles.error, children: error }), joined && _jsx("p", { style: styles.success, children: "\u2705 Registered! You'll be notified before start." }), _jsxs("div", { style: styles.section, children: [_jsx("p", { style: styles.sectionTitle, children: "Prize Distribution" }), _jsxs("div", { style: styles.prizeRow, children: [_jsx("span", { style: styles.prizeLabel, children: "\uD83E\uDD47 Winner (70%)" }), _jsxs("span", { style: styles.prizeVal, children: [(parseFloat(tournament.prizePool) * 0.70).toFixed(2), " TON"] })] }), _jsxs("div", { style: styles.prizeRow, children: [_jsx("span", { style: styles.prizeLabel, children: "\uD83D\uDC64 Creator (5%)" }), _jsxs("span", { style: styles.prizeVal, children: [(parseFloat(tournament.prizePool) * 0.05).toFixed(2), " TON"] })] }), _jsxs("div", { style: styles.prizeRow, children: [_jsx("span", { style: styles.prizeLabel, children: "\uD83C\uDFE6 Platform (25%)" }), _jsxs("span", { style: styles.prizeVal, children: [(parseFloat(tournament.prizePool) * 0.25).toFixed(2), " TON"] })] })] }), tournament.matches.length > 0 && (_jsxs("div", { style: styles.section, children: [_jsxs("p", { style: styles.sectionTitle, children: ["Bracket \u00B7 Round ", tournament.currentRound] }), Array.from({ length: maxRound }, (_, i) => i + 1).map(round => (_jsxs("div", { children: [_jsxs("p", { style: styles.roundLabel, children: ["Round ", round] }), tournament.matches.filter(m => m.round === round).map(m => {
                                const p1 = tournament.participants.find(p => p.userId === m.player1Id);
                                const p2 = tournament.participants.find(p => p.userId === m.player2Id);
                                return (_jsxs("div", { style: styles.matchCard, children: [_jsxs("span", { style: { ...styles.matchPlayer, ...(m.winnerId === m.player1Id ? styles.winner : {}) }, children: [p1?.username ?? 'TBD', " (", p1?.elo ?? '?', ")"] }), _jsx("span", { style: styles.vs, children: m.isBye ? 'BYE' : 'vs' }), _jsx("span", { style: { ...styles.matchPlayer, ...(m.winnerId === m.player2Id ? styles.winner : {}) }, children: m.isBye ? '—' : (p2?.username ?? 'TBD') })] }, m.matchNumber));
                            })] }, round)))] })), _jsxs("div", { style: styles.section, children: [_jsxs("p", { style: styles.sectionTitle, children: ["Players (", tournament.participants.length, ")"] }), tournament.participants.map(p => (_jsxs("div", { style: styles.participantRow, children: [_jsx("span", { style: { ...styles.participantName, ...(p.isEliminated ? styles.eliminated : {}) }, children: p.username }), _jsxs("span", { style: styles.participantElo, children: [p.elo, " ELO ", p.receivedBye ? '(bye)' : ''] })] }, p.userId)))] })] }));
}
function Stat({ label, value }) {
    return (_jsxs("div", { style: { textAlign: 'center' }, children: [_jsx("p", { style: { color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: 0 }, children: label }), _jsx("p", { style: { color: 'var(--tg-theme-text-color)', fontWeight: 700, fontSize: 16, margin: 0 }, children: value })] }));
}
const styles = {
    container: { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh', paddingBottom: 80 },
    title: { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 12px' },
    infoRow: { display: 'flex', justifyContent: 'space-around', background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: '14px', marginBottom: 12 },
    starts: { color: '#4CAF50', fontSize: 13, marginBottom: 12 },
    error: { color: 'var(--tg-theme-destructive-text-color)', fontSize: 13 },
    success: { color: '#4CAF50', fontSize: 13 },
    section: { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: 14, marginTop: 12 },
    sectionTitle: { color: 'var(--tg-theme-text-color)', fontWeight: 600, fontSize: 15, margin: '0 0 10px' },
    prizeRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0' },
    prizeLabel: { color: 'var(--tg-theme-text-color)', fontSize: 14 },
    prizeVal: { color: '#2AABEE', fontWeight: 600, fontSize: 14 },
    roundLabel: { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '8px 0 4px' },
    matchCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--tg-theme-bg-color)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 },
    matchPlayer: { color: 'var(--tg-theme-text-color)', fontSize: 13, flex: 1 },
    winner: { color: '#4CAF50', fontWeight: 700 },
    vs: { color: 'var(--tg-theme-hint-color)', fontSize: 12, padding: '0 8px' },
    participantRow: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--tg-theme-bg-color)' },
    participantName: { color: 'var(--tg-theme-text-color)', fontSize: 14 },
    participantElo: { color: 'var(--tg-theme-hint-color)', fontSize: 13 },
    eliminated: { textDecoration: 'line-through', color: 'var(--tg-theme-hint-color)' },
    loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--tg-theme-hint-color)', background: 'var(--tg-theme-bg-color)' },
};
