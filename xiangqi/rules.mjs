export const RED = 'red';
export const BLACK = 'black';
export const FILES = 9;
export const RANKS = 10;
export const SQUARES = FILES * RANKS;

const TYPES = 'rnbakcp';
const CHINESE = '零一二三四五六七八九';
const PIECE_NAMES = { r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒', B: '相', A: '仕', K: '帅', P: '兵' };
const MAX_QUIET_PLIES = 100;

export const otherSide = side => side === RED ? BLACK : RED;
export const pieceSide = piece => !piece ? null : piece === piece.toUpperCase() ? RED : BLACK;
export const rowOf = square => Math.floor(square / FILES);
export const colOf = square => square % FILES;
export const at = (row, col) => row * FILES + col;
const isSquare = square => Number.isInteger(square) && square >= 0 && square < SQUARES;
const inPalace = (row, col, side) => col >= 3 && col <= 5 && (side === RED ? row >= 7 : row <= 2);
const crossedRiver = (row, side) => side === RED ? row <= 4 : row >= 5;

const candidates = Array.from({ length: SQUARES }, (_, from) => {
  const targets = Object.fromEntries([...TYPES].map(type => [type, []]));
  for (let to = 0; to < SQUARES; to++) {
    if (from === to) continue;
    const rows = Math.abs(rowOf(to) - rowOf(from));
    const cols = Math.abs(colOf(to) - colOf(from));
    if (!rows || !cols) { targets.r.push(to); targets.c.push(to); }
    if (rows + cols === 3 && rows && cols) targets.n.push(to);
    if (rows === 2 && cols === 2) targets.b.push(to);
    if (rows === 1 && cols === 1) targets.a.push(to);
    if (!cols || rows + cols === 1) targets.k.push(to);
    if (rows + cols === 1) targets.p.push(to);
  }
  return targets;
});

export function initialBoard() {
  const board = Array(SQUARES).fill(null);
  board.splice(0, FILES, ...'rnbakabnr');
  board.splice(81, FILES, ...'RNBAKABNR');
  for (const file of [1, 7]) { board[at(2, file)] = 'c'; board[at(7, file)] = 'C'; }
  for (const file of [0, 2, 4, 6, 8]) { board[at(3, file)] = 'p'; board[at(6, file)] = 'P'; }
  return board;
}

function screens(board, from, to) {
  const step = rowOf(from) === rowOf(to) ? Math.sign(to - from) : Math.sign(to - from) * FILES;
  let count = 0;
  for (let square = from + step; square !== to; square += step) {
    if (board[square] && ++count > 1) break;
  }
  return count;
}

function reaches(board, from, to, piece) {
  const side = pieceSide(piece);
  const row = rowOf(from), col = colOf(from);
  const targetRow = rowOf(to), targetCol = colOf(to);
  const dr = targetRow - row, dc = targetCol - col;
  const rows = Math.abs(dr), cols = Math.abs(dc);
  switch (piece.toLowerCase()) {
    case 'r': return (!rows || !cols) && screens(board, from, to) === 0;
    case 'c': return (!rows || !cols) && screens(board, from, to) === (board[to] ? 1 : 0);
    case 'n':
      return rows + cols === 3 && rows > 0 && cols > 0 &&
        !board[at(row + (rows === 2 ? Math.sign(dr) : 0), col + (cols === 2 ? Math.sign(dc) : 0))];
    case 'b': return rows === 2 && cols === 2 && !crossedRiver(targetRow, side) && !board[at(row + dr / 2, col + dc / 2)];
    case 'a': return rows === 1 && cols === 1 && inPalace(targetRow, targetCol, side);
    case 'k':
      return (rows + cols === 1 && inPalace(targetRow, targetCol, side)) ||
        (!cols && board[to] === (side === RED ? 'k' : 'K') && screens(board, from, to) === 0);
    case 'p': return (!cols && dr === (side === RED ? -1 : 1)) || (!rows && cols === 1 && crossedRiver(row, side));
    default: return false;
  }
}

export function inCheck(board, side) {
  const king = board.indexOf(side === RED ? 'K' : 'k');
  if (king === -1) return true;
  const enemy = otherSide(side);
  return board.some((piece, from) => pieceSide(piece) === enemy && reaches(board, from, king, piece));
}

export function makeMove(board, { from, to }) {
  const captured = board[to];
  board[to] = board[from];
  board[from] = null;
  return captured;
}

export function unmakeMove(board, { from, to }, captured) {
  board[from] = board[to];
  board[to] = captured;
}

export function isLegalMove(board, side, from, to) {
  if (!isSquare(from) || !isSquare(to) || from === to) return false;
  const piece = board[from];
  if (!piece || pieceSide(piece) !== side || pieceSide(board[to]) === side || !reaches(board, from, to, piece)) return false;
  const move = { from, to };
  const captured = makeMove(board, move);
  const legal = !inCheck(board, side);
  unmakeMove(board, move, captured);
  return legal;
}

export function legalMoves(board, side, firstOnly = false) {
  const moves = [];
  if (!board.includes(side === RED ? 'K' : 'k')) return moves;
  for (let from = 0; from < SQUARES; from++) {
    const piece = board[from];
    if (pieceSide(piece) !== side) continue;
    for (const to of candidates[from][piece.toLowerCase()]) {
      if (!isLegalMove(board, side, from, to)) continue;
      moves.push({ from, to });
      if (firstOnly) return moves;
    }
  }
  return moves;
}

export function notation(board, { from, to }) {
  const piece = board[from];
  const side = pieceSide(piece);
  const type = piece.toLowerCase();
  const numeral = number => side === RED ? CHINESE[number] : String(number);
  const file = square => numeral(side === RED ? FILES - colOf(square) : colOf(square) + 1);
  const sameFile = board.flatMap((item, square) => item === piece && colOf(square) === colOf(from) ? [square] : []);
  if (side === BLACK) sameFile.reverse();
  const index = sameFile.indexOf(from);
  const position = index === 0 ? '前' : index === sameFile.length - 1 ? '后' : sameFile.length === 3 ? '中' : numeral(index + 1);
  const name = PIECE_NAMES[piece] ?? PIECE_NAMES[type];
  const start = sameFile.length > 1 && 'rncp'.includes(type) ? position + name : name + file(from);
  const dr = rowOf(to) - rowOf(from);
  if (dr === 0) return `${start}平${file(to)}`;
  const direction = (side === RED ? dr < 0 : dr > 0) ? '进' : '退';
  return `${start}${direction}${colOf(from) === colOf(to) ? numeral(Math.abs(dr)) : file(to)}`;
}

const keyOf = (board, side) => `${side}:${board.map(piece => piece ?? '.').join('')}`;
const INITIAL_KEY = keyOf(initialBoard(), RED);

export function newGame({ mode = 'computer', level = 'quiet', flipped = false } = {}) {
  return { mode, level, flipped, board: initialBoard(), turn: RED, history: [], quietPlies: 0, check: false, outcome: null };
}

export function positionOutcome(board, turn, history, quietPlies) {
  if (!legalMoves(board, turn, true).length) return { winner: otherSide(turn), reason: inCheck(board, turn) ? 'mate' : 'stalemate' };
  const position = keyOf(board, turn);
  const repeats = position === INITIAL_KEY ? [0] : [];
  for (const [index, move] of history.entries()) {
    if (move.key === position) repeats.push(index + 1);
  }
  if (repeats.length >= 4) {
    const sequence = history.slice(repeats.at(-4));
    const alwaysChecks = side => sequence.filter(move => move.side === side).every(move => move.check);
    const redChecking = alwaysChecks(RED), blackChecking = alwaysChecks(BLACK);
    if (redChecking !== blackChecking) return { winner: redChecking ? BLACK : RED, reason: 'perpetual-check' };
    return { winner: null, reason: 'repetition' };
  }
  if (quietPlies >= MAX_QUIET_PLIES) return { winner: null, reason: 'quiet-limit' };
  return null;
}

export function playMove(game, move) {
  if (game.outcome) throw new Error('本局已经结束。');
  const board = [...game.board];
  if (!isLegalMove(board, game.turn, move.from, move.to)) throw new Error('这步棋不合法。');
  const text = notation(board, move);
  const piece = board[move.from];
  const captured = makeMove(board, move);
  const turn = otherSide(game.turn);
  const check = inCheck(board, turn);
  const history = [...game.history, { ...move, piece, captured, side: game.turn, text, check, key: keyOf(board, turn) }];
  const quietPlies = captured ? 0 : game.quietPlies + 1;
  return { ...game, board, turn, history, quietPlies, check, outcome: positionOutcome(board, turn, history, quietPlies) };
}

export const isMode = value => value === 'computer' || value === 'local';
export const isLevel = value => value === 'quiet' || value === 'strong';

export function encodeGame(game) {
  return { format: 1, mode: game.mode, level: game.level, flipped: game.flipped, moves: game.history.map(({ from, to }) => [from, to]) };
}

export function restoreGame(record) {
  if (record?.format !== 1 || !isMode(record.mode) || !isLevel(record.level) ||
      typeof record.flipped !== 'boolean' || !Array.isArray(record.moves) || record.moves.length > 3100) {
    throw new Error('棋谱格式不受支持。');
  }
  let game = newGame(record);
  for (const move of record.moves) {
    if (!Array.isArray(move) || move.length !== 2) throw new Error('棋谱包含无效着法。');
    game = playMove(game, { from: move[0], to: move[1] });
  }
  if (game.mode === 'computer' && game.turn === BLACK && !game.outcome) throw new Error('棋谱缺少黑方应手。');
  return game;
}
