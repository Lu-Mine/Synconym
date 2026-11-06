import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseRoomCode } from '../public/room-code.js';
import { playerItemMarkup, shellMarkup } from '../public/render.js';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const check = source.match(/async function checkJoinInput\([\s\S]*?\n}\n/)[0];

function setup(value, response) {
  const hint = { textContent: '' }, number = { textContent: '' }, host = { innerHTML: '' };
  const input = { value, isConnected: true };
  const calls = [];
  const modal = { removeAttribute: () => calls.push('enable'), classList: { add: () => calls.push('open') }, querySelector: () => ({ focus: () => calls.push('focus') }) };
  const elements = { '#join-hint': hint, '#join-modal': modal, '#join-host': host, '#join-room-number': number };
  const context = { app: { querySelector: (key) => elements[key] }, state: { room: null }, profileOpen: false, pendingJoin: null, pendingConfirm: null, renameOpen: false, inviteTrigger: null, joinCheckVersion: 1, parseRoomCode, playerItemMarkup, hydrateAvatars: () => {}, syncModalScrollLock: () => {}, fetch: async () => response };
  runInNewContext(check, context);
  return { context, input, hint, number, host, calls };
}

test('房间预览有效时展示房号和复用的房主条目，尚未加入', async () => {
  const host = { uid: 'HOST', name: '<房主>', seat: 0, connected: true };
  const s = setup('http://example.com/?r=12345', { ok: true, json: async () => ({ host }) });
  await s.context.checkJoinInput(s.input, 1);
  assert.equal(s.number.textContent, '房号 12345');
  assert.match(s.host.innerHTML, /class="player status-host is-host/);
  assert.match(s.host.innerHTML, /&lt;房主&gt;/);
  assert.equal(s.context.pendingJoin.code, '12345');
  assert.deepEqual(s.calls, ['enable', 'open', 'focus']);
  assert.match(shellMarkup(), /data-action="confirm-join"/);
});

test('无效输入、房间错误和过期查询不会弹出确认框', async () => {
  const invalid = setup('abc', null);
  await invalid.context.checkJoinInput(invalid.input, 1);
  assert.match(invalid.hint.textContent, /5 位房号/);
  const missing = setup('12345', { ok: false, json: async () => ({ error: '房间已满' }) });
  await missing.context.checkJoinInput(missing.input, 1);
  assert.equal(missing.hint.textContent, '房间已满');
  const stale = setup('12345', { ok: true, json: async () => ({ host: { uid: 'a' } }) });
  stale.context.joinCheckVersion = 2;
  await stale.context.checkJoinInput(stale.input, 1);
  assert.equal(stale.context.pendingJoin, null);
  assert.deepEqual(stale.calls, []);
});

test('只有点击确认才发送加入请求，取消不发送', async () => {
  const branch = source.match(/if \(button\.dataset\.action === 'cancel-join'\)[\s\S]*?(?=  if \(button\.dataset\.action === 'paste-invite'\))/)[0];
  for (const action of ['cancel-join', 'confirm-join']) {
    const sent = [];
    const context = { button: { dataset: { action } }, pendingJoin: { code: '12345' }, closeJoin() {}, enqueueWrite: (message) => sent.push(message) };
    await runInNewContext(`(async () => {${branch}})()`, context);
    assert.equal(sent.length, action === 'confirm-join' ? 1 : 0);
    if (sent.length) { assert.equal(sent[0].type, 'joinRoom'); assert.equal(sent[0].code, '12345'); }
  }
});
