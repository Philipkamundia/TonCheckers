/**
 * tests/unit/validation/validation.test.ts
 *
 * Zod schema validation — auth, gameState, tournament.
 */

import { describe, it, expect } from 'vitest';
import { ConnectWalletSchema, VerifyInitDataSchema, RefreshTokenSchema } from '../../../apps/backend/src/validation/auth.js';
import { parseGameState, assertGameState } from '../../../apps/backend/src/validation/gameState.js';
import { CreateTournamentSchema } from '../../../apps/backend/src/validation/tournament.js';
import { initialGameState } from '../../../apps/backend/src/engine/board.js';

// ─── ConnectWalletSchema ──────────────────────────────────────────────────────

describe('ConnectWalletSchema', () => {
  const valid = {
    walletAddress: 'EQDtestWalletAddress123',
    initData: 'query_id=abc&user=123',
    proof: {
      timestamp: 1700000000,
      domain: { value: 'localhost', lengthBytes: 9 },
      signature: 'base64sig',
      payload: 'nonce123',
    },
  };

  it('accepts valid input', () => {
    expect(ConnectWalletSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing walletAddress', () => {
    const { walletAddress: _, ...rest } = valid;
    expect(ConnectWalletSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty initData', () => {
    expect(ConnectWalletSchema.safeParse({ ...valid, initData: '' }).success).toBe(false);
  });

  it('accepts optional stateInit and publicKey in proof', () => {
    const withOptionals = { ...valid, proof: { ...valid.proof, stateInit: 'base64state', publicKey: 'abcdef' } };
    expect(ConnectWalletSchema.safeParse(withOptionals).success).toBe(true);
  });
});

describe('VerifyInitDataSchema', () => {
  it('accepts valid input', () => {
    expect(VerifyInitDataSchema.safeParse({ initData: 'query_id=abc', walletAddress: 'EQDtest123' }).success).toBe(true);
  });

  it('rejects empty initData', () => {
    expect(VerifyInitDataSchema.safeParse({ initData: '', walletAddress: 'EQDtest123' }).success).toBe(false);
  });
});

describe('RefreshTokenSchema', () => {
  it('accepts valid refresh token', () => {
    expect(RefreshTokenSchema.safeParse({ refreshToken: 'a'.repeat(20) }).success).toBe(true);
  });

  it('rejects short token', () => {
    expect(RefreshTokenSchema.safeParse({ refreshToken: 'short' }).success).toBe(false);
  });
});

// ─── parseGameState / assertGameState ────────────────────────────────────────

describe('parseGameState', () => {
  it('returns valid GameState for correct input', () => {
    const state = initialGameState();
    const result = parseGameState(state);
    expect(result).not.toBeNull();
    expect(result?.activePlayer).toBe(1);
  });

  it('returns null for null input', () => {
    expect(parseGameState(null)).toBeNull();
  });

  it('returns null for wrong board dimensions', () => {
    const bad = { board: [[0, 1]], activePlayer: 1, boardHashHistory: [], moveCount: 0 };
    expect(parseGameState(bad)).toBeNull();
  });

  it('returns null for invalid activePlayer', () => {
    const state = { ...initialGameState(), activePlayer: 3 };
    expect(parseGameState(state)).toBeNull();
  });

  it('returns null for invalid square value', () => {
    const state = initialGameState();
    const badBoard = state.board.map(row => [...row]);
    badBoard[0][0] = 9 as never; // invalid square
    expect(parseGameState({ ...state, board: badBoard })).toBeNull();
  });

  it('passes through extra fields (passthrough)', () => {
    const state = { ...initialGameState(), extraField: 'hello' };
    const result = parseGameState(state);
    expect(result).not.toBeNull();
  });
});

describe('assertGameState', () => {
  it('returns GameState for valid input', () => {
    const state = initialGameState();
    expect(() => assertGameState(state)).not.toThrow();
  });

  it('throws for invalid input', () => {
    expect(() => assertGameState(null)).toThrow('Corrupted board state');
  });
});

// ─── CreateTournamentSchema ───────────────────────────────────────────────────

describe('CreateTournamentSchema', () => {
  const valid = {
    name: 'Test Cup',
    bracketSize: 8,
    entryFee: '1.5',
    startsAt: '2026-12-01T12:00:00Z',
  };

  it('accepts valid tournament', () => {
    expect(CreateTournamentSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid bracket size', () => {
    expect(CreateTournamentSchema.safeParse({ ...valid, bracketSize: 10 }).success).toBe(false);
  });

  it('accepts all valid bracket sizes', () => {
    for (const size of [8, 16, 32, 64]) {
      expect(CreateTournamentSchema.safeParse({ ...valid, bracketSize: size }).success).toBe(true);
    }
  });

  it('rejects invalid entry fee format', () => {
    expect(CreateTournamentSchema.safeParse({ ...valid, entryFee: 'abc' }).success).toBe(false);
    expect(CreateTournamentSchema.safeParse({ ...valid, entryFee: '-1' }).success).toBe(false);
  });

  it('accepts zero entry fee', () => {
    expect(CreateTournamentSchema.safeParse({ ...valid, entryFee: '0' }).success).toBe(true);
  });

  it('rejects name shorter than 3 chars', () => {
    expect(CreateTournamentSchema.safeParse({ ...valid, name: 'ab' }).success).toBe(false);
  });
});
