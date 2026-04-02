/**
 * matchmakingScan.ts — 5-second matchmaking scan job
 *
 * PRD §6 flow:
 * 1. Find compatible pair in queue
 * 2. Lock both with Redis SETNX (prevent races)
 * 3. Recheck balance for higher-stake player on mismatch
 * 4. Create game record (status: waiting)
 * 5. Emit mm.found to both players
 * 6. Start 10s lobby countdown via WebSocket
 * 7. After 10s → start game, emit game.start
 *    OR if either player cancels → emit mm.cancelled, unlock both
 */

import { Server } from 'socket.io';
import { MatchmakingService } from '../services/matchmaking.service.js';
import { GameService } from '../services/game.service.js';
import { BalanceService } from '../services/balance.service.js';
import { GameTimerService } from '../services/game-timer.service.js';
import { initialGameState } from '../engine/board.js';
import pool from '../config/db.js';
import redis from '../config/redis.js';
import { logger } from '../utils/logger.js';

const LOBBY_COUNTDOWN_MS    = 10_000;
const COUNTDOWN_CANCEL_KEY  = 'lobby:cancel:';

// Track active lobby countdowns: gameId → { p1, p2, stake, timeout }
const activeLobbies = new Map<string, {
  player1Id: string;
  player2Id: string;
  resolvedStake: string;
  timeoutId: ReturnType<typeof setTimeout>;
}>();

export function startMatchmakingScan(io: Server): ReturnType<typeof setInterval> {
  return setInterval(() => runScan(io), 5_000);
}

async function runScan(io: Server): Promise<void> {
  try {
    const entries = await MatchmakingService.getAllEntries();
    if (entries.length < 2) return;

    const paired = new Set<string>();

    for (const seeker of entries) {
      if (paired.has(seeker.userId)) continue;

      const remaining = entries.filter(e => !paired.has(e.userId));
      const result    = MatchmakingService.findMatch(seeker, remaining);
      if (!result) continue;

      const { match, resolvedStake, stakeMismatch } = result;

      // Acquire locks for both players atomically
      const [lock1, lock2] = await Promise.all([
        MatchmakingService.acquireLock(seeker.userId),
        MatchmakingService.acquireLock(match.userId),
      ]);

      if (!lock1 || !lock2) {
        // Another scan is processing one of these players — skip
        if (lock1) await MatchmakingService.releaseLock(seeker.userId);
        if (lock2) await MatchmakingService.releaseLock(match.userId);
        continue;
      }

      try {
        // On stake mismatch: higher-stake player gets partial unlock
        // (their stake is locked at their amount, we need to unlock the difference)
        if (stakeMismatch) {
          const seekerStake = parseFloat(seeker.stake);
          const matchStake  = parseFloat(match.stake);
          const resolved    = parseFloat(resolvedStake);

          if (seekerStake > resolved) {
            const diff = (seekerStake - resolved).toFixed(9);
            await BalanceService.unlockBalance(seeker.userId, diff);
          }
          if (matchStake > resolved) {
            const diff = (matchStake - resolved).toFixed(9);
            await BalanceService.unlockBalance(match.userId, diff);
          }
        }

        // Remove both from queue (keep balance locked — will unlock if lobby cancelled)
        await Promise.all([
          MatchmakingService.removeFromQueue(seeker.userId, resolvedStake, false),
          MatchmakingService.removeFromQueue(match.userId,  resolvedStake, false),
        ]);

        // Create game record in DB (status: waiting — not started yet)
        // Insert directly as waiting to avoid a two-query race window
        const gameRecord = await GameService.createGame(
          seeker.userId, match.userId, resolvedStake,
          seeker.elo, match.elo, initialGameState(),
          pool, 'waiting',
        );

        paired.add(seeker.userId);
        paired.add(match.userId);

        logger.info(`Match found: ${seeker.userId} vs ${match.userId} stake=${resolvedStake} game=${gameRecord.id}`);

        // Notify both players
        const payload = {
          gameId:        gameRecord.id,
          opponentElo:   null as number | null,
          stake:         resolvedStake,
          stakeMismatch,
          countdownMs:   LOBBY_COUNTDOWN_MS,
        };

        io.to(`user:${seeker.userId}`).emit('mm.found', {
          ...payload,
          opponentElo: match.elo,
          originalStake: seeker.stake,
        });
        io.to(`user:${match.userId}`).emit('mm.found', {
          ...payload,
          opponentElo: seeker.elo,
          originalStake: match.stake,
        });

        if (stakeMismatch) {
          // Notify the player whose stake was reduced
          const seekerStakeNum = parseFloat(seeker.stake);
          const matchStakeNum  = parseFloat(match.stake);
          if (seekerStakeNum !== matchStakeNum) {
            const higherStakePlayer = seekerStakeNum > matchStakeNum ? seeker.userId : match.userId;
            const higherOriginal    = Math.max(seekerStakeNum, matchStakeNum).toFixed(9);
            io.to(`user:${higherStakePlayer}`).emit('mm.stake_adjusted', {
              gameId: gameRecord.id,
              originalStake: higherOriginal,
              resolvedStake,
            });
          }
        }

        // Start 10s lobby countdown
        startLobbyCountdown(io, gameRecord.id, seeker.userId, match.userId, resolvedStake);

      } finally {
        await Promise.all([
          MatchmakingService.releaseLock(seeker.userId),
          MatchmakingService.releaseLock(match.userId),
        ]);
      }
    }
  } catch (err) {
    logger.error(`Matchmaking scan error: ${(err as Error).message}`);
  }
}

/**
 * 10-second lobby countdown.
 * PRD §6: Either player can cancel during the 10-second countdown.
 * Stakes unlocked, both returned to queue.
 */
function startLobbyCountdown(
  io: Server,
  gameId: string,
  player1Id: string,
  player2Id: string,
  stake: string,
): void {
  // Tick every second
  let remaining = LOBBY_COUNTDOWN_MS / 1000;

  const tickInterval = setInterval(() => {
    remaining--;
    io.to(`user:${player1Id}`).emit('mm.countdown', { gameId, remaining });
    io.to(`user:${player2Id}`).emit('mm.countdown', { gameId, remaining });
  }, 1_000);

  const timeoutId = setTimeout(async () => {
    clearInterval(tickInterval);
    activeLobbies.delete(gameId);

    try {
      // Check neither player cancelled during countdown
      const cancelKey = `${COUNTDOWN_CANCEL_KEY}${gameId}`;
      const cancelled = await redis.get(cancelKey);
      await redis.del(cancelKey);

      if (cancelled) {
        // Someone cancelled — handled in cancelLobby()
        return;
      }

      // Start the game — update DB status to active, start timer
      await pool.query(
        `UPDATE games SET status='active', started_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [gameId],
      );
      await GameTimerService.startTimer(gameId, 1);

      io.to(`user:${player1Id}`).emit('mm.game_start', { gameId, playerNumber: 1 });
      io.to(`user:${player2Id}`).emit('mm.game_start', { gameId, playerNumber: 2 });

      logger.info(`Game started: ${gameId}`);
    } catch (err) {
      logger.error(`Lobby countdown error game=${gameId}: ${(err as Error).message}`);
      // Refund both players — game failed to start
      await Promise.allSettled([
        BalanceService.unlockBalance(player1Id, stake),
        BalanceService.unlockBalance(player2Id, stake),
      ]);
      await pool.query(
        `UPDATE games SET status='cancelled', updated_at=NOW() WHERE id=$1`, [gameId],
      );
      io.to(`user:${player1Id}`).emit('mm.cancelled', { gameId, cancelledBy: 'server_error' });
      io.to(`user:${player2Id}`).emit('mm.cancelled', { gameId, cancelledBy: 'server_error' });
    }
  }, LOBBY_COUNTDOWN_MS);

  activeLobbies.set(gameId, { player1Id, player2Id, resolvedStake: stake, timeoutId });
}

/**
 * POST /lobby/:gameId/cancel — cancel during countdown
 * PRD §6: Either player can cancel. Stakes unlocked. Both returned to queue.
 */
export async function cancelLobby(
  io: Server,
  gameId: string,
  cancellingUserId: string,
): Promise<void> {
  const lobby = activeLobbies.get(gameId);
  if (!lobby) throw new Error('Lobby not found or already started');

  // Set cancel flag in Redis (checked when countdown fires)
  await redis.set(`${COUNTDOWN_CANCEL_KEY}${gameId}`, cancellingUserId, 'PX', 15_000);

  clearTimeout(lobby.timeoutId);
  activeLobbies.delete(gameId);

  // Cancel game record
  await pool.query(
    `UPDATE games SET status='cancelled', updated_at=NOW() WHERE id=$1`, [gameId],
  );

  // Unlock stakes for both players
  await Promise.all([
    BalanceService.unlockBalance(lobby.player1Id, lobby.resolvedStake),
    BalanceService.unlockBalance(lobby.player2Id,  lobby.resolvedStake),
  ]);

  // Notify both
  io.to(`user:${lobby.player1Id}`).emit('mm.cancelled', { gameId, cancelledBy: cancellingUserId });
  io.to(`user:${lobby.player2Id}`).emit('mm.cancelled', { gameId, cancelledBy: cancellingUserId });

  logger.info(`Lobby cancelled: game=${gameId} by=${cancellingUserId}`);
}
