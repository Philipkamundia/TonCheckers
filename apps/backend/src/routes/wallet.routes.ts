import { Router } from 'express';
import { walletController } from '../controllers/wallet.controller.js';
import { withdrawalController } from '../controllers/withdrawal.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { financialRateLimit } from '../middleware/rateLimit.js';

export const walletRouter = Router();
walletRouter.use(requireAuth);

// GET  /api/balance             — available, locked, total
walletRouter.get('/', walletController.getBalance);

// GET  /api/balance/history     — paginated transaction log
walletRouter.get('/history', walletController.getHistory);

// POST /api/balance/deposit/init — hot wallet address + memo
walletRouter.post('/deposit/init', financialRateLimit, walletController.initDeposit);

// POST /api/balance/withdraw     — withdrawal request (PRD §4)
walletRouter.post('/withdraw', financialRateLimit, withdrawalController.requestWithdrawal);
