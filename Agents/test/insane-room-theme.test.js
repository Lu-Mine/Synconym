import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { INSANE_MODES, isInsaneMode } from '../../public/render.js';

const css = () => readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
const source = () => readFile(new URL('../../public/app.js', import.meta.url), 'utf8');

test('五种狂意玩法都按狂意场景处理，自由与主题房间不变', () => {
  assert.deepEqual([...INSANE_MODES], ['livonym', 'shiritori', 'impostor', 'blitz', 'bridge']);
  for (const mode of INSANE_MODES) assert.equal(isInsaneMode(mode), true);
  for (const mode of ['free', 'theme', '', undefined, null, 'livonymx']) assert.equal(isInsaneMode(mode), false);
});

test('狂意页与狂意系列玩法的房间共用一个场景标记与同一块背景画布', async () => {
  const app = await source();
  assert.match(app, /function isInsaneScene\(screen\)\s*\{\s*return screen === 'insane' \|\| isInsaneMode\(state\.room\?\.mode\);/);
  assert.match(app, /if \(insane\) document\.body\.dataset\.insane = '';/);
  assert.match(app, /else delete document\.body\.dataset\.insane;/);
  assert.match(app, /if \(insane && isInsaneMode\(mode\)\) document\.body\.dataset\.insaneMode = mode;/);
  assert.match(app, /else delete document\.body\.dataset\.insaneMode;/);
  // 页面与房间都打开背景，离开场景时一起关闭
  assert.match(app, /insaneBackground\.setActive\(insane\)/);
  assert.doesNotMatch(app, /dataset\.roomTheme/);
  assert.doesNotMatch(app, /insaneBackground\.setActive\(insaneScene \|\| insaneRoom\)/);
});

test('狂意场景整套换用深色色板，玩法色只跟着当前玩法走', async () => {
  const styles = await css();
  const scene = styles.match(/body\[data-insane\]\s*\{([^}]*)\}/)?.[1];
  assert.ok(scene);
  for (const token of ['--card:', '--card-hover:', '--line:', '--line-strong:', '--ink:', '--ink-secondary:', '--muted:', '--accent:', '--accent-soft:', '--bg-subtle:']) {
    assert.ok(scene.includes(token), `缺少 ${token}`);
  }
  assert.match(scene, /color-scheme:\s*dark;/);
  assert.match(scene, /background:\s*#071026;/);
  assert.match(scene, /--ink:\s*#f4f3fb;/);
  assert.match(styles, /body\[data-insane\]\[data-insane-mode="livonym"\]\s*\{\s*--mode-a:\s*#8ee4d7;/);
  // 背景沿用狂意页的同一组氛围色；有 WebGL 背景时只留画布
  assert.match(styles, /body\[data-insane\]::before\s*\{[^}]*background:\s*radial-gradient\(ellipse at 42% 46%, #24407a 0, #101f46 38%, transparent 72%\)/);
  assert.match(styles, /body\[data-insane\]::after\s*\{[^}]*rgb\(4 8 22 \/ \.38\)[^}]*backdrop-filter:\s*blur\(6px\) saturate\(1\.1\)/);
  assert.match(styles, /body\.has-insane-gl\[data-insane\]::before\s*\{\s*display:\s*none;/);
  // 场景根只有一处，页面不再维护第二套浅色令牌
  assert.doesNotMatch(styles, /body\[data-scene="insane"\]::before/);
  assert.doesNotMatch(styles, /data-room-theme/);
});

test('狂意场景只把玩法色用在标记与光晕上', async () => {
  const styles = await css();
  assert.match(styles, /body\[data-insane\] \.writing-stage\s*\{[^}]*radial-gradient\(120% 88% at 50% -30%, color-mix\(in srgb, var\(--mode-a\) 16%, transparent\)[^}]*var\(--card\)/);
  assert.match(styles, /body\[data-insane\] \.stage-step\.is-current,[\s\S]*?body\[data-insane\] \.livonym-guessed-rank\s*\{\s*color:\s*var\(--mode-a\);/);
  assert.match(styles, /body\[data-insane\] \.livonym-secret\s*\{\s*text-shadow:\s*0 0 28px color-mix\(in srgb, var\(--mode-a\) 45%, transparent\);/);
  // 白字主按钮仍用可读的紫，避免玩法色与白字对比不足
  assert.match(styles, /body\[data-insane\]\s*\{[^}]*--accent:\s*#6a56f0;/);
  assert.doesNotMatch(styles, /body\[data-insane\] \.primary/);
});

test('深色底上按浅色写死的组件都有深色取值', async () => {
  const styles = await css();
  for (const rule of [
    /body\[data-insane\] \.toast\s*\{[^}]*background:\s*#262a4a;[^}]*color:\s*var\(--ink\);/,
    /body\[data-insane\] \.brand:hover\s*\{\s*background:\s*var\(--card-hover\);/,
    /body\[data-insane\] \.connection-status\s*\{[^}]*background:\s*#3b2f16;/,
    /body\[data-insane\] \.idle-clock\.urgent,[\s\S]*?\.ready-state\.host-state\s*\{[^}]*color:\s*#ff9d90;[^}]*background:\s*#3b1f26;/,
    /body\[data-insane\] \.player,[\s\S]*?\.game-status\s*\{\s*--status-color:\s*#c8c2d9;/,
    /body\[data-insane\] \.result-vote-choice\.is-no,[\s\S]*?\.result-break-label\s*\{\s*color:\s*#ff9d90;/,
    /body\[data-insane\] \.start-countdown-content\s*\{[^}]*--countdown-ink:\s*var\(--mode-a\);/
  ]) assert.match(styles, rule);
  // Toast 在狂意场景里也是深色卡片，不再反色成浅色底
  assert.doesNotMatch(styles, /#ece8fa/);
});

test('普通场景与狂意场景互换时播放侵蚀过场', async () => {
  const app = await source();
  assert.match(app, /let currentInsaneScene = false;/);
  assert.match(app, /const nextInsaneScene = isInsaneScene\(nextScreen\);/);
  assert.match(app, /const insaneSwitch = nextInsaneScene !== currentInsaneScene;/);
  assert.match(app, /document\.documentElement\.dataset\.sceneMotion = insaneSwitch \? 'erosion' : motion\.kind;/);
  assert.match(app, /currentInsaneScene = syncInsaneTheme\(nextScreen\);/);
  // 过场由场景决定，不再只看狂意页这个屏幕名
  assert.doesNotMatch(app, /previousScreen === 'insane' && nextScreen === 'home'/);
});

test('狂意玩法的房间退出后回到狂意模式大厅', async () => {
  const app = await source();
  assert.match(app, /if \(previous\?\.code && isInsaneMode\(previous\.mode\)\) \{/);
  assert.match(app, /history\.replaceState\(\{ insane: true \}, '', `\$\{APP_ROOT\}\?insane`\)/);
  // 普通房间退出仍然回到主页；初次同步保留地址里的页面
  assert.match(app, /if \(previous\?\.code\) insaneOpen = false;/);
  assert.match(app, /if \(!insaneOpen && !profileOpen && !privacyOpen && !qaOpen && location\.search\) history\.replaceState\(null, '', APP_ROOT\);/);
});

test('狂意背景漩涡仅在狂意大厅（screen === insane）开启 glitch', async () => {
  const bg = await readFile(new URL('../../public/insane-background.js', import.meta.url), 'utf8');
  const app = await source();
  assert.match(bg, /uniform float uGlitch;/);
  assert.match(bg, /float burst = uGlitch \* step\(\.55, hash/);
  assert.match(bg, /setGlitch\(value\)/);
  assert.match(app, /insaneBackground\.setGlitch\?\.\(nextScreen === 'insane'\)/);
});
test('五种狂意模式的开局倒计时使用对应配色与专属像素动画，并在 footer 上方展示英文艺术字，不显示普通模式双星球', async () => {
  const styles = await css();
  const { startCountdownMarkup, wordmarkArt } = await import('../../public/render.js');
  const { INSANE_COUNTDOWN_THEMES, insaneCountdownTheme, insanePixelPose } = await import('../../public/countdown.js');
  assert.match(styles, /body\[data-insane\] \.start-countdown-content\s*\{[^}]*--countdown-ink:\s*var\(--mode-a\);/);
  assert.match(styles, /body\[data-insane\] \.start-countdown-progress span\s*\{[^}]*var\(--mode-a\), var\(--mode-b\)/);
  assert.match(styles, /body\[data-insane\] \.start-countdown-wordmark\s*\{[^}]*margin-top:\s*auto;/);
  for (const mode of INSANE_MODES) {
    const html = startCountdownMarkup({ code: '12345', mode });
    assert.match(html, /class="start-countdown-insane-fx"/);
    assert.match(html, /class="mode-wordmark start-countdown-wordmark"/);
    assert.ok(html.includes(wordmarkArt[mode]));
    assert.doesNotMatch(html, /start-countdown-cosmos|countdown-planet/);
    const theme = insaneCountdownTheme(mode);
    assert.ok(INSANE_COUNTDOWN_THEMES[mode]);
    assert.equal(theme.sprites.length, 2);
    const pose = insanePixelPose({ index: 0, baseAngle: 0, rx: 200, ry: 120, phase: 0 }, 0.5, mode, 1280, 720);
    assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y));
  }
  for (const mode of ['free', 'theme']) {
    const html = startCountdownMarkup({ code: '12345', mode });
    assert.match(html, /class="start-countdown-cosmos"/);
    assert.doesNotMatch(html, /start-countdown-insane-fx|start-countdown-wordmark/);
  }
});
