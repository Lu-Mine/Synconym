import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/clipboard.js', import.meta.url), 'utf8').replace('export ', '');

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
    const input = { style: {}, setAttribute() {}, addEventListener() {}, focus() {}, select() { calls.push(['selected', this.value]); } };
    const context = {
      event: { preventDefault() {} }, state: { room: { code: '12345' }, publicUrl: 'https://example.com' },
      location: { origin: 'http://localhost' }, button: { classList: { add: () => calls.push('copied'), remove() {} }, insertAdjacentElement() {} },
      copyText: async (text) => { calls.push(text); return success; },
      toast: (message) => calls.push(message), setTimeout() {},
      document: { createElement: () => input }
    };
    await runInNewContext(`(async () => {${branch}})()`, context);
    assert.equal(calls[0], 'https://example.com/?r=12345');
    if (success) assert.deepEqual(calls.slice(1), ['copied', '邀请链接已复制']);
    else assert.deepEqual(calls.slice(1), [['selected', 'https://example.com/?r=12345'], '请手动复制邀请链接']);
  }
});
