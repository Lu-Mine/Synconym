import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createSynconymServer } from '../server/index.js';
import { createDatabase } from '../server/db.js';

function openClient(port, uid, roomCode) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const client = { ws, uid, states: [], errors: [] };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', uid, roomCode })));
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'hello') { client.uid = message.uid; resolve(client); }
      if (message.type === 'state') client.states.push(message);
      if (message.type === 'error') client.errors.push(message.message);
    });
    ws.on('error', reject);
  });
}
function nextState(client, predicate = () => true, timeout = 2000) {
  const existing = client.states.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMessage); reject(new Error('等待快照超时')); }, timeout);
    const ws = client.ws;
    function onMessage(data) {
      const message = JSON.parse(data);
      if (message.type === 'state' && predicate(message)) {
        clearTimeout(timer); ws.off('message', onMessage); resolve(message);
      }
    }
    ws.on('message', onMessage);
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('真实 WebSocket 完成 M1 流程并恢复原席位', async (t) => {
  const db = createDatabase(':memory:');
  const { server, manager } = createSynconymServer({ db });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  const host = await openClient(port);
  await nextState(host, (state) => state.room === null);
  host.ws.send(JSON.stringify({ type: 'createRoom' }));
  const created = await nextState(host, (state) => state.room);
  const code = created.room.code;
  await sleep(510);
  const guest = await openClient(port, undefined, code);
  guest.ws.send(JSON.stringify({ type: 'joinRoom', code }));
  const joined = await nextState(guest, (state) => state.room?.players.length === 2);
  const uid = guest.uid;
  const seat = joined.room.players.find((player) => player.uid === uid).seat;
  await sleep(510);
  guest.ws.send(JSON.stringify({ type: 'rename', name: '恢复席位的人' }));
  await nextState(guest, (state) => state.room?.players.some((player) => player.name === '恢复席位的人'));
  guest.ws.close();
  await sleep(100);
  assert.equal(manager.rooms.get(code).players.length, 2);
  const restored = await openClient(port, uid, code);
  const recovered = await nextState(restored, (state) => state.room?.players.length === 2);
  assert.equal(recovered.room.players.find((player) => player.uid === uid).seat, seat);
  assert.equal(recovered.room.players.find((player) => player.uid === uid).name, '恢复席位的人');
  await sleep(510);
  host.ws.send(JSON.stringify({ type: 'setReady', ready: true }));
  await sleep(510);
  restored.ws.send(JSON.stringify({ type: 'setReady', ready: true }));
  await sleep(510);
  host.ws.send(JSON.stringify({ type: 'start' }));
  const started = await nextState(host, (state) => state.room?.phase === 'writing');
  assert.equal(started.room.round, 1);
  host.ws.close(); restored.ws.close();
});

test('SQLite 持久化玩家与改名历史', () => {
  const db = createDatabase(':memory:');
  db.createPlayer('uid-1', '初始名字', 1);
  db.rename('uid-1', '后来的名字', 2);
  assert.equal(db.getPlayer('uid-1').name, '后来的名字');
  db.close();
});
