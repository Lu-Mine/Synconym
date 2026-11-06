import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/clipboard.js', import.meta.url), 'utf8').replaceAll('export ', '');

function setup(clipboard, result = true) {
  const calls = [];
  const input = { style: {}, setAttribute() {}, select() { calls.push(['select', this.value]); }, remove() { calls.push(['remove']); } };
  const document = {
    createElement: () => input,
    body: { appendChild: () => calls.push(['append']) },
    execCommand: (command) => { calls.push([command]); if (result instanceof Error) throw result; return result; }
  };
  const context = { navigator: { clipboard }, document };
  runInNewContext(source, context);
  return { copy: context.copyText, calls };
}

test('优先使用 Clipboard API 复制完整链接', async () => {
  const written = [];
  const { copy, calls } = setup({ writeText: async (text) => written.push(text) });
  assert.equal(await copy('https://example.com/?r=12345'), true);
  assert.deepEqual(written, ['https://example.com/?r=12345']);
  assert.deepEqual(calls, []);
});

test('Clipboard API 不可用或拒绝时尝试传统复制并清理临时元素', async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw new Error('denied'); } }]) {
    const { copy, calls } = setup(clipboard);
    assert.equal(await copy('https://example.com/?r=12345'), true);
    assert.deepEqual(calls, [['append'], ['select', 'https://example.com/?r=12345'], ['copy'], ['remove']]);
  }
});

test('传统复制失败或抛错时报告失败并清理临时元素', async () => {
  for (const result of [false, new Error('unsupported')]) {
    const { copy, calls } = setup(undefined, result);
    assert.equal(await copy('link'), false);
    assert.deepEqual(calls.at(-1), ['remove']);
  }
});

test('房间复制按钮复制邀请链接，失败时提供实际链接手动复制', async () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const branch = app.match(/} else if \(button\.dataset\.action === 'copy'\) \{([\s\S]*?)\n  \}\n\}\);/)[1];
  for (const success of [true, false]) {
    const calls = [];
    const context = {
      event: { preventDefault() {} }, state: { room: { code: '12345' }, publicUrl: 'https://example.com' },
      location: { origin: 'http://localhost' }, button: { classList: { add: () => calls.push('copied'), remove() {} }, insertAdjacentElement() {} },
      copyText: async (text) => { calls.push(text); return success; },
      toast: (message) => calls.push(message), setTimeout() {},
      openInvite: (url) => calls.push(['dialog', url])
    };
    await runInNewContext(`(async () => {${branch}})()`, context);
    assert.equal(calls[0], 'https://example.com/?r=12345');
    if (success) assert.deepEqual(calls.slice(1), ['copied', '邀请链接已复制']);
    else assert.deepEqual(calls.slice(1), [['dialog', 'https://example.com/?r=12345']]);
  }
});

test('手动复制使用站内弹窗并支持打开、关闭和焦点恢复', async () => {
  const { shellMarkup } = await import('../public/render.js');
  const html = shellMarkup(true);
  assert.match(html, /id="invite-modal" inert/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="invite-title"/);
  assert.match(html, /id="invite-link" aria-label="邀请链接" readonly/);
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const functions = source.match(/function openInvite\([\s\S]*?\n}\n\nfunction closeInvite\([\s\S]*?\n}/)[0];
  const calls = [];
  const modal = { classList: { add: () => calls.push('open'), remove: () => calls.push('close') }, removeAttribute: () => calls.push('enable'), setAttribute: () => calls.push('disable') };
  const input = { focus: () => calls.push('focus'), select: () => calls.push('select') };
  const trigger = { isConnected: true, focus: () => calls.push('restore') };
  const context = { inviteTrigger: null, app: { querySelector: (selector) => selector === '#invite-modal' ? modal : input }, syncModalScrollLock: () => calls.push('scroll') };
  runInNewContext(functions, context);
  context.openInvite('https://example.com/?r=12345', trigger);
  assert.equal(input.value, 'https://example.com/?r=12345');
  assert.deepEqual(calls, ['enable', 'open', 'scroll', 'focus', 'select']);
  context.closeInvite();
  assert.deepEqual(calls.slice(5), ['close', 'disable', 'scroll', 'restore']);
  assert.equal(context.inviteTrigger, null);
});

test('读取剪贴板文本，权限拒绝或接口不可用时安全回退', async () => {
  const { readClipboardText } = await import('../public/clipboard.js');
  assert.equal(await readClipboardText({ readText: async () => 'http://example.com/?r=12345' }), 'http://example.com/?r=12345');
  assert.equal(await readClipboardText({ readText: async () => { throw new Error('denied'); } }), null);
  assert.equal(await readClipboardText({}), null);
});

test('粘贴按钮填入内容，读取失败保留输入并提示', async () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const branch = app.match(/if \(button\.dataset\.action === 'paste-invite'\) \{([\s\S]*?)\n  \}/)[1];
  for (const text of ['http://example.com/?r=12345', null]) {
    const calls = [];
    const input = { isConnected: true, value: 'old', focus: () => calls.push('focus'), dispatchEvent: () => calls.push('input') };
    const context = { button: { closest: () => ({ querySelector: () => input }) }, readClipboardText: async () => text, toast: (message) => calls.push(message), Event };
    await runInNewContext(`(async () => {${branch}})()`, context);
    assert.equal(input.value, text ?? 'old');
    assert.deepEqual(calls, text === null ? ['focus', '无法读取剪贴板，请手动粘贴邀请链接'] : ['input', 'focus']);
  }
});
