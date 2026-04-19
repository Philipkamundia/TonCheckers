/**
 * tests/integration/jobs/tournamentJobs.test.ts
 *
 * Tournament job orchestration — tests the tick logic directly
 * by simulating what each job's interval callback does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDbQuery,
  mockStartTournament,
  mockRecoverStuckRound,
  mockNotifySend,
  mockResolveBracket,
  mockGetExpiredBracket,
  mockGetPresentPlayers,
  mockClearBracketWindow,
  mockGetExpiredLobbies,
  mockGetJoinedPlayers,
  mockClearLobby,
  mockActivateGame,
  mockStartTimer,
  mockRecordMatchResult,
  mockGetExpiredPreviews,
  mockClearPreviewWindow,
  mockActivateRoundMatchLobby,
  mockLogger,
} = vi.hoisted(() => ({
  mockDbQuery:              vi.fn(),
  mockStartTournament:      vi.fn(),
  mockRecoverStuckRound:    vi.fn(),
  mockNotifySend:           vi.fn(),
  mockResolveBracket:       vi.fn(),
  mockGetExpiredBracket:    vi.fn(),
  mockGetPresentPlayers:    vi.fn(),
  mockClearBracketWindow:   vi.fn(),
  mockGetExpiredLobbies:    vi.fn(),
  mockGetJoinedPlayers:     vi.fn(),
  mockClearLobby:           vi.fn(),
  mockActivateGame:         vi.fn(),
  mockStartTimer:           vi.fn(),
  mockRecordMatchResult:    vi.fn(),
  mockGetExpiredPreviews:   vi.fn(),
  mockClearPreviewWindow:   vi.fn(),
  mockActivateRoundMatchLobby: vi.fn(),
  mockLogger:               { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/backend/src/config/db.js', () => ({ default: { query: mockDbQuery } }));
vi.mock('../../../apps/backend/src/utils/logger.js', () => ({ logger: mockLogger }));
vi.mock('../../../apps/backend/src/services/tournament.service.js', () => ({
  TournamentService: {
    startTournament:          mockStartTournament,
    recoverStuckRound:        mockRecoverStuckRound,
    resolveBracketWindow:     mockResolveBracket,
    recordMatchResult:        mockRecordMatchResult,
    activateRoundMatchLobby:  mockActivateRoundMatchLobby,
  },
}));
vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: mockNotifySend },
}));
vi.mock('../../../apps/backend/src/services/tournament-bracket.service.js', () => ({
  TournamentBracketService: {
    getExpiredWindows:   mockGetExpiredBracket,
    getPresentPlayers:   mockGetPresentPlayers,
    clearWindow:         mockClearBracketWindow,
  },
}));
vi.mock('../../../apps/backend/src/services/tournament-lobby.service.js', () => ({
  TournamentLobbyService: {
    getExpiredLobbies:  mockGetExpiredLobbies,
    getJoinedPlayers:   mockGetJoinedPlayers,
    clearLobby:         mockClearLobby,
  },
}));
vi.mock('../../../apps/backend/src/services/game.service.js', () => ({
  GameService: { activateGame: mockActivateGame },
}));
vi.mock('../../../apps/backend/src/services/game-timer.service.js', () => ({
  GameTimerService: { startTimer: mockStartTimer },
}));
vi.mock('../../../apps/backend/src/services/tournament-round-preview.service.js', () => ({
  TournamentRoundPreviewService: {
    getExpiredWindows: mockGetExpiredPreviews,
    clearWindow:       mockClearPreviewWindow,
  },
}));

import { TournamentService }             from '../../../apps/backend/src/services/tournament.service.js';
import { TournamentBracketService }      from '../../../apps/backend/src/services/tournament-bracket.service.js';
import { TournamentLobbyService }        from '../../../apps/backend/src/services/tournament-lobby.service.js';
import { TournamentRoundPreviewService } from '../../../apps/backend/src/services/tournament-round-preview.service.js';
import { NotificationService }           from '../../../apps/backend/src/services/notification.service.js';
import { GameService }                   from '../../../apps/backend/src/services/game.service.js';
import { GameTimerService }              from '../../../apps/backend/src/services/game-timer.service.js';

function makeMockIo() {
  return { to: vi.fn().mockImplementation(() => ({ emit: vi.fn() })) } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── tournamentStartCheck logic ───────────────────────────────────────────────

async function runStartCheck(io: any): Promise<void> {
  // checkDue
  const { rows: due } = await mockDbQuery(`SELECT id FROM tournaments WHERE status='open' AND starts_at <= NOW()`);
  for (const { id } of due) {
    try { await TournamentService.startTournament(id, io); }
    catch (err) { mockLogger.error(`Start failed: ${id}: ${(err as Error).message}`); }
  }
  // checkStuckRounds
  const { rows: stuck } = await mockDbQuery(`SELECT id, current_round FROM tournaments WHERE stuck`);
  for (const { id, currentRound } of stuck) {
    try { await TournamentService.recoverStuckRound(id, currentRound, io); }
    catch (err) { mockLogger.error(`Recovery failed: ${(err as Error).message}`); }
  }
  // notifyUpcoming
  const { rows: upcoming } = await mockDbQuery(`SELECT id, name, uids FROM tournaments WHERE upcoming`);
  for (const t of upcoming) {
    for (const uid of (t.uids as string[])) {
      await NotificationService.send(uid, 'tournament_starting', { name: t.name });
      io.to(`user:${uid}`).emit('tournament.starting_soon', { tournamentId: t.id });
    }
  }
}

describe('tournamentStartCheck — checkDue', () => {
  it('starts due tournaments', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 't-001' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockStartTournament.mockResolvedValue(undefined);

    const io = makeMockIo();
    await runStartCheck(io);
    expect(mockStartTournament).toHaveBeenCalledWith('t-001', io);
  });

  it('logs error and continues when one tournament fails to start', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 't-fail' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockStartTournament.mockRejectedValue(new Error('Start failed'));

    const io = makeMockIo();
    await runStartCheck(io);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Start failed'));
  });
});

describe('tournamentStartCheck — checkStuckRounds', () => {
  it('recovers stuck rounds', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 't-stuck', currentRound: 2 }] })
      .mockResolvedValueOnce({ rows: [] });
    mockRecoverStuckRound.mockResolvedValue(undefined);

    const io = makeMockIo();
    await runStartCheck(io);
    expect(mockRecoverStuckRound).toHaveBeenCalledWith('t-stuck', 2, io);
  });
});

describe('tournamentStartCheck — notifyUpcoming', () => {
  it('sends notifications for upcoming tournaments', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 't-soon', name: 'Big Tournament', uids: ['u1', 'u2'] }] });
    mockNotifySend.mockResolvedValue(undefined);

    const io = makeMockIo();
    await runStartCheck(io);
    expect(mockNotifySend).toHaveBeenCalledWith('u1', 'tournament_starting', expect.any(Object));
    expect(mockNotifySend).toHaveBeenCalledWith('u2', 'tournament_starting', expect.any(Object));
  });
});

// ─── tournamentBracketCheck logic ─────────────────────────────────────────────

async function runBracketCheck(io: any): Promise<void> {
  const expired = await TournamentBracketService.getExpiredWindows();
  for (const { tournamentId, meta } of expired) {
    const present = await TournamentBracketService.getPresentPlayers(tournamentId);
    await TournamentBracketService.clearWindow(tournamentId);
    try {
      await TournamentService.resolveBracketWindow(tournamentId, present, meta.participants, io);
    } catch (err) {
      mockLogger.error(`Bracket resolve failed: tournament=${tournamentId}: ${(err as Error).message}`);
    }
  }
}

describe('tournamentBracketCheck', () => {
  const PARTICIPANTS = [{ userId: 'p1', seedElo: 1800 }, { userId: 'p2', seedElo: 1600 }];

  it('resolves bracket window when expired', async () => {
    mockGetExpiredBracket.mockResolvedValue([{
      tournamentId: 't-001',
      meta: { tournamentId: 't-001', expiresAt: Date.now() - 1000, participants: PARTICIPANTS },
    }]);
    mockGetPresentPlayers.mockResolvedValue(['p1', 'p2']);
    mockClearBracketWindow.mockResolvedValue(undefined);
    mockResolveBracket.mockResolvedValue(undefined);

    const io = makeMockIo();
    await runBracketCheck(io);
    expect(mockResolveBracket).toHaveBeenCalledWith('t-001', ['p1', 'p2'], PARTICIPANTS, io);
  });

  it('logs error when bracket resolve fails but does not crash', async () => {
    mockGetExpiredBracket.mockResolvedValue([{
      tournamentId: 't-fail',
      meta: { tournamentId: 't-fail', expiresAt: Date.now() - 1000, participants: PARTICIPANTS },
    }]);
    mockGetPresentPlayers.mockResolvedValue(['p1']);
    mockClearBracketWindow.mockResolvedValue(undefined);
    mockResolveBracket.mockRejectedValue(new Error('Resolve failed'));

    const io = makeMockIo();
    await runBracketCheck(io);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Bracket resolve failed'));
  });
});

// ─── tournamentLobbyCheck logic ───────────────────────────────────────────────

async function runLobbyCheck(io: any): Promise<void> {
  const expired = await TournamentLobbyService.getExpiredLobbies();
  for (const { gameId, meta } of expired) {
    const joined = await TournamentLobbyService.getJoinedPlayers(gameId);
    await TournamentLobbyService.clearLobby(gameId);

    const bothJoined = joined.includes(meta.player1Id) && joined.includes(meta.player2Id);
    if (bothJoined) {
      await GameService.activateGame(gameId);
      await GameTimerService.startTimer(gameId, 1);
      io.to(`user:${meta.player1Id}`).emit('tournament.game_start', { gameId });
      io.to(`user:${meta.player2Id}`).emit('tournament.game_start', { gameId });
      continue;
    }

    let winnerId: string;
    let loserId:  string;
    if (joined.includes(meta.player1Id) && !joined.includes(meta.player2Id)) {
      winnerId = meta.player1Id; loserId = meta.player2Id;
    } else if (joined.includes(meta.player2Id) && !joined.includes(meta.player1Id)) {
      winnerId = meta.player2Id; loserId = meta.player1Id;
    } else {
      winnerId = meta.player1Id; loserId = meta.player2Id;
    }

    io.to(`user:${loserId}`).emit('tournament.lobby_forfeit', { gameId });
    io.to(`user:${winnerId}`).emit('tournament.lobby_win', { gameId });
    await TournamentService.recordMatchResult(meta.tournamentId, meta.matchId, winnerId, io);
  }
}

describe('tournamentLobbyCheck — both players joined', () => {
  const META = { tournamentId: 't-001', matchId: 'm-001', player1Id: 'p1', player2Id: 'p2', expiresAt: Date.now() - 1000 };

  it('activates game and starts timer when both players joined', async () => {
    mockGetExpiredLobbies.mockResolvedValue([{ gameId: 'g-001', meta: META }]);
    mockGetJoinedPlayers.mockResolvedValue(['p1', 'p2']);
    mockClearLobby.mockResolvedValue(undefined);
    mockActivateGame.mockResolvedValue(undefined);
    mockStartTimer.mockResolvedValue(undefined);

    const io = makeMockIo();
    await runLobbyCheck(io);
    expect(mockActivateGame).toHaveBeenCalledWith('g-001');
    expect(mockStartTimer).toHaveBeenCalledWith('g-001', 1);
  });
});

describe('tournamentLobbyCheck — forfeit scenarios', () => {
  const META = { tournamentId: 't-001', matchId: 'm-001', player1Id: 'p1', player2Id: 'p2', expiresAt: Date.now() - 1000 };

  it('records p1 win when only p1 joined', async () => {
    mockGetExpiredLobbies.mockResolvedValue([{ gameId: 'g-001', meta: META }]);
    mockGetJoinedPlayers.mockResolvedValue(['p1']);
    mockClearLobby.mockResolvedValue(undefined);
    mockRecordMatchResult.mockResolvedValue(undefined);

    const io = makeMockIo();
    await runLobbyCheck(io);
    expect(mockRecordMatchResult).toHaveBeenCalledWith('t-001', 'm-001', 'p1', io);
  });

  it('records p2 win when only p2 joined', async () => {
    mockGetExpiredLobbies.mockResolvedValue([{ gameId: 'g-001', meta: META }]);
    mockGetJoinedPlayers.mockResolvedValue(['p2']);
    mockClearLobby.mockResolvedValue(undefined);
    mockRecordMatchResult.mockResolvedValue(undefined);

    const io = makeMockIo();
    await runLobbyCheck(io);
    expect(mockRecordMatchResult).toHaveBeenCalledWith('t-001', 'm-001', 'p2', io);
  });

  it('records p1 win by convention when neither joined', async () => {
    mockGetExpiredLobbies.mockResolvedValue([{ gameId: 'g-001', meta: META }]);
    mockGetJoinedPlayers.mockResolvedValue([]);
    mockClearLobby.mockResolvedValue(undefined);
    mockRecordMatchResult.mockResolvedValue(undefined);

    const io = makeMockIo();
    await runLobbyCheck(io);
    expect(mockRecordMatchResult).toHaveBeenCalledWith('t-001', 'm-001', 'p1', io);
  });
});

// ─── tournamentRoundPreviewCheck logic ───────────────────────────────────────

async function runPreviewCheck(io: any): Promise<void> {
  const expired = await TournamentRoundPreviewService.getExpiredWindows();
  for (const preview of expired) {
    await TournamentRoundPreviewService.clearWindow(preview.tournamentId);
    for (const match of preview.matches) {
      try {
        await TournamentService.activateRoundMatchLobby(preview.tournamentId, preview.round, match, io);
      } catch (err) {
        mockLogger.error(`Round preview activation failed: tournament=${preview.tournamentId} round=${preview.round} game=${match.gameId}: ${(err as Error).message}`);
      }
    }
  }
}

describe('tournamentRoundPreviewCheck', () => {
  const MATCHES = [
    { gameId: 'g1', matchId: 'm1', player1Id: 'p1', player2Id: 'p2' },
    { gameId: 'g2', matchId: 'm2', player1Id: 'p3', player2Id: 'p4' },
  ];

  it('activates lobbies for all matches in expired preview', async () => {
    mockGetExpiredPreviews.mockResolvedValue([{
      tournamentId: 't-001', round: 2, expiresAt: Date.now() - 1000, matches: MATCHES,
    }]);
    mockClearPreviewWindow.mockResolvedValue(undefined);
    mockActivateRoundMatchLobby.mockResolvedValue(undefined);

    const io = makeMockIo();
    await runPreviewCheck(io);
    expect(mockActivateRoundMatchLobby).toHaveBeenCalledTimes(2);
    expect(mockActivateRoundMatchLobby).toHaveBeenCalledWith('t-001', 2, MATCHES[0], io);
    expect(mockActivateRoundMatchLobby).toHaveBeenCalledWith('t-001', 2, MATCHES[1], io);
  });

  it('logs error per match but continues when one activation fails', async () => {
    mockGetExpiredPreviews.mockResolvedValue([{
      tournamentId: 't-001', round: 1, expiresAt: Date.now() - 1000, matches: MATCHES,
    }]);
    mockClearPreviewWindow.mockResolvedValue(undefined);
    mockActivateRoundMatchLobby
      .mockRejectedValueOnce(new Error('Lobby creation failed'))
      .mockResolvedValueOnce(undefined);

    const io = makeMockIo();
    await runPreviewCheck(io);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Round preview activation failed'));
    expect(mockActivateRoundMatchLobby).toHaveBeenCalledTimes(2);
  });
});
