import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createSynconymServer } from '../../server/index.js';
import { createDatabase } from '../../server/db.js';

function waitFor(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', receive); reject(new Error('等待模拟状态超时')); }, 3000);
    function receive(data) {
      const message = JSON.parse(data);
      if (message.type === 'error') { clearTimeout(timer); ws.off('message', receive); reject(new Error(message.message)); }
      else if (predicate(message)) { clearTimeout(timer); ws.off('message', receive); resolve(message); }
    }
    ws.on('message', receive);
  });
}

test('模拟玩家执行真实规则且模拟房间与正式房间隔离', async t => {
  const instance = createSynconymServer({ db: createDatabase(':memory:'), mock: true });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  t.after(() => { for (const ws of instance.wss.clients) ws.terminate(); instance.server.close(); });
  const port = instance.server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/__mock/ws`);
  await once(ws, 'open');
  let pending = waitFor(ws, m => m.type === 'state');
  ws.send(JSON.stringify({ type: 'hello' })); await pending;
  async function action(message, predicate) {
    const result = waitFor(ws, m => m.type === 'state' && predicate(m.room));
    ws.send(JSON.stringify(message));
    return (await result).room;
  }
  let room = await action({ type: 'createRoom' }, r => r?.phase === 'lobby');
  assert.equal(instance.manager.rooms.size, 0);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/rooms/${room.code}`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/__mock/api/rooms/${room.code}`)).status, 200);
  room = await action({ type: 'mockAction', action: 'add' }, r => r?.players.length === 2);
  const bot = room.players.find(p => p.mockBot);
  assert.ok(bot);
  room = await action({ type: 'mockAction', action: 'ready', uid: bot.uid, ready: true }, r => r?.players.find(p => p.uid === bot.uid)?.ready);
  await new Promise(resolve => setTimeout(resolve, 510));
  room = await action({ type: 'start' }, r => r?.phase === 'countdown');
  room = await action({ type: 'mockAction', action: 'advance' }, r => r?.phase === 'writing');
  room = await action({ type: 'mockAction', action: 'submitWord', uid: bot.uid, word: '苹果' }, r => r?.players.find(p => p.uid === bot.uid)?.submitted);
  assert.equal(room.round, 1);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/playing`)).json()).playing, 0);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/__mock/api/playing`)).json()).playing, 2);
});

test('mock 固定 99999 房间可查询和加入，包含可控制机器人', async t => {
  const instance = createSynconymServer({ db: createDatabase(':memory:'), mock: true });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  t.after(() => { for (const ws of instance.wss.clients) ws.terminate(); instance.server.close(); });
  const port = instance.server.address().port;
  assert.equal((await fetch(`http://127.0.0.1:${port}/__mock/api/rooms/99999`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/rooms/99999`)).status, 404);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/__mock/ws`);
  await once(ws, 'open');
  let pending = waitFor(ws, m => m.type === 'state');
  ws.send(JSON.stringify({ type: 'hello' })); await pending;
  pending = waitFor(ws, m => m.type === 'state' && m.room?.code === '99999');
  ws.send(JSON.stringify({ type: 'joinRoom', code: '99999' }));
  const { room } = await pending;
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.length, 2);
  const bot = room.players.find(p => p.mockBot);
  assert.equal(bot.name, '加入测试机器人');
  assert.equal(bot.uid, room.hostUid);
});
