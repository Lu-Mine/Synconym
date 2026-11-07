import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createSynconymServer } from '../server/index.js';
import { createDatabase } from '../server/db.js';

async function listen(t, options = {}) {
  const { server, wss, manager } = createSynconymServer({ db: createDatabase(':memory:'), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  return { server, wss, manager, port: server.address().port };
}

function openClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const client = { ws, states: [], errors: [] };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello' })));
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'hello') resolve(client);
      if (message.type === 'state') client.states.push(message);
      if (message.type === 'error') client.errors.push(message.message);
    });
    ws.on('error', reject);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test('房间预览只返回房主信息，不改变房间，拒绝不存在、已开始和已满房间', async (t) => {
  const { port, manager } = await listen(t);
  const host = { uid: 'ABCDEFGH', name: '房主', seat: 0, connected: true, secret: 'private' };
  const room = { code: '12345', hostUid: host.uid, players: [host], phase: 'lobby' };
  manager.rooms.set(room.code, room);
  const url = `http://127.0.0.1:${port}/api/rooms/12345`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { code: '12345', host: { uid: host.uid, name: host.name, seat: 0, connected: true } });
  assert.equal(room.players.length, 1);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/rooms/99999`)).status, 404);
  room.phase = 'writing';
  assert.equal((await (await fetch(url)).json()).error, '这局已经开始');
  room.phase = 'lobby'; room.players.push({}, {}, {});
  assert.equal((await (await fetch(url)).json()).error, '房间已满');
});


test('健康检查端点返回 200 与运行指标', async (t) => {
  const { port } = await listen(t);
  const client = await openClient(port);
  client.ws.send(JSON.stringify({ type: 'createRoom' }));
  await sleep(60);
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.rooms, 1);
  assert.equal(body.clients, 1);
  assert.equal(typeof body.uptime, 'number');
  assert.equal(typeof body.vectors, 'boolean');
});

test('健康检查不需要 WebSocket，且不暴露静态文件目录', async (t) => {
  const { port } = await listen(t);
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  const body = await response.json();
  assert.equal(body.rooms, 0);
  assert.equal(body.clients, 0);
  const missing = await fetch(`http://127.0.0.1:${port}/healthz/../server/db.js`);
  assert.equal(missing.status, 404);
});

test('房间数达到上限后拒绝新建，但已存在房间仍可加入', async (t) => {
  const { port } = await listen(t, { maxRooms: 1 });
  const host = await openClient(port);
  host.ws.send(JSON.stringify({ type: 'createRoom' }));
  await sleep(60);
  const code = host.states.at(-1).room.code;
  assert.match(code, /^\d{5}$/);

  const other = await openClient(port);
  other.ws.send(JSON.stringify({ type: 'createRoom' }));
  await sleep(80);
  assert.match(other.errors[0], /房间已满/);
  assert.equal(other.states.at(-1).room ?? null, null);


  await sleep(520); // 服务端每连接 500ms 写冷却
  other.ws.send(JSON.stringify({ type: 'joinRoom', code }));
  await sleep(80);
  assert.equal(other.states.at(-1).room.code, code);
});

test('单条消息超过 maxPayload 时连接被关闭', async (t) => {
  const { port } = await listen(t, { maxPayload: 1024 });
  const client = await openClient(port);
  const closed = new Promise((resolve) => client.ws.on('close', (code) => resolve(code)));
  client.ws.send(JSON.stringify({ type: 'rename', name: 'x'.repeat(4096) }));
  assert.equal(await closed, 1009);
});

test('默认上限下正常大小的消息不受影响', async (t) => {
  const { port } = await listen(t);
  const client = await openClient(port);
  client.ws.send(JSON.stringify({ type: 'rename', name: '正常名字' }));
  await sleep(80);
  assert.equal(client.ws.readyState, WebSocket.OPEN);
  assert.equal(client.states.at(-1).user.name, '正常名字');
});
