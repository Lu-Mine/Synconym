export const DISCONNECT_WINDOW_MS = 90_000;
export const PREPARE_GRACE_MS = 10_000;
export const REMATCH_SECONDS = 30;

export function isTimedPhase(phase) {
  return ['writing', 'voting', 'prepare', 'breakVote', 'result', 'rematch'].includes(phase);
}

export function hasDisconnectedPlayer(room) {
  return room.players.some((player) => !player.connected && player.leftReason === 'disconnect');
}

export function preparePlan(room) {
  const grace = hasDisconnectedPlayer(room) ? PREPARE_GRACE_MS : 0;
  return { durationMs: room.prepareSeconds * 1000 + grace, graceMs: grace };
}

export function prepareCanAdvance(room, now = Date.now()) {
  return room.phase === 'prepare'
    && now >= (room.prepareGraceDeadline ?? 0)
    && room.players.some((player) => player.connected)
    && room.players.filter((player) => player.connected).every((player) => player.ready);
}

export function deadlineExpired(room, now = Date.now()) {
  return room.phaseDeadline != null && now >= room.phaseDeadline;
}
