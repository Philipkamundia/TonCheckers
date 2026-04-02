/**
 * useWebSocket.ts — Socket.IO client hook
 * Connects with JWT auth, handles reconnects, exposes event emitter.
 */
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:3001';

let globalSocket: Socket | null = null;

function createSocket(token: string): Socket {
  const socket = io(WS_URL, {
    auth:                 { token },
    // Use polling first — required for Railway and most proxies.
    // Socket.IO will upgrade to WebSocket automatically if supported.
    transports:           ['polling', 'websocket'],
    reconnection:         true,
    reconnectionDelay:    1_000,
    reconnectionAttempts: 10,
  });

  socket.on('connect',       () => console.log('[ws] connected', socket.id));
  socket.on('disconnect',    (r) => console.log('[ws] disconnected', r));
  socket.on('connect_error', (e) => console.error('[ws] connect_error', e.message));

  return socket;
}

/** Update socket auth token — called after token refresh */
export function updateSocketToken(token: string): void {
  if (globalSocket) {
    globalSocket.auth = { token };
    if (!globalSocket.connected) globalSocket.connect();
  }
}

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    // Always create a fresh socket if none exists or previous one failed permanently
    if (!globalSocket || globalSocket.disconnected) {
      globalSocket?.removeAllListeners();
      globalSocket = createSocket(token);
    }

    socketRef.current = globalSocket;
  }, []);

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

  return { on, emit, subscribe, socket: socketRef };
}
