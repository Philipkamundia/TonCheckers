import { Router } from 'express';
import { matchmakingController, makeLobbyController } from '../controllers/matchmaking.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const matchmakingRouter = Router();
matchmakingRouter.use(requireAuth);

// POST /api/matchmaking/join    — enter queue
matchmakingRouter.post('/join',   matchmakingController.join);

// POST /api/matchmaking/cancel  — leave queue
matchmakingRouter.post('/cancel', matchmakingController.cancel);

// GET  /api/matchmaking/status  — current queue position + ELO range
matchmakingRouter.get('/status',  matchmakingController.status);

// Lobby cancel route is registered in index.ts with io injected:
// POST /api/lobby/:gameId/cancel
export function registerLobbyRoute(router: Router, io: import('socket.io').Server): void {
  const ctrl = makeLobbyController(io);
  router.post('/:gameId/cancel', requireAuth, ctrl.cancelLobby.bind(ctrl));
}
