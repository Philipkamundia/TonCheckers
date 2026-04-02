import { Router } from 'express';

// Phase stub — fully implemented in its dedicated phase
export const gameRouter = Router();

gameRouter.get('/ping', (_req, res) => {
  res.json({ ok: true, route: 'game', message: 'Phase stub — not yet implemented' });
});
