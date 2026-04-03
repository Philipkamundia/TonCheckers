import { Router } from 'express';
import { adminController } from '../controllers/admin.controller.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requireAuth } from '../middleware/auth.js';
import { adminRateLimit } from '../middleware/rateLimit.js';
import { handleAdminBotWebhook } from '../notifications/botService.js';

export const adminRouter = Router();

// Challenge endpoint is public — needed to get the challenge before signing
adminRouter.get('/challenge', adminController.getChallenge);

// Admin bot webhook — public, called by Telegram servers (no auth)
// Telegram includes X-Telegram-Bot-Api-Secret-Token header for verification
adminRouter.post('/bot-webhook', async (req, res, next) => {
  try {
    const secret = process.env.TELEGRAM_BOT_SECRET;
    if (secret) {
      const incoming = req.headers['x-telegram-bot-api-secret-token'];
      if (incoming !== secret) {
        res.status(403).json({ ok: false, error: 'Invalid secret token' });
        return;
      }
    }
    await handleAdminBotWebhook(req.body);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// All other admin routes require rate limit + JWT auth + wallet + passcode
adminRouter.use(adminRateLimit, requireAuth, requireAdmin);

// Summary
adminRouter.get('/summary',                    adminController.getSummary);

// Withdrawal queue
adminRouter.get('/withdrawals/pending',        adminController.getPendingWithdrawals);
adminRouter.post('/withdrawals/:id/approve',   adminController.approveWithdrawal);
adminRouter.post('/withdrawals/:id/reject',    adminController.rejectWithdrawal);

// Treasury health
adminRouter.get('/treasury',                   adminController.getTreasury);

// User management
adminRouter.get('/users',                      adminController.getUsers);
adminRouter.post('/users/:id/ban',             adminController.banUser);
adminRouter.post('/users/:id/unban',           adminController.unbanUser);

// Game log
adminRouter.get('/games',                      adminController.getGameLog);

// Tournament oversight
adminRouter.get('/tournaments',                adminController.getTournaments);

// Fee tracker
adminRouter.get('/fees',                       adminController.getFees);

// Crash log
adminRouter.get('/crashes',                    adminController.getCrashLog);

