import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const userRouter = Router();

// GET /api/users/username/:username — must be before /:id to avoid shadowing
userRouter.get('/username/:username', requireAuth, userController.getByUsername);

// GET /api/users/:id              — public profile by ID
userRouter.get('/:id', requireAuth, userController.getById);
