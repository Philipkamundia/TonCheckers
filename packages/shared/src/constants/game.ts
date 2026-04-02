// Game configuration constants — PRD §5, §6, §7
export const GAME_CONFIG = {
  BOARD_SIZE: 8,
  INITIAL_PIECES_PER_PLAYER: 12,
  KING_ROW: {
    RED: 0,
    BLACK: 7,
  },
  DISCONNECT_TIMEOUT:       30_000,  // 30 seconds — PRD §6
  MOVE_TIMEOUT:             30_000,  // 30 seconds per move — PRD §6
  MAX_MOVES_WITHOUT_CAPTURE: 50,
  REPEATED_POSITION_LIMIT:  25,      // PRD §5: draw at 25 repetitions
} as const;

// Stakes configuration (in TON)
export const STAKE_OPTIONS = ['0.1', '0.5', '1', '2', '5', '10'] as const;

// ELO rating system — PRD §7
export const ELO_CONFIG = {
  DEFAULT_RATING:        1200,  // PRD §7: starting ELO
  MIN_RATING:            100,   // PRD §7: ELO floor
  MAX_RATING:            3000,
  K_FACTOR_BEGINNER:     40,    // ELO < 1400
  K_FACTOR_INTERMEDIATE: 24,    // 1400–1800
  K_FACTOR_ADVANCED:     16,    // 1800–2200
  K_FACTOR_ELITE:        10,    // > 2200
} as const;

// Matchmaking configuration — PRD §6
export const MATCHMAKING_CONFIG = {
  ELO_RANGE_INITIAL:   100,
  ELO_RANGE_EXPANSION: 50,      // Expand every 30s
  LOBBY_COUNTDOWN_MS:  10_000,  // 10-second lobby countdown
} as const;

// Platform fees — PRD §12, §9
export const PLATFORM_FEES = {
  GAME_FEE:       0.15,  // 15% of prize pool (PRD §12)
  TOURNAMENT_FEE: 0.25,  // 25% of prize pool (PRD §9)
  CREATOR_FEE:    0.05,  // 5% to tournament creator (PRD §9)
  WITHDRAWAL_FEE: 0.00,  // No withdrawal fee
} as const;
