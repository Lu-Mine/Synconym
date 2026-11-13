// 导航语义独立于渲染：同一数据快照不重播，反向操作采用同一动效的镜像。
const SECONDARY = ['profile', 'qa', 'privacy', 'insane'];
const PHASES = ['lobby', 'countdown', 'writing', 'voting', 'prepare', 'breakVote', 'result', 'rematch', 'interrupted'];

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
