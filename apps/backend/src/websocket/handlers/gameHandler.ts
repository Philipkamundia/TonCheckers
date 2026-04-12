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

// C-03: In-memory map of pending disconnect-forfeit timers.
// Key: `${gameId}:${userId}` — cleared on reconnect or game end.
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

      // Only join the live room for active/waiting games.
      // Completed/cancelled games send state once but don't join the room —
      // avoids memory leaks and stale event delivery.
      if (game.status === 'active' || game.status === 'waiting') {
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
      }

      // C-03: If this player had a pending disconnect-forfeit timer, cancel it —
      // they have reconnected in time.
      const pendingForfeitKey = `${gameId}:${userId}`;
      const pendingTimer = disconnectTimers.get(pendingForfeitKey);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        disconnectTimers.delete(pendingForfeitKey);
        logger.info(`Disconnect grace cancelled — player reconnected: game=${gameId} user=${userId}`);
        // Notify opponent that the player is back
        const room_ = GameRoomManager.get(gameId);
        if (room_) {
          const opponentId = room_.player1Id === userId ? room_.player2Id : room_.player1Id;
          io.to(`user:${opponentId}`).emit('game.opponent_reconnected', { gameId });
        }
      }

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
      const newState   = nextGameState(game.boardState, move, newHash, newBoard);

      // N-05: Track consecutive moves without capture for 50-move draw rule.
      // A capture resets the counter; a simple move increments it.
      const movesSinceCapture = move.captures.length > 0
        ? 0
        : ((game.boardState as unknown as { movesSinceCapture?: number }).movesSinceCapture ?? 0) + 1;

      // Embed movesSinceCapture in the state so it survives board state reads
      (newState as unknown as { movesSinceCapture: number }).movesSinceCapture = movesSinceCapture;

      await GameService.updateBoardState(gameId, newState, nextPlayer, newState.moveCount);
      await GameTimerService.startTimer(gameId, nextPlayer);

      // Check end conditions
      const condition = checkWinCondition(newBoard, nextPlayer, newState.boardHashHistory, movesSinceCapture);

      if (condition.status === 'draw') {
        await GameTimerService.clearTimer(gameId);
        const drawResult = await SettlementService.settleDraw(
          gameId, game.player1Id, game.player2Id!, game.stake,
        );
        const drawMessage = condition.reason === 'no_capture_limit'
          ? 'Draw — 50 moves without capture. Stakes returned in full.'
          : 'Draw — threefold repetition. Stakes returned in full.';
        io.to(`game:${gameId}`).emit('game.draw', {
          gameId,
          reason:   condition.reason,
          stake:    drawResult.stake,
          returned: drawResult.stake,
          message:  drawMessage,
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
        if (result.alreadySettled) { GameRoomManager.remove(gameId); return; }
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
      if (result.alreadySettled) return;

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

  // ─── game.offer_draw ─────────────────────────────────────────────────────
  socket.on('game.offer_draw', async ({ gameId }: { gameId: string }) => {
    try {
      const game = await GameService.getGame(gameId);
      if (!game || game.status !== 'active') return;
      if (game.player1Id !== userId && game.player2Id !== userId) return;

      const { rows: [user] } = await (await import('../../config/db.js')).default.query(
        'SELECT username FROM users WHERE id=$1', [userId],
      );
      const opponentId = game.player1Id === userId ? game.player2Id! : game.player1Id;

      // C-08: Record who made the offer so accept_draw can validate the recipient
      const { default: redis } = await import('../../config/redis.js');
      await redis.set(`draw:offer:${gameId}`, userId, 'EX', 60);

      io.to(`user:${opponentId}`).emit('game.draw_offer', {
        gameId, fromUserId: userId, fromUsername: user?.username ?? 'Opponent',
      });
      logger.info(`Draw offered: game=${gameId} by=${userId}`);
    } catch (err) {
      logger.error(`game.offer_draw: ${(err as Error).message}`);
    }
  });

  // ─── game.accept_draw ────────────────────────────────────────────────────
  socket.on('game.accept_draw', async ({ gameId }: { gameId: string }) => {
    try {
      const game = await GameService.getGame(gameId);
      if (!game || game.status !== 'active') return;
      if (game.player1Id !== userId && game.player2Id !== userId) return;

      // C-08: Verify there is a pending draw offer AND the accepting player is
      // not the same player who sent it (prevents unilateral self-accept exploit).
      const { default: redis } = await import('../../config/redis.js');
      const offerKey  = `draw:offer:${gameId}`;
      const offeredBy = await redis.get(offerKey);
      if (!offeredBy) {
        socket.emit('error', { message: 'No pending draw offer' });
        return;
      }
      if (offeredBy === userId) {
        socket.emit('error', { message: 'Cannot accept your own draw offer' });
        return;
      }
      await redis.del(offerKey);

      await GameTimerService.clearTimer(gameId);
      const drawResult = await SettlementService.settleDraw(
        gameId, game.player1Id, game.player2Id!, game.stake,
      );
      io.to(`game:${gameId}`).emit('game.draw', {
        gameId, stake: drawResult.stake, returned: drawResult.stake,
        message: 'Draw agreed — stakes returned in full',
      });
      GameRoomManager.remove(gameId);
      logger.info(`Draw accepted: game=${gameId} by=${userId}`);
    } catch (err) {
      logger.error(`game.accept_draw: ${(err as Error).message}`);
    }
  });

  // ─── game.decline_draw ───────────────────────────────────────────────────
  socket.on('game.decline_draw', async ({ gameId }: { gameId: string }) => {
    try {
      const game = await GameService.getGame(gameId);
      if (!game || game.status !== 'active') return;

      const opponentId = game.player1Id === userId ? game.player2Id! : game.player1Id;
      // M-10: Clean up pending offer key so the opponent cannot later "accept" a declined offer
      const { default: redis } = await import('../../config/redis.js');
      await redis.del(`draw:offer:${gameId}`);
      io.to(`user:${opponentId}`).emit('game.draw_offer_declined', { gameId });
      logger.info(`Draw declined: game=${gameId} by=${userId}`);
    } catch (err) {
      logger.error(`game.decline_draw: ${(err as Error).message}`);
    }
  });
  // PRD §6 + C-03: Disconnect starts a 30-second grace period before forfeit.
  // GAME_CONFIG.DISCONNECT_TIMEOUT = 30_000 ms is the defined constant.
  // If the player reconnects (game.subscribe) within the window the timer is cleared.
  // Only after the full grace period with no reconnect does the game settle.
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

      const GRACE_PERIOD_MS = 30_000;
      const timerKey = `${room.gameId}:${userId}`;

      // Notify opponent that player disconnected and the grace period has started
      io.to(`user:${winnerId}`).emit('game.opponent_disconnected', {
        gameId:      room.gameId,
        graceMs:     GRACE_PERIOD_MS,
        message:     'Opponent disconnected — waiting 30 seconds before awarding win',
      });

      logger.info(`Disconnect grace started: game=${room.gameId} user=${userId} grace=${GRACE_PERIOD_MS}ms`);

      const timer = setTimeout(async () => {
        disconnectTimers.delete(timerKey);
        try {
          // Re-fetch game — it may have ended normally during the grace period
          const current = await GameService.getGame(room.gameId);
          if (!current || current.status !== 'active') return;

          // Re-check room — player may have reconnected
          const currentRoom = GameRoomManager.get(room.gameId);
          const reconnected = currentRoom
            ? (room.player1Id === userId ? currentRoom.player1SocketId !== null : currentRoom.player2SocketId !== null)
            : false;
          if (reconnected) {
            logger.info(`Disconnect grace expired but player reconnected: game=${room.gameId} user=${userId}`);
            return;
          }

          await GameTimerService.clearTimer(room.gameId);
          const result = await SettlementService.settleWin(
            room.gameId, winnerId, userId, 'disconnect', room.stake, io,
          );
          if (result.alreadySettled) return;

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

          // Emit to both user rooms as fallback
          io.to(`user:${winnerId}`).emit('game.end', {
            gameId: room.gameId, result: 'win', reason: 'disconnect', winnerId,
          });

          GameRoomManager.remove(room.gameId);
          logger.info(`Forfeit applied: game=${room.gameId} disconnected=${userId} after ${GRACE_PERIOD_MS}ms grace`);
        } catch (err) {
          logger.error(`disconnect grace timer: ${(err as Error).message}`);
        }
      }, GRACE_PERIOD_MS);

      disconnectTimers.set(timerKey, timer);
    } catch (err) {
      logger.error(`disconnect handler: ${(err as Error).message}`);
    }
  });
}
