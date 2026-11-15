import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';
import { createMockControls } from '../../server/mock.js';

function setup(t, mode = 'livonym') {
  const db = createDatabase(':memory:');
  const manager = new RoomManager({ db });
  const controls = createMockControls(manager);
  t.after(() => { manager.close(); db.close(); });
  const user = manager.connect();
  user.ws = { readyState: 1, send() {}, close() {} };
  manager.handle(user, { type: 'createRoom', mode });
  return { manager, controls, user, room: manager.roomFor(user) };
}

function playToDescribing(controls, user, room) {
  controls.handle(user, { action: 'start' });
  controls.handle(user, { action: 'advance' });
  assert.equal(room.phase, 'lvIntro');
  controls.handle(user, { action: 'advance' });
  assert.equal(room.phase, 'lvPlay');
}

test('即时竞猜大厅的模拟玩家默认已准备，并按房间人数上限添加', t => {
  const { controls, user, room } = setup(t);
  assert.equal(room.players.length, 1);
  for (let index = 0; index < 7; index += 1) controls.handle(user, { action: 'add' });
  assert.equal(room.players.length, 8, '即时竞猜可以加到 8 人');
  for (const player of room.players.filter(player => player.uid !== user.uid)) {
    assert.equal(player.ready, true, '添加的模拟玩家默认已准备');
    assert.equal(player.connected, true);
  }
  assert.throws(() => controls.handle(user, { action: 'add' }), /未满员/);
});

test('自由房间的模拟玩家仍按 4 人上限添加', t => {
  const { controls, user, room } = setup(t, 'free');
  for (let index = 0; index < 3; index += 1) controls.handle(user, { action: 'add' });
  assert.equal(room.players.length, 4);
  assert.throws(() => controls.handle(user, { action: 'add' }), /未满员/);
});

test('模拟玩家无需手动准备即可开局，并能猜中谜底', t => {
  const { controls, user, room } = setup(t);
  controls.handle(user, { action: 'add' });
  controls.handle(user, { action: 'add' });
  assert.equal(room.players.length, 3);
  playToDescribing(controls, user, room);
  const describerUid = room.livonym.order[room.livonym.index];
  assert.equal(describerUid, user.uid);
  const guesser = room.players.find(player => player.uid !== user.uid);
  controls.handle(user, { action: 'guess', uid: guesser.uid });
  assert.ok(room.livonym.guessed.some(item => item.uid === guesser.uid));
  assert.throws(() => controls.handle(user, { action: 'describe', uid: guesser.uid, text: 'abcdefg' }), /不是这位模拟玩家出题/);
});

test('出题人是模拟玩家时按面板文本描述，猜中后轮到下一棒', t => {
  const { controls, user, room } = setup(t);
  controls.handle(user, { action: 'add' });
  controls.handle(user, { action: 'add' });
  playToDescribing(controls, user, room);
  const [first, second] = room.players.filter(player => player.uid !== user.uid);
  controls.handle(user, { action: 'guess', uid: first.uid });
  controls.handle(user, { action: 'guess', uid: second.uid });
  assert.equal(room.phase, 'lvScore', '全员猜中即结算本轮');
  controls.handle(user, { action: 'advance' });
  assert.equal(room.phase, 'lvIntro');
  controls.handle(user, { action: 'advance' });
  assert.equal(room.phase, 'lvPlay');
  const describerUid = room.livonym.order[room.livonym.index];
  assert.equal(describerUid, first.uid);
  controls.handle(user, { action: 'describe', uid: first.uid, text: 'abcdefg' });
  assert.equal(room.livonym.stream.text, 'abcdefg');
  assert.throws(() => controls.handle(user, { action: 'guess', uid: first.uid }), /由这位模拟玩家出题/);
  controls.handle(user, { action: 'guess', uid: second.uid });
  assert.ok(room.livonym.guessed.some(item => item.uid === second.uid), '跨轮立刻猜中不受上一轮冷却影响');
  assert.throws(() => controls.handle(user, { action: 'guess', uid: second.uid }), /已经猜中/);
});
