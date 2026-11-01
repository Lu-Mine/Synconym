import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, createMemoryDb } from '../server/rooms.js';
import { DEFAULT_SETTINGS, normalizeWord, validateName, validateSettings } from '../server/rules.js';
import { avatarDetails, homeMarkup, lobbyMarkup, shellMarkup, writingMarkup } from '../public/render.js';

function client(manager, uid) {
  const connection = manager.connect(uid);
  connection.ws = { readyState: 1, send() {}, close() {} };
  return connection;
}
function passRateLimit(t) { t.mock.timers.tick(501); }

test('名字默认生成，改名保留 uid 并写入数据库', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const db = createMemoryDb();
  const manager = new RoomManager({ db });
  const a = client(manager);
  manager.handle(a, { type: 'createRoom' });
  const uid = a.uid;
  passRateLimit(t);
  manager.handle(a, { type: 'rename', name: '新的名字' });
  assert.equal(db.getPlayer(uid).name, '新的名字');
  assert.equal(manager.roomFor(a).players[0].uid, uid);
});

test('未进入房间也可以修改名字并收到用户资料状态', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const db = createMemoryDb();
  const manager = new RoomManager({ db });
  const states = [];
  const connection = manager.connect();
  connection.ws = { readyState: 1, send(payload) { states.push(JSON.parse(payload)); }, close() {} };

  manager.sendState(connection, null);
  assert.equal(states.at(-1).user.uid, connection.uid);
  assert.equal(states.at(-1).user.name, db.getPlayer(connection.uid).name);
  assert.equal(states.at(-1).room, null);

  passRateLimit(t);
  manager.handle(connection, { type: 'rename', name: '首页新名字' });
  assert.equal(db.getPlayer(connection.uid).name, '首页新名字');
  assert.equal(states.at(-1).user.name, '首页新名字');
});

test('凭房号加入、改名、准备、取消、房主开始', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager();
  const host = client(manager);
  manager.handle(host, { type: 'createRoom' });
  const room = manager.roomFor(host);
  const guest = client(manager);
  passRateLimit(t);
  manager.handle(guest, { type: 'joinRoom', code: room.code.toLowerCase() });
  assert.equal(room.players.length, 2);
  passRateLimit(t);
  assert.throws(() => manager.handle(host, { type: 'start' }), /所有在线玩家准备/);
  passRateLimit(t);
  manager.handle(guest, { type: 'rename', name: '同席新名字' });
  passRateLimit(t);
  manager.handle(host, { type: 'setReady', ready: true });
  passRateLimit(t);
  manager.handle(guest, { type: 'setReady', ready: true });
  passRateLimit(t);
  manager.handle(guest, { type: 'setReady', ready: false });
  passRateLimit(t);
  manager.handle(guest, { type: 'setReady', ready: true });
  passRateLimit(t);
  manager.handle(host, { type: 'start' });
  assert.equal(room.phase, 'writing');
  assert.equal(room.round, 1);
  assert.equal(manager.playerFor(room, guest.uid).name, '同席新名字');
});

test('断线 90 秒内保留席位，超过后移除并移交房主', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager();
  const host = client(manager);
  manager.handle(host, { type: 'createRoom' });
  const room = manager.roomFor(host);
  const guest = client(manager);
  passRateLimit(t);
  manager.handle(guest, { type: 'joinRoom', code: room.code });
  const seat = manager.playerFor(room, guest.uid).seat;
  manager.disconnect(guest);
  assert.equal(room.players.length, 2);
  const restored = client(manager, guest.uid);
  restored.roomCode = room.code;
  assert.equal(manager.playerFor(room, guest.uid).seat, seat);
  manager.disconnect(restored);
  t.mock.timers.tick(90001);
  manager.cleanup();
  assert.equal(room.players.length, 1);
  manager.disconnect(host);
  assert.equal(room.hostUid, host.uid);
  t.mock.timers.tick(90001);
  manager.cleanup();
  assert.equal(manager.rooms.has(room.code), false);
});

test('非房主不能改设置，四人满房，五分钟无活动清理', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager();
  const host = client(manager);
  manager.handle(host, { type: 'createRoom' });
  const room = manager.roomFor(host);
  const guests = [client(manager), client(manager), client(manager)];
  for (const guest of guests) {
    passRateLimit(t);
    manager.handle(guest, { type: 'joinRoom', code: room.code });
  }
  passRateLimit(t);
  assert.throws(() => manager.handle(guests[0], { type: 'updateSettings', maxRounds: 20 }), /只有房主/);
  passRateLimit(t);
  manager.handle(host, { type: 'updateSettings', maxRounds: 20, writeSeconds: 60 });
  assert.equal(room.maxRounds, 20);
  const fifth = client(manager);
  passRateLimit(t);
  assert.throws(() => manager.handle(fifth, { type: 'joinRoom', code: room.code }), /房间已满/);
  room.lastActiveAt = Date.now() - 300001;
  manager.cleanup();
  assert.equal(manager.rooms.has(room.code), false);
});

test('规则校验与繁简、空格归一', () => {
  assert.equal(normalizeWord(' iOS 手机 '), normalizeWord('ｉＯＳ手机'));
  assert.equal(normalizeWord('憂鬱'), normalizeWord('忧郁'));
  assert.equal(validateSettings({}).maxRounds, 12);
  assert.throws(() => validateSettings({ maxRounds: 3 }));
  assert.equal(validateName(' 名字 '), '名字');
  assert.throws(() => validateName('十三个字符的名字不能通过验证'));
});

test('设置校验兼容字符串数值，且所有控件按钮均显式声明 type 防止页面刷新', () => {
  const parsed = validateSettings({ maxRounds: '16', writeSeconds: '30', prepareSeconds: '15', banRepeat: false });
  assert.deepEqual(parsed, { mode: 'free', maxRounds: 16, writeSeconds: 30, prepareSeconds: 15, banRepeat: false });

  const sampleRoom = {
    code: 'ABCD',
    ...DEFAULT_SETTINGS,
    phase: 'lobby',
    round: 1,
    hostUid: 'u1',
    players: [
      { uid: 'u1', name: '甲', seat: 0, connected: true, ready: false },
      { uid: 'u2', name: '乙', seat: 1, connected: true, ready: true }
    ]
  };
  const markups = [
    shellMarkup(true, { uid: 'user-uid', name: '甲' }, true),
    homeMarkup(DEFAULT_SETTINGS, true),
    lobbyMarkup({ room: sampleRoom, uid: 'u1', user: { uid: 'u1', name: '甲' } }, true),
    writingMarkup({ room: { ...sampleRoom, phase: 'writing' }, uid: 'u1', user: { uid: 'u1', name: '甲' } })
  ];
  const allTags = markups.flatMap((html) => html.match(/<button\b[^>]*>/g) || []);
  assert.ok(allTags.length > 0);
  for (const tag of allTags) {
    assert.match(tag, /\btype="(button|submit)"/, `按钮缺少显式 type 属性: ${tag}`);
  }
});

test('header 展示用户与 UID，玩家改名按钮位于名字右侧', () => {
  const shell = shellMarkup(false, { uid: 'uid-123', name: '测试用户' }, true);
  assert.match(shell, /header-user-name[^>]*>测试用户</);
  assert.match(shell, /UID：uid-123/);
  assert.match(shell, /rename-modal is-open/);

  const room = {
    code: 'ABCD', ...DEFAULT_SETTINGS, phase: 'lobby', round: 0, hostUid: 'u1',
    players: [{ uid: 'u1', name: '甲', seat: 0, connected: true, ready: false }]
  };
  const lobby = lobbyMarkup({ room, uid: 'u1', user: { uid: 'u1', name: '甲' } });
  assert.match(lobby, /player-name-row[\s\S]*player-name[^>]*>甲<[\s\S]*rename-trigger[\s\S]*<\/div>/);
});

test('文字头像按完整名字稳定映射四种配色', () => {
  const first = avatarDetails('随和的荔枝');
  assert.deepEqual(avatarDetails('随和的荔枝'), first);
  assert.equal(first.initial, '随');
  assert.equal(avatarDetails('Alice').initial, 'A');

  const tones = new Set(Array.from({ length: 64 }, (_, index) => `用户${index}`)
    .map((name) => avatarDetails(name).tone));
  assert.deepEqual([...tones].sort(), [0, 1, 2, 3]);

  const shell = shellMarkup(false, { uid: 'u1', name: '随和的荔枝' });
  assert.match(shell, new RegExp(`data-avatar-tone="${first.tone}"[^>]*>随<`));
});
