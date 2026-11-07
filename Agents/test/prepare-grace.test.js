import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../server/rooms.js';
import { countdownState } from '../../public/countdown.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager(); t.after(() => manager.close());
  const clients = Array.from({ length: 3 }, () => { const c = manager.connect(); c.messages = []; c.ws = { readyState: 1, send: raw => c.messages.push(JSON.parse(raw)), close() {} }; return c; });
  const send = (c, message) => { t.mock.timers.tick(501); manager.handle(c, message); };
  const [a, b, c] = clients;
  send(a, { type: 'createRoom', prepareSeconds: 15 }); const room = manager.roomFor(a);
  for (const client of [b, c]) { send(client, { type: 'joinRoom', code: room.code }); send(client, { type: 'setReady', ready: true }); }
  send(a, { type: 'start' });
  const miss = () => { manager.reveal(room); manager.finishVote(room); };
  return { manager, room, clients, send, miss };
}

test('准备开始仍掉线则额外10秒，在线全准备也不跳过蓝色等待期', t => {
  const { manager, room, clients: [a, b, c], send, miss } = setup(t);
  manager.disconnect(c); miss();
  assert.equal(room.phaseDeadline - Date.now(), 25000);
  assert.equal(room.prepareGraceDeadline - Date.now(), 10000);
  assert.equal(room.prepareSeconds, 15);
  const deadline = room.prepareGraceDeadline;
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  assert.equal(room.phase, 'prepare');
  t.mock.timers.setTime(deadline - 1); manager.checkProgress(room); assert.equal(room.phase, 'prepare');
  t.mock.timers.setTime(deadline); manager.checkProgress(room); assert.equal(room.phase, 'writing');
  assert.equal(room.prepareGraceDeadline, null);
});

test('多个掉线只加一次；重连和重复掉线不延长已开始的准备等待', t => {
  const { manager, room, clients: [, b, c], miss } = setup(t);
  manager.disconnect(b); manager.disconnect(c); miss();
  const deadline = room.phaseDeadline, grace = room.prepareGraceDeadline;
  assert.equal(deadline - Date.now(), 25000);
  const restored = manager.connect(b.uid); restored.ws = { readyState: 1, send() {}, close() {} };
  manager.restore(restored, room.code); manager.disconnect(restored);
  assert.equal(room.phaseDeadline, deadline); assert.equal(room.prepareGraceDeadline, grace);
});

test('正常轮次和主动退出不触发掉线加时；已重连者不触发加时', t => {
  const { manager, room, clients: [, , c], send, miss } = setup(t);
  send(c, { type: 'leave' }); miss();
  assert.equal(room.phaseDeadline - Date.now(), 15000); assert.equal(room.prepareGraceDeadline, null);
});

test('蓝色等待期结束自动检查已准备状态，不需要额外玩家消息', t => {
  const { manager, room, clients: [a, b, c], send } = setup(t);
  const timers = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { timers.push({ callback, delay }); return { unref() {} }; });
  manager.disconnect(c); manager.reveal(room); manager.finishVote(room);
  const graceTimer = timers.find(timer => timer.delay === 10000);
  assert.ok(graceTimer);
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  t.mock.timers.setTime(room.prepareGraceDeadline); graceTimer.callback();
  assert.equal(room.phase, 'writing');
});

test('前10秒蓝色，之后回正常计时，最后10秒仍紧急色', () => {
  const room = { phase: 'prepare', phaseDeadline: 25000, prepareGraceDeadline: 10000 };
  assert.deepEqual(countdownState(room, 0), { seconds: 25, grace: true, urgent: false });
  assert.deepEqual(countdownState(room, 9999), { seconds: 16, grace: true, urgent: false });
  assert.deepEqual(countdownState(room, 10000), { seconds: 15, grace: false, urgent: false });
  assert.deepEqual(countdownState(room, 15000), { seconds: 10, grace: false, urgent: true });
  assert.equal(countdownState({ ...room, phase: 'writing' }, 0).grace, false);
});

test('准备前已重连不额外等待，切换阶段后旧加时回调失效', t => {
  const { manager, room, clients: [, , c], miss } = setup(t);
  manager.disconnect(c);
  const restored = manager.connect(c.uid); restored.ws = { readyState: 1, send() {}, close() {} };
  manager.restore(restored, room.code); miss();
  assert.equal(room.phaseDeadline - Date.now(), 15000);
  assert.equal(room.prepareGraceDeadline, null);
  manager.startWriting(room); manager.disconnect(restored);
  const timers = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { timers.push({ callback, delay }); return { unref() {} }; });
  miss(); const callback = timers.find(timer => timer.delay === 10000).callback;
  manager.startWriting(room); const round = room.round;
  callback(); assert.equal(room.round, round); assert.equal(room.phase, 'writing');
});
