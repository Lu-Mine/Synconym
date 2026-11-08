import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../server/rooms.js';
import { validateSettings } from '../../server/rules.js';
import { settingsMarkup, shellMarkup } from '../../public/render.js';

test('密码严格为六位数字字符串，关闭时清除密码', () => {
  for (const password of ['', '12345', '1234567', 'abcdef', '１２３４５６', 123456]) {
    assert.throws(() => validateSettings({ passwordEnabled: true, password }), /6 位数字/);
  }
  assert.equal(validateSettings({ passwordEnabled: true, password: '001234' }).password, '001234');
  assert.equal(validateSettings({ passwordEnabled: false, password: '001234' }).password, '');
});

test('加密房间校验入房、权限、快照、重连及关闭密码', (t) => {
  const manager = new RoomManager();
  t.after(() => manager.close());
  const host = manager.connect(), guest = manager.connect();
  const send = (client, message) => { client.lastWrite = 0; manager.handle(client, message); };
  send(host, { type: 'createRoom', passwordEnabled: true, password: '001234' });
  const room = manager.roomFor(host), code = room.code;
  for (const password of [undefined, '123456', 1234]) {
    assert.throws(() => send(guest, { type: 'joinRoom', code, password }), /密码错误/);
    assert.equal(guest.roomCode, null);
  }
  send(guest, { type: 'joinRoom', code, password: '001234' });
  assert.throws(() => send(guest, { type: 'updateSettings', passwordEnabled: false }), /只有房主/);
  let snapshot;
  guest.ws = { readyState: 1, send: (data) => { snapshot = JSON.parse(data); } };
  manager.sendState(guest);
  assert.equal(snapshot.room.passwordEnabled, true);
  assert.equal(Object.hasOwn(snapshot.room, 'password'), false);
  manager.disconnect(guest);
  const restored = manager.connect(guest.uid);
  assert.equal(manager.restore(restored, code), true);
  send(restored, { type: 'leave' });
  assert.throws(() => send(restored, { type: 'joinRecentRoom', code }), /密码错误/);
  send(host, { type: 'updateSettings', maxRounds: 8 });
  assert.equal(room.password, '001234');
  assert.throws(() => send(host, { type: 'updateSettings', password: '12' }), /6 位数字/);
  assert.equal(room.password, '001234');
  send(host, { type: 'updateSettings', passwordEnabled: false });
  assert.equal(room.password, '');
  send(restored, { type: 'joinRoom', code });
  assert.equal(restored.roomCode, code);
});

test('仅房主有密码设置输入，加入弹窗含提示', () => {
  const settings = validateSettings({ passwordEnabled: true, password: '001234' });
  assert.match(settingsMarkup(settings, true), /id="room-password"/);
  assert.match(settingsMarkup(settings, true), /inputmode="numeric"/);
  assert.doesNotMatch(settingsMarkup(settings, false), /001234|id="room-password"/);
  assert.match(shellMarkup(), /id="join-password"/);
  assert.match(shellMarkup(), /房主提供的 6 位数字密码/);
});
