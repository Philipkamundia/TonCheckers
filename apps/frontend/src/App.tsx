import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { useStore } from './store';
import { WalletGate }        from './screens/WalletGate';
import { Home }              from './screens/Home';
import { PvpLobby }          from './screens/PvpLobby';
import { LobbyRoom }         from './screens/LobbyRoom';
import { GameRoom }          from './screens/GameRoom';
import { PostGame }          from './screens/PostGame';
import { AiSelect }          from './screens/AiSelect';
import { AiGameRoom }        from './screens/AiGameRoom';
import { TournamentList }    from './screens/TournamentList';
import { TournamentDetail }  from './screens/TournamentDetail';
import { TournamentCreate }  from './screens/TournamentCreate';
import { Leaderboard }       from './screens/Leaderboard';
import { Deposit }           from './screens/Deposit';
import { Withdraw }          from './screens/Withdraw';
import { AdminDashboard }    from './screens/AdminDashboard';

const MANIFEST_URL = `${import.meta.env.VITE_APP_URL ?? 'https://checkton.app'}/tonconnect-manifest.json`;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useStore();
  if (!accessToken) return <Navigate to="/connect" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { accessToken, user } = useStore();
  const navigate = useNavigate();

  return (
    <Routes>
      {/* Public — wallet gate */}
      <Route path="/connect" element={
        accessToken && user
          ? <Navigate to={new URLSearchParams(window.location.search).get('mode') === 'admin' ? '/admin' : '/'} replace />
          : <WalletGate onConnected={() => navigate('/', { replace: true })} />
      } />

      {/* Protected — all game screens */}
      <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />

      <Route path="/pvp"       element={<ProtectedRoute><PvpLobby /></ProtectedRoute>} />
      <Route path="/lobby/:gameId" element={<ProtectedRoute><LobbyRoom /></ProtectedRoute>} />
      <Route path="/game/:gameId"  element={<ProtectedRoute><GameRoom /></ProtectedRoute>} />

      <Route path="/ai"              element={<ProtectedRoute><AiSelect /></ProtectedRoute>} />
      <Route path="/ai-game/:gameId" element={<ProtectedRoute><AiGameRoom /></ProtectedRoute>} />

      <Route path="/tournaments"           element={<ProtectedRoute><TournamentList /></ProtectedRoute>} />
      <Route path="/tournaments/create"    element={<ProtectedRoute><TournamentCreate /></ProtectedRoute>} />
      <Route path="/tournaments/:id"       element={<ProtectedRoute><TournamentDetail /></ProtectedRoute>} />

      <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
      <Route path="/deposit"     element={<ProtectedRoute><Deposit /></ProtectedRoute>} />
      <Route path="/withdraw"    element={<ProtectedRoute><Withdraw /></ProtectedRoute>} />

      {/* Admin — only accessible via bot link with ?mode=admin */}
      <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />

      {/* Catch-all → home or connect */}
      <Route path="*" element={<Navigate to={accessToken ? '/' : '/connect'} replace />} />
    </Routes>
  );
}

export function App() {
  const { hydrated, hydrate } = useStore();

  // Hydrate user + balance from API on first load
  useEffect(() => { hydrate(); }, []);

  // Apply Telegram theme CSS variables globally
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const applyTheme = () => {
      const root = document.documentElement;
      const p    = tg.themeParams;
      if (p.bg_color)           root.style.setProperty('--tg-theme-bg-color',            p.bg_color);
      if (p.secondary_bg_color) root.style.setProperty('--tg-theme-secondary-bg-color',  p.secondary_bg_color);
      if (p.text_color)         root.style.setProperty('--tg-theme-text-color',           p.text_color);
      if (p.hint_color)         root.style.setProperty('--tg-theme-hint-color',           p.hint_color);
      if (p.link_color)         root.style.setProperty('--tg-theme-link-color',           p.link_color);
      if (p.button_color)       root.style.setProperty('--tg-theme-button-color',         p.button_color);
      if (p.button_text_color)  root.style.setProperty('--tg-theme-button-text-color',    p.button_text_color);
      if (p.destructive_text_color) root.style.setProperty('--tg-theme-destructive-text-color', p.destructive_text_color);
    };

    applyTheme();
    tg.onEvent('themeChanged', applyTheme);
    return () => tg.offEvent('themeChanged', applyTheme);
  }, []);

  return (
    <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
      {!hydrated ? null : (
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      )}
    </TonConnectUIProvider>
  );
}
