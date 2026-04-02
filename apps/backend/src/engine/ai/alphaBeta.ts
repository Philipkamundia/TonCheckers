/**
 * alphaBeta.ts — Master AI
 * Alpha-beta pruning to depth 8 with enhanced positional evaluation.
 * PRD §8: Master difficulty level — plays competitively
 */

import { Board, Player, Move, Square, P1, P2, P1_KING, P2_KING } from '../board.js';
import { getAvailableMoves } from '../moves.js';
import { applyMoveWithPromotion } from '../rules.js';
import { checkWinCondition } from '../conditions.js';
import { hashBoardState } from '../hash.js';

const AB_DEPTH = 8;

function evaluateEnhanced(board: Board, player: Player): number {
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c] as Square;
      if (sq === 0) continue;

      const isPlayer1Piece = sq === P1 || sq === P1_KING;
      const isPlayer2Piece = sq === P2 || sq === P2_KING;
      const isKingPiece    = sq === P1_KING || sq === P2_KING;
      const sign           = (isPlayer1Piece && player === 1) || (isPlayer2Piece && player === 2) ? 1 : -1;

      let pieceScore = isKingPiece ? 3.0 : 1.0;

      if (!isKingPiece) {
        const advancementRow = isPlayer1Piece ? (7 - r) : r;
        pieceScore += advancementRow * 0.05;
      }

      if (r >= 2 && r <= 5 && c >= 2 && c <= 5) {
        pieceScore += 0.1;
      }

      if ((isPlayer1Piece && r === 7) || (isPlayer2Piece && r === 0)) {
        pieceScore += 0.15;
      }

      if (isKingPiece) {
        const directions = [[-1,-1],[-1,1],[1,-1],[1,1]];
        let mobility = 0;
        for (const [dr, dc] of directions) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === 0) mobility++;
        }
        pieceScore += mobility * 0.05;
      }

      score += sign * pieceScore;
    }
  }

  return score;
}

function alphaBeta(
  board:    Board,
  player:   Player,
  aiPlayer: Player,
  depth:    number,
  alpha:    number,
  beta:     number,
  history:  string[],
): number {
  const result = checkWinCondition(board, player, history);
  if (result.status === 'win')  return result.winner === aiPlayer ? 10000 : -10000;
  if (result.status === 'draw') return 0;
  if (depth === 0)              return evaluateEnhanced(board, aiPlayer);

  const moves    = getAvailableMoves(board, player);
  const isMaxing = player === aiPlayer;

  if (!moves.length) return isMaxing ? -10000 : 10000;

  const ordered = [...moves].sort((a, b) => b.captures.length - a.captures.length);

  if (isMaxing) {
    let best = -Infinity;
    for (const move of ordered) {
      const newBoard   = applyMoveWithPromotion(board, move);
      const nextPlayer: Player = player === 1 ? 2 : 1;
      const newHash    = hashBoardState(newBoard, nextPlayer);
      const score      = alphaBeta(newBoard, nextPlayer, aiPlayer, depth - 1, alpha, beta, [...history, newHash]);
      best  = Math.max(best, score);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of ordered) {
      const newBoard   = applyMoveWithPromotion(board, move);
      const nextPlayer: Player = player === 1 ? 2 : 1;
      const newHash    = hashBoardState(newBoard, nextPlayer);
      const score      = alphaBeta(newBoard, nextPlayer, aiPlayer, depth - 1, alpha, beta, [...history, newHash]);
      best = Math.min(best, score);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

export function alphaBetaMove(board: Board, aiPlayer: Player): Move | null {
  const moves = getAvailableMoves(board, aiPlayer);
  if (!moves.length) return null;

  let bestMove  = moves[0];
  let bestScore = -Infinity;
  // alpha and beta must be mutable for the root loop
  let alpha = -Infinity;
  const beta  = Infinity;

  const ordered = [...moves].sort((a, b) => b.captures.length - a.captures.length);

  for (const move of ordered) {
    const newBoard   = applyMoveWithPromotion(board, move);
    const nextPlayer: Player = aiPlayer === 1 ? 2 : 1;
    const newHash    = hashBoardState(newBoard, nextPlayer);
    const score      = alphaBeta(newBoard, nextPlayer, aiPlayer, AB_DEPTH - 1, alpha, beta, [newHash]);
    if (score > bestScore) {
      bestScore = score;
      bestMove  = move;
    }
    alpha = Math.max(alpha, bestScore);
  }

  return bestMove;
}
