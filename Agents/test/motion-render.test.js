import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { motionTarget, sceneMotion } from '../../public/motion.js';

const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
const renderSource = source.slice(source.indexOf('function render({'), source.indexOf('\nfunction flushWriteQueue'));

function harness() {
  const transitions = [], paints = [], scrolls = [];
  const noop = () => {};
  const context = vm.createContext({
    motionTarget, sceneMotion, state: { room: null, profile: null },
    currentScreen: 'qa', currentMotionTarget: motionTarget('qa'),
    pendingMotionTarget: null, activeSceneTransition: null,
    deferredSceneRender: false, deferredForceFull: false, renderGeneration: 0, currentInsaneScene: false,
    targetScreen: 'profile', pathOpen: false, homeSettingsOpen: false,
    location: { search: '' }, historyQuery: () => ({}),
    screenKeyFor: () => context.targetScreen,
    closeStartEntry: noop, clearStartEntry: noop, syncModalScrollLock: noop,
    clearLaunchCurtain: noop, showLaunchCurtain: noop, ensureShell: () => ({}),
    syncConnectionUI: noop, syncPathModalDOM: noop, refreshTimers: noop,
    insaneBackground: { setActive: noop }, isInsaneScene: () => false, syncInsaneTheme: () => false,
    patchSameScene: () => { paints.push('patch'); return true; },
    replaceScene: () => paints.push('replace'),
    app: { scrollTo: () => scrolls.push('app') },
    window: { matchMedia: () => ({ matches: false }), scrollTo: () => scrolls.push('window') },
    document: {
      body: { dataset: {} }, documentElement: { dataset: {}, classList: { contains: () => false } },
      startViewTransition: (apply) => {
        let finish;
        const t = { apply, skipped: false, ready: Promise.resolve(),
          finished: new Promise(resolve => { finish = resolve; }),
          skipTransition() { this.skipped = true; finish(); }, finish: () => finish() };
        transitions.push(t);
        return t;
      }
    }
  });
  vm.runInContext(renderSource, context);
  return { context, transitions, paints, scrolls, render: (options) => context.render(options) };
}

for (const when of ['before capture', 'during playback']) {
  test(`历史数据回包 ${when} 合并刷新，不取消或重启过渡`, async () => {
    const h = harness();
    h.render();
    assert.equal(h.scrolls.length, 0, '捕获旧快照前不滚动');
    if (when === 'during playback') h.transitions[0].apply();
    h.render({ forceFull: true });
    assert.equal(h.transitions.length, 1);
    assert.equal(h.transitions[0].skipped, false);
    if (when === 'before capture') h.transitions[0].apply();
    assert.equal(h.context.document.documentElement.dataset.sceneSnapshot, 'new');
    h.transitions[0].finish();
    await Promise.resolve();
    assert.deepEqual(h.paints, ['patch', 'replace']);
    assert.equal(h.context.activeSceneTransition, null);
    assert.equal(h.context.document.documentElement.dataset.sceneSnapshot, undefined);
  });
}

test('捕获前快速返回会丢弃过期回调，捕获后导航仍可打断', async () => {
  const h = harness();
  h.render();
  h.context.targetScreen = 'qa';
  h.render();
  h.transitions[0].apply();
  await Promise.resolve();
  assert.equal(h.transitions[0].skipped, true);
  assert.equal(h.context.currentMotionTarget.screen, 'qa');
  assert.deepEqual(h.paints, ['patch']);
  h.context.targetScreen = 'privacy';
  h.render();
  h.transitions[1].apply();
  h.context.targetScreen = 'profile';
  h.render();
  assert.equal(h.transitions[1].skipped, true);
  h.transitions[2].apply();
  h.transitions[2].finish();
  await Promise.resolve();
  assert.equal(h.context.currentMotionTarget.screen, 'profile');
});

test('普通场景与狂意场景互换时才播侵蚀过场', () => {
  const h = harness();
  let insane = false;
  h.context.isInsaneScene = () => insane;
  h.context.syncInsaneTheme = () => insane;
  h.context.targetScreen = 'home';
  h.render();
  h.transitions[0].apply();
  assert.equal(h.context.document.documentElement.dataset.sceneMotion, 'depth');

  insane = true;
  h.context.targetScreen = 'insane';
  h.render();
  assert.equal(h.context.document.documentElement.dataset.sceneMotion, 'erosion');
  h.transitions[1].apply();
  h.transitions[1].finish();

  // 场景没变，房间内换屏走常规阶段动效。
  h.context.targetScreen = 'lobby';
  h.render();
  assert.notEqual(h.context.document.documentElement.dataset.sceneMotion, 'erosion');
  h.transitions[2].apply();
  h.transitions[2].finish();

  // 狂意房间同样是狂意场景，离开时才回到普通场景的过场。
  insane = true;
  h.context.targetScreen = 'writing';
  h.render();
  assert.notEqual(h.context.document.documentElement.dataset.sceneMotion, 'erosion');
  h.transitions[3].apply();
  h.transitions[3].finish();

  insane = false;
  h.context.targetScreen = 'home';
  h.render();
  assert.equal(h.context.document.documentElement.dataset.sceneMotion, 'erosion');
});
