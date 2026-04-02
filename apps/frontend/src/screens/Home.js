import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
/**
 * Home.tsx — Home screen
 * Balance card + mode selection grid (PvP / AI / Tournaments)
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { balanceApi } from '../services/api';
export function Home() {
    const { hideBackButton, hideMainButton } = useTelegram();
    const { user, balance, setBalance } = useStore();
    const navigate = useNavigate();
    useEffect(() => {
        hideBackButton();
        hideMainButton();
        balanceApi.get().then(r => setBalance(r.data.balance)).catch(() => null);
    }, []);
    return (_jsxs("div", { style: styles.container, children: [_jsxs("div", { style: styles.balanceCard, children: [_jsxs("p", { style: styles.greeting, children: ["Hey, ", user?.username ?? 'Player', " \uD83D\uDC4B"] }), _jsxs("div", { style: styles.balanceRow, children: [_jsx("span", { style: styles.balanceLabel, children: "Balance" }), _jsxs("span", { style: styles.balanceValue, children: [parseFloat(balance?.available ?? '0').toFixed(2), " TON"] })] }), parseFloat(balance?.locked ?? '0') > 0 && (_jsxs("p", { style: styles.lockedText, children: [parseFloat(balance.locked).toFixed(2), " TON locked in game"] })), _jsxs("div", { style: styles.eloRow, children: [_jsx("span", { style: styles.eloLabel, children: "ELO" }), _jsx("span", { style: styles.eloValue, children: user?.elo ?? 1200 })] })] }), _jsxs("div", { style: styles.grid, children: [_jsx(ModeCard, { emoji: "\u2694\uFE0F", title: "PvP", subtitle: "Ranked wagering", onClick: () => navigate('/pvp'), primary: true }), _jsx(ModeCard, { emoji: "\uD83E\uDD16", title: "Practice", subtitle: "AI opponent", onClick: () => navigate('/ai') }), _jsx(ModeCard, { emoji: "\uD83C\uDFC6", title: "Tournaments", subtitle: "Compete for prize pool", onClick: () => navigate('/tournaments') }), _jsx(ModeCard, { emoji: "\uD83D\uDCCA", title: "Leaderboard", subtitle: "Global rankings", onClick: () => navigate('/leaderboard') })] }), _jsxs("div", { style: styles.walletRow, children: [_jsx("button", { style: styles.walletBtn, onClick: () => navigate('/deposit'), children: "Deposit" }), _jsx("button", { style: styles.walletBtn, onClick: () => navigate('/withdraw'), children: "Withdraw" })] })] }));
}
function ModeCard({ emoji, title, subtitle, onClick, primary }) {
    return (_jsxs("button", { style: { ...styles.modeCard, ...(primary ? styles.primaryCard : {}) }, onClick: onClick, children: [_jsx("span", { style: styles.modeEmoji, children: emoji }), _jsx("span", { style: styles.modeTitle, children: title }), _jsx("span", { style: styles.modeSubtitle, children: subtitle })] }));
}
const styles = {
    container: { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
    balanceCard: { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 16, padding: 20, marginBottom: 20 },
    greeting: { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '0 0 8px' },
    balanceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    balanceLabel: { color: 'var(--tg-theme-hint-color)', fontSize: 14 },
    balanceValue: { color: 'var(--tg-theme-text-color)', fontSize: 28, fontWeight: 700 },
    lockedText: { color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: '4px 0 0' },
    eloRow: { display: 'flex', justifyContent: 'space-between', marginTop: 12 },
    eloLabel: { color: 'var(--tg-theme-hint-color)', fontSize: 13 },
    eloValue: { color: '#2AABEE', fontSize: 16, fontWeight: 600 },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 },
    modeCard: { background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 16, padding: '20px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', textAlign: 'center' },
    primaryCard: { background: '#2AABEE', gridColumn: '1 / -1' },
    modeEmoji: { fontSize: 28 },
    modeTitle: { color: 'var(--tg-theme-text-color)', fontWeight: 600, fontSize: 15 },
    modeSubtitle: { color: 'var(--tg-theme-hint-color)', fontSize: 12 },
    walletRow: { display: 'flex', gap: 12 },
    walletBtn: { flex: 1, background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 12, padding: '14px', color: 'var(--tg-theme-text-color)', fontSize: 15, fontWeight: 500, cursor: 'pointer' },
};
