/**
 * userHandler.ts — Personal user WebSocket room
 *
 * Each authenticated user joins a room keyed by their userId:  user:{userId}
 * This allows the server to push personal events (mm.found, mm.countdown, etc.)
 * without broadcasting to all connected clients.
 */
import { Socket } from 'socket.io';
import { logger } from '../../utils/logger.js';

export function registerUserHandlers(socket: Socket): void {
  const userId = (socket as Socket & { userId: string }).userId;

  // Auto-join personal room on connect
  socket.join(`user:${userId}`);
  logger.debug(`User ${userId} joined personal room`);

  // Leave personal room on disconnect to free Socket.IO room resources
  socket.on('disconnect', () => {
    socket.leave(`user:${userId}`);
    logger.debug(`User ${userId} left personal room`);
  });
}
