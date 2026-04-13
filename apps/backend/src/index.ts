import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initSentry } from './config/sentry.js';
import { checkDbConnection } from './config/db.js';
import { checkRedisConnection } from './config/redis.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { configureRoutes } from './routes/index.js';
import { WebSocketService } from './services/websocket.service.js';
import { DepositDetectionService } from './services/deposit-detection.service.js';
import { GameService } from './services/game.service.js';
import { startTimerCheckJob } from './jobs/gameTimerCheck.js';
import { startMatchmakingScan } from './jobs/matchmakingScan.js';
import { startTreasuryMonitor } from './jobs/treasuryMonitor.js';
import { startTournamentStartCheck } from './jobs/tournamentStartCheck.js';
import { startTournamentLobbyCheck } from './jobs/tournamentLobbyCheck.js';
import { startTournamentBracketCheck } from './jobs/tournamentBracketCheck.js';
import { startLeaderboardRebuild } from './jobs/leaderboardRebuild.js';
import { startWithdrawalRecoveryJob } from './jobs/withdrawalRecovery.js';
import { startOrphanedLockRecoveryJob } from './jobs/orphanedLockRecovery.js';
import { startBalanceReconciliationJob } from './jobs/balanceReconciliation.js';
import { logger } from './utils/logger.js';
import { runMigrations } from './migrate.js';

const app        = express();
const httpServer = createServer(app);
const PORT       = process.env.PORT || 3001;

// Trust Railway/proxy X-Forwarded-For headers
app.set('trust proxy', 1);

// Fail fast on missing required env vars
const REQUIRED_ENV = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'TELEGRAM_BOT_TOKEN', 'ADMIN_PASSCODE'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// Init Sentry before anything else so it captures startup errors
initSentry();

const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? (process.env.FRONTEND_URL ?? '').split(',').map(s => s.trim()).filter(Boolean)
  : ['http://localhost:3000', 'http://localhost:5173'];

const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
  pingInterval: 25_000,
  pingTimeout:  20_000,
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(helmet());
app.use(morgan('combined', { stream: { write: (msg: string) => logger.http(msg.trim()) } }));
app.use(compression());
app.use(rateLimitMiddleware);

app.get('/health', async (_req, res) => {
  const [db, redis] = await Promise.all([checkDbConnection(), checkRedisConnection()]);
  const ok = db && redis;
  res.status(ok ? 200 : 503).json({
    ok, db: db ? 'connected' : 'error', redis: redis ? 'connected' : 'error',
    uptime: process.uptime(), timestamp: new Date().toISOString(),
  });
});

configureRoutes(app, io);
app.use(notFoundHandler);
app.use(errorHandler);

// ─── NOTE: SPA routing ────────────────────────────────────────────────────────
// The frontend is a Single Page App served separately (Vite/Railway/Vercel).

// ─── M-08: Graceful shutdown ──────────────────────────────────────────────────
// On SIGTERM / SIGINT: stop accepting new connections, wait for in-flight
// requests to complete, then close DB pool and Redis. This prevents
// in-flight game moves and withdrawals from being abruptly cut off during
// rolling deployments on Railway / Docker.
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`${signal} received — starting graceful shutdown`);

  // Stop accepting new HTTP + WebSocket connections
  httpServer.close(async () => {
    logger.info('HTTP server closed');
    try {
      // Close DB pool
      const { default: pool } = await import('./config/db.js');
      await pool.end();
      logger.info('DB pool closed');

      // Close Redis connection
      const { default: redis } = await import('./config/redis.js');
      redis.disconnect();
      logger.info('Redis disconnected');
    } catch (err) {
      logger.error(`Shutdown error: ${(err as Error).message}`);
    }
    process.exit(0);
  });

  // Force-kill if graceful shutdown takes > 30s
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — force exiting');
    process.exit(1);
  }, 30_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
// Your hosting must return index.html for ALL non-API routes so that
// BrowserRouter works when Telegram opens a deep link like /game/abc123.
// On Railway: set the "Rewrite" rule to serve index.html for /* paths.
// On Nginx:   add `try_files $uri $uri/ /index.html;` to your location block.

httpServer.listen(PORT, async () => {
  logger.info(`🚀 CheckTON backend on port ${PORT}`);

  // Run DB migrations on every startup — idempotent, safe to run repeatedly
  await runMigrations();

  const recovered = await GameService.recoverCrashedGames(io);
  if (recovered.length) logger.warn(`Recovered ${recovered.length} crashed games`);

  new WebSocketService(io);

  startTimerCheckJob(io);
  startMatchmakingScan(io);
  startTournamentStartCheck(io);
  startTournamentLobbyCheck(io);
  startTournamentBracketCheck(io);
  startLeaderboardRebuild();
  startWithdrawalRecoveryJob();
  startOrphanedLockRecoveryJob();
  startBalanceReconciliationJob();

  try {
    await DepositDetectionService.start();
  } catch (err) {
    logger.warn(`Deposit poller: ${(err as Error).message}`);
  }

  startTreasuryMonitor();

  logger.info('✅ All services running');
  logger.info(`  ⏱  Move timer job`);
  logger.info(`  🎯 Matchmaking scan`);
  logger.info(`  🏆 Tournament check`);
  logger.info(`  📊 Leaderboard rebuild`);
  logger.info(`  💰 Deposit poller`);
  logger.info(`  🏦 Treasury monitor`);
  logger.info(`  🔄 Withdrawal recovery`);
  logger.info(`  🔓 Orphaned lock recovery`);
});

const shutdown = () => {
  DepositDetectionService.stop();
  httpServer.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
