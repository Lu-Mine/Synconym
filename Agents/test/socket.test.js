import test from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from '../../public/ws.js';

function setup(t, savedLeave = '') {
  const storage = (entries = []) => { const values = new Map(entries); return { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) }; };
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = 0; this.events = new Map(); this.sent = []; FakeSocket.instances.push(this); }
    addEventListener(name, callback) { this.events.set(name, callback); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    emit(name, data) { this.events.get(name)?.(data); }
    open() { this.readyState = 1; this.emit('open'); }
    message(data) { this.emit('message', { data: JSON.stringify(data) }); }
    close(code = 1006) { this.readyState = 3; this.emit('close', { code }); }
  }
  const scheduled = [];
  const originals = Object.fromEntries(['WebSocket', 'localStorage', 'sessionStorage', 'location', 'document'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const values = { WebSocket: FakeSocket, localStorage: storage([['sy_uid', 'ABCDEFGH']]), sessionStorage: storage(savedLeave ? [['sy_pending_leave', savedLeave]] : []), location: { protocol: 'http:', host: 'localhost', search: '?r=12345' }, document: {} };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  t.mock.method(globalThis, 'setTimeout', (callback) => { scheduled.push(callback); return 1; });
  const states = [], statuses = [], hello = [], stateMetadata = [];
  const socket = new Socket({ onState: (m, metadata) => { states.push(m); stateMetadata.push(metadata); }, onHello: (m) => hello.push(m), onConnection: (status) => statuses.push(status) });
  return { socket, states, statuses, hello, stateMetadata, scheduled, FakeSocket, ws: socket.ws };
}

function ready(ws) { ws.open(); ws.message({ type: 'hello', uid: 'ABCDEFGH', restored: true }); ws.message({ type: 'state', room: { code: '12345' } }); }

test('普通断线保留恢复房号，但不排队重放投票或准备', (t) => {
  const { socket, ws, scheduled, statuses, FakeSocket } = setup(t);
  ready(ws); assert.equal(socket.ready, true);
  ws.close(); assert.equal(socket.ready, false);
  assert.equal(socket.send({ type: 'vote', yes: true }), false);
  assert.equal(socket.send({ type: 'ready' }), false);
  scheduled.shift()();
  const reconnect = FakeSocket.instances.at(-1); reconnect.open();
  assert.equal(reconnect.sent[0].roomCode, '12345');
  reconnect.message({ type: 'hello', uid: 'ABCDEFGH', restored: true });
  reconnect.message({ type: 'state', room: { code: '12345' } });
  assert.deepEqual(reconnect.sent.map(m => m.type), ['hello']);
  assert.equal(statuses.at(-1), 'connected');
});

test('每次连接首个有效状态标记为同步，后续实时状态保持普通更新', (t) => {
  const { ws, scheduled, FakeSocket, stateMetadata } = setup(t);
  ready(ws);
  ws.message({ type: 'state', room: { code: '12345', phase: 'writing' } });
  ws.close(); scheduled.shift()();
  const reconnect = FakeSocket.instances.at(-1); reconnect.open();
  reconnect.message({ type: 'hello', uid: 'ABCDEFGH', restored: true });
  reconnect.message({ type: 'state', room: { code: '12345', phase: 'voting' } });
  reconnect.message({ type: 'state', room: { code: '12345', phase: 'prepare' } });
  assert.deepEqual(stateMetadata.map(m => m.initialSync), [true, false, true, false]);
});

test('显式加入等权威快照之后才发送', (t) => {
  const { socket, ws } = setup(t);
  socket.send({ type: 'joinRoom', code: '12345' });
  ws.open(); ws.message({ type: 'hello', uid: 'ABCDEFGH', restored: false });
  assert.deepEqual(ws.sent.map(m => m.type), ['hello']);
  ws.message({ type: 'state', room: null });
  assert.deepEqual(ws.sent.map(m => m.type), ['hello', 'joinRoom']);
});

test('主动退出遇到断线后优先完成退出，不向页面恢复房间', (t) => {
  const { socket, ws, states, scheduled, FakeSocket } = setup(t);
  ready(ws); socket.send({ type: 'leave' });
  assert.equal(sessionStorage.getItem('sy_pending_leave'), '12345');
  ws.close(); scheduled.shift()();
  const reconnect = FakeSocket.instances.at(-1); reconnect.open();
  assert.equal(reconnect.sent[0].leaveRoom, true);
  reconnect.message({ type: 'hello', uid: 'ABCDEFGH', restored: true });
  assert.equal(reconnect.sent.at(-1).type, 'leave');
  reconnect.message({ type: 'state', room: { code: '12345' } });
  assert.equal(states.length, 1);
  reconnect.message({ type: 'state', room: null });
  assert.equal(states.at(-1).room, null);
  assert.equal(sessionStorage.getItem('sy_pending_leave'), null);
});

test('已退出/已过期的身份不能在重连时自动加入旧房间', (t) => {
  const { socket, ws, hello, states } = setup(t, '12345');
  ws.open(); ws.message({ type: 'hello', uid: 'ABCDEFGH', restored: false });
  ws.message({ type: 'state', room: null });
  assert.equal(socket.roomCode, ''); assert.equal(hello.length, 0);
  assert.equal(states.at(-1).room, null);
  assert.deepEqual(ws.sent.map(m => m.type), ['hello']);
});

test('同 UID 被其他页面接管后停止自动抢连', (t) => {
  const { ws, socket, statuses, scheduled } = setup(t);
  ready(ws); ws.close(4001);
  assert.equal(socket.closed, true); assert.equal(socket.ready, false);
  assert.equal(statuses.at(-1), 'replaced'); assert.equal(scheduled.length, 0);
});

test('刷新遇到旧连接未释放时退避重试并恢复房间', (t) => {
  const { socket, ws, scheduled, statuses, FakeSocket } = setup(t);
  ws.open(); ws.close(4002);
  assert.equal(statuses.at(-1), 'uid-in-use');
  assert.equal(socket.closed, false);
  assert.equal(socket.reconnectDelay, 1000);
  scheduled.shift()();
  const retry = FakeSocket.instances.at(-1);
  retry.open(); retry.close(4002);
  assert.equal(socket.reconnectDelay, 2000);
  scheduled.shift()();
  const restored = FakeSocket.instances.at(-1);
  restored.open();
  assert.equal(restored.sent[0].roomCode, '12345');
  restored.message({ type: 'hello', uid: 'ABCDEFGH', restored: true });
  restored.message({ type: 'state', room: { code: '12345' } });
  assert.equal(statuses.at(-1), 'connected');
  assert.equal(socket.reconnectDelay, 500);
});

test('普通断线窗口过期后不再自动加入等待房间', (t) => {
  const { socket, ws, scheduled, FakeSocket } = setup(t);
  ready(ws); ws.close(); scheduled.shift()();
  const reconnect = FakeSocket.instances.at(-1); reconnect.open();
  reconnect.message({ type: 'hello', uid: 'ABCDEFGH', restored: false });
  assert.equal(socket.roomCode, '');
  reconnect.message({ type: 'state', room: null });
  assert.deepEqual(reconnect.sent.map(m => m.type), ['hello']);
});

test('保存凭证并在重连和重置身份后使用新的凭证', (t) => {
  const { socket, ws, scheduled, FakeSocket } = setup(t);
  ws.open();
  assert.equal(ws.sent[0].uid, undefined);
  ws.message({ type: 'hello', uid: 'ABCDEFGH', credential: 'secret-a', restored: false });
  assert.deepEqual(JSON.parse(localStorage.getItem('sy_identity')), { uid: 'ABCDEFGH', credential: 'secret-a' });
  ws.message({ type: 'identity', uid: 'BCDEFGHJ', credential: 'secret-b' });
  assert.deepEqual(JSON.parse(localStorage.getItem('sy_identity')), { uid: 'BCDEFGHJ', credential: 'secret-b' });
  ws.close(); scheduled.shift()();
  const reconnect = FakeSocket.instances.at(-1); reconnect.open();
  assert.equal(reconnect.sent[0].uid, 'BCDEFGHJ');
  assert.equal(reconnect.sent[0].credential, 'secret-b');
  reconnect.close(4003);
  assert.equal(socket.closed, true);
  assert.equal(scheduled.length, 0);
});
