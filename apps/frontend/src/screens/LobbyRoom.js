import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
    const { gameId } = useParams();
    const { showBackButton, haptic } = useTelegram();
    const { pendingLobby, setActiveGame } = useStore();
    const { on } = useWebSocket();
    const navigate = useNavigate();
    const [countdown, setCountdown] = useState(10);
    const [cancelled, setCancelled] = useState(false);
    const [cancelledBy, setCancelledBy] = useState(null);
    // Back button cancels lobby (PRD §16)
    useEffect(() => {
        return showBackButton(handleCancel);
    }, []);
    // Countdown ticks
    useEffect(() => {
        const unsubs = [
            on('mm.countdown', ({ remaining }) => {
                setCountdown(remaining);
                if (remaining <= 3)
                    haptic.impact('light');
            }),
            on('mm.game_start', ({ playerNumber }) => {
                haptic.success();
                setActiveGame(gameId, playerNumber);
                navigate(`/game/${gameId}`);
            }),
            on('mm.cancelled', ({ cancelledBy }) => {
                setCancelled(true);
                setCancelledBy(cancelledBy);
                haptic.warning();
                setTimeout(() => navigate('/pvp'), 2000);
            }),
        ];
        return () => unsubs.forEach(u => u());
    }, [on, gameId]);
    async function handleCancel() {
        if (!gameId)
            return;
        await lobbyApi.cancel(gameId).catch(() => null);
    }
    if (cancelled) {
        return (_jsxs("div", { style: styles.centred, children: [_jsx("p", { style: styles.cancelledText, children: "\u274C Lobby cancelled" }), _jsx("p", { style: styles.hint, children: cancelledBy === 'server_error'
                        ? 'Server error — stake returned'
                        : 'Returning to matchmaking…' })] }));
    }
    return (_jsxs("div", { style: styles.container, children: [_jsx("h2", { style: styles.title, children: "Match Found!" }), _jsxs("div", { style: styles.playersRow, children: [_jsxs("div", { style: styles.playerCard, children: [_jsx("span", { style: styles.playerLabel, children: "You" }), _jsx("span", { style: styles.playerElo, children: "\u2014" })] }), _jsx("span", { style: styles.vs, children: "VS" }), _jsxs("div", { style: styles.playerCard, children: [_jsx("span", { style: styles.playerLabel, children: "Opponent" }), _jsxs("span", { style: styles.playerElo, children: [pendingLobby?.opponentElo ?? '?', " ELO"] })] })] }), _jsxs("div", { style: styles.stakeInfo, children: [_jsx("span", { style: styles.stakeLabel, children: "Stake" }), _jsxs("span", { style: styles.stakeValue, children: [pendingLobby?.stake ?? '?', " TON"] })] }), _jsx("div", { style: styles.countdownCircle, children: _jsx("span", { style: styles.countdownNum, children: countdown }) }), _jsxs("p", { style: styles.hint, children: ["Game starts automatically in ", countdown, "s"] }), _jsx("button", { style: styles.cancelBtn, onClick: handleCancel, children: "Cancel (stake returned)" })] }));
}
const styles = {
    container: { padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, minHeight: '100vh', background: 'var(--tg-theme-bg-color)' },
    title: { color: 'var(--tg-theme-text-color)', fontSize: 24, fontWeight: 700, margin: 0 },
    playersRow: { display: 'flex', alignItems: 'center', gap: 16, width: '100%', justifyContent: 'center' },
    playerCard: { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
    playerLabel: { color: 'var(--tg-theme-hint-color)', fontSize: 12 },
    playerElo: { color: '#2AABEE', fontWeight: 700, fontSize: 18 },
    vs: { color: 'var(--tg-theme-hint-color)', fontSize: 18, fontWeight: 700 },
    stakeInfo: { display: 'flex', gap: 8, alignItems: 'center' },
    stakeLabel: { color: 'var(--tg-theme-hint-color)', fontSize: 14 },
    stakeValue: { color: 'var(--tg-theme-text-color)', fontWeight: 700, fontSize: 18 },
    countdownCircle: { width: 80, height: 80, borderRadius: 40, background: '#2AABEE', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    countdownNum: { color: '#fff', fontSize: 36, fontWeight: 700 },
    hint: { color: 'var(--tg-theme-hint-color)', fontSize: 13 },
    cancelBtn: { background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 12, padding: '14px 28px', color: 'var(--tg-theme-destructive-text-color)', fontSize: 15, cursor: 'pointer' },
    centred: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12 },
    cancelledText: { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 600 },
};
