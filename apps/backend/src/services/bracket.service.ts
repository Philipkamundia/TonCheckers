/**
 * BracketService — Bracket generation and round advancement (PRD §9)
 *
 * - Single elimination, sizes: 8/16/32/64
 * - Incomplete: top ELO players get byes, rest are paired by closest ELO
 * - Prize split: 70% winner / 5% creator / 25% platform
 */

export interface BracketPlayer {
  userId:  string;
  seedElo: number;
}

export interface BracketMatch {
  round:       number;
  matchNumber: number;
  player1Id:   string | null;
  player2Id:   string | null;
  isBye:       boolean;
}

export class BracketService {

  /**
   * Generate Round 1 bracket.
   *
   * PRD §9 incomplete bracket example:
   *   16-bracket, 12 players:
   *   byes = 16 - 12 = 4  → top 4 ELO skip R1
   *   R1 players = 12 - 4 = 8  → 4 R1 matches
   */
  static generateRound1(
    players:     BracketPlayer[],
    bracketSize: number,
  ): { matches: BracketMatch[]; byePlayers: string[] } {
    const sorted = [...players].sort((a, b) => b.seedElo - a.seedElo);
    const n      = sorted.length;
    if (n <= 1) {
      const byePlayers = sorted.map(p => p.userId);
      const matches = byePlayers.map((userId, idx) => ({
        round: 1,
        matchNumber: idx + 1,
        player1Id: userId,
        player2Id: null,
        isBye: true,
      }));
      return { matches, byePlayers };
    }

    // byeCount = how many top-seeded players skip R1.
    // Rules:
    //   1. Never more byes than (n - 2), so at least 2 players always play R1.
    //   2. r1Players count (n - byeCount) must be even so everyone is paired.
    let byeCount = Math.max(0, bracketSize - n);
    byeCount     = Math.min(byeCount, n - 2);          // rule 1
    if ((n - byeCount) % 2 !== 0) byeCount--;          // rule 2 — reduce by 1 to make even
    byeCount     = Math.max(0, byeCount);               // clamp to 0

    const byePlayers = sorted.slice(0, byeCount).map(p => p.userId);
    const r1Players  = sorted.slice(byeCount);

    const matches: BracketMatch[] = [];
    let matchNum = 1;

    // Pair R1 players — adjacent in ELO-sorted order = closest ELO pairing
    for (let i = 0; i < r1Players.length; i += 2) {
      matches.push({
        round: 1, matchNumber: matchNum++,
        player1Id: r1Players[i]?.userId   ?? null,
        player2Id: r1Players[i+1]?.userId ?? null,
        isBye: false,
      });
    }

    // Bye entries — player advances without a game
    for (const userId of byePlayers) {
      matches.push({
        round: 1, matchNumber: matchNum++,
        player1Id: userId, player2Id: null, isBye: true,
      });
    }

    return { matches, byePlayers };
  }

  /** Generate subsequent round matches from a list of advancing winners */
  static generateNextRound(winners: string[], round: number): BracketMatch[] {
    const matches: BracketMatch[] = [];
    let matchNum = 1;
    for (let i = 0; i < winners.length; i += 2) {
      matches.push({
        round, matchNumber: matchNum++,
        player1Id: winners[i]     ?? null,
        player2Id: winners[i + 1] ?? null,
        isBye: !winners[i + 1],
      });
    }
    return matches;
  }

  /** log2(bracketSize) — e.g. 8→3, 16→4, 32→5, 64→6 */
  static totalRounds(bracketSize: number): number {
    return Math.log2(bracketSize);
  }

  /** PRD §9: 70% winner / 5% creator / 25% platform */
  static calculatePrizes(prizePool: string) {
    const p = parseFloat(prizePool);
    return {
      winnerPayout:  (p * 0.70).toFixed(9),
      creatorPayout: (p * 0.05).toFixed(9),
      platformFee:   (p * 0.25).toFixed(9),
    };
  }
}
