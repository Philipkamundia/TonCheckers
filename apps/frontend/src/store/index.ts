import { create } from 'zustand';
import { authApi, balanceApi } from '../services/api';

interface User {
  id:            string;
  username:      string;
  elo:           number;
  walletAddress: string;
  gamesPlayed:   number;
  gamesWon:      number;
  gamesLost:     number;
  gamesDrawn:    number;
  totalWon:      string;
}

interface Balance {
  available: string;
  locked:    string;
  total:     string;
}

export interface TournamentLobbyPayload {
  tournamentId:     string;
  gameId:           string;
  round:            number;
  opponentId:       string;
  opponentUsername: string;
  opponentElo:      number;
  expiresAt:        number; // unix ms — source of truth for countdown
}

interface AppStore {
  user:                  User | null;
  balance:               Balance | null;
  accessToken:           string | null;
  activeGameId:          string | null;
  myPlayerNum:           1 | 2 | null;
  pendingLobby:          { gameId: string; stake: string; opponentElo: number } | null;
  // Tournament state
  pendingTournamentLobby: TournamentLobbyPayload | null;
  activeTournamentId:    string | null;
  hydrated:              boolean;

  setUser:                   (user: User | null)    => void;
  setBalance:                (b: Balance | null)    => void;
  setTokens:                 (access: string, refresh: string) => void;
  setActiveGame:             (gameId: string | null, playerNum: 1 | 2 | null) => void;
  setPendingLobby:           (lobby: AppStore['pendingLobby']) => void;
  setPendingTournamentLobby: (lobby: TournamentLobbyPayload | null) => void;
  setActiveTournamentId:     (id: string | null) => void;
  logout:                    () => void;
  /** Rehydrate user + balance from API on app load when a token exists in localStorage */
  hydrate:                   () => Promise<void>;
}

export const useStore = create<AppStore>((set, get) => ({
  user:                   null,
  balance:                null,
  accessToken:            localStorage.getItem('access_token'),
  activeGameId:           null,
  myPlayerNum:            null,
  pendingLobby:           null,
  pendingTournamentLobby: null,
  activeTournamentId:     null,
  hydrated:               false,

  setUser:    (user)           => set({ user }),
  setBalance: (balance)        => set({ balance }),
  setTokens:  (access, refresh) => {
    localStorage.setItem('access_token',  access);
    localStorage.setItem('refresh_token', refresh);
    set({ accessToken: access });
  },
  setActiveGame:             (gameId, playerNum) => set({ activeGameId: gameId, myPlayerNum: playerNum }),
  setPendingLobby:           (lobby)   => set({ pendingLobby: lobby }),
  setPendingTournamentLobby: (lobby)   => set({ pendingTournamentLobby: lobby }),
  setActiveTournamentId:     (id)      => set({ activeTournamentId: id }),
  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    set({ user: null, balance: null, accessToken: null, activeGameId: null, myPlayerNum: null, pendingTournamentLobby: null, activeTournamentId: null });
  },
  hydrate: async () => {
    if (!get().accessToken) { set({ hydrated: true }); return; }
    try {
      const [meRes, balRes] = await Promise.all([authApi.me(), balanceApi.get()]);
      set({ user: meRes.data.user, balance: balRes.data.balance, hydrated: true });
    } catch {
      // Token invalid — clear it so the user is sent to /connect
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      set({ accessToken: null, hydrated: true });
    }
  },
}));
