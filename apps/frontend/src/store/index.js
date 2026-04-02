import { create } from 'zustand';
import { authApi, balanceApi } from '../services/api';
export const useStore = create((set, get) => ({
    user: null,
    balance: null,
    accessToken: localStorage.getItem('access_token'),
    activeGameId: null,
    myPlayerNum: null,
    pendingLobby: null,
    hydrated: false,
    setUser: (user) => set({ user }),
    setBalance: (balance) => set({ balance }),
    setTokens: (access, refresh) => {
        localStorage.setItem('access_token', access);
        localStorage.setItem('refresh_token', refresh);
        set({ accessToken: access });
    },
    setActiveGame: (gameId, playerNum) => set({ activeGameId: gameId, myPlayerNum: playerNum }),
    setPendingLobby: (lobby) => set({ pendingLobby: lobby }),
    logout: () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        set({ user: null, balance: null, accessToken: null, activeGameId: null, myPlayerNum: null, hydrated: false });
    },
    hydrate: async () => {
        if (!get().accessToken) {
            set({ hydrated: true });
            return;
        }
        try {
            const [meRes, balRes] = await Promise.all([authApi.me(), balanceApi.get()]);
            set({ user: meRes.data.user, balance: balRes.data.balance, hydrated: true });
        }
        catch {
            // Token invalid — clear it so the user is sent to /connect
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            set({ accessToken: null, hydrated: true });
        }
    },
}));
