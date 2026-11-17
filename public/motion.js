// 导航语义独立于渲染：同一数据快照不重播，反向操作采用同一动效的镜像。
const SECONDARY = ['profile', 'qa', 'privacy', 'insane'];
const PHASES = ['lobby', 'countdown', 'lvIntro', 'lvPlay', 'lvScore', 'writing', 'voting', 'prepare', 'breakVote', 'result', 'rematch', 'interrupted'];

export function motionTarget(screen, { detail = '', page = 1, query = '' } = {}) {
  return { screen, detail: screen === 'profile' ? detail : '', page, query };
}

export function sceneMotion(previous, next) {
  if (!previous) return null;
  const a = previous.screen;
  const b = next.screen;
  const depth = (target) => target.screen === 'home' ? 0 : target.detail ? 2 : 1;
  if (a === b) {
    if (previous.detail !== next.detail) {
      return { kind: 'depth', direction: next.detail ? 1 : -1 };
    }
    if (a === 'profile' && !next.detail && previous.query === next.query && previous.page !== next.page) {
      return { kind: 'lateral', direction: Math.sign(next.page - previous.page) };
    }
    return null;
  }
  if (a === 'home' || b === 'home' || (SECONDARY.includes(a) && SECONDARY.includes(b) && depth(previous) !== depth(next))) {
    return { kind: 'depth', direction: Math.sign(depth(next) - depth(previous)) || 1 };
  }
  if (SECONDARY.includes(a) && SECONDARY.includes(b)) {
    return { kind: 'lateral', direction: Math.sign(SECONDARY.indexOf(b) - SECONDARY.indexOf(a)) };
  }
  // 结算与再来一局共用页面，仅更新操作区。
  if (['result', 'rematch'].includes(a) && ['result', 'rematch'].includes(b)) return null;
  return { kind: 'phase', direction: Math.sign(PHASES.indexOf(b) - PHASES.indexOf(a)) || 1 };
}

// 非房间页面返回栈：记录同会话内的浏览层级，「返回」按层级与来源回退，不会从 ?me 退回详情或同级打转。
export function createNavHistory(initialScreen = 'home') {
  const session = Math.random().toString(36).slice(2);
  let nextId = 1;
  let currentId = 0;
  const entries = new Map();

  function createEntry(pos, screen, backStack = []) {
    const id = nextId++;
    const entry = { id, pos, screen, backStack };
    entries.set(id, entry);
    return entry;
  }

  function pruneForward(fromPos) {
    for (const [id, entry] of entries) {
      if (entry.pos >= fromPos) entries.delete(id);
    }
  }

  function nextBackStackFor(curr, nextScreen) {
    if (!curr) return [];
    const stack = curr.backStack;
    if (nextScreen === 'profile') {
      const idx = stack.findIndex((id) => {
        const screen = entries.get(id)?.screen;
        return screen === 'profile' || screen === 'match-detail';
      });
      if (idx >= 0) return stack.slice(0, idx);
      if (curr.screen === 'profile' || curr.screen === 'match-detail') return [...stack];
      return [...stack, curr.id];
    }
    if (nextScreen === 'match-detail') {
      if (curr.screen === 'match-detail') return [...stack];
      return [...stack, curr.id];
    }
    const idx = stack.findIndex((id) => entries.get(id)?.screen === nextScreen);
    if (idx >= 0) return stack.slice(0, idx);
    if (curr.screen === nextScreen) return [...stack];
    return [...stack, curr.id];
  }

  function stamp(state) {
    const base = state && typeof state === 'object' ? state : {};
    return { ...base, __navSession: session, __navId: currentId };
  }

  function init(screen = initialScreen) {
    entries.clear();
    const entry = createEntry(0, screen, []);
    currentId = entry.id;
    return entry;
  }

  function reset(screen = 'home', posOffset = 0) {
    const curr = entries.get(currentId);
    const pos = (curr ? curr.pos : 0) + posOffset;
    pruneForward(pos);
    const entry = createEntry(pos, screen, []);
    currentId = entry.id;
    return entry;
  }

  function advanceRoomGuard() {
    const curr = entries.get(currentId);
    const pos = (curr ? curr.pos : 0) + 1;
    pruneForward(pos);
    const entry = createEntry(pos, 'home', []);
    currentId = entry.id;
    return entry;
  }

  function push(nextScreen) {
    const curr = entries.get(currentId);
    const pos = (curr ? curr.pos : 0) + 1;
    const backStack = nextBackStackFor(curr, nextScreen);
    pruneForward(pos);
    const entry = createEntry(pos, nextScreen, backStack);
    currentId = entry.id;
    return entry;
  }

  function syncPop(historyState, screen) {
    const id = historyState && historyState.__navSession === session ? historyState.__navId : null;
    if (id && entries.has(id)) {
      currentId = id;
      return { known: true, entry: entries.get(id) };
    }
    const curr = entries.get(currentId);
    const pos = curr ? curr.pos : 0;
    const entry = createEntry(pos, screen, []);
    currentId = entry.id;
    return { known: false, entry };
  }

  function backDelta() {
    const curr = entries.get(currentId);
    if (!curr || !curr.backStack.length) return 0;
    for (let i = curr.backStack.length - 1; i >= 0; i--) {
      const target = entries.get(curr.backStack[i]);
      if (target && target.pos < curr.pos) return target.pos - curr.pos;
    }
    return 0;
  }

  init(initialScreen);
  return { init, reset, advanceRoomGuard, push, syncPop, backDelta, stamp, session };
}
