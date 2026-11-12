import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countdownState, updateStartCountdown, planetFrames, planetTransform, planetPose, fadeFirstRound } from '../../public/countdown.js';
import { startCountdownMarkup, shellMarkup } from '../../public/render.js';

function fixture() {
  let updates = 0;
  const steps = [1, 2, 3, 4, 5].map((step) => ({ dataset: { step }, classList: { toggle(name, on) { this[name] = on; } } }));
  const orbits = [0, 1].map(() => ({ style: { removeProperty(key) { delete this[key]; } } }));
  const cosmos = { isConnected: true, querySelectorAll: () => orbits };
  const scene = { dataset: { beat: '5' }, style: { setProperty(name, value) { this[name] = value; updates++; } }, querySelectorAll: () => steps, querySelector: () => null };
  const element = { textContent: '5', closest: () => scene };
  return { element, scene, cosmos, orbits, steps, updates: () => updates };
}

test('开场数字、进度按服务端五秒截止时间推进，不额外延长开局', () => {
  const f = fixture();
  const room = { phase: 'countdown', phaseDeadline: 15000 };
  for (let elapsed = 0; elapsed <= 5; elapsed++) {
    const { seconds } = countdownState(room, 10000 + elapsed * 1000);
    updateStartCountdown(f.element, seconds);
    assert.equal(f.scene.dataset.beat, String(5 - elapsed));
    assert.equal(f.element.textContent, elapsed === 5 ? '开始' : String(5 - elapsed));
    assert.equal(f.steps.filter((s) => s.classList['is-complete']).length, elapsed);
    assert.equal(Number(f.scene.style['--countdown-progress']), elapsed / 5);
  }
});

test('重复 tick 不重置节拍，晚加入直接显示剩余秒数', () => {
  const f = fixture();
  updateStartCountdown(f.element, 2);
  assert.equal(f.element.textContent, '2');
  assert.equal(f.steps.filter((s) => s.classList['is-complete']).length, 3);
  updateStartCountdown(f.element, 2);
  updateStartCountdown(f.element, 2);
  assert.equal(f.updates(), 1);
  updateStartCountdown(f.element, 0);
  assert.equal(f.element.textContent, '开始');
  updateStartCountdown(f.element, null);
  assert.equal(f.element.textContent, '–');
});

test('开场保留主题、无障碍计时语义及壳层 footer', () => {
  const html = startCountdownMarkup({ code: '12345', mode: 'theme', themeName: '<旅行>' });
  assert.match(html, /role="timer"[^>]*aria-live="off"/);
  assert.match(html, /&lt;旅行&gt;/);
  assert.equal((html.match(/data-step=/g) || []).length, 5);
  assert.doesNotMatch(startCountdownMarkup({ mode: 'free' }), /本局主题/);
  assert.match(shellMarkup(true), /<footer class="site-footer">/);
});

test('开场不再用全屏高层遮罩，页脚在正常内容层且支持减少动态效果', () => {
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const block = css.match(/\.start-countdown \{[^}]*\}/)[0];
  assert.doesNotMatch(block, /position: fixed|z-index: 100/);
  assert.match(css, /body\[data-scene="countdown"\] \.site-footer \{[^}]*position: relative;[^}]*z-index: 1;[^}]*flex: 0 0 auto/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*body\[data-scene="countdown"\][\s\S]*?animation: none !important; transition: none !important;/);
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /nextScreen === 'countdown' && stage.querySelector\('\.start-countdown'\)\?\.dataset.room === state.room\?\.code\) return true/);
});

test('逐帧轨道跟随时间推进，重复 tick 不重建循环，离开页面时停止', (t) => {
  const globals = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originals = globals.map((key) => globalThis[key]);
  let nextFrame;
  let requests = 0;
  globalThis.window = { innerWidth: 1280, matchMedia: () => ({ matches: false }) };
  globalThis.requestAnimationFrame = (callback) => { nextFrame = callback; return ++requests; };
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => globals.forEach((key, i) => { if (originals[i] === undefined) delete globalThis[key]; else globalThis[key] = originals[i]; }));
  t.mock.method(performance, 'now', () => 1000);
  const f = fixture();
  f.scene.querySelector = () => f.cosmos;
  updateStartCountdown(f.element, 2, 1750);
  assert.equal(f.orbits[0].style.transform, planetTransform(.65, false, 320, 300));
  updateStartCountdown(f.element, 2, 1750);
  assert.equal(requests, 1);
  nextFrame(1250);
  assert.equal(f.orbits[0].style.transform, planetTransform(.7, false, 320, 300));
  f.cosmos.isConnected = false;
  nextFrame(1266);
  assert.equal(requests, 2);
  assert.equal(f.orbits[0].style.transform, undefined);
});

test('轨道使用连续函数采样，关键帧不包含层级与缩放跳变', () => {
  for (const opposite of [false, true]) {
    const frames = planetFrames(opposite);
    assert.equal(frames.length, 181);
    const positions = frames.map((f) => [...f.transform.matchAll(/([-\d.e+]+)px/g)].map((m) => Number(m[1])));
    assert.ok(positions.every((p) => p.length === 2));
    const velocities = positions.slice(1).map((p, i) => p.map((v, j) => v - positions[i][j]));
    for (let i = 1; i < velocities.length; i++) {
      assert.ok(Math.hypot(...velocities[i].map((v, j) => v - velocities[i - 1][j])) < .003);
    }
    assert.ok(frames.every((f) => Object.keys(f).join(',') === 'offset,transform'));
  }
});

test('双行星置于背景层，开局专属全屏揭幕且写词阶段配色统一', () => {
  const html = startCountdownMarkup({ mode: 'free' });
  assert.match(html, /start-countdown-cosmos" aria-hidden="true"/);
  assert.equal((html.match(/class="countdown-planet /g) || []).length, 2);
  assert.doesNotMatch(html, /start-countdown-orbits/);
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /body\[data-scene="writing"\] \{ --bg-a: #FFD0BF; --bg-b: #FFC4DE; --bg-c: #FFE7B3;/);
  assert.doesNotMatch(css, /body\[data-scene="writing"\]\[data-round=/);
  assert.match(css, /animation: launch-curtain 900ms cubic-bezier\(.65, 0, .35, 1\)/);
  assert.match(css, /mask-image: radial-gradient\(circle at 50% 46%/);
  assert.doesNotMatch(css, /is-match-launch|150vmax|@keyframes planet-orbit|\.start-countdown-content::before/);
  assert.match(css, /\.start-countdown-content \{ text-shadow:/);
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /!initialSync && previousScreen === 'countdown' && nextScreen === 'writing'/);
  assert.match(app, /if \(launch\) showLaunchCurtain\(\);\s*applyDOM\(\)/);
});

test('首轮内容与圆形揭幕共用 cubic 曲线渐显，减少动态效果直接显示', (t) => {
  const originals = [globalThis.window, globalThis.document];
  let reduced = false;
  globalThis.window = { matchMedia: () => ({ matches: reduced }) };
  globalThis.document = { hidden: false };
  t.after(() => ['window', 'document'].forEach((key, i) => { if (originals[i] === undefined) delete globalThis[key]; else globalThis[key] = originals[i]; }));
  const calls = [];
  const page = { animate: (...args) => calls.push(args) };
  fadeFirstRound(page);
  assert.deepEqual(calls[0], [[{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: 'cubic-bezier(.65, 0, .35, 1)' }]);
  reduced = true;
  fadeFirstRound(page);
  assert.equal(calls.length, 1);
});

test('旋转背景与揭幕快照共用超大方形覆盖层', () => {
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /body\[data-scene="countdown"\]::before,\s*body\[data-scene="countdown"\]::after,\s*\.launch-atmosphere \{[^}]*width: 200vmax; height: 200vmax/);
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /applyDOM\(\);\s*if \(launch\) fadeFirstRound\(app.querySelector\('\.writing-page'\)\)/);
});

test('轨道深度决定近大远小，揭幕继续运动时缩放连续', () => {
  for (let t = 0; t <= 1.2; t += .001) {
    const a = planetPose(t, false, 320, 300);
    const b = planetPose(t, true, 320, 300);
    assert.equal(a.depth > b.depth, a.scale > b.scale);
    assert.ok(a.scale >= .69 && a.scale <= 1.14);
    const next = planetPose(t + .001, false, 320, 300);
    assert.ok(Math.abs(next.scale - a.scale) < .003);
  }
  const near = planetPose((Math.PI / 2 + 2.8) / (Math.PI * 2));
  const far = planetPose((Math.PI / 2 + 2.8) / (Math.PI * 2), true);
  assert.ok(near.scale / far.scale > 1.6);
});

test('前后交换发生在星球及环带分离处，窄屏也不会交叠翻层', () => {
  for (const width of [320, 390, 844, 1440]) {
    const radius = Math.min(width * .3, 320);
    const diameter = Math.min(300, Math.max(140, width * .24));
    for (const t of [2.8 / (Math.PI * 2), (2.8 + Math.PI) / (Math.PI * 2)]) {
      const a = planetPose(t, false, radius, diameter);
      const b = planetPose(t, true, radius, diameter);
      assert.ok(Math.abs(a.x - b.x) > diameter * 1.5 * (a.scale + b.scale) / 2);
    }
  }
});
