import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Deposit.tsx — Deposit initiation screen (PRD §4)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { balanceApi } from '../services/api';
export function Deposit() {
    const { showBackButton, hideMainButton } = useTelegram();
    const navigate = useNavigate();
    const [depositInfo, setDepositInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    useEffect(() => { return showBackButton(() => navigate('/')); }, []);
    useEffect(() => { hideMainButton(); }, []);
    async function getDepositAddress() {
        setLoading(true);
        try {
            const r = await balanceApi.depositInit();
            setDepositInfo(r.data);
        }
        catch { /* ignore */ }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { style: styles.container, children: [_jsx("h2", { style: styles.title, children: "Deposit TON" }), _jsx("p", { style: styles.hint, children: "Minimum deposit: 0.5 TON" }), _jsx("p", { style: styles.desc, children: "Send TON from your wallet to the address below. Your balance will update automatically within 60 seconds of confirmation." }), !depositInfo ? (_jsx("button", { style: styles.btn, onClick: getDepositAddress, disabled: loading, children: loading ? 'Loading…' : 'Get Deposit Address' })) : (_jsxs("div", { style: styles.infoCard, children: [_jsx("p", { style: styles.label, children: "Wallet Address" }), _jsx("p", { style: styles.value, children: depositInfo.address }), _jsx("p", { style: styles.label, children: "Memo (required)" }), _jsx("p", { style: styles.value, children: depositInfo.memo }), _jsx("p", { style: styles.warning, children: "\u26A0\uFE0F You MUST include the memo above, or your deposit cannot be credited." }), _jsx("button", { style: styles.copyBtn, onClick: () => navigator.clipboard?.writeText(depositInfo.memo), children: "Copy Memo" })] }))] }));
}
const styles = {
    container: { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
    title: { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
    hint: { color: '#4CAF50', fontSize: 13, margin: '0 0 12px' },
    desc: { color: 'var(--tg-theme-hint-color)', fontSize: 14, lineHeight: 1.5, marginBottom: 20 },
    btn: { width: '100%', background: '#2AABEE', border: 'none', borderRadius: 14, padding: '16px', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' },
    infoCard: { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: 16 },
    label: { color: 'var(--tg-theme-hint-color)', fontSize: 12, margin: '8px 0 2px' },
    value: { color: 'var(--tg-theme-text-color)', fontSize: 14, fontWeight: 500, wordBreak: 'break-all', margin: 0 },
    warning: { color: '#FF8F00', fontSize: 13, margin: '12px 0' },
    copyBtn: { background: 'var(--tg-theme-bg-color)', border: 'none', borderRadius: 10, padding: '10px 20px', color: '#2AABEE', fontSize: 14, cursor: 'pointer' },
};
