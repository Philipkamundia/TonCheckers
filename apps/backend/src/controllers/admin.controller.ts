import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/admin.service.js';
import { generateAdminChallenge } from '../middleware/requireAdmin.js';

export const adminController = {

  // GET /api/admin/challenge — get a fresh signing challenge
  async getChallenge(_req: Request, res: Response) {
    res.json({ ok: true, challenge: generateAdminChallenge() });
  },

  // GET /api/admin/summary
  async getSummary(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AdminService.getSummary();
      res.json({ ok: true, summary: data });
    } catch (err) { next(err); }
  },

  // GET /api/admin/withdrawals/pending
  async getPendingWithdrawals(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AdminService.getPendingWithdrawals();
      res.json({ ok: true, withdrawals: data });
    } catch (err) { next(err); }
  },

  // POST /api/admin/withdrawals/:id/approve
  async approveWithdrawal(req: Request, res: Response, next: NextFunction) {
    try {
      await AdminService.approveWithdrawal(req.params.id, req.body.note);
      res.json({ ok: true, message: 'Withdrawal approved and processing' });
    } catch (err) { next(err); }
  },

  // POST /api/admin/withdrawals/:id/reject
  async rejectWithdrawal(req: Request, res: Response, next: NextFunction) {
    try {
      const { reason } = req.body;
      await AdminService.rejectWithdrawal(req.params.id, reason ?? 'Rejected by admin');
      res.json({ ok: true, message: 'Withdrawal rejected and balance refunded' });
    } catch (err) { next(err); }
  },

  // GET /api/admin/treasury
  async getTreasury(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AdminService.getTreasuryHealth();
      res.json({ ok: true, treasury: data });
    } catch (err) { next(err); }
  },

  // GET /api/admin/users?page=1&search=
  async getUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const page   = parseInt(String(req.query.page  ?? '1'), 10);
      const search = req.query.search as string | undefined;
      const data   = await AdminService.listUsers(page, 50, search);
      res.json({ ok: true, ...data });
    } catch (err) { next(err); }
  },

  // POST /api/admin/users/:id/ban
  async banUser(req: Request, res: Response, next: NextFunction) {
    try {
      await AdminService.banUser(req.params.id, req.body.reason ?? 'Admin action');
      res.json({ ok: true, message: 'User banned' });
    } catch (err) { next(err); }
  },

  // POST /api/admin/users/:id/unban
  async unbanUser(req: Request, res: Response, next: NextFunction) {
    try {
      await AdminService.unbanUser(req.params.id);
      res.json({ ok: true, message: 'User unbanned' });
    } catch (err) { next(err); }
  },

  // GET /api/admin/games?page=1
  async getGameLog(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(String(req.query.page ?? '1'), 10);
      const data = await AdminService.getGameLog(page);
      res.json({ ok: true, ...data });
    } catch (err) { next(err); }
  },

  // GET /api/admin/tournaments
  async getTournaments(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AdminService.getTournamentOverview();
      res.json({ ok: true, tournaments: data });
    } catch (err) { next(err); }
  },

  // GET /api/admin/fees
  async getFees(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AdminService.getFeeBreakdown();
      res.json({ ok: true, fees: data });
    } catch (err) { next(err); }
  },

  // GET /api/admin/crashes
  async getCrashLog(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(String(req.query.page ?? '1'), 10);
      const data = await AdminService.getCrashLog(page);
      res.json({ ok: true, ...data });
    } catch (err) { next(err); }
  },
  getReconciliationHistory: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? '24'), 10), 100);
      const { rows } = await (await import('../config/db.js')).default.query(
        `SELECT * FROM reconciliation_log ORDER BY created_at DESC LIMIT $1`, [limit],
      );
      res.json({ ok: true, snapshots: rows });
    } catch (err) { next(err); }
  },

  triggerReconciliation: async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { runReconciliation } = await import('../jobs/balanceReconciliation.js');
      runReconciliation().catch(err =>
        console.error('On-demand reconciliation error:', (err as Error).message),
      );
      res.json({ ok: true, message: 'Reconciliation triggered — results will appear in logs and /admin/reconciliation' });
    } catch (err) { next(err); }
  },

  triggerWithdrawalRecovery: async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { runWithdrawalRecovery } = await import('../jobs/withdrawalRecovery.js');
      runWithdrawalRecovery().catch(err =>
        console.error('On-demand withdrawal recovery error:', (err as Error).message),
      );
      res.json({ ok: true, message: 'Withdrawal recovery triggered — failed/stuck transactions will be reconciled against the chain' });
    } catch (err) { next(err); }
  },
};
