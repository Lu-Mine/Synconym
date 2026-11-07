import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createSynconymServer } from '../../server/index.js';
import { createDatabase } from '../../server/db.js';
import { createSecurityPolicy } from '../../server/security.js';

async function listen(t, security = {}) {
  const { server, wss } = createSynconymServer({ db: createDatabase(':memory:'), security });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  return { port: server.address().port, wss };
}

function connect(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'hello') ws.emit('greeted', message);
    });
  });
}

const closeOf = (ws) => new Promise((resolve) => ws.once('close', (code) => resolve(code)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const greeted = (ws) => new Promise((resolve) => ws.once('greeted', resolve));

test('超出每来源连接上限后拒绝升级并正确回收', async (t) => {
  const { port } = await listen(t, { maxConnectionsPerSource: 2 });
  const a = await connect(port), b = await connect(port);
  const ready = Promise.all([greeted(a), greeted(b)]);
  a.send(JSON.stringify({ type: 'hello' }));
  b.send(JSON.stringify({ type: 'hello' }));
  await ready;
  // 第三个连接被直接拒绝
  await assert.rejects(connect(port));
  // 释放后可重新连接
  b.close();
  await sleep(50);
  const c = await connect(port);
  c.send(JSON.stringify({ type: 'hello' }));
  await greeted(c);
  a.close(); c.close();
});

test('全局连接上限', async (t) => {
  const { port } = await listen(t, { maxGlobalConnections: 1, maxConnectionsPerSource: 10 });
  const a = await connect(port);
  a.send(JSON.stringify({ type: 'hello' }));
  await greeted(a);
  await assert.rejects(connect(port));
  a.close();
});

test('匿名建号限速：超额返回错误并断开，已认证 uid 不受限', async (t) => {
  const { port } = await listen(t, { maxAccountsPerSource: 2, accountWindowMs: 10000 });
  const first = await connect(port);
  first.send(JSON.stringify({ type: 'hello' }));
  const hello1 = await greeted(first);
  assert.ok(hello1.uid); assert.ok(hello1.credential);
  const second = await connect(port);
  second.send(JSON.stringify({ type: 'hello' }));
  await greeted(second);
  // 第三个匿名建号被拒
  const third = await connect(port);
  third.send(JSON.stringify({ type: 'hello' }));
  const [code, error] = await Promise.all([
    closeOf(third),
    new Promise((resolve) => third.once('message', (d) => resolve(JSON.parse(d))))
  ]);
  assert.equal(code, 4004);
  assert.match(error.message, /过于频繁/);
  // 复用已有 uid（凭据无效）走的是身份验证失败路径，不是建号限速
  const fourth = await connect(port);
  fourth.send(JSON.stringify({ type: 'hello', uid: hello1.uid, credential: 'x'.repeat(43) }));
  assert.equal(await closeOf(fourth), 4003);
  first.close(); second.close();
});

test('每连接消息速率限制触发 4002', async (t) => {
  const { port } = await listen(t, { messageBurst: 5, messageRefillPerSecond: 1, globalMessageBurst: 1000, globalMessageRefillPerSecond: 1000 });
  const ws = await connect(port);
  ws.send(JSON.stringify({ type: 'hello' }));
  await greeted(ws);
  let code = null;
  ws.on('close', (c) => { code = c; });
  // 洪泛：远超容量
  for (let i = 0; i < 30; i++) ws.send(JSON.stringify({ type: 'ping' }));
  const closed = await closeOf(ws);
  assert.equal(closed, 4002);
  assert.ok(code === 4002);
});

test('未握手超时后关闭连接', async (t) => {
  const { port } = await listen(t, { handshakeTimeoutMs: 100 });
  const ws = await connect(port);
  assert.equal(await closeOf(ws), 1006);
});

test('trustProxy 默认不信任 X-Forwarded-For，开启后取代理追加的最右侧', () => {
  const request = { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } };
  const socket = { remoteAddress: '127.0.0.1' };
  const noTrust = createSecurityPolicy();
  assert.equal(noTrust.ipOf(request, socket), '127.0.0.1');
  const trust = createSecurityPolicy({ trustProxy: true });
  assert.equal(trust.ipOf(request, socket), '10.0.0.1');
  trust.close(); noTrust.close();
});

test('非法 security 配置抛出 TypeError', () => {
  assert.throws(() => createSecurityPolicy({ maxGlobalConnections: 0 }), TypeError);
  assert.throws(() => createSecurityPolicy({ handshakeTimeoutMs: -1 }), TypeError);
});

test('策略计数随连接释放归零', async (t) => {
  const { port } = await listen(t);
  const a = await connect(port);
  a.send(JSON.stringify({ type: 'hello' }));
  await greeted(a);
  a.close();
  await sleep(50);
  const b = await connect(port);
  b.send(JSON.stringify({ type: 'hello' }));
  await greeted(b);
  b.close();
});
