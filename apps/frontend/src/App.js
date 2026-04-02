import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { useStore } from './store';
import { WalletGate } from './screens/WalletGate';
import { Home } from './screens/Home';
import { PvpLobby } from './screens/PvpLobby';
import { LobbyRoom } from './screens/LobbyRoom';
import { GameRoom } from './screens/GameRoom';
import { AiSelect } from './screens/AiSelect';
import { AiGameRoom } from './screens/AiGameRoom';
import { TournamentList } from './screens/TournamentList';
import { TournamentDetail } from './screens/TournamentDetail';
import { TournamentCreate } from './screens/TournamentCreate';
import { Leaderboard } from './screens/Leaderboard';
import { Deposit } from './screens/Deposit';
import { Withdraw } from './screens/Withdraw';
import { AdminDashboard } from './screens/AdminDashboard';
const MANIFEST_URL = `${import.meta.env.VITE_APP_URL ?? 'https://checkton.app'}/tonconnect-manifest.json`;
function ProtectedRoute({ children }) {
    const { accessToken } = useStore();
    if (!accessToken)
        return _jsx(Navigate, { to: "/connect", replace: true });
    return _jsx(_Fragment, { children: children });
}
function AppRoutes() {
    const { accessToken, user } = useStore();
    const navigate = useNavigate();
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/connect", element: accessToken && user
                    ? _jsx(Navigate, { to: new URLSearchParams(window.location.search).get('mode') === 'admin' ? '/admin' : '/', replace: true })
                    : _jsx(WalletGate, { onConnected: () => navigate('/', { replace: true }) }) }), _jsx(Route, { path: "/", element: _jsx(ProtectedRoute, { children: _jsx(Home, {}) }) }), _jsx(Route, { path: "/pvp", element: _jsx(ProtectedRoute, { children: _jsx(PvpLobby, {}) }) }), _jsx(Route, { path: "/lobby/:gameId", element: _jsx(ProtectedRoute, { children: _jsx(LobbyRoom, {}) }) }), _jsx(Route, { path: "/game/:gameId", element: _jsx(ProtectedRoute, { children: _jsx(GameRoom, {}) }) }), _jsx(Route, { path: "/ai", element: _jsx(ProtectedRoute, { children: _jsx(AiSelect, {}) }) }), _jsx(Route, { path: "/ai-game/:gameId", element: _jsx(ProtectedRoute, { children: _jsx(AiGameRoom, {}) }) }), _jsx(Route, { path: "/tournaments", element: _jsx(ProtectedRoute, { children: _jsx(TournamentList, {}) }) }), _jsx(Route, { path: "/tournaments/create", element: _jsx(ProtectedRoute, { children: _jsx(TournamentCreate, {}) }) }), _jsx(Route, { path: "/tournaments/:id", element: _jsx(ProtectedRoute, { children: _jsx(TournamentDetail, {}) }) }), _jsx(Route, { path: "/leaderboard", element: _jsx(ProtectedRoute, { children: _jsx(Leaderboard, {}) }) }), _jsx(Route, { path: "/deposit", element: _jsx(ProtectedRoute, { children: _jsx(Deposit, {}) }) }), _jsx(Route, { path: "/withdraw", element: _jsx(ProtectedRoute, { children: _jsx(Withdraw, {}) }) }), _jsx(Route, { path: "/admin", element: _jsx(ProtectedRoute, { children: _jsx(AdminDashboard, {}) }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: accessToken ? '/' : '/connect', replace: true }) })] }));
}
export function App() {
    const { hydrated, hydrate } = useStore();
    // Hydrate user + balance from API on first load
    useEffect(() => { hydrate(); }, []);
    // Apply Telegram theme CSS variables globally
    useEffect(() => {
        const tg = window.Telegram?.WebApp;
        if (!tg)
            return;
        const applyTheme = () => {
            const root = document.documentElement;
            const p = tg.themeParams;
            if (p.bg_color)
                root.style.setProperty('--tg-theme-bg-color', p.bg_color);
            if (p.secondary_bg_color)
                root.style.setProperty('--tg-theme-secondary-bg-color', p.secondary_bg_color);
            if (p.text_color)
                root.style.setProperty('--tg-theme-text-color', p.text_color);
            if (p.hint_color)
                root.style.setProperty('--tg-theme-hint-color', p.hint_color);
            if (p.link_color)
                root.style.setProperty('--tg-theme-link-color', p.link_color);
            if (p.button_color)
                root.style.setProperty('--tg-theme-button-color', p.button_color);
            if (p.button_text_color)
                root.style.setProperty('--tg-theme-button-text-color', p.button_text_color);
            if (p.destructive_text_color)
                root.style.setProperty('--tg-theme-destructive-text-color', p.destructive_text_color);
        };
        applyTheme();
        tg.onEvent('themeChanged', applyTheme);
        return () => tg.offEvent('themeChanged', applyTheme);
    }, []);
    return (_jsx(TonConnectUIProvider, { manifestUrl: MANIFEST_URL, children: !hydrated ? null : (_jsx(BrowserRouter, { children: _jsx(AppRoutes, {}) })) }));
}
