/**
 * EloService — Dynamic K-factor ELO (PRD §7)
 *
 * K-factor tiers:
 *   ELO < 1400    → K=40  (Beginner)
 *   1400–1800     → K=24  (Intermediate)
 *   1800–2200     → K=16  (Advanced)
 *   > 2200        → K=10  (Elite)
 *
 * Special cases (PRD §7):
 *   Draw          → no ELO change
 *   Server crash  → no ELO change
 */

export interface EloResult {
  player1NewElo: number;
  player2NewElo: number;
  player1Delta:  number;
  player2Delta:  number;
}

export class EloService {

  static getKFactor(elo: number): number {
    if (elo < 1400) return 40;
    if (elo < 1800) return 24;
    if (elo < 2200) return 16;
    return 10;
  }

  /** Standard ELO expected score formula */
  static expectedScore(eloA: number, eloB: number): number {
    return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  }

  /**
   * Calculate new ELOs after a game.
   * winner: 1 | 2 (player number) or 0 for draw
   */
  static calculate(winner: 0 | 1 | 2, elo1: number, elo2: number): EloResult {
    // PRD §7: draw → no change
    if (winner === 0) {
      return { player1NewElo: elo1, player2NewElo: elo2, player1Delta: 0, player2Delta: 0 };
    }

    const k1 = EloService.getKFactor(elo1);
    const k2 = EloService.getKFactor(elo2);
    const e1 = EloService.expectedScore(elo1, elo2);
    const e2 = EloService.expectedScore(elo2, elo1);

    const s1 = winner === 1 ? 1 : 0;
    const s2 = winner === 2 ? 1 : 0;

    const d1 = Math.round(k1 * (s1 - e1));
    const d2 = Math.round(k2 * (s2 - e2));

    // ELO floor: 100
    const newElo1 = Math.max(100, elo1 + d1);
    const newElo2 = Math.max(100, elo2 + d2);

    return {
      player1NewElo: newElo1,
      player2NewElo: newElo2,
      player1Delta:  newElo1 - elo1,
      player2Delta:  newElo2 - elo2,
    };
  }
}
