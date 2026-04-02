import { Router } from 'express';
import { leaderboardController } from '../controllers/leaderboard.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const leaderboardRouter = Router();

// GET /api/leaderboard?sort=elo|ton_won|win_rate|games_played&page=1
leaderboardRouter.get('/',   leaderboardController.getLeaderboard);

// GET /api/leaderboard/me — caller's rank (requires auth)
leaderboardRouter.get('/me', requireAuth, leaderboardController.getMyRanks);
