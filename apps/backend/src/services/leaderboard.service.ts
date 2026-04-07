/**
 * LeaderboardService — Global leaderboard with Redis caching (PRD §10)
 *
 * 4 sort modes: elo | ton_won | win_rate | games_played
 * Cache: rebuilt every 5 minutes, served from Redis
 * Resets: none — permanent rankings
 */
import pool from '../config/db.js';
import redis from '../config/redis.js';
import { logger } from '../utils/logger.js';

export type LeaderboardSort = 'elo' | 'ton_won' | 'win_rate' | 'games_played';

export interface LeaderboardEntry {
  rank:        number;
  userId?:     string;  // only included in /me response, stripped from public list
  username:    string;
  elo:         number;
  totalWon:    string;
  winRate:     number;
  gamesPlayed: number;
  gamesWon:    number;
}

const CACHE_KEY_PREFIX = 'leaderboard:';
const CACHE_TTL_SECS   = 5 * 60;  // 5 minutes
const PAGE_SIZE        = 50;

export class LeaderboardService {

  /** Build and cache a leaderboard for a sort mode */
  static async rebuild(sort: LeaderboardSort): Promise<LeaderboardEntry[]> {
    const orderByMap: Record<LeaderboardSort, string> = {
      elo:          'u.elo DESC',
      ton_won:      'u.total_won DESC',
      win_rate:     'CASE WHEN u.games_played > 0 THEN u.games_won::float/u.games_played ELSE 0 END DESC',
      games_played: 'u.games_played DESC',
    };

    // Whitelist check — never interpolate untrusted input into SQL
    if (!orderByMap[sort]) sort = 'elo';
    const orderBy = orderByMap[sort];

    const { rows } = await pool.query(
      `SELECT
         u.id AS "userId", u.username, u.elo,
         u.total_won::text AS "totalWon",
         u.games_played AS "gamesPlayed",
         u.games_won    AS "gamesWon",
         CASE WHEN u.games_played > 0
              THEN ROUND((u.games_won::float / u.games_played * 100)::numeric, 1)
              ELSE 0
         END AS "winRate"
       FROM users u
       WHERE u.is_banned = false AND u.games_played > 0
       ORDER BY ${orderBy}
       LIMIT 200`,
    );

    const entries: LeaderboardEntry[] = rows.map((r: LeaderboardEntry, i: number) => ({
      ...r,
      rank:    i + 1,
      winRate: parseFloat(String(r.winRate)),
    }));

    await redis.set(
      `${CACHE_KEY_PREFIX}${sort}`,
      JSON.stringify(entries),
      'EX',
      CACHE_TTL_SECS,
    );

    logger.debug(`Leaderboard rebuilt: sort=${sort} entries=${entries.length}`);
    return entries;
  }

  /** GET /leaderboard?sort=elo&page=1 — serve from cache, rebuild if stale */
  static async getLeaderboard(
    sort: LeaderboardSort = 'elo',
    page = 1,
  ): Promise<{ entries: LeaderboardEntry[]; total: number; page: number; totalPages: number }> {
    const validSorts: LeaderboardSort[] = ['elo', 'ton_won', 'win_rate', 'games_played'];
    if (!validSorts.includes(sort)) sort = 'elo';

    // Try cache first
    let entries: LeaderboardEntry[];
    const cached = await redis.get(`${CACHE_KEY_PREFIX}${sort}`);

    if (cached) {
      entries = JSON.parse(cached);
    } else {
      entries = await LeaderboardService.rebuild(sort);
    }

    // Paginate
    const total      = entries.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const start      = (page - 1) * PAGE_SIZE;
    const paginated  = entries.slice(start, start + PAGE_SIZE);

    return {
      entries: paginated.map(({ userId: _uid, ...rest }) => rest),
      total,
      page,
      totalPages,
    };
  }

  /** GET /leaderboard/me — caller's rank across all 4 categories */
  static async getMyRanks(userId: string): Promise<Record<LeaderboardSort, { rank: number | null; total: number }>> {
    const sorts: LeaderboardSort[] = ['elo', 'ton_won', 'win_rate', 'games_played'];
    const result = {} as Record<LeaderboardSort, { rank: number | null; total: number }>;

    for (const sort of sorts) {
      let entries: LeaderboardEntry[];
      const cached = await redis.get(`${CACHE_KEY_PREFIX}${sort}`);
      entries = cached ? JSON.parse(cached) : await LeaderboardService.rebuild(sort);

      const idx = entries.findIndex(e => e.userId === userId);
      result[sort] = {
        rank:  idx >= 0 ? idx + 1 : null,
        total: entries.length,
      };
    }

    return result;
  }

  /** Scheduled rebuild — call every 5 minutes */
  static async rebuildAll(): Promise<void> {
    const sorts: LeaderboardSort[] = ['elo', 'ton_won', 'win_rate', 'games_played'];
    await Promise.all(sorts.map(s => LeaderboardService.rebuild(s)));
    logger.info('Leaderboard cache rebuilt for all 4 sort modes');
  }
}
