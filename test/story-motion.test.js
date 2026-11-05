import test from 'node:test';
import assert from 'node:assert/strict';
import { observeStoryMotion } from '../public/story-motion.js';

test('演示仅在可见且页面未隐藏时播放，清理观察器', () => {
  const makeDemo = () => {
    const classes = new Set();
    return { classes, classList: { add: (name) => classes.add(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } };
  };
  const demos = [makeDemo(), makeDemo()];
  let observer;
  class FakeObserver {
    constructor(callback) { this.callback = callback; this.items = []; observer = this; }
    observe(item) { this.items.push(item); }
    disconnect() { this.disconnected = true; }
  }
  const doc = { hidden: false, addEventListener(type, cb) { this.callback = cb; }, removeEventListener(type, cb) { assert.equal(cb, this.callback); this.removed = true; } };
  const stop = observeStoryMotion({ querySelectorAll: () => demos }, { doc, Observer: FakeObserver });
  assert.equal(observer.items.length, 2);
  assert.ok(demos.every(d => d.classes.has('motion-observed') && !d.classes.has('motion-visible')));
  observer.callback([{ target: demos[0], isIntersecting: true }, { target: demos[1], isIntersecting: false }]);
  assert.equal(demos[0].classes.has('motion-visible'), true);
  assert.equal(demos[1].classes.has('motion-visible'), false);
  doc.hidden = true; doc.callback();
  assert.ok(demos.every(d => d.classes.has('motion-hidden')));
  doc.hidden = false; doc.callback();
  assert.ok(demos.every(d => !d.classes.has('motion-hidden')));
  stop(); assert.equal(observer.disconnected, true); assert.equal(doc.removed, true);
});

test('不支持 IntersectionObserver 时保留原有动画', () => {
  const stop = observeStoryMotion({ querySelectorAll: () => [{}] }, { doc: {}, Observer: null });
  assert.doesNotThrow(stop);
});
