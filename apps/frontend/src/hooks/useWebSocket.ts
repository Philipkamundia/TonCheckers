/**
 * useWebSocket.ts — Socket.IO client hook
 *
 * Socket is created eagerly at module load (as soon as a token exists).
 * Critical global listeners (like tournament.starting) are registered at
 * module level so they are never missed regardless of component render timing.
 */
import { useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:3001';

let globalSocket: Socket | null = null;

// Global event bus — listeners registered before socket connects are queued
// and replayed once the socket is live.
type AnyHandler = (data: any) => void;
const globalListeners = new Map<string, Set<AnyHandler>>();

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

  globalSocket.on('connect', () => {
    console.log('[ws] connected', globalSocket?.id);
    // Re-attach all global listeners after reconnect
    globalListeners.forEach((handlers, event) => {
      handlers.forEach(h => globalSocket?.on(event, h));
    });
  });
  globalSocket.on('disconnect',    (r) => console.log('[ws] disconnected', r));
  globalSocket.on('connect_error', (e) => console.error('[ws] connect_error', e.message));

  // Attach any already-registered global listeners
  globalListeners.forEach((handlers, event) => {
    handlers.forEach(h => globalSocket?.on(event, h));
  });

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

/**
 * Register a persistent global listener that survives component unmounts.
 * Use this for critical events that must never be missed (e.g. tournament.starting).
 * Returns an unsubscribe function.
 */
export function onGlobal<T>(event: string, handler: (data: T) => void): () => void {
  const h = handler as AnyHandler;
  if (!globalListeners.has(event)) globalListeners.set(event, new Set());
  globalListeners.get(event)!.add(h);
  globalSocket?.on(event, h);
  return () => {
    globalListeners.get(event)?.delete(h);
    globalSocket?.off(event, h);
  };
}

export function useWebSocket() {
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
