import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { normalizeDeviceProfile, decideAdoption, collectDeviceLinks } from '../../server/identity.js';
import { RoomManager } from '../../server/rooms.js';
import { createSynconymServer } from '../../server/index.js';
import { createDatabase } from '../../server/db.js';

const day = 24 * 60 * 60 * 1000;

// 同一台 iPhone 上 Safari 与微信内置浏览器：系统、屏幕、时区一致，只有浏览器名与版本不同。
const SAFARI = {
  os: 'ios', osVersion: '17.5', model: '', screen: '393x852', dpr: '3',
  timezone: 'Asia/Shanghai', languages: 'zh-CN,zh', cores: '6', memory: '', touch: '5',
  gpu: 'Apple GPU', browser: 'safari', browserVersion: '17.5'
};
const WECHAT = { ...SAFARI, browser: 'wechat', browserVersion: '8.0.44' };
const UPGRADED = { ...SAFARI, osVersion: '18.0', browser: 'safari', browserVersion: '18.0' };

test('设备特征只保留白名单字段，缺少系统或屏幕时不可用', () => {
  const profile = normalizeDeviceProfile({ ...SAFARI, ip: '203.0.113.9', canvas: 'x'.repeat(200) });
  assert.ok(profile.deviceKey);
  assert.doesNotMatch(profile.profile, /203\.0\.113\.9/);
  assert.doesNotMatch(profile.profile, /canvas/);
  assert.equal(normalizeDeviceProfile({ ...SAFARI, screen: '' }), null);
  assert.equal(normalizeDeviceProfile({ ...SAFARI, os: '' }), null);
  assert.equal(normalizeDeviceProfile(null), null);
  assert.equal(normalizeDeviceProfile('ios'), null);
  assert.equal(normalizeDeviceProfile([SAFARI]), null);
});

test('超长字段被截断，不会撑大指纹', () => {
  const profile = normalizeDeviceProfile({ ...SAFARI, gpu: 'g'.repeat(500) });
  assert.ok(profile.profile.length < 700);
});

test('同一台设备的浏览器升级后强指纹变化、弱指纹不变', () => {
  const safari = normalizeDeviceProfile(SAFARI);
  const wechat = normalizeDeviceProfile(WECHAT);
  const upgraded = normalizeDeviceProfile(UPGRADED);
  assert.notEqual(safari.deviceKey, wechat.deviceKey);
  assert.equal(safari.weakKey, wechat.weakKey);
  assert.equal(safari.weakKey, upgraded.weakKey);
  assert.notEqual(safari.deviceKey, upgraded.deviceKey);
});

test('换网络不影响指纹', () => {
  const before = normalizeDeviceProfile(SAFARI);
  const after = normalizeDeviceProfile({ ...SAFARI, ip: '198.51.100.7', network: '4g' });
  assert.equal(before.deviceKey, after.deviceKey);
});

test('只有一个新鲜绑定时自动沿用，不需要确认', () => {
  const now = 1_000 * day;
  const decision = decideAdoption({ links: [{ uid: 'ABCD2345', last_seen: now - day }], now });
  assert.equal(decision.action, 'adopt');
  assert.equal(decision.uid, 'ABCD2345');
});

test('同设备有多个身份时降级为选择', () => {
  const now = 1_000 * day;
  const decision = decideAdoption({
    links: [{ uid: 'ABCD2345', last_seen: now - day }, { uid: 'EFGH6789', last_seen: now - 2 * day }], now
  });
  assert.equal(decision.action, 'choose');
  assert.equal(decision.reason, 'multiple');
  assert.deepEqual(decision.candidates, ['ABCD2345', 'EFGH6789']);
});

test('该身份正在房间里游玩时降级为选择', () => {
  const now = 1_000 * day;
  const decision = decideAdoption({
    links: [{ uid: 'ABCD2345', last_seen: now - 1000 }], playing: (uid) => uid === 'ABCD2345', now
  });
  assert.equal(decision.action, 'choose');
  assert.equal(decision.reason, 'playing');
});

test('被否认过的身份不再参与自动沿用', () => {
  const now = 1_000 * day;
  const decision = decideAdoption({
    links: [{ uid: 'ABCD2345', last_seen: now - 1000 }], rejected: (uid) => uid === 'ABCD2345', now
  });
  assert.equal(decision.action, 'none');
});

test('超过采纳期的陈旧绑定不再自动沿用', () => {
  const now = 1_000 * day;
  const decision = decideAdoption({ links: [{ uid: 'ABCD2345', last_seen: now - 45 * day }], now });
  assert.equal(decision.action, 'none');
});

test('confirm 档一律让用户确认', () => {
  const now = 1_000 * day;
  const decision = decideAdoption({ links: [{ uid: 'ABCD2345', last_seen: now }], adopt: 'confirm', now });
  assert.equal(decision.action, 'choose');
  assert.equal(decision.reason, 'confirm');
});

test('强指纹与弱指纹命中的设备绑定合并去重', () => {
  const device = normalizeDeviceProfile(SAFARI);
  const upgraded = normalizeDeviceProfile(UPGRADED);
  const database = {
    getDeviceLinks: (key) => (key === upgraded.deviceKey ? [{ uid: 'WEAK2345', last_seen: 1 }] : [{ uid: 'ABCD2345', last_seen: 2 }]),
    devicesByWeakKey: () => [{ device_key: upgraded.deviceKey }]
  };
  const links = collectDeviceLinks(database, device);
  assert.deepEqual(links.map((link) => link.uid).sort(), ['ABCD2345', 'WEAK2345']);
});

async function startServer(t, options = {}) {
  const db = createDatabase(':memory:');
  const instance = createSynconymServer({ db, ...options });
  instance.server.listen(0, '127.0.0.1');
  await once(instance.server, 'listening');
  t.after(() => {
    for (const ws of instance.wss.clients) ws.terminate();
    instance.server.close();
    db.close();
  });
  return { db, server: instance.server };
}

// 每个连接都有 4 秒兜底，卡住会变成明确的失败而不是挂死整个测试进程。
function connect(port, hello) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const client = { ws, hello: null, states: [], identities: [], profiles: [], errors: [] };
    const timer = setTimeout(() => reject(new Error('连接超时')), 4000);
    const settle = () => { clearTimeout(timer); resolve(client); };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', ...hello })));
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'hello') { client.hello = message; settle(); }
      if (message.type === 'state') client.states.push(message);
      if (message.type === 'identity') client.identities.push(message);
      if (message.type === 'profile') client.profiles.push(message.profile);
      if (message.type === 'error') { client.errors.push(message.message); settle(); }
    });
    ws.on('close', (code) => { client.closeCode = code; settle(); });
    ws.on('error', (error) => { client.error = error; settle(); });
  });
}

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('等待条件超时');
}

test('同一台设备换浏览器自动沿用同一身份，且不弹确认', async (t) => {
  const { server, db } = await startServer(t);
  const port = server.address().port;
  const first = await connect(port, { device: SAFARI });
  assert.deepEqual(first.errors, []);
  assert.equal(first.hello.deviceCandidates, undefined);
  const uid = first.hello.uid;
  assert.ok(db.getPlayer(uid));
  const second = await connect(port, { device: WECHAT });
  assert.deepEqual(second.errors, []);
  assert.equal(second.hello.uid, uid);
  assert.equal(second.hello.deviceCandidates, undefined);
  assert.ok(second.hello.credential);
  assert.notEqual(second.hello.credential, first.hello.credential);
  assert.equal(db.countCredentials(uid), 2);
  first.ws.close(); second.ws.close();
});

test('该身份正在房间里游玩时下发候选，由用户选择', async (t) => {
  const { server } = await startServer(t);
  const port = server.address().port;
  const first = await connect(port, { device: SAFARI });
  const uid = first.hello.uid;
  first.ws.send(JSON.stringify({ type: 'createRoom' }));
  await waitFor(() => first.states.some((state) => state.room));
  const second = await connect(port, { device: WECHAT });
  assert.equal(second.hello.deviceCandidates?.reason, 'playing');
  assert.equal(second.hello.deviceCandidates.candidates[0].uid, uid);
  assert.notEqual(second.hello.uid, uid);
  first.ws.close(); second.ws.close();
});

test('否认卡片上的身份后，该设备不再提示', async (t) => {
  const { server, db } = await startServer(t);
  const port = server.address().port;
  const first = await connect(port, { device: SAFARI });
  const uid = first.hello.uid;
  first.ws.send(JSON.stringify({ type: 'createRoom' }));
  await waitFor(() => first.states.some((state) => state.room));
  const second = await connect(port, { device: WECHAT });
  assert.equal(second.hello.deviceCandidates?.reason, 'playing');
  second.ws.send(JSON.stringify({ type: 'rejectDevice', uid }));
  await waitFor(() => db.isDeviceRejected(normalizeDeviceProfile(WECHAT).deviceKey, uid));
  second.ws.close();
  const third = await connect(port, { device: WECHAT });
  assert.equal(third.hello.deviceCandidates, undefined);
  assert.notEqual(third.hello.uid, uid);
  first.ws.close(); third.ws.close();
});

test('超大的设备字段被忽略，但登录照常成功', async (t) => {
  const { server } = await startServer(t);
  const port = server.address().port;
  const client = await connect(port, { device: { ...SAFARI, gpu: 'g'.repeat(2000) } });
  assert.deepEqual(client.errors, []);
  assert.ok(client.hello.uid);
  client.ws.close();
});

test('confirm 档在只有一台设备时也要确认', async (t) => {
  const { server } = await startServer(t, { identity: { adopt: 'confirm' } });
  const port = server.address().port;
  const first = await connect(port, { device: SAFARI });
  const uid = first.hello.uid;
  first.ws.close();
  const second = await connect(port, { device: WECHAT });
  assert.equal(second.hello.deviceCandidates?.reason, 'confirm');
  assert.equal(second.hello.deviceCandidates.candidates[0].uid, uid);
  second.ws.close();
});

test('脱离当前身份时，别的浏览器还认得的旧身份原样保留', async (t) => {
  const { server, db } = await startServer(t);
  const port = server.address().port;
  // 同一台设备的两个浏览器共享身份：留下的那个就是旧身份的看守者。
  const keeper = await connect(port, { device: SAFARI });
  const uid = keeper.hello.uid;
  const name = db.getPlayer(uid).name;
  const leaver = await connect(port, { device: WECHAT });
  assert.equal(leaver.hello.uid, uid);

  leaver.ws.send(JSON.stringify({ type: 'leaveIdentity' }));
  await waitFor(() => leaver.identities.length > 0);

  assert.notEqual(leaver.identities.at(-1).uid, uid);
  assert.equal(leaver.identities.at(-1).orphaned, false);
  assert.ok(db.getPlayer(uid), '旧身份还有看守者，不能被注销');
  assert.equal(db.getPlayer(uid).name, name);
  keeper.ws.close(); leaver.ws.close();
});

test('档案给出 soleOwner 标记，说明脱离后旧身份会不会失主', async (t) => {
  const { server } = await startServer(t);
  const port = server.address().port;
  const solo = await connect(port, { device: SAFARI });
  solo.ws.send(JSON.stringify({ type: 'openProfile' }));
  await waitFor(() => solo.profiles.length > 0);
  assert.equal(solo.profiles.at(-1).user.soleOwner, true);
  solo.ws.close();
});

test('启动巡检只注销早就没人认得的身份', async (t) => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const hoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const orphan = db.createPlayer('ORPHAN01', '孤儿', hoursAgo);
  const owned = db.createPlayer('OWNED001', '有主', hoursAgo);
  db.addCredential(owned.uid, Buffer.from('owned'), hoursAgo);
  const fresh = db.createPlayer('FRESH001', '刚建的');
  const manager = new RoomManager({ db });
  t.after(() => manager.close());

  assert.equal(manager.sweepOwnerlessIdentities(), 1);
  assert.equal(db.getPlayer(orphan.uid), undefined);
  assert.ok(db.getPlayer(owned.uid));
  assert.ok(db.getPlayer(fresh.uid));
});

test('认领设备上另一个身份时，被放弃的那个若无主也注销', (t) => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const manager = new RoomManager({ db });
  t.after(() => manager.close());
  manager.issueCredential = (uid) => { db.addCredential(uid, Buffer.from(uid)); return 'c'.repeat(43); };
  db.insertDevice({ deviceKey: 'device-w', weakKey: 'weak-w', profileJson: '{}' });
  const connection = manager.connect();
  connection.deviceKey = 'device-w';
  db.linkDevice('device-w', connection.uid, 'created');
  const abandoned = connection.uid;
  // 同一台设备上还认得另一个老身份。
  const target = db.createPlayer('TARGET001', '老身份');
  db.linkDevice('device-w', target.uid, 'created');

  manager.claimDevice(connection, target.uid);

  assert.equal(connection.uid, target.uid);
  assert.ok(db.getPlayer(target.uid));
  // 刚放弃的身份已经没有任何凭证与绑定，留着就是无主数据。
  assert.equal(db.getPlayer(abandoned), undefined);
});

test('同一身份在多个浏览器签发多份凭证后，任一浏览器重连都可通过鉴权', async (t) => {
  const { server } = await startServer(t);
  const port = server.address().port;

  const first = await connect(port, { device: SAFARI });
  const { uid, credential: safariCred } = first.hello;
  first.ws.close();

  const second = await connect(port, { device: WECHAT });
  assert.equal(second.hello.uid, uid);
  const wechatCred = second.hello.credential;
  assert.notEqual(wechatCred, safariCred);
  second.ws.close();

  const reSafari = await connect(port, { uid, credential: safariCred, device: SAFARI });
  assert.equal(reSafari.hello.uid, uid);
  assert.deepEqual(reSafari.errors, []);
  reSafari.ws.close();

  const reWechat = await connect(port, { uid, credential: wechatCred, device: WECHAT });
  assert.equal(reWechat.hello.uid, uid);
  assert.deepEqual(reWechat.errors, []);
  reWechat.ws.close();
});

test('跨浏览器与系统升级的弱指纹关联可执行认领、拒绝与完整退出', async (t) => {
  const { db, server } = await startServer(t);
  const port = server.address().port;

  const a = await connect(port, { device: SAFARI });
  const targetUid = a.hello.uid;
  a.ws.send(JSON.stringify({ type: 'createRoom' }));
  await waitFor(() => a.states.some((s) => s.room));

  // 微信内置浏览器因大号在房间中收到 playing 候选，可执行拒绝
  const b = await connect(port, { device: WECHAT });
  assert.equal(b.hello.deviceCandidates?.candidates[0].uid, targetUid);
  b.ws.send(JSON.stringify({ type: 'rejectDevice', uid: targetUid }));
  await waitFor(() => db.isDeviceRejected(normalizeDeviceProfile(SAFARI).deviceKey, targetUid));
  b.ws.close();
  a.ws.close();

  // 拒绝后，即使升级系统（仅 weakKey 相同）也不再弹出 targetUid 候选提示，而是自动沿用刚才在微信建立的新身份
  const c = await connect(port, { device: UPGRADED });
  assert.equal(c.hello.uid, b.hello.uid);
  assert.equal(c.hello.deviceCandidates, undefined);
  c.ws.close();

  // 模拟另一台设备系统升级后持原凭证重连：产生两个不同 deviceKey 但共享 weakKey，且只有 1 份凭证
  const IPAD_OLD = { ...SAFARI, screen: '820x1180' };
  const IPAD_NEW = { ...UPGRADED, screen: '820x1180' };
  const d1 = await connect(port, { device: IPAD_OLD });
  const soloUid = d1.hello.uid;
  const soloCred = d1.hello.credential;
  d1.ws.close();

  const d2 = await connect(port, { uid: soloUid, credential: soloCred, device: IPAD_NEW });
  d2.ws.send(JSON.stringify({ type: 'openProfile', page: 1 }));
  await waitFor(() => d2.profiles.length > 0);
  assert.equal(d2.profiles[0].user.soleOwner, true);

  d2.ws.send(JSON.stringify({ type: 'leaveIdentity' }));
  await waitFor(() => d2.identities.some((m) => m.uid !== soloUid));
  const leftMsg = d2.identities.at(-1);
  assert.equal(leftMsg.orphaned, true);
  assert.equal(db.getPlayer(soloUid), undefined);
  d2.ws.close();
});

