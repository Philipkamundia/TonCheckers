import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { useStore } from './store';
import { WalletGate }             from './screens/WalletGate';
import { Home }                   from './screens/Home';
import { applyTheme }             from './screens/Profile';
import { PvpLobby }               from './screens/PvpLobby';
import { LobbyRoom }              from './screens/LobbyRoom';
import { GameRoom }               from './screens/GameRoom';
import { AiSelect }               from './screens/AiSelect';
import { AiGameRoom }             from './screens/AiGameRoom';
import { TournamentList }         from './screens/TournamentList';
import { TournamentDetail }       from './screens/TournamentDetail';
import { TournamentCreate }       from './screens/TournamentCreate';
import { TournamentLobbyRoom }    from './screens/TournamentLobbyRoom';
import { Leaderboard }            from './screens/Leaderboard';
import { Deposit }                from './screens/Deposit';
import { Withdraw }               from './screens/Withdraw';
import { Profile }                from './screens/Profile';
import { AdminDashboard }         from './screens/AdminDashboard';
import { useWebSocket }           from './hooks/useWebSocket';
import type { TournamentLobbyPayload } from './store';

const MANIFEST_URL = `${import.meta.env.VITE_APP_URL ?? 'https://toncheckers.pages.dev'}/tonconnect-manifest.json`;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useStore();
  if (!accessToken) return <Navigate to="/connect" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function AppRoutes() {
  const { accessToken, user, activeGameId, setPendingTournamentLobby } = useStore();
  const navigate = useNavigate();
  const { on } = useWebSocket();
  const postAuthPath = '/';

  const activeGameIdRef = useRef(activeGameId);
  useEffect(() => { activeGameIdRef.current = activeGameId; }, [activeGameId]);

  // Pending tournament starting prompts (can be multiple concurrent tournaments)
  const [tournamentPrompts, setTournamentPrompts] = useState<
    Array<{ tournamentId: string; tournamentName: string; windowSeconds: number }>
  >([]);

  useEffect(() => {
    return on<{ tournamentId: string; tournamentName: string; windowSeconds: number }>(
      'tournament.starting', (data) => {
        setTournamentPrompts(prev => {
          if (prev.find(p => p.tournamentId === data.tournamentId)) return prev;
          return [...prev, data];
        });
      },
    );
  }, [on]);

  function acceptTournament(tournamentId: string) {
    setTournamentPrompts(prev => prev.filter(p => p.tournamentId !== tournamentId));
    navigate(`/tournaments/${tournamentId}`);
  }

  function declineTournament(tournamentId: string) {
    setTournamentPrompts(prev => prev.filter(p => p.tournamentId !== tournamentId));
  }

  // Global tournament lobby_ready — route directly if not in a game
  useEffect(() => {
    return on<TournamentLobbyPayload>('tournament.lobby_ready', (data) => {
      if (!activeGameIdRef.current) {
        setPendingTournamentLobby(data);
        navigate(`/tournament-lobby/${data.gameId}`);
      }
    });
  }, [on]);

  return (
    <>
      {/* Tournament starting prompts — stacked, one per tournament */}
      {tournamentPrompts.map((p, i) => (
        <div key={p.tournamentId} style={{
          position: 'fixed', bottom: 80 + i * 130, left: 16, right: 16, zIndex: 1000,
          background: 'var(--tg-theme-secondary-bg-color)',
          borderRadius: 16, padding: '14px 16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          border: '1px solid #2AABEE',
        }}>
          <p style={{ color: 'var(--tg-theme-text-color)', fontWeight: 700, fontSize: 15, margin: '0 0 4px' }}>
            🏆 {p.tournamentName}
          </p>
          <p style={{ color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '0 0 12px' }}>
            Tournament is starting — join the bracket ({p.windowSeconds}s window)
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => acceptTournament(p.tournamentId)} style={{
              flex: 1, background: '#2AABEE', border: 'none', borderRadius: 10,
              padding: '10px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>Join Bracket</button>
            <button onClick={() => declineTournament(p.tournamentId)} style={{
              flex: 1, background: 'var(--tg-theme-bg-color)', border: 'none', borderRadius: 10,
              padding: '10px', color: 'var(--tg-theme-hint-color)', fontSize: 14, cursor: 'pointer',
            }}>Decline</button>
          </div>
        </div>
      ))}
      <Routes>
      {/* Public — wallet gate */}
      <Route path="/connect" element={
        accessToken && user
          ? <Navigate to={postAuthPath} replace />
          : <WalletGate onConnected={() => navigate(postAuthPath, { replace: true })} />
      } />

      {/* Protected — all game screens */}
      <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />

      <Route path="/pvp"           element={<ProtectedRoute><PvpLobby /></ProtectedRoute>} />
      <Route path="/lobby/:gameId" element={<ProtectedRoute><LobbyRoom /></ProtectedRoute>} />
      <Route path="/game/:gameId"  element={<ProtectedRoute><GameRoom /></ProtectedRoute>} />

      <Route path="/ai"              element={<ProtectedRoute><AiSelect /></ProtectedRoute>} />
      <Route path="/ai-game/:gameId" element={<ProtectedRoute><AiGameRoom /></ProtectedRoute>} />

      <Route path="/tournaments"                    element={<ProtectedRoute><TournamentList /></ProtectedRoute>} />
      <Route path="/tournaments/create"             element={<ProtectedRoute><TournamentCreate /></ProtectedRoute>} />
      <Route path="/tournaments/:id"                element={<ProtectedRoute><TournamentDetail /></ProtectedRoute>} />
      <Route path="/tournament-lobby/:gameId"       element={<ProtectedRoute><TournamentLobbyRoom /></ProtectedRoute>} />

      <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
      <Route path="/deposit"     element={<ProtectedRoute><Deposit /></ProtectedRoute>} />
      <Route path="/withdraw"    element={<ProtectedRoute><Withdraw /></ProtectedRoute>} />
      <Route path="/profile"     element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/admin"       element={<AdminRoute><AdminDashboard /></AdminRoute>} />

      {/* Catch-all */}
      <Route path="*" element={
        accessToken
          ? <Navigate to="/" replace />
          : <Navigate to="/connect" replace />
      } />
    </Routes>
    </>
  );
}

export function App() {
  const { hydrated, hydrate } = useStore();

  // Hydrate user + balance from API on first load
  useEffect(() => { hydrate(); }, []);

  // Apply saved theme override immediately on mount, before Telegram theme runs
  useEffect(() => {
    const saved = (localStorage.getItem('app_theme') ?? 'system') as 'system' | 'light' | 'dark';
    if (saved !== 'system') applyTheme(saved);
  }, []);

  // Apply Telegram theme CSS variables globally (skipped if user has override)
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const applyTheme = () => {
      // Don't override if user has a manual theme set
      const saved = localStorage.getItem('app_theme');
      if (saved === 'dark' || saved === 'light') return;

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
