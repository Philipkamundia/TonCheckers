import { z } from 'zod';

// Player status
export enum PlayerStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  IN_GAME = 'in_game',
  SEARCHING = 'searching'
}

// Tournament badge types
export enum BadgeType {
  TOURNAMENT_WINNER = 'tournament_winner',
  TOURNAMENT_RUNNER_UP = 'tournament_runner_up',
  WIN_STREAK = 'win_streak',
  HIGH_ELO = 'high_elo'
}

// Tournament badge
export const TournamentBadgeSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(BadgeType),
  title: z.string(),
  description: z.string(),
  earnedAt: z.date(),
  tournamentId: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

export type TournamentBadge = z.infer<typeof TournamentBadgeSchema>;

// Player statistics
export const PlayerStatsSchema = z.object({
  gamesPlayed: z.number().default(0),
  gamesWon: z.number().default(0),
  gamesLost: z.number().default(0),
  gamesDrawn: z.number().default(0),
  winRate: z.number().default(0),
  currentWinStreak: z.number().default(0),
  longestWinStreak: z.number().default(0),
  elo: z.number().default(1200),
  totalEarnings: z.string().default('0'), // TON amount as string
  tournamentsWon: z.number().default(0),
  tournamentsParticipated: z.number().default(0)
});

export type PlayerStats = z.infer<typeof PlayerStatsSchema>;

// Player
export const PlayerSchema = z.object({
  id: z.string(),
  username: z.string(),
  walletAddress: z.string(),
  avatarUrl: z.string().optional(),
  balance: z.string().default('0'), // TON amount as string
  status: z.nativeEnum(PlayerStatus).default(PlayerStatus.OFFLINE),
  stats: PlayerStatsSchema,
  badges: z.array(TournamentBadgeSchema).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastActiveAt: z.date().optional()
});

export type Player = z.infer<typeof PlayerSchema>;
