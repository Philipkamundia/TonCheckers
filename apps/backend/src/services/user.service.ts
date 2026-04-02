import pool from '../config/db.js';
import { AppError } from '../middleware/errorHandler.js';

export interface PublicProfile {
  id:          string;
  username:    string;
  elo:         number;
  gamesPlayed: number;
  gamesWon:    number;
  gamesLost:   number;
  gamesDrawn:  number;
  totalWon:    string;
  createdAt:   string;
}

export class UserService {

  static async getProfile(userId: string): Promise<PublicProfile> {
    const { rows } = await pool.query(
      `SELECT id, username, elo,
              games_played  AS "gamesPlayed",  games_won   AS "gamesWon",
              games_lost    AS "gamesLost",    games_drawn AS "gamesDrawn",
              total_won::text AS "totalWon",   created_at  AS "createdAt"
       FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows[0]) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    return rows[0] as PublicProfile;
  }

  static async getProfileByUsername(username: string): Promise<PublicProfile> {
    const { rows } = await pool.query(
      `SELECT id, username, elo,
              games_played  AS "gamesPlayed",  games_won   AS "gamesWon",
              games_lost    AS "gamesLost",    games_drawn AS "gamesDrawn",
              total_won::text AS "totalWon",   created_at  AS "createdAt"
       FROM users WHERE username = $1`,
      [username],
    );
    if (!rows[0]) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    return rows[0] as PublicProfile;
  }

  static async isBanned(userId: string): Promise<boolean> {
    const { rows } = await pool.query(
      'SELECT is_banned FROM users WHERE id = $1', [userId],
    );
    return rows[0]?.is_banned ?? false;
  }
}
