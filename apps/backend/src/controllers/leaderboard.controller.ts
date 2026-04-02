import { Request, Response, NextFunction } from 'express';
import { LeaderboardService, type LeaderboardSort } from '../services/leaderboard.service.js';

export const leaderboardController = {

  // GET /api/leaderboard?sort=elo&page=1
  async getLeaderboard(req: Request, res: Response, next: NextFunction) {
    try {
      const sort = (req.query.sort as LeaderboardSort) || 'elo';
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const data = await LeaderboardService.getLeaderboard(sort, page);
      return res.json({ ok: true, ...data });
    } catch (err) { return next(err); }
  },

  // GET /api/leaderboard/me — caller's rank in all 4 categories
  async getMyRanks(req: Request, res: Response, next: NextFunction) {
    try {
      const ranks = await LeaderboardService.getMyRanks(req.user!.userId);
      return res.json({ ok: true, ranks });
    } catch (err) { return next(err); }
  },
};
