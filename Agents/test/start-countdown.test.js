import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../server/rooms.js';
import { startCountdownMarkup } from '../../public/render.js';
import { countdownState } from '../../public/countdown.js';

test('开局倒计时同步主题，结束后才开始完整写词时间，重赛同样倒计时', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager();
  t.after(() => manager.close());
  const clients = [manager.connect(), manager.connect()];
  for (const client of clients) {
    client.messages = [];
    client.ws = { readyState: 1, send: raw => client.messages.push(JSON.parse(raw)), close() {} };
  }
  const send = (client, message) => { t.mock.timers.tick(501); manager.handle(client, message); };
  const [a, b] = clients;
  send(a, { type: 'createRoom', mode: 'theme' });
  const room = manager.roomFor(a);
  send(b, { type: 'joinRoom', code: room.code });
  send(b, { type: 'setReady', ready: true });
  send(a, { type: 'start' });
  assert.equal(room.phase, 'countdown');
  assert.equal(room.phaseDeadline - Date.now(), 5000);
  assert.ok(room.themeName);
  assert.equal(countdownState(room, Date.now()).seconds, 5);
  assert.equal(clients[1].messages.filter(m => m.type === 'state').at(-1).room.themeName, room.themeName);
  assert.throws(() => send(a, { type: 'submitWord', word: '苹果' }), /当前不能提交/);
  assert.equal(room.phase, 'countdown');
  assert.equal(room.round, 0);
  t.mock.timers.setTime(room.phaseDeadline);
  manager.advanceDeadline(room);
  assert.equal(room.phase, 'writing');
  assert.equal(room.round, 1);
  assert.equal(room.phaseDeadline - Date.now(), room.writeSeconds * 1000);
  send(a, { type: 'submitWord', word: '苹果' });
  send(b, { type: 'submitWord', word: '苹果' });
  assert.equal(room.phase, 'result');
  send(a, { type: 'rematch', choice: 'rematch' });
  send(b, { type: 'rematch', choice: 'rematch' });
  assert.equal(room.phase, 'countdown');
  assert.equal(room.phaseDeadline - Date.now(), 5000);
});

test('准备页仅在有主题时显示主题，并转义内容', () => {
  const themed = startCountdownMarkup({ code: '12345', mode: 'theme', themeName: '<主题>' });
  assert.match(themed, /&lt;主题&gt;/);
  assert.match(themed, /id="countdown"/);
  assert.doesNotMatch(startCountdownMarkup({ mode: 'free' }), /本局主题/);
  assert.doesNotMatch(startCountdownMarkup({ mode: 'theme', themeName: null }), /本局主题/);
});

test('倒计时期间只剩一人时中断对局', t => {
  const manager = new RoomManager();
  t.after(() => manager.close());
  const room = { phase: 'countdown', players: [{ connected: true }], history: [] };
  manager.checkProgress(room);
  assert.equal(room.phase, 'interrupted');
});
