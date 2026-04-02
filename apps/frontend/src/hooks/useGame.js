/**
 * useGame.ts — Game state management hook
 * Wires WebSocket game events to local React state.
 */
import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { useTelegram } from './useTelegram';
export function useGame(gameId, myPlayerNumber) {
    const { on, emit, subscribe } = useWebSocket();
    const { haptic } = useTelegram();
    const [gameState, setGameState] = useState({
        board: null,
        activePlayer: 1,
        remainingMs: 30000,
        status: 'active',
    });
    const [selectedPiece, setSelectedPiece] = useState(null);
    const [invalidMove, setInvalidMove] = useState(null);
    // Subscribe to game room on mount
    useEffect(() => {
        if (!gameId)
            return;
        subscribe(gameId);
    }, [gameId, subscribe]);
    // Wire all game events
    useEffect(() => {
        const unsubs = [
            on('game.state', (data) => {
                setGameState(prev => ({ ...prev, ...data }));
            }),
            on('game.move_ok', (data) => {
                setGameState(prev => ({
                    ...prev,
                    board: data.board,
                    activePlayer: data.activePlayer,
                    remainingMs: data.remainingMs,
                }));
                setSelectedPiece(null);
                setInvalidMove(null);
                haptic.impact('light');
            }),
            on('game.move_invalid', ({ reason }) => {
                setInvalidMove(reason);
                setSelectedPiece(null);
                haptic.error();
                setTimeout(() => setInvalidMove(null), 2000);
            }),
            on('game.end', (data) => {
                haptic[data?.winner === myPlayerNumber ? 'success' : 'error']();
                setGameState(prev => ({ ...prev, status: 'completed', result: data, board: data.board ?? prev.board }));
            }),
            on('game.draw', (data) => {
                haptic.warning();
                setGameState(prev => ({ ...prev, status: 'completed', result: { reason: 'draw', stake: data.stake } }));
            }),
            on('game.crashed', () => {
                setGameState(prev => ({ ...prev, status: 'crashed' }));
            }),
            on('game.tick', ({ remainingMs }) => {
                setGameState(prev => ({ ...prev, remainingMs }));
            }),
        ];
        return () => unsubs.forEach(u => u());
    }, [on, haptic, myPlayerNumber]);
    const makeMove = useCallback((from, to) => {
        if (!gameId)
            return;
        emit('game.move', { gameId, from, to });
        haptic.selection();
    }, [gameId, emit, haptic]);
    const resign = useCallback(() => {
        if (!gameId)
            return;
        emit('game.resign', { gameId });
        haptic.impact('heavy');
    }, [gameId, emit, haptic]);
    return { gameState, selectedPiece, setSelectedPiece, invalidMove, makeMove, resign };
}
