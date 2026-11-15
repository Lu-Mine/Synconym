import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { normalizeDeviceProfile, decideAdoption, collectDeviceLinks } from '../../server/identity.js';
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
    const client = { ws, hello: null, states: [], errors: [] };
    const timer = setTimeout(() => reject(new Error('连接超时')), 4000);
    const settle = () => { clearTimeout(timer); resolve(client); };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', ...hello })));
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'hello') { client.hello = message; settle(); }
      if (message.type === 'state') client.states.push(message);
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
