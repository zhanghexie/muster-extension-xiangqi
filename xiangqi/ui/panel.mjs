const FILES = 9;
const RANKS = 10;
const LAST = FILES * RANKS - 1;
const GLYPHS = { r: '車', n: '馬', b: '象', a: '士', k: '將', c: '砲', p: '卒', R: '車', N: '馬', B: '相', A: '仕', K: '帥', C: '炮', P: '兵' };
const SIDES = { red: '红方', black: '黑方' };
const REASONS = { mate: '将死', stalemate: '困毙', 'perpetual-check': '单方长将', repetition: '重复局面', 'quiet-limit': '双方各 50 着未吃子' };
const ARROWS = new Map([['ArrowUp', [-1, 0]], ['ArrowDown', [1, 0]], ['ArrowLeft', [0, -1]], ['ArrowRight', [0, 1]]]);

const ownerOf = piece => !piece ? null : piece === piece.toUpperCase() ? 'red' : 'black';
const twoDigits = value => String(value).padStart(2, '0');

export function mountXiangqi(doc, host) {
  const byId = id => doc.getElementById(id);
  const board = byId('board');
  const modeButtons = [...doc.querySelectorAll('[data-mode]')];
  const levelButtons = [...doc.querySelectorAll('[data-level]')];
  const abort = new doc.defaultView.AbortController();
  const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: abort.signal });
  const slots = [];
  let focusIndex = 6 * FILES + 4;
  let state = null;
  let selected = null;
  let hint = null;
  let busy = '';
  let error = '';
  let note = '';
  let connected = false;
  let refreshAfter = -1;
  let renderedRecord = null;
  let unsubscribe;

  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };

  for (let row = 0; row < RANKS; row++) {
    const rail = element('div', 'board-row');
    rail.setAttribute('role', 'row');
    for (let col = 0; col < FILES; col++) {
      const cell = element('div');
      cell.setAttribute('role', 'gridcell');
      const button = element('button', 'square');
      button.type = 'button';
      button.tabIndex = -1;
      button.dataset.visual = String(slots.length);
      const piece = element('span', 'piece');
      piece.setAttribute('aria-hidden', 'true');
      button.append(piece);
      cell.append(button);
      rail.append(cell);
      slots.push({ cell, button, piece });
    }
    board.append(rail);
  }

  function slotOf(target) {
    const button = target?.closest?.('.square');
    return button && board.contains(button) ? Number(button.dataset.visual) : null;
  }

  function focusAt(index) {
    slots[focusIndex].button.tabIndex = -1;
    focusIndex = index;
    slots[focusIndex].button.tabIndex = state ? 0 : -1;
  }

  function createSeat(id) {
    const root = byId(id);
    const info = element('div', 'seat-info');
    const emblem = element('span', 'seat-emblem');
    emblem.setAttribute('aria-hidden', 'true');
    const label = element('strong');
    const role = element('span', 'seat-role');
    const captures = element('div', 'captures');
    info.append(emblem, label, role);
    root.append(info, captures);
    return { root, emblem, label, role, captures };
  }

  const topSeat = createSeat('seat-top');
  const bottomSeat = createSeat('seat-bottom');
  const rulers = [byId('ruler-top'), byId('ruler-bottom')];
  for (const ruler of rulers) {
    for (let col = 0; col < FILES; col++) ruler.append(element('span'));
  }

  function renderSeat(seat, side) {
    seat.root.dataset.side = side;
    text(seat.emblem, side === 'red' ? '帥' : '將');
    text(seat.label, SIDES[side]);
    text(seat.role, state?.mode === 'local' ? (side === 'red' ? '先行' : '后行') : (side === 'red' ? '你' : '电脑'));
    const captured = state?.captures[side] ?? [];
    seat.captures.setAttribute('aria-label', `${SIDES[side]}吃子：${captured.map(piece => GLYPHS[piece]).join('、') || '无'}`);
    seat.captures.replaceChildren(...captured.map(piece => {
      const token = element('span', '', GLYPHS[piece]);
      token.dataset.owner = ownerOf(piece);
      token.setAttribute('aria-hidden', 'true');
      return token;
    }));
  }

  function renderBoard() {
    const disabled = !state || Boolean(busy || state.outcome || state.damaged);
    board.setAttribute('aria-disabled', String(disabled));
    const last = state?.recent.at(-1);
    const destinations = new Set(state?.legal.filter(move => move.from === selected).map(move => move.to));
    for (const [visual, { cell, button, piece }] of slots.entries()) {
      const logical = state?.flipped ? LAST - visual : visual;
      const token = state?.board[logical];
      const owner = ownerOf(token);
      const targeted = destinations.has(logical);
      const active = selected === logical;
      button.dataset.square = String(logical);
      button.tabIndex = state && visual === focusIndex ? 0 : -1;
      button.toggleAttribute('data-own', !disabled && owner === state.turn);
      button.toggleAttribute('data-piece', Boolean(token));
      button.toggleAttribute('data-legal', targeted);
      button.toggleAttribute('data-hint', hint?.from === logical || hint?.to === logical);
      button.toggleAttribute('data-last', last?.from === logical || last?.to === logical);
      button.toggleAttribute('data-check', Boolean(state?.check && owner === state.turn && token?.toLowerCase() === 'k'));
      cell.setAttribute('aria-selected', String(active));
      if (token) button.setAttribute('aria-pressed', String(active));
      else button.removeAttribute('aria-pressed');
      const identity = token ? `${SIDES[owner]}${GLYPHS[token]}` : '空点';
      const coordinate = `第 ${Math.floor(visual / FILES) + 1} 行第 ${visual % FILES + 1} 列`;
      button.setAttribute('aria-label', `${coordinate}，${identity}${targeted ? '，可落子' : ''}${active ? '，已选中' : ''}`);
      piece.hidden = !token;
      if (token) { piece.dataset.owner = owner; text(piece, GLYPHS[token]); }
    }
  }

  function renderRecord() {
    if (renderedRecord === state) return;
    renderedRecord = state;
    const count = state?.moves ?? 0;
    text(byId('move-count'), `${count} 着`);
    byId('record-empty').hidden = count > 0;
    byId('record-body').hidden = count === 0;
    const rounds = new Map();
    for (const [index, move] of (state?.recent ?? []).entries()) {
      const round = Math.floor((count - state.recent.length + index) / 2) + 1;
      if (!rounds.has(round)) rounds.set(round, {});
      rounds.get(round)[move.side] = move.text + (move.check ? '＋' : '');
    }
    const moveList = byId('moves');
    moveList.replaceChildren(...Array.from(rounds, ([number, moves]) => {
      const row = element('li', 'move-row');
      row.setAttribute('aria-label', `第 ${number} 回合，红方 ${moves.red ?? '无记录'}，黑方 ${moves.black ?? '无记录'}`);
      row.append(element('span', '', twoDigits(number)), element('span', '', moves.red ?? '—'), element('span', '', moves.black ?? '—'));
      return row;
    }));
    moveList.scrollTop = moveList.scrollHeight;
  }

  function turnText() {
    if (!state) return error ? '棋局暂不可用' : '正铺开棋盘…';
    if (state.damaged) return '旧棋谱无法读取';
    if (busy === 'computer') return '黑方思考中…';
    if (state.outcome) {
      const { winner, reason } = state.outcome;
      return `${winner ? `${SIDES[winner]}胜` : '和棋'} · ${REASONS[reason]}`;
    }
    return state.check ? `${SIDES[state.turn]}被将军` : state.mode === 'computer' ? '轮到你走棋' : `轮到${SIDES[state.turn]}`;
  }

  function render() {
    const side = state?.turn ?? 'red';
    byId('turn-label').dataset.side = busy === 'computer' ? 'black' : side;
    byId('turn-label').dataset.check = String(Boolean(state?.check && busy !== 'computer'));
    text(byId('turn'), turnText());
    text(byId('round'), `第 ${twoDigits(Math.max(1, Math.ceil(((state?.moves ?? 0) + (state?.outcome ? 0 : 1)) / 2)))} 回合`);

    const upper = state?.flipped ? 'red' : 'black';
    const lower = state?.flipped ? 'black' : 'red';
    renderSeat(topSeat, upper);
    renderSeat(bottomSeat, lower);
    for (const [index, ruler] of rulers.entries()) {
      const color = index === 0 ? upper : lower;
      const labels = color === 'red' ? [...'九八七六五四三二一'] : [...'123456789'];
      if (state?.flipped) labels.reverse();
      for (const [col, label] of labels.entries()) text(ruler.children[col], label);
    }
    renderBoard();
    renderRecord();

    const locked = !state || Boolean(busy);
    const unusable = locked || state.damaged;
    byId('undo').disabled = unusable || !state.moves;
    byId('hint').disabled = unusable || Boolean(state.outcome);
    byId('flip').disabled = unusable;
    byId('flip').setAttribute('aria-pressed', String(Boolean(state?.flipped)));
    byId('new-game').disabled = locked;
    for (const button of modeButtons) {
      button.disabled = unusable;
      button.setAttribute('aria-pressed', String(button.dataset.mode === (state?.mode ?? 'computer')));
    }
    for (const button of levelButtons) {
      button.disabled = unusable || state.mode !== 'computer';
      button.setAttribute('aria-pressed', String(button.dataset.level === (state?.level ?? 'quiet')));
    }
    byId('level').hidden = state?.mode === 'local';
    text(byId('mode-note'), state?.mode === 'local' ? '同一棋盘，红黑轮流走棋。' : '你执红先行，电脑执黑。');
    text(byId('save-text'), state?.damaged ? '旧棋谱保留，开新局前会询问。' : state?.saved ? '棋局已保存 · 随时续弈' : '对局自动保存到当前工作区');
    const message = byId('message');
    text(message, note || (busy === 'hint' ? '正在推演一着…' : ''));
    message.hidden = !message.textContent;
    byId('failure').hidden = !error;
    text(byId('failure-text'), error);
    text(byId('retry'), connected ? '重试读取' : '重载面板');
  }

  function accept(snapshot) {
    if (!Number.isInteger(snapshot?.version) || !Array.isArray(snapshot.state?.board) || snapshot.state.board.length !== LAST + 1) {
      throw new Error('宿主返回了无效棋局。');
    }
    const next = { ...snapshot.state, version: snapshot.version };
    if (state && next.version < state.version) return;
    if (state && next.flipped !== state.flipped) focusAt(LAST - focusIndex);
    if (next.version !== state?.version) { selected = null; hint = null; }
    state = next;
  }

  async function run(kind, operation) {
    if (busy || abort.signal.aborted) return;
    busy = kind;
    error = '';
    note = '';
    render();
    try { await operation(); }
    catch (failure) { error = `${kind === 'load' ? '无法读取棋局' : '操作未确认'}：${String(failure?.message ?? failure).slice(0, 150)}`; }
    finally {
      busy = '';
      if (!abort.signal.aborted) {
        render();
        const shouldRefresh = refreshAfter > (state?.version ?? -1);
        refreshAfter = -1;
        if (shouldRefresh) void sync();
      }
    }
  }

  function sync() {
    return run('load', async () => {
      if (!host) throw new Error('请从 Muster 扩展入口打开。');
      if (!connected) {
        await host.ready;
        if (abort.signal.aborted) return;
        connected = true;
        unsubscribe = host.on('state.changed', event => {
          if (!Number.isInteger(event?.version) || event.version <= (state?.version ?? -1)) return;
          if (busy) refreshAfter = Math.max(refreshAfter, event.version);
          else void sync();
        });
      }
      accept(await host.agent.domain.snapshot());
    });
  }

  async function command(name, args, expected) {
    const response = await host.agent.domain.command(name, { ...args, expected });
    if (!response?.ok) throw new Error('宿主没有确认棋局变更。');
    accept(response.result);
  }

  function choose(visual) {
    if (!state || busy || state.outcome || state.damaged) return;
    focusAt(visual);
    const square = state.flipped ? LAST - visual : visual;
    hint = null;
    note = '';
    if (square === selected) selected = null;
    else if (ownerOf(state.board[square]) === state.turn) {
      selected = square;
      if (!state.legal.some(move => move.from === square)) note = '这枚棋子当前没有合法落点。';
    } else if (selected !== null && state.legal.some(move => move.from === selected && move.to === square)) {
      void run(state.mode === 'computer' ? 'computer' : 'move', () => command('game.move', { from: selected, to: square }, state.version));
      return;
    } else if (selected !== null) note = '这里不能落子，请选绿色标记的落点。';
    render();
  }

  function newGame(mode) {
    if (!state) return;
    const expected = state.version;
    return run('new', async () => {
      if (state.moves || state.damaged) {
        const allowed = await host.ui.confirm({
          title: state.damaged ? '替换无法读取的棋谱？' : '开始一盘新棋？',
          detail: state.damaged ? '开新局会替换当前工作区的旧棋谱。' : '当前对局会被替换。取消可继续下这盘棋。',
          confirmLabel: '开新局', cancelLabel: '取消', danger: true
        });
        if (allowed !== true && allowed?.confirmed !== true) return;
      }
      await command('game.new', { mode }, expected);
    });
  }

  listen(board, 'click', event => {
    const index = slotOf(event.target);
    if (index !== null) choose(index);
  });
  listen(board, 'focusin', event => {
    const index = slotOf(event.target);
    if (index !== null) focusAt(index);
  });
  listen(board, 'keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = slotOf(event.composedPath()[0]);
    if (index === null) return;
    if (event.key === 'Escape' && (selected !== null || hint)) {
      event.preventDefault();
      selected = null; hint = null; note = ''; render();
      return;
    }
    const direction = ARROWS.get(event.key);
    if (!direction) return;
    const row = Math.floor(index / FILES) + direction[0];
    const col = index % FILES + direction[1];
    if (row < 0 || row >= RANKS || col < 0 || col >= FILES) return;
    event.preventDefault();
    const next = row * FILES + col;
    focusAt(next);
    slots[next].button.focus({ preventScroll: true });
    slots[next].button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
  listen(byId('retry'), 'click', () => { if (connected) void sync(); else doc.location.reload(); });
  listen(byId('new-game'), 'click', () => { if (state) void newGame(state.mode); });
  listen(byId('undo'), 'click', () => void run('undo', () => command('game.undo', {}, state.version)));
  listen(byId('flip'), 'click', () => void run('settings', () => command('game.settings', { flipped: !state.flipped }, state.version)));
  listen(byId('hint'), 'click', () => void run('hint', async () => {
    const suggestion = await host.agent.domain.query('game.hint', {});
    if (suggestion.version !== state.version || refreshAfter > state.version) return;
    hint = suggestion.move;
    selected = null;
    note = hint ? `建议：${suggestion.text}` : '当前没有可提示的着法。';
  }));
  for (const button of modeButtons) listen(button, 'click', () => {
    if (button.dataset.mode !== state?.mode) void newGame(button.dataset.mode);
  });
  for (const button of levelButtons) listen(button, 'click', () => {
    if (button.dataset.level !== state?.level) void run('settings', () => command('game.settings', { level: button.dataset.level }, state.version));
  });

  const ready = sync();
  return { ready, dispose() { abort.abort(); unsubscribe?.(); } };
}

if (typeof window !== 'undefined' && document.getElementById('board')) {
  const panel = mountXiangqi(document, window.ma);
  window.addEventListener('pagehide', panel.dispose, { once: true });
}
