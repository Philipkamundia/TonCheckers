import { Router } from 'express';
import { makeTournamentController } from '../controllers/tournament.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { financialRateLimit } from '../middleware/rateLimit.js';
import type { Server } from 'socket.io';

export const tournamentRouter = Router();

export function registerTournamentRoutes(router: Router, io: Server): void {
  const ctrl = makeTournamentController(io);

  // GET  /api/tournaments            — list (filter by ?status=open|in_progress|completed)
  router.get('/',         requireAuth, ctrl.list.bind(ctrl));

  // GET  /api/tournaments/:id        — detail with bracket + participants
  router.get('/:id',      requireAuth, ctrl.getOne.bind(ctrl));

  // POST /api/tournaments            — create tournament
  router.post('/',        requireAuth, ctrl.create.bind(ctrl));

  // POST /api/tournaments/:id/join   — join + deduct entry fee
  router.post('/:id/join', requireAuth, financialRateLimit, ctrl.join.bind(ctrl));
}

// Stub router for when io is not yet available (replaced at startup)
tournamentRouter.get('/ping', (_req, res) => res.json({ ok: true, route: 'tournaments' }));
