import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomManager, createMemoryDb } from '../../server/rooms.js';
import { homeMarkup } from '../../public/render.js';
import { DEFAULT_SETTINGS } from '../../server/rules.js';

function client(manager) {
  const connection = manager.connect();
  connection.messages = [];
  connection.ws = { readyState: 1, send: data => connection.messages.push(JSON.parse(data)), close() {} };
  return connection;
}
function send(manager, connection, message, t) {
  t.mock.timers.tick(501);
  manager.handle(connection, message);
}

test('只记录最近一次主动退出，五分钟到期后不能再快捷加入', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db: createMemoryDb() });
  const a = client(manager), b = client(manager), c = client(manager);
  send(manager, a, { type: 'createRoom', ...DEFAULT_SETTINGS }, t);
  const first = a.roomCode;
  send(manager, b, { type: 'joinRoom', code: first }, t);
  send(manager, b, { type: 'leave' }, t);
  assert.equal(b.messages.at(-1).recentRoom.code, first);
  send(manager, c, { type: 'createRoom', ...DEFAULT_SETTINGS }, t);
  const second = c.roomCode;
  send(manager, b, { type: 'joinRoom', code: second }, t);
  send(manager, b, { type: 'leave' }, t);
  const recent = b.messages.at(-1).recentRoom;
  assert.equal(recent.code, second);
  t.mock.timers.tick(501);
  assert.throws(() => manager.handle(b, { type: 'joinRecentRoom', code: first }), /失效/);
  t.mock.timers.tick(300000);
  assert.equal(manager.recentRoomFor(b.uid), null);
  assert.throws(() => manager.handle(b, { type: 'joinRecentRoom', code: second }), /失效/);
  manager.close();
});

test('销毁房间即时清除入口，复用房号也不能进入新房间', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db: createMemoryDb() });
  const a = client(manager), b = client(manager);
  send(manager, a, { type: 'createRoom', ...DEFAULT_SETTINGS }, t);
  const code = a.roomCode;
  send(manager, b, { type: 'joinRoom', code }, t);
  send(manager, b, { type: 'leave' }, t);
  send(manager, a, { type: 'leave' }, t);
  assert.equal(b.messages.at(-1).recentRoom, null);
  manager.rooms.set(code, { code, players: [], phase: 'lobby' });
  t.mock.timers.tick(501);
  assert.throws(() => manager.handle(b, { type: 'joinRecentRoom', code }), /失效/);
  manager.close();
});

test('快捷返回沿用正常加入规则', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db: createMemoryDb() });
  const a = client(manager), b = client(manager);
  send(manager, a, { type: 'createRoom', ...DEFAULT_SETTINGS }, t);
  const code = a.roomCode;
  send(manager, b, { type: 'joinRoom', code }, t);
  send(manager, b, { type: 'leave' }, t);
  const room = manager.rooms.get(code);
  room.phase = 'writing';
  t.mock.timers.tick(501);
  assert.throws(() => manager.handle(b, { type: 'joinRecentRoom', code }), /已经开始/);
  room.phase = 'lobby';
  send(manager, b, { type: 'joinRecentRoom', code }, t);
  assert.equal(b.roomCode, code);
  manager.close();
});

test('断线与切换房间都记录最近离开的房间，旧席位清理不覆盖新记录', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db: createMemoryDb() });
  const a = client(manager), b = client(manager), c = client(manager);
  send(manager, a, { type: 'createRoom', ...DEFAULT_SETTINGS }, t);
  const first = a.roomCode;
  send(manager, b, { type: 'joinRoom', code: first }, t);
  manager.disconnect(b);
  const disconnectedAt = Date.now();
  assert.deepEqual(manager.recentRoomFor(b.uid), { code: first, expiresAt: disconnectedAt + 300000 });
  const returning = manager.connect(b.uid);
  returning.ws = { readyState: 1, send() {}, close() {} };
  send(manager, c, { type: 'createRoom', ...DEFAULT_SETTINGS }, t);
  const second = c.roomCode;
  send(manager, returning, { type: 'joinRoom', code: second }, t);
  send(manager, returning, { type: 'joinRoom', code: first }, t);
  assert.equal(manager.recentRoomFor(b.uid).code, second);
  manager.rememberDeparture(b.uid, manager.rooms.get(first), disconnectedAt);
  assert.equal(manager.recentRoomFor(b.uid).code, second);
  manager.close();
});

test('结算超时被移出时，房间仍存在则记录最近房间', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db: createMemoryDb() });
  const a = client(manager), b = client(manager);
  send(manager, a, { type: 'createRoom', ...DEFAULT_SETTINGS }, t);
  const code = a.roomCode;
  send(manager, b, { type: 'joinRoom', code }, t);
  const room = manager.rooms.get(code);
  room.phase = 'result';
  room.rematchDeadline = Date.now();
  room.rematchEligibleUids = [a.uid, b.uid];
  room.rematchVotes = { [a.uid]: 'room' };
  manager.finishRematch(room, true);
  assert.equal(b.roomCode, null);
  assert.equal(b.messages.at(-2).recentRoom.code, code);
  assert.equal(room.phase, 'lobby');
  manager.close();
});

test('主页在房号输入下提供默认隐藏的最近房间入口', () => {
  const html = homeMarkup(DEFAULT_SETTINGS, false);
  assert.match(html, /id="room-code"[\s\S]*id="recent-room"[^>]*hidden/);
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /setTimeout\(syncRecentRoomDOM, remaining\)/);
  assert.match(app, /if \(recent && Number\(recent\.expiresAt\) > gameNow\(\)\) requestJoin\(recent\.code\)/);
});
