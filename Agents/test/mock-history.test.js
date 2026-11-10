import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';
import { createMockControls } from '../../server/mock.js';

test('mock 档案预置三页记录，支持搜索与真实详情且不重复初始化', t => {
  const db = createDatabase(':memory:');
  const manager = new RoomManager({ db });
  createMockControls(manager);
  t.after(() => { manager.close(); db.close(); });
  const connection = manager.connect();
  const messages = [];
  connection.ws = { readyState: 1, send: text => messages.push(JSON.parse(text)) };
  const query = message => { manager.handle(connection, message); return messages.at(-1); };
  let profile = query({ type: 'openProfile' }).profile;
  assert.equal(profile.total, 24);
  assert.equal(profile.matches.length, 10);
  assert.equal(query({ type: 'openProfile', page: 3 }).profile.matches.length, 4);
  assert.equal(query({ type: 'openProfile' }).profile.total, 24);
  // 一段输入同时匹配房号、UID、名字、主题与时间
  assert.equal(query({ type: 'openProfile', filter: { type: 'any', value: '12345' } }).profile.total, 8);
  assert.equal(query({ type: 'openProfile', filter: { type: 'any', value: '123' } }).profile.total, 8);
  assert.equal(query({ type: 'openProfile', filter: { type: 'any', value: 'MOCK0003' } }).profile.total, 8);
  // 前三局每位朋友都可能在，前缀 MOCK00 覆盖全部 24 局
  assert.equal(query({ type: 'openProfile', filter: { type: 'any', value: 'MOCK00' } }).profile.total, 24);
  const recent = query({ type: 'openProfile', filter: { type: 'any', value: '', from: Date.now() - 86400000 } }).profile;
  assert.equal(recent.total, 1);
  assert.equal(query({ type: 'openProfile', filter: { type: 'any', value: '新点子' } }).profile.total, 8);
  assert.equal(query({ type: 'openProfile', filter: { type: 'any', value: '海洋' } }).profile.total, 12);
  const nameHit = query({ type: 'openProfile', filter: { type: 'any', value: '新点子' } }).profile.matches
    .find((match) => match.id === `mock-history-${connection.uid}-2`);
  assert.deepEqual(nameHit.hits, { room: false, theme: false, time: false, names: [{ name: '总有新点子的牛油果', whole: false }] });
  const matches = [0, 1, 2].map(i => query({ type: 'openMatch', id: `mock-history-${connection.uid}-${i}` }).match);
  assert.deepEqual(matches.map(m => m.outcome), ['exact', 'voted', 'none']);
  assert.deepEqual(matches.map(m => m.players.length), [2, 3, 4]);
  assert.equal(matches[0].themeName, '海洋');
  assert.equal(matches[1].mode, 'free');
  assert.equal(matches[2].history.length, 12);
  assert.equal(matches[2].history[1].marks.MOCK0001, 'empty');
  assert.equal(matches[2].history[2].marks.MOCK0002, 'invalid');
  assert.equal(matches[1].history.at(-1).votes[connection.uid], true);
});

test('正式 manager 不注入模拟历史', t => {
  const db = createDatabase(':memory:');
  const manager = new RoomManager({ db });
  t.after(() => { manager.close(); db.close(); });
  const connection = manager.connect();
  assert.equal(manager.profileFor(connection.uid).total, 0);
});

test('固定加入房间在机器人独自等待时保活，销毁后补回', t => {
  const db = createDatabase(':memory:');
  const manager = new RoomManager({ db });
  createMockControls(manager);
  t.after(() => { manager.close(); db.close(); });
  const room = manager.rooms.get('99999');
  assert.equal(room.players.length, 1);
  manager.cleanup(Date.now() + 600000);
  assert.equal(manager.rooms.get('99999'), room);
  manager.destroyRoom(room);
  manager.cleanup();
  const restored = manager.rooms.get('99999');
  assert.equal(restored.phase, 'lobby');
  assert.equal(restored.players.length, 1);
  assert.equal(restored.players[0].name, '加入测试机器人');
});
