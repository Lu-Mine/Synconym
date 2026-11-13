import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';
import { createMockControls } from '../../server/mock.js';
import { roomPlayerLimits } from '../../public/render.js';

const source = readFileSync(new URL('../../dev/mock.js', import.meta.url), 'utf8');

function panelFixture() {
  const nodes = new Map();
  const sent = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', checked: false, disabled: false, hidden: false,
      style: {}, handlers: {}, attrs: {},
      classList: { add() {}, remove() {}, toggle(_, value) { return value; } },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      setAttribute(key, value) { this.attrs[key] = value; },
      replaceChildren(...options) { this.value = options[0]?.value || ''; },
      getBoundingClientRect() { return { left: 600, top: 16, width: 336, height: 600 }; },
      setPointerCapture() {}, hasPointerCapture() { return true; }, releasePointerCapture() {}, focus() {},
      contentWindow: { postMessage(message) { sent.push(message); } } });
    return nodes.get(id);
  }
  const window = { innerWidth: 1000, innerHeight: 800, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  runInNewContext(source, {
    document: { querySelector: node }, window, location: { origin: 'http://test' },
    Option: function (text, value) { this.value = value; }
  });
  return { node, window, sent };
}

function pushRoom(fixture, room) {
  fixture.window.handlers.message({
    origin: 'http://test', source: fixture.node('#game').contentWindow,
    data: { type: 'mock-state', room, mockPausedAt: null }
  });
}

function lobbyRoom(mode, count) {
  const players = [{ uid: 'human', connected: true, ready: false }];
  for (let index = 1; index < count; index += 1) players.push({ uid: `bot${index}`, mockBot: true, connected: true, ready: true });
  return { code: '12345', mode, phase: 'lobby', hostUid: 'human', players };
}

test('控制栏开始按房间人数范围与准备状态启用', () => {
  const fixture = panelFixture();
  const room = lobbyRoom('free', 2);
  pushRoom(fixture, room);
  assert.equal(fixture.node('#start').disabled, false);

  room.mode = 'livonym';
  pushRoom(fixture, room);
  assert.equal(fixture.node('#start').disabled, true, '即时竞猜要满 3 人');

  room.players.push({ uid: 'bot2', mockBot: true, connected: true, ready: true });
  pushRoom(fixture, room);
  assert.equal(fixture.node('#start').disabled, false);

  room.players[2].ready = false;
  pushRoom(fixture, room);
  assert.equal(fixture.node('#start').disabled, true);

  room.players[2].ready = true;
  room.hostUid = 'bot1';
  room.players[0].ready = true;
  pushRoom(fixture, room);
  assert.equal(fixture.node('#start').disabled, false);

  room.hostUid = 'human';
  room.players[1].connected = false;
  pushRoom(fixture, room);
  assert.equal(fixture.node('#start').disabled, true);

  pushRoom(fixture, null);
  assert.equal(fixture.node('#start').disabled, true);
});

test('控制栏添加玩家按房间人数上限禁用，不写死 4 人', () => {
  const fixture = panelFixture();
  const room = lobbyRoom('free', 4);
  pushRoom(fixture, room);
  assert.equal(fixture.node('#add').disabled, true);

  room.mode = 'livonym';
  pushRoom(fixture, room);
  assert.equal(fixture.node('#add').disabled, false, '即时竞猜可加到 8 人');

  room.players.push({ uid: 'bot4', mockBot: true, connected: true, ready: true });
  room.players.push({ uid: 'bot5', mockBot: true, connected: true, ready: true });
  room.players.push({ uid: 'bot6', mockBot: true, connected: true, ready: true });
  room.players.push({ uid: 'bot7', mockBot: true, connected: true, ready: true });
  pushRoom(fixture, room);
  assert.equal(room.players.length, 8);
  assert.equal(fixture.node('#add').disabled, true);

  room.phase = 'countdown';
  pushRoom(fixture, room);
  assert.equal(fixture.node('#add').disabled, true);
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
  const nonHost = room.players.find(p => p.uid !== room.hostUid);
  if (!botHost) assert.equal(nonHost.ready, true, '添加的模拟玩家默认已准备');
  const connection = manager.clients.get(nonHost.uid);
  connection.lastWrite = 0;
  manager.handle(connection, { type: 'setReady', ready: false });
  assert.throws(() => controls.handle(user, { action: 'start', uid: 'not-the-host' }));
  connection.lastWrite = 0;
  manager.handle(connection, { type: 'setReady', ready: true });
  controls.handle(user, { action: 'start', uid: 'not-the-host' });
  assert.equal(room.phase, 'countdown');
});

test('面板人数限制与页面和服务端规则一致', () => {
  const literal = source.match(/const ROOM_LIMITS = (\{[^}]*\});/)?.[1];
  assert.ok(literal, '面板应保留 ROOM_LIMITS 常量');
  const limits = new Function(`return ${literal}`)();
  for (const mode of ['free', 'theme', 'livonym', 'shiritori', 'impostor', 'blitz', 'bridge']) {
    assert.deepEqual(limits[mode], roomPlayerLimits(mode), mode);
  }

});
