/**
 * gameHandler.ts — WebSocket game event handlers
 *
 * Events in:  game.subscribe, game.move, game.resign
 * Events out: game.state, game.move_ok, game.move_invalid,
 *             game.end (win/timeout/resign/disconnect), game.draw, game.crashed, game.tick
 *
 * Settlement is fully handled by SettlementService (Phase 7).
 * game.end payload includes full PRD §13 breakdown.
 */
import { Server, Socket } from 'socket.io';
import { GameService } from '../../services/game.service.js';
import { GameTimerService } from '../../services/game-timer.service.js';
import { SettlementService } from '../../services/settlement.service.js';
import { GameRoomManager } from '../rooms/gameRoom.js';
import {
  getAvailableMoves, applyMoveWithPromotion, nextGameState,
  hashBoardState, checkWinCondition, type Player,
} from '../../engine/index.js';
import { logger } from '../../utils/logger.js';

export function registerGameHandlers(io: Server, socket: Socket): void {
  const userId = (socket as Socket & { userId: string }).userId;

  // ─── game.subscribe ───────────────────────────────────────────────────────
  socket.on('game.subscribe', async ({ gameId }: { gameId: string }) => {
    try {
      const game = await GameService.getGame(gameId);
      if (!game) return socket.emit('error', { message: 'Game not found' });

      if (game.player1Id !== userId && game.player2Id !== userId) {
        return socket.emit('error', { message: 'Not a participant' });
      }

      // Populate or update the in-memory room so disconnect handler can find it
      const existingRoom = GameRoomManager.get(gameId);
      if (!existingRoom && game.player2Id) {
        GameRoomManager.create({
          gameId,
          player1Id:       game.player1Id,
          player2Id:       game.player2Id,
          player1SocketId: game.player1Id === userId ? socket.id : null,
          player2SocketId: game.player2Id === userId ? socket.id : null,
          stake:           game.stake,
        });
      } else {
        GameRoomManager.updateSocket(gameId, userId, socket.id);
      }
      socket.join(`game:${gameId}`);

      const remainingMs = await GameTimerService.getRemainingMs(gameId);
      socket.emit('game.state', {
        gameId,
        board:        game.boardState?.board,
        activePlayer: game.activePlayer,
        remainingMs:  remainingMs ?? 30_000,
        status:       game.status,
      });

      if (game.status === 'crashed') socket.emit('game.crashed', { gameId });
    } catch (err) {
      logger.error(`game.subscribe: ${(err as Error).message}`);
      socket.emit('error', { message: 'Subscribe failed' });
    }
  });

  // ─── game.move ────────────────────────────────────────────────────────────
  socket.on('game.move', async ({ gameId, from, to }: {
    gameId: string;
    from: { row: number; col: number };
    to:   { row: number; col: number };
  }) => {
    try {
      const game = await GameService.getGame(gameId);
      if (!game || game.status !== 'active' || !game.boardState) {
        return socket.emit('game.move_invalid', { gameId, reason: 'Game not active' });
      }

      // Validate coordinate bounds before any board access
      const validCoord = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7;
      if (!validCoord(from?.row) || !validCoord(from?.col) || !validCoord(to?.row) || !validCoord(to?.col)) {
        return socket.emit('game.move_invalid', { gameId, reason: 'Invalid coordinates' });
      }

      const playerNum: Player = game.player1Id === userId ? 1 : 2;
      if (game.activePlayer !== playerNum) {
        return socket.emit('game.move_invalid', { gameId, reason: 'Not your turn' });
      }

      // Validate move against legal moves
      const legalMoves = getAvailableMoves(game.boardState.board, playerNum);
      const move = legalMoves.find(
        m => m.from.row === from.row && m.from.col === from.col &&
             m.to.row   === to.row   && m.to.col   === to.col,
      );
      if (!move) {
        return socket.emit('game.move_invalid', { gameId, reason: 'Illegal move' });
      }

      // Apply move + promotion
      const newBoard   = applyMoveWithPromotion(game.boardState.board, move);
      const nextPlayer: Player = playerNum === 1 ? 2 : 1;
      const newHash    = hashBoardState(newBoard, nextPlayer);
      const newState   = nextGameState(game.boardState, move, newHash);

      await GameService.updateBoardState(gameId, newState, nextPlayer, newState.moveCount);
      await GameTimerService.startTimer(gameId, nextPlayer);

      // Check end conditions
      const condition = checkWinCondition(newBoard, nextPlayer, newState.boardHashHistory);

      if (condition.status === 'draw') {
        await GameTimerService.clearTimer(gameId);
        const drawResult = await SettlementService.settleDraw(
          gameId, game.player1Id, game.player2Id!, game.stake,
        );
        io.to(`game:${gameId}`).emit('game.draw', {
          gameId,
          stake:    drawResult.stake,
          returned: drawResult.stake,
          message:  'Draw — stakes returned in full, no fee charged',
        });
        GameRoomManager.remove(gameId);
        return;
      }

      if (condition.status === 'win') {
        await GameTimerService.clearTimer(gameId);
        const winnerId = condition.winner === 1 ? game.player1Id : game.player2Id!;
        const loserId  = condition.winner === 1 ? game.player2Id! : game.player1Id;
        const result   = await SettlementService.settleWin(
          gameId, winnerId, loserId, condition.reason, game.stake, io,
        );
        // PRD §13 full breakdown in game.end
        io.to(`game:${gameId}`).emit('game.end', {
          gameId,
          result:       'win',
          winner:       condition.winner,
          reason:       condition.reason,
          winnerId,
          loserId,
          winnerPayout: result.winnerPayout,
          platformFee:  result.platformFee,
          prizePool:    result.prizePool,
          stake:        result.stake,
          eloChanges:   result.eloChanges,
        });
        GameRoomManager.remove(gameId);
        return;
      }

      // Game ongoing — broadcast new state
      io.to(`game:${gameId}`).emit('game.move_ok', {
        gameId,
        board:        newBoard,
        activePlayer: nextPlayer,
        remainingMs:  30_000,
        captures:     move.captures,
        moveCount:    newState.moveCount,
      });

    } catch (err) {
      logger.error(`game.move: ${(err as Error).message}`);
      socket.emit('game.move_invalid', { gameId, reason: 'Server error' });
    }
  });

  // ─── game.resign ─────────────────────────────────────────────────────────
  socket.on('game.resign', async ({ gameId }: { gameId: string }) => {
    try {
      const game = await GameService.getGame(gameId);
      if (!game || game.status !== 'active') return;

      // Verify the resigning user is actually a participant
      if (game.player1Id !== userId && game.player2Id !== userId) return;

      const resigningPlayer: Player = game.player1Id === userId ? 1 : 2;
      const winnerId = resigningPlayer === 1 ? game.player2Id! : game.player1Id;

      await GameTimerService.clearTimer(gameId);
      const result = await SettlementService.settleWin(
        gameId, winnerId, userId, 'resign', game.stake, io,
      );

      io.to(`game:${gameId}`).emit('game.end', {
        gameId,
        result:       'win',
        winner:       resigningPlayer === 1 ? 2 : 1,
        reason:       'resign',
        winnerId,
        loserId:      userId,
        winnerPayout: result.winnerPayout,
        platformFee:  result.platformFee,
        prizePool:    result.prizePool,
        stake:        result.stake,
        eloChanges:   result.eloChanges,
      });

      GameRoomManager.remove(gameId);
    } catch (err) {
      logger.error(`game.resign: ${(err as Error).message}`);
    }
  });

  // ─── disconnect (forfeit) ─────────────────────────────────────────────────
  // PRD §6: Disconnect = forfeit
  socket.on('disconnect', async () => {
    const room = GameRoomManager.getBySocketId(socket.id);
    if (!room) return;

    GameRoomManager.removeSocket(socket.id);

    try {
      const game = await GameService.getGame(room.gameId);
      if (!game || game.status !== 'active') return;

      const disconnectedPlayer: Player = room.player1Id === userId ? 1 : 2;
      const winnerId = disconnectedPlayer === 1 ? room.player2Id : room.player1Id;

      if (!winnerId) {
        logger.warn(`disconnect: no opponent for game=${room.gameId}, skipping forfeit`);
        return;
      }

      await GameTimerService.clearTimer(room.gameId);
      const result = await SettlementService.settleWin(
        room.gameId, winnerId, userId, 'disconnect', room.stake, io,
      );

      io.to(`game:${room.gameId}`).emit('game.end', {
        gameId:       room.gameId,
        result:       'win',
        winner:       disconnectedPlayer === 1 ? 2 : 1,
        reason:       'disconnect',
        winnerId,
        loserId:      userId,
        winnerPayout: result.winnerPayout,
        platformFee:  result.platformFee,
        prizePool:    result.prizePool,
        stake:        result.stake,
        eloChanges:   result.eloChanges,
      });

      GameRoomManager.remove(room.gameId);
    } catch (err) {
      logger.error(`disconnect handler: ${(err as Error).message}`);
    }
  });
}
