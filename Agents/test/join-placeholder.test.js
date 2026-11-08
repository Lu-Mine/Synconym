import test from 'node:test';
import assert from 'node:assert/strict';
import { observeJoinPlaceholder } from '../../public/join-placeholder.js';

test('提示只在空间不足时滚动，宽度变化后更新并释放观察器', () => {
  const previous = globalThis.ResizeObserver;
  let observer;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.update = callback; observer = this; }
    observe() {}
    disconnect() { this.closed = true; }
  };
  try {
    const text = { offsetWidth: 250 };
    const state = {};
    const viewport = {
      clientWidth: 100,
      querySelector: () => text,
      style: { setProperty: (name, value) => { state[name] = value; } },
      classList: { toggle: (name, value) => { state[name] = value; } }
    };
    const secondState = {};
    const secondViewport = {
      clientWidth: 200,
      querySelector: () => ({ offsetWidth: 210 }),
      style: { setProperty: (name, value) => { secondState[name] = value; } },
      classList: { toggle: (name, value) => { secondState[name] = value; } }
    };
    const stop = observeJoinPlaceholder({ querySelectorAll: () => [viewport, secondViewport] });
    assert.equal(state['--join-placeholder-offset'], '-150px');
    assert.equal(state['is-overflowing'], true);
    assert.equal(secondState['--join-placeholder-offset'], '-10px');
    assert.equal(secondState['is-overflowing'], true);
    viewport.clientWidth = 300;
    observer.update();
    assert.equal(state['--join-placeholder-offset'], '0px');
    assert.equal(state['is-overflowing'], false);
    stop();
    assert.equal(observer.closed, true);
  } finally {
    globalThis.ResizeObserver = previous;
  }
});
