import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseRoomCode, sanitizeRoomInput } from '../../public/room-code.js';

test('普通输入只保留最多五位数字，兼容全角数字', () => {
  assert.equal(sanitizeRoomInput('a１２b34567'), '12345');
  assert.equal(sanitizeRoomInput('abc'), '');
  assert.equal(sanitizeRoomInput('00123'), '00123');
});

test('粘贴链接或五位房号时提取房号，无效内容不覆盖原输入', () => {
  const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const fn = source.match(/function applyRoomPaste\([\s\S]*?\n}\n/)[0];
  const hint = { textContent: '' }, calls = [];
  const context = { parseRoomCode, app: { querySelector: () => hint }, joinCheckVersion: 0, checkJoinOnInput: (input, pasted) => calls.push([input.value, pasted]) };
  runInNewContext(fn, context);
  const input = { value: '' };
  context.applyRoomPaste(input, 'https://example.com/?r=01234');
  assert.equal(input.value, '01234');
  context.applyRoomPaste(input, '６３０６８');
  assert.equal(input.value, '63068');
  context.applyRoomPaste(input, 'https://example.com/?r=12345&r=67890');
  assert.equal(input.value, '63068');
  assert.match(hint.textContent, /有效的邀请链接/);
  assert.deepEqual(calls, [['01234', true], ['63068', true]]);
  assert.equal(context.joinCheckVersion, 1);
});
