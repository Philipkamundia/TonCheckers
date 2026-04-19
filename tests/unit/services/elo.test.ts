/**
 * tests/unit/services/elo.test.ts
 *
 * EloService — PRD §7 Dynamic K-factor ELO
 * 100% branch coverage required.
 */

import { describe, it, expect } from 'vitest';
import { EloService } from '../../../apps/backend/src/services/elo.service.js';

describe('EloService', () => {

  // ─── K-factor tier boundaries ─────────────────────────────────────────────

  describe('getKFactor', () => {
    it('returns K=40 for beginner (ELO < 1400)', () => {
      expect(EloService.getKFactor(100)).toBe(40);
      expect(EloService.getKFactor(1199)).toBe(40);
      expect(EloService.getKFactor(1399)).toBe(40);
    });

    it('returns K=24 for intermediate (1400 ≤ ELO < 1800)', () => {
      expect(EloService.getKFactor(1400)).toBe(24);
      expect(EloService.getKFactor(1600)).toBe(24);
      expect(EloService.getKFactor(1799)).toBe(24);
    });

    it('returns K=16 for advanced (1800 ≤ ELO < 2200)', () => {
      expect(EloService.getKFactor(1800)).toBe(16);
      expect(EloService.getKFactor(2000)).toBe(16);
      expect(EloService.getKFactor(2199)).toBe(16);
    });

    it('returns K=10 for elite (ELO ≥ 2200)', () => {
      expect(EloService.getKFactor(2200)).toBe(10);
      expect(EloService.getKFactor(3000)).toBe(10);
    });
  });

  // ─── Expected score formula ───────────────────────────────────────────────

  describe('expectedScore', () => {
    it('returns 0.5 for equal ELO', () => {
      expect(EloService.expectedScore(1200, 1200)).toBeCloseTo(0.5, 5);
    });

    it('returns > 0.5 when eloA > eloB (favourite)', () => {
      const score = EloService.expectedScore(1600, 1200);
      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThan(1);
    });

    it('returns < 0.5 when eloA < eloB (underdog)', () => {
      const score = EloService.expectedScore(1200, 1600);
      expect(score).toBeLessThan(0.5);
      expect(score).toBeGreaterThan(0);
    });

    it('approaches 1 for a large positive gap (400 points = 0.909)', () => {
      // Classic ELO: 400 point gap ≈ 0.909
      expect(EloService.expectedScore(1600, 1200)).toBeCloseTo(0.909, 2);
    });

    it('is symmetric: e(A,B) + e(B,A) = 1', () => {
      const eAB = EloService.expectedScore(1350, 1800);
      const eBA = EloService.expectedScore(1800, 1350);
      expect(eAB + eBA).toBeCloseTo(1, 10);
    });
  });

  // ─── Calculate — win scenarios ────────────────────────────────────────────

  describe('calculate — player1 wins (winner=1)', () => {
    it('increases winner ELO and decreases loser ELO', () => {
      const result = EloService.calculate(1, 1200, 1200);
      expect(result.player1NewElo).toBeGreaterThan(1200); // winner gains
      expect(result.player2NewElo).toBeLessThan(1200);    // loser loses
    });

    it('winner gains less when beating a much weaker opponent', () => {
      const upsetGain    = EloService.calculate(1, 1600, 1200).player1Delta; // favourite wins
      const expectedGain = EloService.calculate(1, 1200, 1600).player1Delta; // underdog wins
      expect(upsetGain).toBeLessThan(expectedGain); // upset earns more ELO
    });

    it('applies correct K-factor for each tier', () => {
      // Beginner vs beginner: K=40 each
      const beg = EloService.calculate(1, 1200, 1200);
      // Equal match → expected=0.5, delta = K*(1-0.5) = 20
      expect(beg.player1Delta).toBe(20);
      expect(beg.player2Delta).toBe(-20);
    });

    it('different K-factors for players in different tiers', () => {
      // Beginner (K=40) beats Intermediate (K=24)
      const result = EloService.calculate(1, 1200, 1500);
      expect(result.player1Delta).toBeGreaterThan(0); // beginner underdog gains
      expect(result.player2Delta).toBeLessThan(0);    // intermediate loses
      // Gains should not be equal (different K-factors)
      expect(Math.abs(result.player1Delta)).not.toBe(Math.abs(result.player2Delta));
    });
  });

  describe('calculate — player2 wins (winner=2)', () => {
    it('increases player2 ELO and decreases player1 ELO', () => {
      const result = EloService.calculate(2, 1200, 1200);
      expect(result.player2NewElo).toBeGreaterThan(1200);
      expect(result.player1NewElo).toBeLessThan(1200);
    });

    it('is symmetric: p1-wins vs p2-wins on equal ELO produce mirror deltas', () => {
      const p1wins = EloService.calculate(1, 1200, 1200);
      const p2wins = EloService.calculate(2, 1200, 1200);
      expect(p1wins.player1Delta).toBe(-p2wins.player1Delta);
      expect(p1wins.player2Delta).toBe(-p2wins.player2Delta);
    });
  });

  // ─── Draw (winner=0) ──────────────────────────────────────────────────────

  describe('calculate — draw (winner=0)', () => {
    it('returns zero deltas and unchanged ELO on draw (PRD §7)', () => {
      const result = EloService.calculate(0, 1500, 1800);
      expect(result.player1Delta).toBe(0);
      expect(result.player2Delta).toBe(0);
      expect(result.player1NewElo).toBe(1500);
      expect(result.player2NewElo).toBe(1800);
    });

    it('draw does not change ELO even for very different ELOs', () => {
      const result = EloService.calculate(0, 100, 3000);
      expect(result.player1NewElo).toBe(100);
      expect(result.player2NewElo).toBe(3000);
    });
  });

  // ─── ELO floor at 100 ────────────────────────────────────────────────────

  describe('ELO floor (100)', () => {
    it('does not let ELO fall below 100', () => {
      // Very weak player (100 ELO) loses to very strong — would go below floor
      const result = EloService.calculate(2, 100, 3000);
      expect(result.player1NewElo).toBe(100); // clamped at 100
    });

    it('allows ELO to stay exactly at 100 on floor', () => {
      const result = EloService.calculate(2, 102, 3000);
      expect(result.player1NewElo).toBeGreaterThanOrEqual(100);
    });
  });

  // ─── Return shape ────────────────────────────────────────────────────────

  describe('result shape', () => {
    it('delta equals newElo - originalElo for both players', () => {
      const result = EloService.calculate(1, 1400, 1600);
      expect(result.player1Delta).toBe(result.player1NewElo - 1400);
      expect(result.player2Delta).toBe(result.player2NewElo - 1600);
    });

    it('returns integer ELO values (Math.round)', () => {
      const result = EloService.calculate(1, 1350, 1750);
      expect(Number.isInteger(result.player1NewElo)).toBe(true);
      expect(Number.isInteger(result.player2NewElo)).toBe(true);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles identical ELO at every tier boundary', () => {
      for (const elo of [1400, 1800, 2200]) {
        expect(() => EloService.calculate(1, elo, elo)).not.toThrow();
      }
    });

    it('handles very large ELO gap (3000 vs 100)', () => {
      const result = EloService.calculate(2, 100, 3000); // strong beats weak
      // Loser (100) should lose 0 (already at floor)
      expect(result.player1NewElo).toBe(100);
    });
  });
});
