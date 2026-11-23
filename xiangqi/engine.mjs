import { RED, colOf, legalMoves, makeMove, otherSide, pieceSide, rowOf, unmakeMove } from './rules.mjs';

const MATERIAL = { r: 900, n: 408, b: 205, a: 205, k: 0, c: 455, p: 100 };
const MATE = 100_000;
const EXHAUSTED = Symbol('search budget exhausted');
const LIMITS = {
  quiet: { depth: 2, milliseconds: 90, visits: 4500 },
  strong: { depth: 4, milliseconds: 220, visits: 18000 }
};

function valueOf(piece) {
  if (!piece) return 0;
  return piece.toLowerCase() === 'k' ? MATE : MATERIAL[piece.toLowerCase()];
}

function evaluate(board, side) {
  let score = 0;
  for (const [square, piece] of board.entries()) {
    if (!piece) continue;
    const owner = pieceSide(piece);
    const advance = owner === RED ? 9 - rowOf(square) : rowOf(square);
    const centre = 4 - Math.abs(colOf(square) - 4);
    const type = piece.toLowerCase();
    let field = 0;
    if (type === 'p') field = advance * 8 + (advance >= 5 ? 25 + centre * 5 : 0);
    if (type === 'n') field = centre * 8 + Math.min(advance, 6) * 4;
    if (type === 'c') field = centre * 6 + Math.min(advance, 5) * 2;
    if (type === 'r') field = centre * 4 + Math.min(advance, 6) * 2;
    score += (owner === side ? 1 : -1) * (MATERIAL[type] + field);
  }
  return score;
}

function ranked(board, moves, preferred) {
  return moves.map(move => ({
    move,
    score: move === preferred ? MATE * 10 : board[move.to] ? valueOf(board[move.to]) * 10 - valueOf(board[move.from]) : 4 - Math.abs(colOf(move.to) - 4)
  })).sort((left, right) => right.score - left.score).map(item => item.move);
}

export function chooseMove(position, side, level = 'quiet') {
  const board = [...position];
  const limits = LIMITS[level] ?? LIMITS.quiet;
  const deadline = performance.now() + limits.milliseconds;
  const moves = legalMoves(board, side);
  if (moves.length === 0) return null;
  let best = ranked(board, moves)[0];
  let visits = 0;

  function scoreMove(move, actor, depth, alpha, beta, ply) {
    const captured = makeMove(board, move);
    try { return -search(otherSide(actor), depth, -beta, -alpha, ply); }
    finally { unmakeMove(board, move, captured); }
  }

  function search(actor, depth, alpha, beta, ply) {
    if (++visits > limits.visits || (visits % 32 === 0 && performance.now() > deadline)) throw EXHAUSTED;
    if (depth === 0) {
      if (!legalMoves(board, actor, true).length) return -MATE + ply;
      return evaluate(board, actor);
    }
    const replies = ranked(board, legalMoves(board, actor));
    if (!replies.length) return -MATE + ply;
    let value = -Infinity;
    for (const reply of replies) {
      value = Math.max(value, scoreMove(reply, actor, depth - 1, alpha, beta, ply + 1));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  for (let depth = 1; depth <= limits.depth; depth++) {
    let alpha = -Infinity;
    let leading = best;
    try {
      for (const move of ranked(board, moves, best)) {
        const value = scoreMove(move, side, depth - 1, alpha, Infinity, 1);
        if (value > alpha) { alpha = value; leading = move; }
      }
    } catch (error) {
      if (error !== EXHAUSTED) throw error;
      break;
    }
    best = leading;
    if (Math.abs(alpha) > MATE - 100) break;
  }
  return best;
}
