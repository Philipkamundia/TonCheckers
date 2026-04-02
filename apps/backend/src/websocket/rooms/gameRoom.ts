/**
 * gameRoom.ts — In-memory game room, one per active game
 *
 * Tracks which socket IDs belong to player1 and player2.
 * Board state lives in DB (GameService) and Redis (GameTimerService).
 */

export interface GameRoom {
  gameId:       string;
  player1Id:    string;
  player2Id:    string;
  player1SocketId: string | null;
  player2SocketId: string | null;
  stake:        string;
}

// In-memory map: gameId → GameRoom
const rooms = new Map<string, GameRoom>();

// Reverse lookup: socketId → gameId
const socketToGame = new Map<string, string>();

export const GameRoomManager = {

  create(room: GameRoom): void {
    rooms.set(room.gameId, room);
    if (room.player1SocketId) socketToGame.set(room.player1SocketId, room.gameId);
    if (room.player2SocketId) socketToGame.set(room.player2SocketId, room.gameId);
  },

  get(gameId: string): GameRoom | undefined {
    return rooms.get(gameId);
  },

  getBySocketId(socketId: string): GameRoom | undefined {
    const gameId = socketToGame.get(socketId);
    return gameId ? rooms.get(gameId) : undefined;
  },

  /** Returns 1 or 2 — which player this socket is in the room */
  getPlayerNumber(gameId: string, socketId: string): 1 | 2 | null {
    const room = rooms.get(gameId);
    if (!room) return null;
    if (room.player1SocketId === socketId) return 1;
    if (room.player2SocketId === socketId) return 2;
    return null;
  },

  /** Update socket ID when a player reconnects */
  updateSocket(gameId: string, playerId: string, socketId: string): void {
    const room = rooms.get(gameId);
    if (!room) return;
    if (room.player1Id === playerId) {
      if (room.player1SocketId) socketToGame.delete(room.player1SocketId);
      room.player1SocketId = socketId;
    } else if (room.player2Id === playerId) {
      if (room.player2SocketId) socketToGame.delete(room.player2SocketId);
      room.player2SocketId = socketId;
    }
    socketToGame.set(socketId, gameId);
  },

  remove(gameId: string): void {
    const room = rooms.get(gameId);
    if (!room) return;
    if (room.player1SocketId) socketToGame.delete(room.player1SocketId);
    if (room.player2SocketId) socketToGame.delete(room.player2SocketId);
    rooms.delete(gameId);
  },

  removeSocket(socketId: string): void {
    const gameId = socketToGame.get(socketId);
    if (gameId) {
      const room = rooms.get(gameId);
      if (room) {
        if (room.player1SocketId === socketId) room.player1SocketId = null;
        if (room.player2SocketId === socketId) room.player2SocketId = null;
      }
      socketToGame.delete(socketId);
    }
  },

  /** Get all socket IDs in a room (for broadcasting) */
  getSockets(gameId: string): string[] {
    const room = rooms.get(gameId);
    if (!room) return [];
    return [room.player1SocketId, room.player2SocketId].filter(Boolean) as string[];
  },
};
