import { create } from 'zustand';
import { authApi, balanceApi } from '../services/api';

interface User {
  id:          string;
  username:    string;
  elo:         number;
  walletAddress: string;
}

interface Balance {
  available: string;
  locked:    string;
  total:     string;
}

interface AppStore {
  user:          User | null;
  balance:       Balance | null;
  accessToken:   string | null;
  activeGameId:  string | null;
  myPlayerNum:   1 | 2 | null;
  pendingLobby:  { gameId: string; stake: string; opponentElo: number } | null;
  hydrated:      boolean;

  setUser:         (user: User | null)    => void;
  setBalance:      (b: Balance | null)    => void;
  setTokens:       (access: string, refresh: string) => void;
  setActiveGame:   (gameId: string | null, playerNum: 1 | 2 | null) => void;
  setPendingLobby: (lobby: AppStore['pendingLobby']) => void;
  logout:          () => void;
  /** Rehydrate user + balance from API on app load when a token exists in localStorage */
  hydrate:         () => Promise<void>;
}

export const useStore = create<AppStore>((set, get) => ({
  user:         null,
  balance:      null,
  accessToken:  localStorage.getItem('access_token'),
  activeGameId: null,
  myPlayerNum:  null,
  pendingLobby: null,
  hydrated:     false,

  setUser:    (user)           => set({ user }),
  setBalance: (balance)        => set({ balance }),
  setTokens:  (access, refresh) => {
    localStorage.setItem('access_token',  access);
    localStorage.setItem('refresh_token', refresh);
    set({ accessToken: access });
  },
  setActiveGame: (gameId, playerNum) => set({ activeGameId: gameId, myPlayerNum: playerNum }),
  setPendingLobby: (lobby)   => set({ pendingLobby: lobby }),
  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    set({ user: null, balance: null, accessToken: null, activeGameId: null, myPlayerNum: null, hydrated: false });
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
