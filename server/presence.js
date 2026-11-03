import { DISCONNECT_WINDOW_MS } from './phase.js';

export function markDisconnected(player, now = Date.now()) {
  if (!player?.connected) return false;
  player.connected = false;
  player.ready = false;
  player.disconnectedAt = now;
  player.leftReason = 'disconnect';
  return true;
}

export function disconnectExpired(player, now = Date.now()) {
  return !player?.connected && player.leftReason === 'disconnect'
    && player.disconnectedAt != null
    && now - player.disconnectedAt >= DISCONNECT_WINDOW_MS;
}

export function removePlayer(room, uid) {
  const player = room.players.find((item) => item.uid === uid);
  if (!player) return null;
  room.players = room.players.filter((item) => item.uid !== uid);
  room.rematchEligibleUids = room.rematchEligibleUids?.filter((item) => item !== uid);
  if (room.rematchVotes) delete room.rematchVotes[uid];
  return player;
}
