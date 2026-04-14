import { Request, Response, NextFunction } from 'express';
import { TournamentService } from '../services/tournament.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { z } from 'zod';
import type { Server } from 'socket.io';

const CreateSchema = z.object({
  name:        z.string().min(3).max(128),
  bracketSize: z.number().int().refine(s => [8,16,32,64].includes(s), 'Must be 8, 16, 32, or 64'),
  entryFee:    z.string().regex(/^\d+(\.\d{1,9})?$/, 'Invalid entry fee'),
  startsAt:    z.string().min(1),
});

export function makeTournamentController(io: Server) {
  return {

    async create(req: Request, res: Response, next: NextFunction) {
      try {
        const parsed = CreateSchema.safeParse(req.body);
        if (!parsed.success) return next(new AppError(400, parsed.error.errors[0].message, 'VALIDATION_ERROR'));
        const t = await TournamentService.createTournament(
          req.user!.userId, parsed.data.name, parsed.data.bracketSize,
          parsed.data.entryFee, parsed.data.startsAt,
        );
        io.emit('tournament.updated', { tournamentId: t.id, kind: 'created' });
        return res.status(201).json({ ok: true, tournament: t });
      } catch (err) { return next(err); }
    },

    async list(req: Request, res: Response, next: NextFunction) {
      try {
        const status = req.query.status as string | undefined;
        const tournaments = await TournamentService.listTournaments(status);
        return res.json({ ok: true, tournaments });
      } catch (err) { return next(err); }
    },

    async getOne(req: Request, res: Response, next: NextFunction) {
      try {
        const t = await TournamentService.getTournamentDetail(req.params.id);
        return res.json({ ok: true, tournament: t });
      } catch (err) { return next(err); }
    },

    async join(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await TournamentService.joinTournament(req.params.id, req.user!.userId);
        io.emit('tournament.updated', { tournamentId: req.params.id, kind: 'joined' });
        return res.json({ ok: true, ...result });
      } catch (err) { return next(err); }
    },
  };
}
