import { Server, Socket } from 'socket.io';
import { AuthService } from './auth.service.js';
import { registerGameHandlers } from '../websocket/handlers/gameHandler.js';
import { registerUserHandlers } from '../websocket/handlers/userHandler.js';
import { registerAiGameHandlers } from '../websocket/handlers/aiGameHandler.js';
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

      // Per-socket rate limiting
      let windowStart  = Date.now();
      let eventCount   = 0;
      const moveCounts = new Map<string, { count: number; windowStart: number }>();

      socket.use(([event], next) => {
        const now = Date.now();

        // Reset general window
        if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
          windowStart = now;
          eventCount  = 0;
        }
        eventCount++;
        if (eventCount > RATE_LIMIT_MAX) {
          logger.warn(`WS rate limit exceeded: socket=${socket.id} user=${userId} event=${event}`);
          return; // drop silently — don't call next()
        }

        // Stricter limit for move events
        if (MOVE_EVENTS.has(event)) {
          const mc = moveCounts.get(event) ?? { count: 0, windowStart: now };
          if (now - mc.windowStart > RATE_LIMIT_WINDOW_MS) {
            mc.count = 0;
            mc.windowStart = now;
          }
          mc.count++;
          moveCounts.set(event, mc);
          if (mc.count > MOVE_LIMIT_MAX) {
            logger.warn(`WS move rate limit exceeded: socket=${socket.id} user=${userId}`);
            socket.emit('game.move_invalid', { reason: 'Too many moves — slow down' });
            return;
          }
        }

        next();
      });

      registerUserHandlers(socket);
      registerGameHandlers(this.io, socket);
      registerAiGameHandlers(this.io, socket);
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
