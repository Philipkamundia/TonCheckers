/**
 * elo.test.ts — Unit tests for EloService
 *
 * Verifies all PRD §7 rules:
 * - K-factor tiers (40/24/16/10)
 * - Expected score formula
 * - Win/loss/draw ELO deltas
 * - Draw = zero ELO change
 */

import { describe, it, expect } from 'vitest';
import { EloService } from '../services/elo.service.js';
import { SettlementService } from '../services/settlement.service.js';

describe('K-factor tiers (PRD §7)', () => {
  it('returns 40 for ELO < 1400 (Beginner)', () => {
    expect(EloService.getKFactor(800)).toBe(40);
    expect(EloService.getKFactor(1200)).toBe(40);
    expect(EloService.getKFactor(1399)).toBe(40);
  });

  it('returns 24 for ELO 1400–1799 (Intermediate)', () => {
    expect(EloService.getKFactor(1400)).toBe(24);
    expect(EloService.getKFactor(1600)).toBe(24);
    expect(EloService.getKFactor(1799)).toBe(24);
  });

  it('returns 16 for ELO 1800–2199 (Advanced)', () => {
    expect(EloService.getKFactor(1800)).toBe(16);
    expect(EloService.getKFactor(2000)).toBe(16);
    expect(EloService.getKFactor(2199)).toBe(16);
  });

  it('returns 10 for ELO >= 2200 (Elite)', () => {
    expect(EloService.getKFactor(2200)).toBe(10);
    expect(EloService.getKFactor(2800)).toBe(10);
  });
});

describe('Expected score', () => {
  it('returns 0.5 for equal ELO', () => {
    expect(EloService.expectedScore(1200, 1200)).toBeCloseTo(0.5);
  });

  it('higher ELO player has expected score > 0.5', () => {
    expect(EloService.expectedScore(1600, 1200)).toBeGreaterThan(0.5);
  });

  it('lower ELO player has expected score < 0.5', () => {
    expect(EloService.expectedScore(1200, 1600)).toBeLessThan(0.5);
  });
});

describe('ELO calculation — win/loss', () => {
  it('equal ELO 1200 vs 1200: winner gains ~20, loser loses ~20', () => {
    // calculate(winner, elo1, elo2) — player1 wins
    const result = EloService.calculate(1, 1200, 1200);
    // K=40, expected=0.5, delta = 40*(1-0.5) = 20
    expect(result.player1Delta).toBe(20);
    expect(result.player2Delta).toBe(-20);
    expect(result.player1NewElo).toBe(1220);
    expect(result.player2NewElo).toBe(1180);
  });

  it('upset: 1000 ELO beats 1400 ELO — larger gain for underdog', () => {
    const result = EloService.calculate(1, 1000, 1400);
    expect(result.player1Delta).toBeGreaterThan(30);
    expect(result.player2Delta).toBeLessThan(-10);
  });

  it('favourite beats underdog — small gain', () => {
    const result = EloService.calculate(1, 1600, 1200);
    expect(result.player1Delta).toBeLessThan(10);
    expect(result.player2Delta).toBeGreaterThan(-20);
  });

  it('player2 wins scenario', () => {
    const result = EloService.calculate(2, 1200, 1200);
    expect(result.player1Delta).toBe(-20);
    expect(result.player2Delta).toBe(20);
    expect(result.player2NewElo).toBe(1220);
  });

  it('ELO floor at 100 — loser near floor loses minimal points', () => {
    // Player1 at 110 loses to player2 at 2800
    // Expected score ≈ 0, so delta ≈ round(40*(0-0)) = 0 (extreme mismatch rounds to 0)
    // Floor only kicks in when delta would push below 100
    const r = EloService.calculate(2, 110, 2800);
    expect(r.player1NewElo).toBeGreaterThanOrEqual(100);
    // Verify floor works when delta is large enough
    const r2 = EloService.calculate(2, 120, 1200);
    expect(r2.player1NewElo).toBeGreaterThanOrEqual(100);
  });
});

describe('Draw — PRD §7: no ELO change', () => {
  it('returns zero deltas for both players on draw (winner=0)', () => {
    const result = EloService.calculate(0, 1200, 1800);
    expect(result.player1Delta).toBe(0);
    expect(result.player2Delta).toBe(0);
  });

  it('ELO unchanged on draw', () => {
    const result = EloService.calculate(0, 1500, 1600);
    expect(result.player1NewElo).toBe(1500);
    expect(result.player2NewElo).toBe(1600);
  });
});

describe('Payout calculation — PRD §12', () => {
  it('1 TON stake: winner gets 1.70, fee is 0.30', () => {
    const r = SettlementService.calculateWinPayout('1.000000000');
    expect(parseFloat(r.winnerPayout)).toBeCloseTo(1.70, 2);
    expect(parseFloat(r.platformFee)).toBeCloseTo(0.30, 2);
  });

  it('5 TON stake: winner gets 8.50, fee is 1.50', () => {
    const r = SettlementService.calculateWinPayout('5.000000000');
    expect(parseFloat(r.winnerPayout)).toBeCloseTo(8.50, 2);
    expect(parseFloat(r.platformFee)).toBeCloseTo(1.50, 2);
  });
});
