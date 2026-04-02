/**
 * useWebSocket.ts — Socket.IO client hook
 * Connects with JWT auth, handles reconnects, exposes event emitter.
 */
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:3001';

let globalSocket: Socket | null = null;

/** Update socket auth token — called after token refresh so reconnects use the new token */
export function updateSocketToken(token: string): void {
  if (globalSocket) {
    globalSocket.auth = { token };
    // If disconnected, reconnect with the new token
    if (!globalSocket.connected) {
      globalSocket.connect();
    }
  }
}

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    if (!globalSocket || !globalSocket.connected) {
      globalSocket = io(WS_URL, {
        auth:                { token },
        reconnection:        true,
        reconnectionDelay:   1_000,
        reconnectionAttempts: 10,
      });
    }

    socketRef.current = globalSocket;

    return () => {
      // Don't disconnect on unmount — keep shared connection alive
    };
  }, []);

  const on = useCallback(<T>(event: string, handler: (data: T) => void) => {
    globalSocket?.on(event, handler);
    return () => { globalSocket?.off(event, handler); };
  }, []);

  const emit = useCallback((event: string, data?: unknown) => {
    globalSocket?.emit(event, data);
  }, []);

  const subscribe = useCallback((gameId: string) => {
    globalSocket?.emit('game.subscribe', { gameId });
  }, []);

  return { on, emit, subscribe, socket: socketRef };
}
