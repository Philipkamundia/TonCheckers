import { Server, Socket } from 'socket.io';
import { AuthService } from './auth.service.js';
import { registerGameHandlers } from '../websocket/handlers/gameHandler.js';
import { registerUserHandlers } from '../websocket/handlers/userHandler.js';
import { registerAiGameHandlers } from '../websocket/handlers/aiGameHandler.js';
import { logger } from '../utils/logger.js';

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
      registerUserHandlers(socket);
      registerGameHandlers(this.io, socket);
      registerAiGameHandlers(this.io, socket);  // Phase 10: AI game events
      socket.on('disconnect', (reason) => {
        logger.debug(`WS disconnect: ${socket.id} reason=${reason}`);
        // Leave all Socket.IO rooms explicitly so room memory is freed immediately
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
