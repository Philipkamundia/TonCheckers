import { Server, Socket } from 'socket.io';
import { AuthService } from './auth.service.js';
import { registerGameHandlers } from '../websocket/handlers/gameHandler.js';
import { registerUserHandlers } from '../websocket/handlers/userHandler.js';
import { registerAiGameHandlers } from '../websocket/handlers/aiGameHandler.js';
import { registerTournamentLobbyHandlers } from '../websocket/handlers/tournamentLobbyHandler.js';
import { registerTournamentBracketHandlers } from '../websocket/handlers/tournamentBracketHandler.js';
import { logger } from '../utils/logger.js';

// Per-socket rate limit: max events per window
const RATE_LIMIT_WINDOW_MS = 1_000;  // 1 second
const RATE_LIMIT_MAX       = 10;     // max 10 events per second per socket

// High-frequency events that need stricter limits (e.g. move spam)
const MOVE_EVENTS    = new Set(['game.move', 'ai.move']);
const MOVE_LIMIT_MAX = 3; // max 3 moves per second (game timer is 30s, no need for more)

export class WebSocketService {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
    this.setupAuth();
    this.setupConnections();
    logger.info('WebSocket server initialised');
  }

  private setupAuth(): void {
    this.io.use((socket: Socket, next) => {
      try {
        const token = socket.handshake.auth?.token
          || socket.handshake.headers?.authorization?.replace('Bearer ', '');
        if (!token) return next(new Error('Authentication required'));
        const payload = AuthService.verifyAccessToken(token);
        (socket as Socket & { userId: string }).userId = payload.userId;
        return next();
      } catch {
        return next(new Error('Invalid token'));
      }
    });
  }

  private setupConnections(): void {
    this.io.on('connection', (socket: Socket) => {
      const userId = (socket as Socket & { userId: string }).userId;
      logger.debug(`WS connect: ${socket.id} user=${userId}`);

      // H-07: Per-USER rate limiting backed by Redis so limits persist across
      // reconnects and hold across all server processes.
      // Key format: ws:rl:{userId}:{eventType}:{windowSecond}
      const redis_ = (await import('../config/redis.js')).default;

      socket.use(async ([event], next) => {
        const windowSec = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);

        // General event limit
        const generalKey = `ws:rl:${userId}:general:${windowSec}`;
        const generalCount = await redis_.incr(generalKey);
        if (generalCount === 1) await redis_.expire(generalKey, 2);
        if (generalCount > RATE_LIMIT_MAX) {
          logger.warn(`WS rate limit exceeded: user=${userId} event=${event}`);
          return; // drop silently
        }

        // Stricter limit for move events
        if (MOVE_EVENTS.has(event)) {
          const moveKey   = `ws:rl:${userId}:moves:${windowSec}`;
          const moveCount = await redis_.incr(moveKey);
          if (moveCount === 1) await redis_.expire(moveKey, 2);
          if (moveCount > MOVE_LIMIT_MAX) {
            logger.warn(`WS move rate limit exceeded: user=${userId}`);
            socket.emit('game.move_invalid', { reason: 'Too many moves — slow down' });
            return;
          }
        }

        next();
      });

      registerUserHandlers(socket);
      registerGameHandlers(this.io, socket);
      registerAiGameHandlers(this.io, socket);
      registerTournamentLobbyHandlers(this.io, socket);
      registerTournamentBracketHandlers(socket);
      socket.on('disconnect', (reason) => {
        logger.debug(`WS disconnect: ${socket.id} reason=${reason}`);
        socket.rooms.forEach((room) => socket.leave(room));
      });
    });
  }

  emitToGame(gameId: string, event: string, data: unknown): void {
    this.io.to(`game:${gameId}`).emit(event, data);
  }

  emitToUser(userId: string, event: string, data: unknown): void {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  getServer(): Server { return this.io; }
}
