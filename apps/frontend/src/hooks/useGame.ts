/**
 * useGame.ts — Game state management hook
 * Wires WebSocket game events to local React state.
 */
import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { useTelegram } from './useTelegram';

export type Square = 0 | 1 | 2 | 3 | 4;
export type Board  = Square[][];
export type GameStatus = 'active' | 'completed' | 'crashed';

export interface GameState {
  board:        Board | null;
  activePlayer: 1 | 2;
  remainingMs:  number;
  status:       GameStatus;
  result?: {
    winner?:      1 | 2;
    reason:       string;
    winnerPayout?: string;
    platformFee?:  string;
    eloChanges?:   {
      winner: { before: number; after: number; delta: number };
      loser:  { before: number; after: number; delta: number };
    };
  };
}

export function useGame(gameId: string | null, myPlayerNumber: 1 | 2 | null) {
  const { on, emit, subscribe } = useWebSocket();
  const { haptic } = useTelegram();

  const [gameState, setGameState] = useState<GameState>({
    board:        null,
    activePlayer: 1,
    remainingMs:  30_000,
    status:       'active',
  });
  const [selectedPiece, setSelectedPiece] = useState<{ row: number; col: number } | null>(null);
  const [invalidMove, setInvalidMove]     = useState<string | null>(null);

  // Subscribe to game room on mount
  useEffect(() => {
    if (!gameId) return;
    subscribe(gameId);
  }, [gameId, subscribe]);

  // Wire all game events
  useEffect(() => {
    const unsubs = [
      on<GameState>('game.state', (data) => {
        setGameState(prev => ({ ...prev, ...data }));
      }),
      on<{ board: Board; activePlayer: 1 | 2; remainingMs: number; captures: unknown[] }>('game.move_ok', (data) => {
        setGameState(prev => ({
          ...prev,
          board:        data.board,
          activePlayer: data.activePlayer,
          remainingMs:  data.remainingMs,
        }));
        setSelectedPiece(null);
        setInvalidMove(null);
        haptic.impact('light');
      }),
      on<{ reason: string }>('game.move_invalid', ({ reason }) => {
        setInvalidMove(reason);
        setSelectedPiece(null);
        haptic.error();
        setTimeout(() => setInvalidMove(null), 2_000);
      }),
      on<GameState['result'] & { board: Board }>('game.end', (data) => {
        haptic[data?.winner === myPlayerNumber ? 'success' : 'error']();
        setGameState(prev => ({ ...prev, status: 'completed', result: data, board: data.board ?? prev.board }));
      }),
      on<{ gameId: string; stake: string; returned: string }>('game.draw', (data) => {
        haptic.warning();
        setGameState(prev => ({ ...prev, status: 'completed', result: { reason: 'draw', stake: data.stake } }));
      }),
      on<{ gameId: string }>('game.crashed', () => {
        setGameState(prev => ({ ...prev, status: 'crashed' }));
      }),
      on<{ remainingMs: number }>('game.tick', ({ remainingMs }) => {
        setGameState(prev => ({ ...prev, remainingMs }));
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [on, haptic, myPlayerNumber]);

  const makeMove = useCallback((from: { row: number; col: number }, to: { row: number; col: number }) => {
    if (!gameId) return;
    emit('game.move', { gameId, from, to });
    haptic.selection();
  }, [gameId, emit, haptic]);

  const resign = useCallback(() => {
    if (!gameId) return;
    emit('game.resign', { gameId });
    haptic.impact('heavy');
  }, [gameId, emit, haptic]);

  return { gameState, selectedPiece, setSelectedPiece, invalidMove, makeMove, resign };
}
