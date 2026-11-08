import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';

const themes = JSON.parse(readFileSync(new URL('../../data/themes.json', import.meta.url), 'utf8'));
const snapshot = (c) => c.messages.filter((m) => m.type === 'state').at(-1).room;

function setup(t, mode = 'theme') {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const db = createDatabase(':memory:');
  const manager = new RoomManager({ db });
  t.after(() => { manager.close(); db.close(); });
  const clients = Array.from({ length: 2 }, () => {
    const c = manager.connect(); c.messages = [];
    c.ws = { readyState: 1, send: (data) => c.messages.push(JSON.parse(data)) };
    return c;
  });
  const send = (c, msg) => {
    t.mock.timers.tick(501);
    const current = c.roomCode ? manager.rooms.get(c.roomCode) : null;
    if (current?.phase === 'countdown' && msg.type === 'submitWord') manager.advanceDeadline(current);
    manager.handle(c, msg);
  };
  const [a, b] = clients;
  send(a, { type: 'createRoom', mode, themeId: 'pets', themeName: '伪造' });
  const room = manager.roomFor(a);
  send(b, { type: 'joinRoom', code: room.code });
  send(b, { type: 'setReady', ready: true });
  return { manager, db, room, a, b, send };
}

function finish(send, a, b, word = '王者荣耀') {
  send(a, { type: 'submitWord', word });
  send(b, { type: 'submitWord', word });
}

test('主题目录固定且包含全部二十个名称', () => {
  assert.deepEqual(themes.map((t) => t.name), ['王者荣耀', 'B站UP主', '欧美音乐', '国语音乐', '春节', '火锅', '高铁出行', '校园', '故宫', '熊猫', '海洋', '天气预报', '短视频', '网购', '手机', '装修', '露营', '咖啡', '传统中医', '宠物']);
  assert.equal(new Set(themes.map((t) => t.id)).size, 20);
  assert.ok(themes.every((t) => typeof t.id === 'string' && t.id.length));
});

test('主题每局抽一次，跨轮和断线重连锁定，持久化及重赛重抽', (t) => {
  const { manager, db, room, a, b, send } = setup(t);
  let draws = 0;
  manager.random = () => { draws++; return draws === 1 ? 0 : 0.99; };
  assert.equal(snapshot(a).themeId, null);
  send(a, { type: 'start', themeId: 'pets' });
  assert.equal(draws, 1); assert.equal(room.themeId, themes[0].id);
  assert.equal(snapshot(b).themeName, themes[0].name);
  send(a, { type: 'submitWord', word: '苹果' });
  send(b, { type: 'submitWord', word: '香蕉' });
  send(a, { type: 'vote', yes: false });
  assert.equal(room.phase, 'prepare');
  manager.advanceDeadline(room);
  assert.equal(room.round, 2); assert.equal(draws, 1);
  manager.disconnect(b);
  const restored = manager.connect(b.uid); restored.messages = [];
  restored.ws = { readyState: 1, send: (data) => restored.messages.push(JSON.parse(data)) };
  assert.equal(manager.restore(restored, room.code), true);
  assert.equal(snapshot(restored).themeId, themes[0].id);
  assert.equal(snapshot(restored).themeName, themes[0].name);
  finish(send, a, restored);
  assert.equal(room.phase, 'result'); assert.equal(db.getMatch(room.matchId).themeId, themes[0].id);
  send(a, { type: 'rematch', choice: 'rematch' });
  send(restored, { type: 'rematch', choice: 'rematch' });
  assert.equal(draws, 2); assert.equal(room.themeId, themes[19].id);
  finish(send, a, restored, '猫');
  assert.equal(db.getMatch(room.matchId).themeId, themes[19].id);
  send(a, { type: 'rematch', choice: 'room' });
  send(restored, { type: 'rematch', choice: 'room' });
  assert.equal(room.phase, 'lobby'); assert.equal(snapshot(a).themeId, null); assert.equal(snapshot(a).themeName, null);
});

test('允许重复抽中同一主题，自由模式不抽取且不接受客户端指定', (t) => {
  const { manager, db, room, a, b, send } = setup(t);
  let draws = 0; manager.random = () => { draws++; return 0; };
  send(a, { type: 'start' }); finish(send, a, b);
  send(a, { type: 'rematch', choice: 'rematch' }); send(b, { type: 'rematch', choice: 'rematch' });
  assert.equal(draws, 2); assert.equal(room.themeId, themes[0].id);
  finish(send, a, b); send(a, { type: 'rematch', choice: 'room' }); send(b, { type: 'rematch', choice: 'room' });
  send(a, { type: 'updateSettings', mode: 'free', themeId: themes[1].id, themeName: '伪造' });
  send(b, { type: 'setReady', ready: true }); send(a, { type: 'start', themeId: themes[1].id });
  assert.equal(draws, 2); assert.equal(snapshot(a).themeId, null); assert.equal(snapshot(a).themeName, null);
  finish(send, a, b); assert.equal(db.getMatch(room.matchId).themeId, null);
});

test('主题模式保留普通词语规则，不添加主题禁词校验', (t) => {
  const { manager, room, a, b, send } = setup(t);
  manager.random = () => 0;
  send(a, { type: 'start' });
  assert.throws(() => send(a, { type: 'submitWord', word: '非法!' }), /请输入/);
  send(a, { type: 'submitWord', word: '王者荣耀' });
  send(b, { type: 'submitWord', word: '香蕉' });
  send(a, { type: 'vote', yes: false }); manager.advanceDeadline(room);
  assert.throws(() => send(a, { type: 'submitWord', word: '王者荣耀' }), /用过/);
});
