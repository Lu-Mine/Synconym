import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { sanitizeNumericInput, sanitizeRoomInput } from '../../public/room-code.js';
import { settingsMarkup } from '../../public/render.js';
import { validateSettings } from '../../server/rules.js';
const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');

test('密码和房号共享数字过滤、全角转换及长度限制', () => {
  assert.equal(sanitizeNumericInput('００a1234567', 6), '001234');
  assert.equal(sanitizeRoomInput('００a1234567'), '00123');
  assert.equal(sanitizeNumericInput('', 6), '');
});

test('密码设置提示位于输入框内且无需开关', () => {
  const markup = settingsMarkup(validateSettings({}), true);
  assert.match(markup, /password-setting-row/);
  assert.match(markup, /input code-input password-input/);
  assert.match(markup, /placeholder="留空无密码，或 6 位数字密码"/);
  assert.match(markup, /aria-describedby="room-password-hint"><span class="join-placeholder password-placeholder" id="room-password-hint"/);
  assert.doesNotMatch(markup, /password-setting-hint|toggle-password|room-password-fields/);
});

test('密码输入根据空值推导开关并保留前导零和光标', () => {
  const fn = source.match(/function acceptPasswordInput\([\s\S]*?\n}/)[0];
  const context = { sanitizeNumericInput, state: { room: null }, settings: {}, pendingLobbySettings: null };
  runInNewContext(fn, context);
  const input = { id: 'room-password', value: '００1234', selectionStart: 6, setSelectionRange(a, b) { this.cursor = [a, b]; } };
  context.acceptPasswordInput(input);
  assert.equal(context.settings.password, '001234');
  assert.equal(context.settings.passwordEnabled, true);
  assert.deepEqual(input.cursor, [6, 6]);
  input.value = '';
  context.acceptPasswordInput(input);
  assert.equal(context.settings.passwordEnabled, false);
});

test('非法反馈标记可访问错误状态，重复调用重新触发抖动', () => {
  const fn = source.match(/function markInvalid\([\s\S]*?\n}/)[0];
  const calls = [];
  const input = { setAttribute: (...args) => calls.push(args), classList: { remove: (name) => calls.push(['remove', name]), add: (name) => calls.push(['add', name]) }, offsetWidth: 100 };
  const context = {};
  runInNewContext(fn, context);
  context.markInvalid(input);
  assert.deepEqual(calls, [['aria-invalid', 'true'], ['remove', 'input-shake'], ['add', 'input-shake']]);
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.input-shake \{ animation: none/);
});
