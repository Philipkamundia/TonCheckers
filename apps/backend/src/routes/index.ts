import { Express, Router } from 'express';
import { authRouter }        from './auth.routes.js';
import { userRouter }        from './user.routes.js';
import { walletRouter }      from './wallet.routes.js';
import { gameRouter }        from './game.routes.js';
import { matchmakingRouter, registerLobbyRoute } from './matchmaking.routes.js';
import { leaderboardRouter } from './leaderboard.routes.js';
import { adminRouter }       from './admin.routes.js';
import { registerTournamentRoutes } from './tournament.routes.js';
import type { Server } from 'socket.io';

export function configureRoutes(app: Express, io?: Server): void {
  app.use('/api/auth',        authRouter);
  app.use('/api/users',       userRouter);
  app.use('/api/balance',     walletRouter);
  app.use('/api/games',       gameRouter);
  app.use('/api/matchmaking', matchmakingRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/admin',       adminRouter);

  if (io) {
    // Tournament routes need io for bracket game creation + WS broadcasts
    const tournamentRouter = Router();
    registerTournamentRoutes(tournamentRouter, io);
    app.use('/api/tournaments', tournamentRouter);

    // Lobby cancel route
    const lobbyRouter = Router();
    registerLobbyRoute(lobbyRouter, io);
    app.use('/api/lobby', lobbyRouter);
  }
}
