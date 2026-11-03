export function countdownState(room, now) {
  const deadline = Number(room?.phaseDeadline);
  const seconds = Number.isFinite(deadline) && deadline > 0 ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const grace = room?.phase === 'prepare' && Number(room.prepareGraceDeadline) > now;
  return { seconds, grace, urgent: !grace && seconds !== null && seconds <= 10 };
}
