import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * PvpLobby.tsx — PvP stake selection + matchmaking
 * PRD §16: Find Match uses Telegram MainButton (not custom button)
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { matchmakingApi } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
const PRESET_STAKES = ['0.1', '0.5', '1', '2', '5', '10'];
export function PvpLobby() {
    const { showBackButton, showMainButton, hideMainButton, setMainButtonLoading, haptic } = useTelegram();
    const { balance, setPendingLobby } = useStore();
    const { on } = useWebSocket();
    const navigate = useNavigate();
    const [stake, setStake] = useState('1');
    const [customStake, setCustomStake] = useState('');
    const [inQueue, setInQueue] = useState(false);
    const [error, setError] = useState(null);
    const finalStake = customStake || stake;
    const availableTON = parseFloat(balance?.available ?? '0');
    const canAfford = parseFloat(finalStake) <= availableTON;
    // Back button — PRD §16: no custom back buttons
    useEffect(() => {
        return showBackButton(() => {
            if (inQueue)
                matchmakingApi.cancel().catch(() => null);
            navigate('/');
        });
    }, [inQueue]);
    // MainButton — PRD §16: primary CTA
    useEffect(() => {
        if (inQueue)
            return;
        return showMainButton(`Find Match · ${finalStake} TON`, handleFindMatch, { disabled: !canAfford });
    }, [finalStake, canAfford, inQueue]);
    // WebSocket matchmaking events
    useEffect(() => {
        const unsubs = [
            on('mm.found', (data) => {
                haptic.success();
                setPendingLobby({ gameId: data.gameId, stake: data.stake, opponentElo: data.opponentElo });
                hideMainButton();
                navigate(`/lobby/${data.gameId}`);
            }),
            on('mm.stake_adjusted', (data) => {
                haptic.warning();
                setError(`Stake adjusted to ${data.resolvedStake} TON (opponent had lower stake)`);
            }),
        ];
        return () => unsubs.forEach(u => u());
    }, [on]);
    async function handleFindMatch() {
        setError(null);
        setMainButtonLoading(true);
        try {
            await matchmakingApi.join(finalStake);
            setInQueue(true);
        }
        catch (e) {
            setError(e?.response?.data?.error ?? 'Failed to join queue');
            haptic.error();
        }
        finally {
            setMainButtonLoading(false);
        }
    }
    async function handleCancel() {
        await matchmakingApi.cancel().catch(() => null);
        setInQueue(false);
        showMainButton(`Find Match · ${finalStake} TON`, handleFindMatch, { disabled: !canAfford });
    }
    return (_jsxs("div", { style: styles.container, children: [_jsx("h2", { style: styles.title, children: "PvP \u2014 Choose Stake" }), _jsxs("p", { style: styles.balance, children: ["Available: ", availableTON.toFixed(2), " TON"] }), !inQueue ? (_jsxs(_Fragment, { children: [_jsx("div", { style: styles.presets, children: PRESET_STAKES.map(s => (_jsxs("button", { style: { ...styles.preset, ...(stake === s && !customStake ? styles.presetActive : {}) }, onClick: () => { setStake(s); setCustomStake(''); haptic.selection(); }, children: [s, " TON"] }, s))) }), _jsx("input", { style: styles.input, type: "number", placeholder: "Custom amount", value: customStake, onChange: e => setCustomStake(e.target.value), min: "0.1", step: "0.1" }), !canAfford && _jsx("p", { style: styles.error, children: "Insufficient balance" }), error && _jsx("p", { style: styles.error, children: error }), _jsxs("p", { style: styles.hint, children: ["Win: ", _jsxs("strong", { children: [(parseFloat(finalStake) * 2 * 0.85).toFixed(2), " TON"] }), " (after 15% fee)"] })] })) : (_jsxs("div", { style: styles.queueBox, children: [_jsx("div", { style: styles.radar, children: "\uD83D\uDD0D" }), _jsx("p", { style: styles.searching, children: "Searching for opponent\u2026" }), _jsxs("p", { style: styles.stakeLabel, children: ["Stake: ", finalStake, " TON"] }), _jsx("button", { style: styles.cancelBtn, onClick: handleCancel, children: "Cancel" })] }))] }));
}
const styles = {
    container: { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
    title: { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, marginBottom: 4 },
    balance: { color: 'var(--tg-theme-hint-color)', fontSize: 14, marginBottom: 20 },
    presets: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    preset: { background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 10, padding: '10px 16px', color: 'var(--tg-theme-text-color)', fontSize: 15, cursor: 'pointer' },
    presetActive: { background: '#2AABEE', color: '#fff' },
    input: { width: '100%', background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 12, padding: '14px', fontSize: 16, color: 'var(--tg-theme-text-color)', boxSizing: 'border-box', marginBottom: 12 },
    hint: { color: 'var(--tg-theme-hint-color)', fontSize: 13, textAlign: 'center' },
    error: { color: 'var(--tg-theme-destructive-text-color)', fontSize: 13 },
    queueBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 40, gap: 12 },
    radar: { fontSize: 48, animation: 'pulse 1.5s infinite' },
    searching: { color: 'var(--tg-theme-text-color)', fontSize: 18, fontWeight: 500 },
    stakeLabel: { color: 'var(--tg-theme-hint-color)', fontSize: 14 },
    cancelBtn: { background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 12, padding: '12px 32px', color: 'var(--tg-theme-destructive-text-color)', fontSize: 15, cursor: 'pointer', marginTop: 16 },
};
