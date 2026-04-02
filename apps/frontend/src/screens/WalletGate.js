import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * WalletGate.tsx — Wallet connection screen
 *
 * PRD §2: Wallet connection is the sole auth method.
 * PRD §16: No email/password. TonConnect SDK handles wallet picker.
 */
import { useState, useEffect } from 'react';
import { useTelegram } from '../hooks/useTelegram';
import { useStore } from '../store';
import { authApi } from '../services/api';
import { tonConnectUI } from '../services/tonConnect';
import { TonConnectButton } from '@tonconnect/ui-react';
export function WalletGate({ onConnected }) {
    const { initData, haptic, showMainButton, hideMainButton } = useTelegram();
    const { setUser, setTokens } = useStore();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [wallet, setWallet] = useState(tonConnectUI.wallet);
    // Track wallet connection state
    useEffect(() => {
        return tonConnectUI.onStatusChange((w) => setWallet(w));
    }, []);
    // Show MainButton once wallet is connected (PRD §16: primary CTA = MainButton)
    useEffect(() => {
        if (!wallet)
            return;
        return showMainButton('Continue', handleAuth, { color: '#2AABEE' });
    }, [wallet]);
    async function handleAuth() {
        if (!wallet || !initData)
            return;
        setLoading(true);
        setError(null);
        try {
            const address = wallet.account.address;
            const proof = wallet.connectItems?.tonProof;
            // If we have a proof (fresh connection), always use /connect
            // If no proof (wallet already connected, app resumed), use /verify
            let res;
            if (proof && 'proof' in proof) {
                res = await authApi.connect({ walletAddress: address, proof: proof.proof, initData });
            }
            else {
                try {
                    res = await authApi.verify({ walletAddress: address, initData });
                }
                catch (verifyErr) {
                    const status = verifyErr?.response?.status;
                    // 404 = wallet not registered yet, but we have no proof to register with
                    if (status === 404) {
                        setError('Please disconnect and reconnect your wallet to complete registration.');
                        haptic.error();
                        return;
                    }
                    throw verifyErr;
                }
            }
            setTokens(res.data.accessToken, res.data.refreshToken);
            setUser(res.data.user);
            haptic.success();
            hideMainButton();
            onConnected();
        }
        catch (err) {
            setError('Connection failed. Please try again.');
            haptic.error();
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { style: styles.container, children: [_jsx("div", { style: styles.logo, children: "\u265F\uFE0F" }), _jsx("h1", { style: styles.title, children: "CheckTON" }), _jsx("p", { style: styles.subtitle, children: "Wager TON. Challenge Opponents. Climb the Ranks." }), _jsxs("div", { style: styles.card, children: [_jsx("p", { style: styles.cardText, children: "Connect your TON wallet to start playing" }), _jsx(TonConnectButton, { style: { margin: '0 auto', display: 'block' } }), wallet && (_jsxs("p", { style: styles.connectedText, children: ["\u2705 Wallet connected \u00B7 ", wallet.account.address.slice(0, 8), "..."] }))] }), error && _jsx("p", { style: styles.error, children: error }), loading && _jsx("p", { style: styles.loading, children: "Authenticating\u2026" })] }));
}
const styles = {
    container: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px', minHeight: '100vh', background: 'var(--tg-theme-bg-color)' },
    logo: { fontSize: 64, marginBottom: 16 },
    title: { fontSize: 32, fontWeight: 700, color: 'var(--tg-theme-text-color)', margin: 0 },
    subtitle: { fontSize: 14, color: 'var(--tg-theme-hint-color)', textAlign: 'center', marginBottom: 32 },
    card: { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 320 },
    cardText: { color: 'var(--tg-theme-text-color)', textAlign: 'center', marginBottom: 16 },
    connectedText: { color: '#4CAF50', textAlign: 'center', fontSize: 13, marginTop: 12 },
    error: { color: 'var(--tg-theme-destructive-text-color)', fontSize: 13, marginTop: 12 },
    loading: { color: 'var(--tg-theme-hint-color)', fontSize: 13, marginTop: 12 },
};
