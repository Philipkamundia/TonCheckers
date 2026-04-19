/**
 * tests/unit/routes/routes.extended.test.ts
 *
 * Covers uncovered branches in:
 * - admin.routes.ts: bot-webhook with/without secret
 * - routes/index.ts: configureRoutes with and without io
 * - tournament.routes.ts: registerTournamentRoutes, ping route
 * - matchmaking.routes.ts: registerLobbyRoute
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockHandleWebhook, mockRequireAuth, mockRequireAdmin, mockAdminRateLimit,
        mockFinancialRateLimit, mockMakeTournamentCtrl, mockMakeLobbyCtrl } = vi.hoisted(() => ({
  mockHandleWebhook:       vi.fn(),
  mockRequireAuth:         vi.fn((_r: unknown, _s: unknown, n: () => void) => n()),
  mockRequireAdmin:        vi.fn((_r: unknown, _s: unknown, n: () => void) => n()),
  mockAdminRateLimit:      vi.fn((_r: unknown, _s: unknown, n: () => void) => n()),
  mockFinancialRateLimit:  vi.fn((_r: unknown, _s: unknown, n: () => void) => n()),
  mockMakeTournamentCtrl:  vi.fn(),
  mockMakeLobbyCtrl:       vi.fn(),
}));

vi.mock('../../../apps/backend/src/notifications/botService.js', () => ({
  handleAdminBotWebhook: mockHandleWebhook,
  bot: null,
  sendTelegramMessage: vi.fn(),
}));
vi.mock('../../../apps/backend/src/middleware/auth.js', () => ({
  requireAuth: mockRequireAuth,
}));
vi.mock('../../../apps/backend/src/middleware/requireAdmin.js', () => ({
  requireAdmin: mockRequireAdmin,
  generateAdminChallenge: vi.fn().mockReturnValue('challenge-123'),
}));
vi.mock('../../../apps/backend/src/middleware/rateLimit.js', () => ({
  adminRateLimit:     mockAdminRateLimit,
  financialRateLimit: mockFinancialRateLimit,
  rateLimitMiddleware: vi.fn((_r: unknown, _s: unknown, n: () => void) => n()),
  authRateLimit:      vi.fn((_r: unknown, _s: unknown, n: () => void) => n()),
}));
vi.mock('../../../apps/backend/src/controllers/tournament.controller.js', () => ({
  makeTournamentController: mockMakeTournamentCtrl,
}));
vi.mock('../../../apps/backend/src/controllers/matchmaking.controller.js', () => ({
  matchmakingController: { join: vi.fn(), cancel: vi.fn(), status: vi.fn() },
  makeLobbyController: mockMakeLobbyCtrl,
}));
vi.mock('../../../apps/backend/src/controllers/admin.controller.js', () => ({
  adminController: {
    getChallenge: vi.fn(), getSummary: vi.fn(), getPendingWithdrawals: vi.fn(),
    approveWithdrawal: vi.fn(), rejectWithdrawal: vi.fn(), getTreasury: vi.fn(),
    getUsers: vi.fn(), banUser: vi.fn(), unbanUser: vi.fn(), getGameLog: vi.fn(),
    getTournaments: vi.fn(), getFees: vi.fn(), getCrashLog: vi.fn(),
    getReconciliationHistory: vi.fn(), triggerReconciliation: vi.fn(),
    triggerWithdrawalRecovery: vi.fn(),
  },
}));
vi.mock('../../../apps/backend/src/config/redis.js', () => ({
  default: { set: vi.fn(), get: vi.fn(), del: vi.fn(), on: vi.fn(), call: vi.fn().mockResolvedValue(0) },
}));
vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock all route modules so they don't try to instantiate real middleware
vi.mock('../../../apps/backend/src/routes/auth.routes.js', () => ({
  authRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../../apps/backend/src/routes/user.routes.js', () => ({
  userRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../../apps/backend/src/routes/wallet.routes.js', () => ({
  walletRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../../apps/backend/src/routes/game.routes.js', () => ({
  gameRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../../apps/backend/src/routes/leaderboard.routes.js', () => ({
  leaderboardRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

// ─── admin.routes.ts — bot-webhook ───────────────────────────────────────────

describe('admin.routes.ts — bot-webhook', () => {
  async function callWebhook(
    secret: string | undefined,
    incomingHeader: string | undefined,
    body = {},
  ) {
    process.env.TELEGRAM_BOT_SECRET = secret as string;
    if (!secret) delete process.env.TELEGRAM_BOT_SECRET;

    const { adminRouter } = await import('../../../apps/backend/src/routes/admin.routes.js');

    const req = {
      headers: incomingHeader ? { 'x-telegram-bot-api-secret-token': incomingHeader } : {},
      body,
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    // Find the bot-webhook route handler
    const layer = (adminRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> }).stack
      .find(l => l.route?.path === '/bot-webhook');

    if (layer?.route) {
      for (const handler of layer.route.stack) {
        await handler.handle(req, res, next);
        if ((res.json as ReturnType<typeof vi.fn>).mock.calls.length > 0) break;
        if ((res.status as ReturnType<typeof vi.fn>).mock.calls.length > 0) break;
      }
    }

    return { req, res, next };
  }

  it('calls webhook when no secret configured', async () => {
    mockHandleWebhook.mockResolvedValueOnce(undefined);
    const { res } = await callWebhook(undefined, undefined, { update_id: 1 });
    expect(mockHandleWebhook).toHaveBeenCalled();
    expect((res.json as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ ok: true });
  });

  it('calls webhook when secret matches header', async () => {
    mockHandleWebhook.mockResolvedValueOnce(undefined);
    const { res } = await callWebhook('my-secret', 'my-secret', { update_id: 1 });
    expect(mockHandleWebhook).toHaveBeenCalled();
    expect((res.json as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 403 when secret configured but header missing', async () => {
    const { res } = await callWebhook('my-secret', undefined);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(403);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it('returns 403 when secret does not match header', async () => {
    const { res } = await callWebhook('my-secret', 'wrong-secret');
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(403);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it('calls next(err) when webhook handler throws', async () => {
    mockHandleWebhook.mockRejectedValueOnce(new Error('Webhook error'));
    const { next } = await callWebhook(undefined, undefined);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── routes/index.ts — configureRoutes ───────────────────────────────────────

describe('routes/index.ts — configureRoutes', () => {
  it('registers all base routes without io', async () => {
    const { configureRoutes } = await import('../../../apps/backend/src/routes/index.js');
    const app = { use: vi.fn() };
    configureRoutes(app as never);

    const paths = app.use.mock.calls.map((c: unknown[]) => c[0]);
    expect(paths).toContain('/api/auth');
    expect(paths).toContain('/api/users');
    expect(paths).toContain('/api/balance');
    expect(paths).toContain('/api/games');
    expect(paths).toContain('/api/matchmaking');
    expect(paths).toContain('/api/leaderboard');
    expect(paths).toContain('/api/admin');
    // Tournament and lobby NOT registered without io
    expect(paths).not.toContain('/api/tournaments');
    expect(paths).not.toContain('/api/lobby');
  });

  it('registers tournament and lobby routes when io is provided', async () => {
    const ctrl = { list: vi.fn(), getOne: vi.fn(), create: vi.fn(), join: vi.fn() };
    mockMakeTournamentCtrl.mockReturnValue(ctrl);
    const lobbyCtrl = { cancelLobby: vi.fn() };
    mockMakeLobbyCtrl.mockReturnValue(lobbyCtrl);

    const { configureRoutes } = await import('../../../apps/backend/src/routes/index.js?v=with-io');
    const app = { use: vi.fn() };
    const io = { to: vi.fn() };
    configureRoutes(app as never, io as never);

    const paths = app.use.mock.calls.map((c: unknown[]) => c[0]);
    expect(paths).toContain('/api/tournaments');
    expect(paths).toContain('/api/lobby');
  });
});

// ─── tournament.routes.ts — ping route ───────────────────────────────────────

describe('tournament.routes.ts — ping route', () => {
  it('GET /ping returns { ok: true, route: "tournaments" }', async () => {
    const { tournamentRouter } = await import('../../../apps/backend/src/routes/tournament.routes.js');

    const req = {} as Request;
    const res = { json: vi.fn() } as unknown as Response;

    const pingLayer = (tournamentRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> }).stack
      .find(l => l.route?.path === '/ping');

    if (pingLayer?.route) {
      pingLayer.route.stack[0].handle(req, res, vi.fn());
    }

    expect(res.json).toHaveBeenCalledWith({ ok: true, route: 'tournaments' });
  });
});

// ─── tournament.routes.ts — registerTournamentRoutes ─────────────────────────

describe('tournament.routes.ts — registerTournamentRoutes', () => {
  it('registers all 4 routes with correct methods', async () => {
    const ctrl = { list: vi.fn(), getOne: vi.fn(), create: vi.fn(), join: vi.fn() };
    mockMakeTournamentCtrl.mockReturnValue(ctrl);

    const { registerTournamentRoutes } = await import('../../../apps/backend/src/routes/tournament.routes.js');
    const router = { get: vi.fn(), post: vi.fn() };
    const io = {};
    registerTournamentRoutes(router as never, io as never);

    expect(router.get).toHaveBeenCalledTimes(2); // list + getOne
    expect(router.post).toHaveBeenCalledTimes(2); // create + join
  });
});

// ─── matchmaking.routes.ts — registerLobbyRoute ──────────────────────────────

describe('matchmaking.routes.ts — registerLobbyRoute', () => {
  it('registers POST /:gameId/cancel route', async () => {
    const lobbyCtrl = { cancelLobby: vi.fn() };
    mockMakeLobbyCtrl.mockReturnValue(lobbyCtrl);

    const { registerLobbyRoute } = await import('../../../apps/backend/src/routes/matchmaking.routes.js');
    const router = { post: vi.fn() };
    const io = {};
    registerLobbyRoute(router as never, io as never);

    expect(router.post).toHaveBeenCalledWith(
      '/:gameId/cancel',
      mockRequireAuth,
      expect.any(Function),
    );
  });
});
