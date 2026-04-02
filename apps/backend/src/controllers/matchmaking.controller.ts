import { Request, Response, NextFunction } from 'express';
import { MatchmakingService } from '../services/matchmaking.service.js';
import { cancelLobby } from '../jobs/matchmakingScan.js';
import { AppError } from '../middleware/errorHandler.js';
import { z } from 'zod';

const JoinSchema = z.object({
  stake: z.string().regex(/^\d+(\.\d{1,9})?$/, 'Invalid stake amount'),
});

export const matchmakingController = {

  async join(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = JoinSchema.safeParse(req.body);
      if (!parsed.success) return next(new AppError(400, parsed.error.errors[0].message, 'VALIDATION_ERROR'));
      await MatchmakingService.joinQueue(req.user!.userId, parsed.data.stake);
      return res.json({ ok: true, message: 'Joined matchmaking queue' });
    } catch (err) { return next(err); }
  },

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      await MatchmakingService.cancelQueue(req.user!.userId);
      return res.json({ ok: true, message: 'Left queue' });
    } catch (err) { return next(err); }
  },

  async status(req: Request, res: Response, next: NextFunction) {
    try {
      const entry = await MatchmakingService.getEntry(req.user!.userId);
      if (!entry) return res.json({ ok: true, inQueue: false });
      return res.json({
        ok: true, inQueue: true,
        stake: entry.stake,
        waitSecs: Math.floor((Date.now() - entry.joinedAt) / 1000),
        eloRange: MatchmakingService.getEloRange(entry),
      });
    } catch (err) { return next(err); }
  },
};

export function makeLobbyController(io: import('socket.io').Server) {
  return {
    async cancelLobby(req: Request, res: Response, next: NextFunction) {
      try {
        await cancelLobby(io, req.params.gameId, req.user!.userId);
        return res.json({ ok: true, message: 'Lobby cancelled' });
      } catch (err) { return next(err); }
    },
  };
}
