import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service.js';

export const userController = {

  // GET /api/users/:id
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await UserService.getProfile(req.params.id);
      return res.json({ ok: true, user: profile });
    } catch (err) {
      return next(err);
    }
  },

  // GET /api/users/username/:username
  async getByUsername(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await UserService.getProfileByUsername(req.params.username);
      return res.json({ ok: true, user: profile });
    } catch (err) {
      return next(err);
    }
  },
};
