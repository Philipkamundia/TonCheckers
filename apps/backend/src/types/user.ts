// User types — aligned with PRD §2 and users table schema

export interface User {
  id:            string;
  walletAddress: string;
  username:      string;
  elo:           number;
  gamesPlayed:   number;
  gamesWon:      number;
  gamesLost:     number;
  gamesDrawn:    number;
  totalWon:      string;   // NUMERIC returned as string
  totalWagered:  string;
  isBanned:      boolean;
  createdAt:     string;
  updatedAt:     string;
}

export type PublicUser = Omit<User, 'isBanned' | 'totalWagered' | 'updatedAt'>;
