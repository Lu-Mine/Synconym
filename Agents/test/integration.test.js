import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createSynconymServer } from '../../server/index.js';
import { createDatabase } from '../../server/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const credentials = new Map();
function openClient(port, uid, roomCode, extra = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const client = { ws, uid, states: [], errors: [] };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', uid, credential: credentials.get(uid), roomCode, ...extra })));
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'hello') { client.uid = message.uid; client.credential = message.credential || credentials.get(message.uid); if (message.credential) credentials.set(message.uid, message.credential); client.restored = message.restored; resolve(client); }
      if (message.type === 'state') client.states.push(message);
      if (message.type === 'error') { client.errors.push(message.message); resolve(client); }
    });
    ws.on('error', reject);
    ws.on('close', (code) => { client.closeCode = code; resolve(client); });
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

async function finishCountdown(manager, client, code) {
  await nextState(client, state => state.room?.code === code && state.room.phase === 'countdown');
  const room = manager.rooms.get(code);
  assert.equal(room.phase, 'countdown');
  manager.advanceDeadline(room);
  manager.broadcast(room);
}

test('公开 UID 不可用于读取档案、接管或退出房间，合法凭证可恢复', async (t) => {
  const db = createDatabase(':memory:');
  const { server, wss, manager } = createSynconymServer({ db });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  const port = server.address().port;
  const victim = await openClient(port);
  assert.match(victim.credential, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(db.getCredentialHash(victim.uid).toString(), victim.credential);
  victim.ws.send(JSON.stringify({ type: 'createRoom' }));
  const room = (await nextState(victim, s => s.room)).room;
  for (const credential of [undefined, 'x'.repeat(43)]) {
    const attacker = await openClient(port, victim.uid, room.code, { credential, leaveRoom: true });
    assert.deepEqual(attacker.errors, ['身份验证失败']);
    if (attacker.ws.readyState !== WebSocket.CLOSED) await once(attacker.ws, 'close');
    assert.equal(attacker.closeCode, 4003);
    assert.deepEqual(attacker.states, []);
    assert.equal(victim.ws.readyState, WebSocket.OPEN);
    assert.equal(manager.rooms.get(room.code).players[0].uid, victim.uid);
  }
  const replacement = await openClient(port, victim.uid, room.code);
  assert.equal(replacement.restored, true);
  await nextState(replacement, s => s.room?.code === room.code);
});

test('resetIdentity 签发独立凭证并允许重连', async (t) => {
  const { server, wss } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  const port = server.address().port;
  const client = await openClient(port);
  const identity = new Promise(resolve => client.ws.on('message', data => { const m = JSON.parse(data); if (m.type === 'identity') resolve(m); }));
  client.ws.send(JSON.stringify({ type: 'resetIdentity' }));
  const fresh = await identity;
  assert.notEqual(fresh.uid, client.uid); assert.notEqual(fresh.credential, client.credential);
  const wrong = await openClient(port, fresh.uid, undefined, { credential: client.credential });
  assert.deepEqual(wrong.errors, ['身份验证失败']);
  credentials.set(fresh.uid, fresh.credential);
  const restored = await openClient(port, fresh.uid);
  assert.equal(restored.uid, fresh.uid);
  await nextState(restored, s => s.room === null);
});

test('文件数据库重启后仍可验证凭证并读取原档案', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'synconym-auth-'));
  const path = join(dir, 'db.sqlite');
  let instance = createSynconymServer({ db: createDatabase(path) });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  const first = await openClient(instance.server.address().port);
  first.ws.close(); await once(first.ws, 'close');
  await new Promise(resolve => instance.server.close(resolve));
  instance = createSynconymServer({ db: createDatabase(path) });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  t.after(async () => { for (const ws of instance.wss.clients) ws.terminate(); await new Promise(resolve => instance.server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const restored = await openClient(instance.server.address().port, first.uid);
  assert.equal(restored.uid, first.uid);
  const profile = new Promise(resolve => restored.ws.on('message', data => { const m = JSON.parse(data); if (m.type === 'profile') resolve(m.profile); }));
  restored.ws.send(JSON.stringify({ type: 'openProfile' }));
  assert.equal((await profile).user.uid, first.uid);
});

test('同 UID 新页面接管连接并保留房间席位', async (t) => {
  const { server, wss, manager } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  const port = server.address().port;
  const first = await openClient(port);
  first.ws.send(JSON.stringify({ type: 'createRoom' }));
  const room = (await nextState(first, (state) => state.room)).room;
  const firstClosed = once(first.ws, 'close');
  const second = await openClient(port, first.uid, room.code);
  const [code] = await firstClosed;
  assert.equal(code, 4001);
  assert.equal(second.uid, first.uid);
  assert.equal(second.restored, true);
  const recovered = await nextState(second, (state) => state.room?.code === room.code);
  assert.equal(recovered.room.players[0].seat, room.players[0].seat);
  assert.equal(manager.playerFor(manager.rooms.get(room.code), first.uid).connected, true);
  assert.equal(manager.clients.get(first.uid).ws.readyState, WebSocket.OPEN);
  assert.deepEqual(second.errors, []);
});

test('同 UID 首页可以并存，不会踢掉房间页面，进入房间时才接管', async (t) => {
  const { server, wss, manager } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  const port = server.address().port;
  const first = await openClient(port);
  const second = await openClient(port, first.uid);
  await nextState(first, s => s.room === null);
  await nextState(second, s => s.room === null);
  assert.equal(first.ws.readyState, WebSocket.OPEN);
  assert.equal(second.ws.readyState, WebSocket.OPEN);
  first.ws.send(JSON.stringify({ type: 'createRoom' }));
  const { room } = await nextState(first, s => s.room);
  const third = await openClient(port, first.uid);
  await nextState(third, s => s.room === null);
  assert.equal(first.ws.readyState, WebSocket.OPEN);
  assert.equal(second.ws.readyState, WebSocket.OPEN);
  const closed = once(first.ws, 'close');
  second.ws.send(JSON.stringify({ type: 'joinRoom', code: room.code }));
  const [code] = await closed;
  assert.equal(code, 4001);
  await nextState(second, s => s.room?.code === room.code);
  assert.equal(third.ws.readyState, WebSocket.OPEN);
  assert.equal(manager.playerFor(manager.rooms.get(room.code), first.uid).connected, true);
});
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
  restored.ws.send(JSON.stringify({ type: 'setReady', ready: true }));
  await sleep(510);
  host.ws.send(JSON.stringify({ type: 'start' }));
  await finishCountdown(manager, host, code);
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

test('真实 WebSocket 完成投票、准备、回归和精确相遇', async (t) => {
  const { server, manager } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  const host = await openClient(port);
  await nextState(host, (state) => state.room === null);
  host.ws.send(JSON.stringify({ type: 'createRoom' }));
  const code = (await nextState(host, (state) => state.room)).room.code;
  const guest = await openClient(port, undefined, code);
  guest.ws.send(JSON.stringify({ type: 'joinRoom', code }));
  const joined = await nextState(guest, (state) => state.room?.players.length === 2);
  const seat = joined.room.players.find((player) => player.uid === guest.uid).seat;
  await sleep(510);
  guest.ws.send(JSON.stringify({ type: 'setReady', ready: true }));
  await nextState(host, (state) => state.room?.players.some((p) => p.uid === guest.uid && p.ready));
  host.ws.send(JSON.stringify({ type: 'start' }));
  await finishCountdown(manager, host, code);
  await nextState(host, (state) => state.room?.phase === 'writing');
  await sleep(510);
  host.ws.send(JSON.stringify({ type: 'submitWord', word: '苹果' }));
  const hidden = await nextState(guest, (state) => state.room?.phase === 'writing' && state.room.players.some((p) => p.uid === host.uid && p.submitted));
  assert.equal(hidden.room.words, null);
  guest.ws.send(JSON.stringify({ type: 'submitWord', word: '香蕉' }));
  const voting = await nextState(host, (state) => state.room?.phase === 'voting');
  assert.equal(voting.room.words[guest.uid], '香蕉');
  await sleep(510);
  host.ws.send(JSON.stringify({ type: 'vote', yes: false }));
  await nextState(host, (state) => state.room?.phase === 'prepare', 2000);
  guest.ws.close();
  await once(guest.ws, 'close');
  const restored = await openClient(port, guest.uid, code);
  const recovered = await nextState(restored, (state) => state.room?.phase === 'prepare');
  await sleep(510);
  assert.equal(recovered.room.players.find((p) => p.uid === guest.uid).seat, seat);
  host.ws.send(JSON.stringify({ type: 'ready' }));
  restored.ws.send(JSON.stringify({ type: 'ready' }));
  await nextState(host, (state) => state.room?.phase === 'writing' && state.room.round === 2);
  await sleep(510);
  host.ws.send(JSON.stringify({ type: 'submitWord', word: '臺灣' }));
  restored.ws.send(JSON.stringify({ type: 'submitWord', word: '台湾' }));
  const result = await nextState(host, (state) => state.room?.phase === 'result');
  assert.equal(result.room.outcome, 'exact');
  assert.deepEqual(host.errors, []);
  assert.deepEqual(restored.errors, []);
  host.ws.close(); restored.ws.close();
});

test('真实 WebSocket 断线回归保留本阶段的提交和投票', async (t) => {
  const { server, manager } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  const host = await openClient(port);
  await nextState(host, (s) => s.room === null);
  host.ws.send(JSON.stringify({ type: 'createRoom' }));
  const code = (await nextState(host, (s) => s.room)).room.code;
  let guest = await openClient(port, undefined, code);
  guest.ws.send(JSON.stringify({ type: 'joinRoom', code }));
  await nextState(guest, (s) => s.room?.players.length === 2);
  await sleep(520);
  guest.ws.send(JSON.stringify({ type: 'setReady', ready: true }));
  await nextState(host, (s) => s.room?.players.some((p) => p.uid === guest.uid && p.ready));
  host.ws.send(JSON.stringify({ type: 'start' }));
  await finishCountdown(manager, guest, code);
  await nextState(guest, (s) => s.room?.phase === 'writing');
  await sleep(520);
  guest.ws.send(JSON.stringify({ type: 'submitWord', word: '苹果' }));
  await nextState(guest, (s) => s.room?.phase === 'writing' && s.room.players.some((p) => p.uid === guest.uid && p.submitted));
  const uid = guest.uid;
  guest.ws.close(); await once(guest.ws, 'close');
  guest = await openClient(port, uid, code);
  const resumed = await nextState(guest, (s) => s.room?.phase === 'writing');
  assert.equal(resumed.room.players.find((p) => p.uid === uid).submitted, true);
  assert.equal(resumed.room.words, null);
  host.ws.send(JSON.stringify({ type: 'submitWord', word: '香蕉' }));
  const voting = await nextState(guest, (s) => s.room?.phase === 'voting');
  assert.equal(voting.room.words[uid], '苹果');
  guest.ws.send(JSON.stringify({ type: 'vote', yes: true }));
  await nextState(guest, (s) => s.room?.phase === 'voting' && s.room.players.some((p) => p.uid === uid && p.voted));
  guest.ws.close(); await once(guest.ws, 'close');
  guest = await openClient(port, uid, code);
  const voted = await nextState(guest, (s) => s.room?.phase === 'voting');
  assert.equal(voted.room.players.find((p) => p.uid === uid).voted, true);
  assert.equal(voted.room.votes, null);
  assert.deepEqual(guest.errors, []);
  host.ws.close(); guest.ws.close();
});

test('结算截止前未执行清理，离线者迟到握手不能恢复资格', async (t) => {
  const { server, manager } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  const host = await openClient(port);
  host.ws.send(JSON.stringify({ type: 'createRoom' }));
  const { room: created } = await nextState(host, (state) => state.room);
  const guest = await openClient(port);
  guest.ws.send(JSON.stringify({ type: 'joinRoom', code: created.code }));
  await nextState(guest, (state) => state.room?.players.length === 2);
  guest.ws.close(); await once(guest.ws, 'close'); await sleep(20);
  const room = manager.rooms.get(created.code);
  room.rematchEligibleUids = room.players.map((p) => p.uid);
  room.rematchVotes = { [host.uid]: 'room' };
  manager.setPhase(room, 'result', 30);
  room.rematchDeadline = Date.now() - 1;
  const late = await openClient(port, guest.uid, room.code);
  assert.equal(late.restored, false);
  await nextState(late, (state) => state.room === null);
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.players.map((p) => p.uid), [host.uid]);
  host.ws.close(); late.ws.close();
});
test('握手真实状态：重连、切房、主动退出、过期和房间销毁', async (t) => {
  const { server, manager, wss } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  const port = server.address().port;
  const host = await openClient(port);
  host.ws.send(JSON.stringify({ type: 'createRoom' }));
  const code = (await nextState(host, (s) => s.room)).room.code;
  let guest = await openClient(port);
  guest.ws.send(JSON.stringify({ type: 'joinRoom', code }));
  await nextState(guest, (s) => s.room?.players.length === 2);
  guest.ws.close();
  await once(guest.ws, 'close');
  const replacement = await openClient(port, guest.uid, code);
  assert.equal(replacement.restored, true);
  await nextState(replacement, (s) => s.room?.code === code);
  await sleep(30);
  assert.equal(manager.playerFor(manager.rooms.get(code), guest.uid).connected, true);
  replacement.ws.send(JSON.stringify({ type: 'leave' }));
  await nextState(replacement, (s) => s.room === null);
  replacement.ws.close(); await once(replacement.ws, 'close');
  guest = await openClient(port, replacement.uid, code);
  assert.equal(guest.restored, false); await nextState(guest, (s) => s.room === null);
  guest.ws.send(JSON.stringify({ type: 'joinRoom', code }));
  await nextState(guest, (s) => s.room?.players.length === 2);
  const other = await openClient(port);
  other.ws.send(JSON.stringify({ type: 'createRoom' }));
  const otherCode = (await nextState(other, (s) => s.room)).room.code;
  guest.ws.close(); await once(guest.ws, 'close');
  const switched = await openClient(port, guest.uid, otherCode);
  assert.equal(switched.restored, false); await nextState(switched, (s) => s.room === null);
  assert.equal(manager.rooms.get(code).players.some((p) => p.uid === guest.uid), false);
  switched.ws.send(JSON.stringify({ type: 'joinRoom', code: otherCode }));
  await nextState(switched, (s) => s.room?.players.length === 2);
  switched.ws.close(); await once(switched.ws, 'close'); await sleep(20);
  manager.playerFor(manager.rooms.get(otherCode), guest.uid).disconnectedAt = Date.now() - 90000;
  const expired = await openClient(port, guest.uid, otherCode);
  assert.equal(expired.restored, false); await nextState(expired, (s) => s.room === null);
  other.ws.close(); await once(other.ws, 'close');
  manager.destroyRoom(manager.rooms.get(otherCode), '测试关闭');
  const destroyed = await openClient(port, other.uid, otherCode);
  assert.equal(destroyed.restored, false); await nextState(destroyed, (s) => s.room === null);
});

test('无结算资格的席位握手不能宣称恢复成功', async (t) => {
  const { server, manager, wss } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  const port = server.address().port;
  const host = await openClient(port);
  host.ws.send(JSON.stringify({ type: 'createRoom' }));
  const code = (await nextState(host, (s) => s.room)).room.code;
  const room = manager.rooms.get(code);
  manager.setPhase(room, 'result', 30);
  room.rematchDeadline = Date.now() + 30000; room.rematchEligibleUids = []; room.rematchVotes = {};
  host.ws.close(); await once(host.ws, 'close');
  const restored = await openClient(port, host.uid, code);
  assert.equal(restored.restored, false);
  await nextState(restored, (s) => s.room === null);
});

test('主动退出意图握手不先恢复在线或触发全员重赛', async (t) => {
  const { server, manager, wss } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  const port = server.address().port;
  const host = await openClient(port);
  host.ws.send(JSON.stringify({ type: 'createRoom' }));
  const code = (await nextState(host, s => s.room)).room.code;
  const guest = await openClient(port);
  guest.ws.send(JSON.stringify({ type: 'joinRoom', code }));
  await nextState(guest, s => s.room?.players.length === 2);
  guest.ws.close(); await once(guest.ws, 'close'); await sleep(20);
  const room = manager.rooms.get(code);
  manager.setPhase(room, 'rematch', 30);
  room.rematchDeadline = room.phaseDeadline;
  room.rematchEligibleUids = [host.uid, guest.uid];
  room.rematchVotes = { [host.uid]: 'rematch', [guest.uid]: 'rematch' };
  const leaving = await openClient(port, guest.uid, code, { leaveRoom: true });
  assert.equal(leaving.restored, false);
  await nextState(leaving, s => s.room === null);
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.players.map(p => p.uid), [host.uid]);
  assert.equal(leaving.states.some(s => s.room), false);
});

test('真实 WebSocket 完整五轮进入崩局投票，提前结束且不保存，可重赛', async (t) => {
  const db = createDatabase(':memory:');
  const { server, wss, manager } = createSynconymServer({ db });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  const port = server.address().port;
  const host = await openClient(port); await nextState(host, (s) => s.room === null);
  host.ws.send(JSON.stringify({ type: 'createRoom', maxRounds: 8, banRepeat: false }));
  const code = (await nextState(host, (s) => s.room)).room.code;
  const guest = await openClient(port); await nextState(guest, (s) => s.room === null);
  guest.ws.send(JSON.stringify({ type: 'joinRoom', code }));
  await nextState(guest, (s) => s.room?.players.length === 2);
  await sleep(520); guest.ws.send(JSON.stringify({ type: 'setReady', ready: true }));
  await nextState(host, (s) => s.room?.players.some((p) => p.uid === guest.uid && p.ready));
  host.ws.send(JSON.stringify({ type: 'start' }));
  await finishCountdown(manager, host, code);
  for (let round = 1; round <= 5; round++) {
    await nextState(host, (s) => s.room?.phase === 'writing' && s.room.round === round);
    await sleep(520);
    host.ws.send(JSON.stringify({ type: 'submitWord', word: '苹果' }));
    guest.ws.send(JSON.stringify({ type: 'submitWord', word: '香蕉' }));
    await nextState(host, (s) => s.room?.phase === 'voting' && s.room.round === round);
    await sleep(520); host.ws.send(JSON.stringify({ type: 'vote', yes: false }));
    if (round < 5) {
      await nextState(host, (s) => s.room?.phase === 'prepare' && s.room.round === round);
      await sleep(520);
      host.ws.send(JSON.stringify({ type: 'ready' }));
      guest.ws.send(JSON.stringify({ type: 'ready' }));
    }
  }
  const phase = await nextState(guest, (s) => s.room?.phase === 'breakVote');
  assert.equal(phase.room.round, 5); assert.equal(phase.room.history.length, 5);
  const id = manager.rooms.get(code).matchId;
  await sleep(520); host.ws.send(JSON.stringify({ type: 'breakVote', yes: true }));
  const result = await nextState(guest, (s) => s.room?.phase === 'result');
  assert.equal(result.room.outcome, 'break'); assert.equal(result.room.history.length, 5);
  assert.equal(db.getMatch(id), undefined);
  await sleep(520);
  host.ws.send(JSON.stringify({ type: 'rematch', choice: 'rematch' }));
  guest.ws.send(JSON.stringify({ type: 'rematch', choice: 'rematch' }));
  await nextState(guest, s => s.serverNow > result.serverNow && s.room?.phase === 'countdown');
  manager.advanceDeadline(manager.rooms.get(code));
  manager.broadcast(manager.rooms.get(code));
  await nextState(guest, (s) => s.serverNow > result.serverNow && s.room?.phase === 'writing' && s.room.round === 1 && s.room.history.length === 0);
  assert.deepEqual(host.errors, []); assert.deepEqual(guest.errors, []);
});
