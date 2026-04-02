import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AdminDashboard.tsx — Admin dashboard (PRD §15)
 *
 * Access: only via admin bot URL (?mode=admin)
 * Auth: treasury wallet must be connected and signed
 * Hidden from regular users — route only renders in admin mode
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../hooks/useTelegram';
import { api } from '../services/api';
import { tonConnectUI } from '../services/tonConnect';
const TABS = [
    { id: 'summary', label: 'Overview', emoji: '📊' },
    { id: 'withdrawals', label: 'Withdrawals', emoji: '💸' },
    { id: 'treasury', label: 'Treasury', emoji: '🏦' },
    { id: 'users', label: 'Users', emoji: '👥' },
    { id: 'games', label: 'Games', emoji: '♟️' },
    { id: 'tournaments', label: 'Tournaments', emoji: '🏆' },
    { id: 'fees', label: 'Fees', emoji: '💰' },
    { id: 'crashes', label: 'Crashes', emoji: '🔴' },
];
export function AdminDashboard() {
    const { haptic } = useTelegram();
    const [tab, setTab] = useState('summary');
    const [authed, setAuthed] = useState(false);
    const [authError, setAuthError] = useState(null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    // Auth: connect treasury wallet and sign challenge
    async function handleAdminAuth() {
        const wallet = tonConnectUI.wallet;
        if (!wallet) {
            setAuthError('Connect your treasury wallet first');
            return;
        }
        try {
            const challengeRes = await api.get('/api/admin/challenge');
            const challenge = challengeRes.data.challenge;
            // Sign the challenge with the wallet via TonConnect
            // The signature is sent as X-Admin-Signature for server-side Ed25519 verification
            let signature;
            let stateInit;
            try {
                await tonConnectUI.sendTransaction({
                    validUntil: Math.floor(Date.now() / 1000) + 300,
                    messages: [],
                });
                const proof = tonConnectUI.wallet?.connectItems?.tonProof;
                if (!proof || !('proof' in proof))
                    throw new Error('No proof available');
                signature = proof.proof.signature;
                stateInit = proof.proof.stateInit ?? '';
            }
            catch {
                setAuthError('Wallet signing failed — reconnect your treasury wallet');
                return;
            }
            api.defaults.headers.common['X-Admin-Wallet'] = wallet.account.address;
            api.defaults.headers.common['X-Admin-Challenge'] = challenge;
            api.defaults.headers.common['X-Admin-Signature'] = signature;
            api.defaults.headers.common['X-Admin-State-Init'] = stateInit;
            await api.get('/api/admin/summary');
            setAuthed(true);
            haptic.success();
        }
        catch {
            setAuthError('Authentication failed — treasury wallet required');
            haptic.error();
        }
    }
    // Load data for active tab
    useEffect(() => {
        if (!authed)
            return;
        setLoading(true);
        setData(null);
        const endpoints = {
            summary: '/api/admin/summary',
            withdrawals: '/api/admin/withdrawals/pending',
            treasury: '/api/admin/treasury',
            users: '/api/admin/users',
            games: '/api/admin/games',
            tournaments: '/api/admin/tournaments',
            fees: '/api/admin/fees',
            crashes: '/api/admin/crashes',
        };
        api.get(endpoints[tab])
            .then(r => setData(r.data))
            .catch(() => setData({ error: 'Failed to load' }))
            .finally(() => setLoading(false));
    }, [tab, authed]);
    if (!authed) {
        return (_jsxs("div", { style: styles.authContainer, children: [_jsx("h2", { style: styles.title, children: "\uD83D\uDD10 Admin Dashboard" }), _jsx("p", { style: styles.hint, children: "Connect your treasury wallet to authenticate" }), _jsx("button", { style: styles.authBtn, onClick: handleAdminAuth, children: "Authenticate with Treasury Wallet" }), authError && _jsx("p", { style: styles.error, children: authError })] }));
    }
    return (_jsxs("div", { style: styles.container, children: [_jsx("h2", { style: styles.title, children: "Admin Dashboard" }), _jsx("div", { style: styles.tabBar, children: TABS.map(t => (_jsxs("button", { style: { ...styles.tabBtn, ...(tab === t.id ? styles.tabBtnActive : {}) }, onClick: () => { setTab(t.id); haptic.selection(); }, children: [_jsx("span", { children: t.emoji }), _jsx("span", { style: styles.tabLabel, children: t.label })] }, t.id))) }), _jsxs("div", { style: styles.content, children: [loading && _jsx("p", { style: styles.hint, children: "Loading\u2026" }), !loading && data && _jsx(AdminTabContent, { tab: tab, data: data, onRefresh: () => setTab(tab) })] })] }));
}
function AdminTabContent({ tab, data, onRefresh }) {
    const d = data;
    if (tab === 'summary' && d.summary) {
        const s = d.summary;
        return (_jsxs("div", { style: styles.grid, children: [_jsx(StatCard, { label: "Total Users", value: s.total_users }), _jsx(StatCard, { label: "New Today", value: s.new_users_today }), _jsx(StatCard, { label: "Active Games", value: s.active_games }), _jsx(StatCard, { label: "Queue Size", value: s.queue_size }), _jsx(StatCard, { label: "Open Tournaments", value: s.open_tournaments }), _jsx(StatCard, { label: "Pending Withdrawals", value: s.pending_withdrawals, highlight: s.pending_withdrawals > 0 })] }));
    }
    if (tab === 'withdrawals') {
        const ws = (d.withdrawals ?? []);
        if (!ws.length)
            return _jsx("p", { style: styles.hint, children: "No pending withdrawals \u2705" });
        return (_jsx("div", { children: ws.map(w => (_jsxs("div", { style: styles.card, children: [_jsxs("p", { style: styles.cardTitle, children: [w.username, " \u2014 ", parseFloat(w.amount).toFixed(2), " TON"] }), _jsx("p", { style: styles.cardSub, children: w.destination }), _jsx("p", { style: styles.cardSub, children: new Date(w.created_at).toLocaleString() }), _jsxs("div", { style: styles.btnRow, children: [_jsx("button", { style: styles.approveBtn, onClick: async () => {
                                    await api.post(`/api/admin/withdrawals/${w.id}/approve`);
                                    onRefresh();
                                }, children: "Approve" }), _jsx("button", { style: styles.rejectBtn, onClick: async () => {
                                    await api.post(`/api/admin/withdrawals/${w.id}/reject`, { reason: 'Rejected by admin' });
                                    onRefresh();
                                }, children: "Reject" })] })] }, w.id))) }));
    }
    if (tab === 'treasury' && d.treasury) {
        const t = d.treasury;
        return (_jsxs("div", { style: styles.grid, children: [_jsx(StatCard, { label: "Total Obligations", value: `${parseFloat(String(t.totalObligations ?? 0)).toFixed(2)} TON` }), _jsx(StatCard, { label: "Available Balances", value: `${parseFloat(String(t.totalAvailable ?? 0)).toFixed(2)} TON` }), _jsx(StatCard, { label: "Locked in Games", value: `${parseFloat(String(t.totalLocked ?? 0)).toFixed(2)} TON` }), _jsx(StatCard, { label: "Platform Fees", value: `${parseFloat(String(t.platformFeesEarned ?? 0)).toFixed(2)} TON` })] }));
    }
    // Generic JSON display for other tabs
    return (_jsx("pre", { style: styles.json, children: JSON.stringify(data, null, 2) }));
}
function StatCard({ label, value, highlight }) {
    return (_jsxs("div", { style: { ...styles.statCard, ...(highlight ? styles.statCardHighlight : {}) }, children: [_jsx("p", { style: styles.statLabel, children: label }), _jsx("p", { style: styles.statValue, children: value })] }));
}
const styles = {
    container: { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
    authContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: 24, gap: 16, background: 'var(--tg-theme-bg-color)' },
    title: { color: 'var(--tg-theme-text-color)', fontSize: 20, fontWeight: 700, margin: '0 0 12px' },
    hint: { color: 'var(--tg-theme-hint-color)', fontSize: 14, textAlign: 'center' },
    authBtn: { background: '#2AABEE', border: 'none', borderRadius: 14, padding: '16px 32px', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', width: '100%', maxWidth: 320 },
    error: { color: 'var(--tg-theme-destructive-text-color)', fontSize: 13 },
    tabBar: { display: 'flex', overflowX: 'auto', gap: 6, marginBottom: 16, paddingBottom: 4 },
    tabBtn: { flex: 'none', background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', minWidth: 64 },
    tabBtnActive: { background: '#2AABEE' },
    tabLabel: { color: 'var(--tg-theme-text-color)', fontSize: 10 },
    content: { paddingBottom: 40 },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
    statCard: { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 12, padding: '14px 12px' },
    statCardHighlight: { background: '#FFF3E0', borderColor: '#FF8F00', border: '1px solid' },
    statLabel: { color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: '0 0 4px' },
    statValue: { color: 'var(--tg-theme-text-color)', fontWeight: 700, fontSize: 18, margin: 0 },
    card: { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 12, padding: 14, marginBottom: 10 },
    cardTitle: { color: 'var(--tg-theme-text-color)', fontWeight: 600, margin: '0 0 4px' },
    cardSub: { color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: '2px 0' },
    btnRow: { display: 'flex', gap: 8, marginTop: 10 },
    approveBtn: { flex: 1, background: '#4CAF50', border: 'none', borderRadius: 10, padding: '10px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
    rejectBtn: { flex: 1, background: 'var(--tg-theme-destructive-text-color)', border: 'none', borderRadius: 10, padding: '10px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
    json: { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 12, padding: 12, fontSize: 11, color: 'var(--tg-theme-text-color)', overflowX: 'auto', whiteSpace: 'pre-wrap' },
};
