import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function panelFixture() {
  const nodes = new Map();
  const sent = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, hidden: false, style: {}, handlers: {}, attrs: {},
      classList: { add() {}, remove() {}, toggle(_, value) { return value; } },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      setAttribute(key, value) { this.attrs[key] = value; },
      replaceChildren(...options) { this.value = options[0]?.value || ''; },
      getBoundingClientRect() { return { left: parseFloat(this.style.left) || 600, top: parseFloat(this.style.top) || 16, width: 336, height: 600 }; },
      setPointerCapture() {}, hasPointerCapture() { return true; }, releasePointerCapture() {}, focus() {},
      contentWindow: { postMessage(message) { sent.push(message); } }
    });
    return nodes.get(id);
  }
  const window = { innerWidth: 1000, innerHeight: 800, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  runInNewContext(readFileSync(new URL('../../dev/mock.js', import.meta.url), 'utf8'), {
    document: { querySelector: node }, window, location: { origin: 'http://test' }, Option: function(text, value) { this.value = value; }
  });
  return { node, window, sent };
}

test('浮窗拖动限制在视口内，支持折叠和键盘移动', () => {
  const { node } = panelFixture();
  const handle = node('#drag-handle');
  handle.handlers.pointerdown({ button: 0, pointerId: 1, clientX: 620, clientY: 30, preventDefault() {} });
  handle.handlers.pointermove({ pointerId: 1, clientX: -200, clientY: 2000 });
  assert.equal(node('#mock-panel').style.left, '8px');
  assert.equal(node('#mock-panel').style.top, '192px');
  handle.handlers.pointerup({ pointerId: 1 });
  handle.handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(node('#mock-panel').style.left, '16px');
  node('#collapse').handlers.click();
  assert.equal(node('#panel-controls').hidden, true);
  assert.equal(node('#collapse').attrs['aria-expanded'], 'false');
  node('#collapse').handlers.click();
  assert.equal(node('#panel-controls').hidden, false);
});

test('准备和冻结使用开关，服务器状态决定实际选中状态', () => {
  const { node, window, sent } = panelFixture();
  const room = { code: '99999', phase: 'lobby', hostUid: 'human', players: [{ uid: 'human', connected: true }, { uid: 'bot', mockBot: true, connected: true, ready: false }] };
  const update = () => window.handlers.message({ origin: 'http://test', source: node('#game').contentWindow, data: { type: 'mock-state', room, mockPausedAt: 123 } });
  update();
  assert.equal(node('#pause').checked, true);
  node('#ready').handlers.change({ target: { checked: true } });
  assert.equal(sent.at(-1).action, 'ready');
  assert.equal(sent.at(-1).ready, true);
  assert.equal(node('#ready').checked, false);
  room.players[1].ready = true; update();
  assert.equal(node('#ready').checked, true);
  node('#pause').handlers.change({ target: { checked: false } });
  assert.equal(sent.at(-1).action, 'resume');
  const html = readFileSync(new URL('../../dev/mock.html', import.meta.url), 'utf8');
  for (const id of ['ready', 'pause']) assert.ok(html.includes(`id="${id}" type="checkbox" role="switch"`));
});

test('宽度滑条实时调整预览，并随窗口更新上限', () => {
  const { node, window } = panelFixture();
  const slider = node('#viewport');
  assert.equal(slider.max, '1000');
  assert.equal(node('#game').style.width, '1000px');
  for (const width of [320, 390, 768]) {
    slider.value = String(width); slider.handlers.input();
    assert.equal(node('#game').style.width, `${width}px`);
    assert.equal(node('#viewport-value').textContent, `${width} px`);
  }
  window.innerWidth = 500; window.handlers.resize();
  assert.equal(slider.max, '500');
  assert.equal(node('#game').style.width, '500px');
  window.innerWidth = 1200; window.handlers.resize();
  assert.equal(node('#game').style.width, '768px');
  slider.value = slider.max; slider.handlers.input();
  window.innerWidth = 1400; window.handlers.resize();
  assert.equal(node('#game').style.width, '1400px');
});
