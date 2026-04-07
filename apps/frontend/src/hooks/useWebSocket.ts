/**
 * useWebSocket.ts — Socket.IO client hook
 *
 * Socket is created eagerly at module load (as soon as a token exists),
 * so event listeners registered in any component are never missed.
 */
import { useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:3001';

let globalSocket: Socket | null = null;

function getOrCreateSocket(): Socket | null {
  const token = localStorage.getItem('access_token');
  if (!token) return null;

  if (globalSocket && !globalSocket.disconnected) return globalSocket;

  globalSocket?.removeAllListeners();
  globalSocket = io(WS_URL, {
    auth:                 { token },
    transports:           ['polling', 'websocket'],
    reconnection:         true,
    reconnectionDelay:    1_000,
    reconnectionAttempts: 10,
  });

  globalSocket.on('connect',       () => console.log('[ws] connected', globalSocket?.id));
  globalSocket.on('disconnect',    (r) => console.log('[ws] disconnected', r));
  globalSocket.on('connect_error', (e) => console.error('[ws] connect_error', e.message));

  return globalSocket;
}

// Eagerly create on module load if token already exists
getOrCreateSocket();

/** Update socket auth token — called after token refresh */
export function updateSocketToken(token: string): void {
  if (globalSocket) {
    globalSocket.auth = { token };
    if (!globalSocket.connected) globalSocket.connect();
  } else {
    getOrCreateSocket();
  }
}

export function useWebSocket() {
  // Ensure socket exists (handles case where token was set after module load)
  getOrCreateSocket();

  const on = useCallback(<T>(event: string, handler: (data: T) => void) => {
    globalSocket?.on(event, handler);
    return () => { globalSocket?.off(event, handler); };
  }, []);

  const emit = useCallback((event: string, data?: unknown) => {
    if (!globalSocket?.connected) {
      console.warn('[ws] emit called but socket not connected:', event);
    }
    globalSocket?.emit(event, data);
  }, []);

  const subscribe = useCallback((gameId: string) => {
    globalSocket?.emit('game.subscribe', { gameId });
  }, []);

  return { on, emit, subscribe };
}
