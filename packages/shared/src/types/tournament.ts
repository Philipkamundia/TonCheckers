// Tournament types aligned with PRD §9
// PRD: 8/16/32/64 player brackets, single elimination, 70/5/25 prize split

export type TournamentStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type BracketSize = 8 | 16 | 32 | 64;

export interface Tournament {
  id:            string;
  creatorId:     string;
  name:          string;
  status:        TournamentStatus;
  bracketSize:   BracketSize;
  entryFee:      string;  // TON as decimal string
  prizePool:     string;  // TON as decimal string
  currentRound:  number;
  startsAt:      string;  // ISO timestamp
  startedAt?:    string;
  completedAt?:  string;
  winnerId?:     string;
  createdAt:     string;
}

export interface TournamentParticipant {
  id:           string;
  tournamentId: string;
  userId:       string;
  seedElo:      number;
  isEliminated: boolean;
  receivedBye:  boolean;
  currentRound: number;
  joinedAt:     string;
}

export interface TournamentMatch {
  id:           string;
  tournamentId: string;
  gameId?:      string;
  round:        number;
  matchNumber:  number;
  player1Id?:   string;
  player2Id?:   string;
  winnerId?:    string;
  isBye:        boolean;
  createdAt:    string;
}

// Prize distribution — PRD §9
export const TOURNAMENT_PRIZE_SPLIT = {
  winner:   0.70,  // 70%
  creator:  0.05,  // 5%
  platform: 0.25,  // 25%
} as const;
