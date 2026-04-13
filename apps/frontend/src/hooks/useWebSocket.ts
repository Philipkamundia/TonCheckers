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

/** Emits replayed after reconnect — bracket / lobby presence must not be lost */
const EMIT_QUEUE_EVENTS = new Set(['tournament.bracket_join', 'tournament.lobby_join']);
type QueuedEmit = { event: string; data?: unknown };
const emitQueue: QueuedEmit[] = [];

const reconnectCallbacks = new Set<() => void>();

function flushEmitQueue(): void {
  if (!globalSocket?.connected) return;
  while (emitQueue.length > 0) {
    const item = emitQueue.shift()!;
    globalSocket.emit(item.event, item.data);
  }
}

/** Components can register one-shot refresh of presence after reconnect */
export function onReconnect(cb: () => void): () => void {
  reconnectCallbacks.add(cb);
  return () => { reconnectCallbacks.delete(cb); };
}

function notifyReconnect(): void {
  reconnectCallbacks.forEach(cb => {
    try { cb(); } catch (e) { console.error('[ws] reconnect callback', e); }
  });
}

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
    // Do NOT re-attach globalListeners here — handlers are already bound to this
    // socket instance; duplicate registration on every reconnect would multiply fires.
    flushEmitQueue();
    notifyReconnect();
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
      if (EMIT_QUEUE_EVENTS.has(event)) {
        emitQueue.push({ event, data });
        console.warn('[ws] emit queued until reconnect:', event);
      } else {
        console.warn('[ws] emit called but socket not connected:', event);
      }
      return;
    }
    globalSocket.emit(event, data);
  }, []);

  const subscribe = useCallback((gameId: string) => {
    globalSocket?.emit('game.subscribe', { gameId });
  }, []);

  return { on, emit, subscribe };
}
