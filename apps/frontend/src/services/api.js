/**
 * api.ts — Axios client
 *
 * PRD §16: initData validated on every backend API request.
 * Every request automatically includes:
 *   Authorization: Bearer <jwt>
 *   X-Telegram-Init-Data: <raw initData string>
 */
import axios from 'axios';
import { updateSocketToken } from '../hooks/useWebSocket';
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
export const api = axios.create({ baseURL: BASE_URL, timeout: 10000 });
// Inject auth token + initData on every request
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('access_token');
    const initData = window.Telegram?.WebApp?.initData ?? '';
    if (token)
        config.headers['Authorization'] = `Bearer ${token}`;
    if (initData)
        config.headers['X-Telegram-Init-Data'] = initData;
    return config;
});
// Auto-refresh on 401
api.interceptors.response.use(res => res, async (error) => {
    if (error.response?.status === 401) {
        const refresh = localStorage.getItem('refresh_token');
        if (refresh) {
            try {
                const { data } = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken: refresh });
                localStorage.setItem('access_token', data.accessToken);
                updateSocketToken(data.accessToken);
                error.config.headers['Authorization'] = `Bearer ${data.accessToken}`;
                return api.request(error.config);
            }
            catch {
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                window.location.reload();
            }
        }
    }
    return Promise.reject(error);
});
// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
    connect: (data) => api.post('/api/auth/connect', data),
    verify: (data) => api.post('/api/auth/verify', data),
    me: () => api.get('/api/auth/me'),
};
// ─── Balance ──────────────────────────────────────────────────────────────────
export const balanceApi = {
    get: () => api.get('/api/balance'),
    history: (page = 1) => api.get('/api/balance/history', { params: { page } }),
    depositInit: () => api.post('/api/balance/deposit/init'),
    withdraw: (amount, destination) => api.post('/api/balance/withdraw', { amount, destination }),
};
// ─── Matchmaking ──────────────────────────────────────────────────────────────
export const matchmakingApi = {
    join: (stake) => api.post('/api/matchmaking/join', { stake }),
    cancel: () => api.post('/api/matchmaking/cancel'),
    status: () => api.get('/api/matchmaking/status'),
};
// ─── Lobby ────────────────────────────────────────────────────────────────────
export const lobbyApi = {
    cancel: (gameId) => api.post(`/api/lobby/${gameId}/cancel`),
};
// ─── Tournaments ──────────────────────────────────────────────────────────────
export const tournamentApi = {
    list: (status) => api.get('/api/tournaments', { params: { status } }),
    get: (id) => api.get(`/api/tournaments/${id}`),
    create: (data) => api.post('/api/tournaments', data),
    join: (id) => api.post(`/api/tournaments/${id}/join`),
};
// ─── Leaderboard ──────────────────────────────────────────────────────────────
export const leaderboardApi = {
    get: (sort = 'elo', page = 1) => api.get('/api/leaderboard', { params: { sort, page } }),
    me: () => api.get('/api/leaderboard/me'),
};
