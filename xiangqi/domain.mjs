import { chooseMove } from './engine.mjs';
import { BLACK, encodeGame, isLevel, isMode, legalMoves, newGame, notation, playMove, RED, restoreGame } from './rules.mjs';

const SAVE = 'game.json';
const RECENT_MOVES = 14;

export function createDomainRuntime({ identity = {}, broker } = {}) {
  if (typeof broker !== 'function') throw new Error('棋局需要宿主存储。');
  const listeners = new Set();
  let queue = Promise.resolve();
  let game;
  let version = 0;
  let saved = false;
  let damaged = false;

  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function load(context) {
    if (game) return;
    const result = await broker('data.read', [SAVE], context);
    if (result === null) { game = newGame(); return; }
    if (typeof result?.content !== 'string') throw new Error('宿主没有返回棋谱。');
    try {
      game = restoreGame(JSON.parse(result.content));
      saved = true;
    } catch {
      game = newGame();
      damaged = true;
    }
  }

  function snapshot() {
    const { board, turn, mode, level, flipped, check, outcome, history } = game;
    return {
      version,
      state: {
        board: [...board], turn, mode, level, flipped, check, outcome, saved, damaged,
        moves: history.length,
        recent: history.slice(-RECENT_MOVES).map(({ key: _key, ...move }) => move),
        captures: {
          red: history.filter(move => move.side === RED && move.captured).map(move => move.captured),
          black: history.filter(move => move.side === BLACK && move.captured).map(move => move.captured)
        },
        legal: damaged || outcome ? [] : legalMoves(board, turn)
      },
      availableCommands: damaged ? ['game.new'] : [
        'game.new', 'game.settings', ...(outcome ? [] : ['game.move']), ...(history.length ? ['game.undo'] : [])
      ],
      capturedAt: new Date().toISOString()
    };
  }

  async function commit(next, name, context) {
    const result = await broker('data.write', [SAVE, JSON.stringify(encodeGame(next))], context);
    if (result?.ok !== true) throw new Error('宿主未确认保存棋谱。');
    game = next;
    saved = true;
    damaged = false;
    version++;
    const event = {
      type: 'state.changed', extensionId: identity.extensionId ?? 'xiangqi',
      extensionInstanceId: identity.extensionInstanceId ?? '', workspaceId: identity.workspaceId ?? '',
      version, requestId: context?.requestId ?? 'xiangqi', actor: context?.actor === 'agent' ? 'agent' : 'human',
      payload: { action: name }
    };
    for (const listener of listeners) listener(event);
    return { ok: true, version, result: snapshot() };
  }

  return {
    getSnapshot(context) { return serialize(async () => { await load(context); return snapshot(); }); },
    query(name, _args, context) {
      return serialize(async () => {
        await load(context);
        if (name !== 'game.hint') throw new Error('未知棋局查询。');
        if (damaged || game.outcome) throw new Error('当前不能提示。');
        const move = chooseMove(game.board, game.turn, 'strong');
        return { version, move, text: move ? notation(game.board, move) : null };
      });
    },
    execute(name, args, context) {
      return serialize(async () => {
        await load(context);
        if (args?.expected !== version) throw new Error('棋局已更新，请重试。');
        if (damaged && name !== 'game.new') throw new Error('旧棋谱无法读取，请确认后开新局。');
        let next;
        switch (name) {
          case 'game.move': {
            next = playMove(game, { from: args.from, to: args.to });
            if (next.mode === 'computer' && !next.outcome) {
              const reply = chooseMove(next.board, BLACK, next.level);
              if (!reply) throw new Error('没有找到黑方应手。');
              next = playMove(next, reply);
            }
            break;
          }
          case 'game.undo': {
            if (!game.history.length) throw new Error('还没有可悔的棋。');
            const plies = game.mode === 'computer' && game.turn === RED ? 2 : 1;
            const record = encodeGame(game);
            next = restoreGame({ ...record, moves: record.moves.slice(0, -plies) });
            break;
          }
          case 'game.new':
            if (!isMode(args.mode)) throw new Error('无效的对弈方式。');
            next = newGame({ ...game, mode: args.mode });
            break;
          case 'game.settings':
            if ((args.level !== undefined && !isLevel(args.level)) || (args.flipped !== undefined && typeof args.flipped !== 'boolean')) {
              throw new Error('无效的棋局设置。');
            }
            next = { ...game, level: args.level ?? game.level, flipped: args.flipped ?? game.flipped };
            break;
          default: throw new Error('未知棋局操作。');
        }
        return commit(next, name, context);
      });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { listeners.clear(); }
  };
}
