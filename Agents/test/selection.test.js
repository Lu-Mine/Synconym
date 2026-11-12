import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const css = readFileSync(new URL('../../public/selection.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');

test('界面默认不可选，可编辑内容和说明正文仍可选择', () => {
  assert.match(css, /body\s*\{[^}]*user-select:\s*none/s);
  assert.match(css, /input, textarea, \[contenteditable\][\s\S]*?\.qa-answer[\s\S]*?user-select:\s*text/);
  assert.match(css, /img, svg, a\s*\{[^}]*-webkit-user-drag:\s*none/s);
});

test('动态图片和链接的拖动被拦截，其他拖动保留', () => {
  const code = app.match(/document\.addEventListener\('dragstart',[\s\S]*?\n\}\);/)?.[0];
  assert.ok(code);
  let handler;
  class Element {
    constructor(match) { this.match = match; }
    closest(selector) { assert.equal(selector, 'img, svg, a'); return this.match ? this : null; }
  }
  runInNewContext(code, { Element, document: { addEventListener: (_, callback) => { handler = callback; } } });
  for (const match of [true, false]) {
    let prevented = false;
    handler({ target: new Element(match), preventDefault() { prevented = true; } });
    assert.equal(prevented, match);
  }
});
