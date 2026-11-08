import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';
import { createMockControls } from '../../server/mock.js';

const source = readFileSync(new URL('../../dev/mock.js', import.meta.url), 'utf8');
const startRule = source.split('\n').find(line => line.includes("$('#start').disabled ="));
function disabled(room) {
  const button = {};
  runInNewContext(startRule, { room, phase: room?.phase, $: () => button });
  return button.disabled;
}
test('控制栏开始按房间条件启用，不依赖选中的机器人是否为房主', () => {
  const room = { phase: 'lobby', hostUid: 'human', players: [
    { uid: 'human', connected: true, ready: false }, { uid: 'bot', connected: true, ready: true }
  ] };
  assert.equal(disabled(room), false);
  room.hostUid = 'bot'; room.players[0].ready = true;
  assert.equal(disabled(room), false);
  room.players[0].ready = false;
  assert.equal(disabled(room), true);
  room.players[0].ready = true; room.players[1].connected = false;
  assert.equal(disabled(room), true);
  assert.equal(disabled(null), true);
});

for (const botHost of [false, true]) test(`控制栏开局使用实际房主（机器人房主=${botHost}），仍校验准备`, t => {
  const db = createDatabase(':memory:');
  const manager = new RoomManager({ db });
  const controls = createMockControls(manager);
  t.after(() => { manager.close(); db.close(); });
  const user = manager.connect();
  user.ws = { readyState: 1, send() {}, close() {} };
  manager.handle(user, botHost ? { type: 'joinRoom', code: '99999' } : { type: 'createRoom' });
  if (!botHost) controls.handle(user, { action: 'add' });
  const room = manager.rooms.get(user.roomCode);
  assert.throws(() => controls.handle(user, { action: 'start', uid: 'not-the-host' }));
  const nonHost = room.players.find(p => p.uid !== room.hostUid);
  const connection = manager.clients.get(nonHost.uid);
  connection.lastWrite = 0;
  manager.handle(connection, { type: 'setReady', ready: true });
  controls.handle(user, { action: 'start', uid: 'not-the-host' });
  assert.equal(room.phase, 'countdown');
});
