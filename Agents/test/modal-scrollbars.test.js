import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../public/scrollbars.js', import.meta.url), 'utf8');

test('弹层打开时只显示弹层滚动条，关闭后恢复背景滚动条', () => {
  const attached = [];
  let open = false;
  const rect = { left: 0, top: 0, right: 100, bottom: 100 };
  const element = (parent = null) => ({
    parent, clientHeight: 100, scrollHeight: 200, clientWidth: 100, scrollWidth: 100,
    scrollTop: 0, getBoundingClientRect: () => rect, closest: () => null,
  });
  const root = element();
  const modal = { contains: node => node.parent === modal };
  const content = element(modal);
  const body = {
    querySelectorAll: () => [content],
    append: rail => attached.push(rail),
  };
  const document = {
    body, scrollingElement: root,
    querySelectorAll: () => open ? [modal] : [],
    documentElement: { classList: { add() {} } },
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {},
      append() {}, remove() { attached.splice(attached.indexOf(this), 1); },
    }),
    addEventListener() {},
  };
  const context = {
    document, innerWidth: 100, innerHeight: 100,
    getComputedStyle: node => ({ visibility: node === content && !open ? 'hidden' : 'visible', overflowY: 'auto', overflowX: 'auto', zIndex: '20' }),
    requestAnimationFrame() {}, MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
    window: { addEventListener() {} },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext('update()', context);
  assert.equal(attached.length, 1);
  const backgroundRail = attached[0];
  open = true;
  vm.runInContext('update()', context);
  assert.equal(attached.length, 1);
  assert.notEqual(attached[0], backgroundRail);
  open = false;
  vm.runInContext('update()', context);
  assert.equal(attached.length, 1);
  assert.notEqual(attached[0], backgroundRail);
});

test('弹层打开时阶段切换不启用整页视图过渡', () => {
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const shouldTransition = Boolean\([\s\S]*?!document\.documentElement\.classList\.contains\('is-modal-open'\)[\s\S]*?\);/);
});

test('标记 scrollbars-left 的滚动容器把竖向滚动条放到左边', () => {
  const attached = [];
  const rect = { left: 0, top: 0, right: 100, bottom: 100 };
  const element = {
    clientHeight: 100, scrollHeight: 200, clientWidth: 100, scrollWidth: 100,
    scrollTop: 0, getBoundingClientRect: () => rect, closest: () => null,
    classList: { contains: name => name === 'scrollbars-left' },
  };
  const root = {
    clientHeight: 100, scrollHeight: 100, clientWidth: 100, scrollWidth: 100,
    scrollTop: 0, getBoundingClientRect: () => rect, closest: () => null,
  };
  const document = {
    body: { querySelectorAll: () => [element], append: rail => attached.push(rail) },
    scrollingElement: root,
    querySelectorAll: () => [],
    documentElement: { classList: { add() {} } },
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {},
      append() {}, remove() {},
    }),
    addEventListener() {},
  };
  const context = {
    document, innerWidth: 100, innerHeight: 100,
    getComputedStyle: () => ({ visibility: 'visible', overflowY: 'auto', overflowX: 'visible', zIndex: '10' }),
    requestAnimationFrame() {}, MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
    window: { addEventListener() {} },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext('update()', context);
  const rail = attached.find(item => item.className.includes('is-vertical'));
  assert.ok(rail.className.includes('is-left'));
  assert.equal(rail.style.left, '2px');
});
