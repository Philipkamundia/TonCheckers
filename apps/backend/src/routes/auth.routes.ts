import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rateLimit.js';

export const authRouter = Router();

// All auth endpoints use the stricter rate limiter
authRouter.use(authRateLimit);

// POST /api/auth/connect  — first connection with TonConnect proof
authRouter.post('/connect', authController.connect);

// POST /api/auth/verify   — re-auth on app resume (initData only)
authRouter.post('/verify', authController.verify);

// POST /api/auth/refresh  — new access token from refresh token
authRouter.post('/refresh', authController.refresh);

// GET  /api/auth/me       — current user profile (protected)
authRouter.get('/me', requireAuth, authController.me);
