import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { validateWord } from '../server/rules.js';

function setup(t, settings = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager();
  t.after(() => manager.close());
  const connect = (uid) => {
    const c = manager.connect(uid); c.messages = [];
    c.ws = { readyState: 1, send: (s) => c.messages.push(JSON.parse(s)), close() {} };
    return c;
  };
  const send = (c, message) => { t.mock.timers.tick(501); manager.handle(c, message); };
  const a = connect(), b = connect();
  send(a, { type: 'createRoom', ...settings });
  const room = manager.roomFor(a);
  send(b, { type: 'joinRoom', code: room.code });
  send(b, { type: 'setReady', ready: true });
  send(a, { type: 'start' });
  return { manager, connect, send, a, b, room };
}

test('词语验证和精确相遇隐藏写词', (t) => {
  const { send, a, b, room } = setup(t);
  send(a, { type: 'typing', word: '臺灣' });
  send(a, { type: 'submitWord', word: '臺灣' });
  const snapshot = b.messages.filter((m) => m.type === 'state').at(-1).room;
  assert.equal(snapshot.words, null);
  assert.ok(!JSON.stringify(snapshot).includes('臺灣'));
  send(b, { type: 'submitWord', word: '台湾' });
  assert.equal(room.phase, 'result'); assert.equal(room.outcome, 'exact');
  assert.equal(room.history[0].words[a.uid], '臺灣');
  assert.equal(validateWord('数字１２3'), '数字123');
  assert.equal(validateWord('123'), '123');
  assert.throws(() => validateWord('数字!'), /汉字、字母或数字/);
  assert.throws(() => validateWord('1234567890123'), /汉字、字母或数字/);
  assert.throws(() => validateWord('１２3', ['123']), /用过/);
  assert.throws(() => validateWord('台湾', ['臺灣']), /用过/);
});

test('投票保密、超时算否、准备以及重复词拒绝', (t) => {
  const { send, a, b, room, manager } = setup(t);
  send(a, { type: 'submitWord', word: '苹果' });
  send(b, { type: 'submitWord', word: '香蕉' });
  assert.equal(room.phase, 'voting');
  send(a, { type: 'vote', yes: true });
  const state = b.messages.filter((m) => m.type === 'state').at(-1).room;
  assert.equal(state.votes, null); assert.equal(state.players.find((p) => p.uid === a.uid).voted, true);
  manager.advanceDeadline(room);
  assert.equal(room.phase, 'prepare'); assert.equal(room.history[0].votes[b.uid], false);
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  assert.equal(room.phase, 'writing'); assert.equal(room.round, 2);
  assert.throws(() => send(a, { type: 'submitWord', word: '苹果' }), /用过/);
  send(a, { type: 'submitWord', word: '梨' }); send(b, { type: 'submitWord', word: '桃' });
  send(a, { type: 'vote', yes: true }); send(b, { type: 'vote', yes: true });
  assert.equal(room.phase, 'voting');
  manager.advanceDeadline(room);
  assert.equal(room.outcome, 'voted');
});

test('超时采用草稿并标注非法及空白，准备超时和轮次上限', (t) => {
  const { send, a, b, room, manager } = setup(t, { maxRounds: 4 });
  send(a, { type: 'typing', word: 'bad!' });
  manager.advanceDeadline(room);
  assert.equal(room.currentRecord.words[a.uid], '[非法答案]');
  assert.equal(room.currentRecord.words[b.uid], '[未提交]');
  manager.advanceDeadline(room); manager.advanceDeadline(room);
  assert.equal(room.round, 2);
  for (let i = 2; i <= 4; i++) {
    manager.advanceDeadline(room); manager.advanceDeadline(room);
    if (i < 4) manager.advanceDeadline(room);
  }
  assert.equal(room.phase, 'result'); assert.equal(room.outcome, 'none');
});

test('离开保留座位并排除当前参与人数，原 UID 回归与到期拒绝', (t) => {
  const { send, a, b, room, manager, connect } = setup(t);
  const seat = manager.playerFor(room, b.uid).seat;
  send(b, { type: 'leave' });
  assert.equal(room.players.length, 2); assert.equal(manager.playerFor(room, b.uid).connected, false);
  assert.ok(a.messages.some((m) => m.type === 'toast' && m.event === 'leave' && m.uid === b.uid));
  assert.equal(manager.restore(b, room.code), true);
  assert.equal(manager.playerFor(room, b.uid).seat, seat);
  manager.disconnect(b);
  const restored = connect(b.uid);
  assert.equal(manager.restore(restored, room.code), true);
  assert.ok(a.messages.some((m) => m.type === 'toast' && m.event === 'return' && m.uid === b.uid));
  manager.disconnect(restored);
  t.mock.timers.tick(90000);
  const late = connect(b.uid);
  assert.equal(manager.restore(late, room.code), false);
  assert.equal(room.players.length, 1);
});
