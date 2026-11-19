import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { homeEntryMarkup, settingsMarkup } from '../../public/render.js';
import { insaneMarkup, insanePreviewMarkup, INSANE_DEFAULT_MODE } from '../../public/insane.js';
import { motionTarget, sceneMotion } from '../../public/motion.js';
import { createSynconymServer } from '../../server/index.js';
import { createDatabase } from '../../server/db.js';

const settings = { mode: 'theme', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true };

test('Insane 是创建前选择器末尾的导航入口，不影响实际房间设置', () => {
  const home = homeEntryMarkup(settings);
  const mode = home.match(/<div class="segmented" role="group" data-segmented="mode"[\s\S]*?<\/div>/)[0];
  assert.match(mode, /--selected:1;--count:3/);
  assert.ok(mode.indexOf('data-value="free"') < mode.indexOf('data-value="theme"'));
  assert.ok(mode.indexOf('data-value="theme"') < mode.indexOf('data-action="open-insane"'));
  assert.match(mode, /href="\?insane"/);
  assert.doesNotMatch(mode, /data-value="insane"/);
  assert.doesNotMatch(settingsMarkup(settings, true), /open-insane/);
  assert.doesNotMatch(settingsMarkup(settings, false), /open-insane/);
});

test('Insane 页面不显示顶栏开始游戏按钮', async () => {
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /body\[data-scene="insane"\] \.header-start\s*\{\s*display:\s*none;/);
});

test('狂意主页标题以 INSANE 英文艺术字在上、下方保留「狂意模式」渐变背光与故障动画，并支持减少动态效果', async () => {
  const html = insaneMarkup();
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(html, /<h1><span class="insane-heading-en" lang="en"><span class="sr-only">INSANE<\/span><span class="wm-insane"[\s\S]*?<span class="insane-heading-zh insane-heading-text" data-glow="狂意模式">狂意模式<\/span><\/h1>/);
  assert.match(css, /\.insane-heading-zh\s*\{[^}]*font-size:\s*22px/);
  assert.match(css, /\.insane-heading h1\s*\{[^}]*font-size:\s*34px/);
  assert.match(css, /\.insane-portal span,\s*\.insane-heading-text\s*\{[^}]*animation:\s*insane-portal-glitch 4\.2s steps\(1, end\) infinite/);
  assert.match(css, /\.insane-heading-en \.ins-char::before\s*\{\s*animation:\s*insane-heading-cyan 4\.2s/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.insane-card::before\s*\{[^}]*\}\s*\.insane-distortion\s*\{[^}]*\}\s*\.insane-portal::after,\s*\.insane-portal span,\s*\.insane-heading-text,\s*\.insane-heading-en \.ins-char::before,\s*\.insane-heading-en \.ins-char::after\s*\{\s*animation:\s*none;/);
});

test('标题双圆以断拍错位保持圆形，减少动态效果时保持静止', async () => {
  const html = insaneMarkup();
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(html, /class="insane-heading-mark" aria-hidden="true"><i><\/i><i><\/i>/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.insane-heading-mark i:first-child\s*\{\s*animation:\s*insane-mark-pull 4\.2s steps\(1, end\)/);
  assert.match(css, /\.insane-heading-mark i:last-child\s*\{\s*animation:\s*insane-mark-counterpull 4\.2s steps\(1, end\)/);
  for (const name of ['insane-mark-pull', 'insane-mark-counterpull']) {
    const frames = css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n  \\}`))?.[1];
    assert.ok(frames);
    assert.doesNotMatch(frames, /scale|rotate/);
    assert.match(frames, /translate\(0, 0\)/);
  }
});

test('标题双圆半透明，电弧附着球体并支持减少动态效果', async () => {
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  for (const child of ['first', 'last']) {
    const rule = css.match(new RegExp(`\\.insane-heading-mark i:${child}-child\\s*\\{([^}]*)\\}`))?.[1];
    assert.match(rule, /background:\s*rgb\([^)]*\/\s*\.72\)/);
    assert.doesNotMatch(rule, /opacity/);
  }
  assert.match(css, /\.insane-heading-mark i::before,\s*\.insane-heading-mark i::after\s*\{[^}]*data:image\/svg\+xml[^}]*opacity:\s*\.65/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\.insane-heading-mark i::before\s*\{\s*animation:\s*insane-mark-spark/);

});
test('狂意背景的故障效果以阶跃闪现而非平滑渐变', async () => {
  const source = await readFile(new URL('../../public/insane-background.js', import.meta.url), 'utf8');
  const burst = source.match(/float burst = ([^;]+);/)?.[1];
  assert.ok(burst);
  assert.match(burst, /step\(\.04, phase\) - step\(\.12, phase\)/);
  assert.match(burst, /step\(\.18, phase\) - step\(\.26, phase\)/);
  assert.doesNotMatch(burst, /smoothstep/);
});

test('WebGL 上下文丢失时把背景交回 CSS 渐变', async () => {
  const source = await readFile(new URL('../../public/insane-background.js', import.meta.url), 'utf8');
  assert.match(source, /canvas\.addEventListener\('webglcontextlost', \(event\) => \{ event\.preventDefault\(\); fallBackToCss\(\); \}\)/);
  assert.match(source, /document\.body\.classList\.remove\('has-insane-gl'\)/);
  assert.match(source, /classList\.toggle\('has-insane-gl', active && !contextLost\)/);
  assert.match(source, /if \(!active \|\| contextLost \|\| document\.hidden\) return;/);
});
test('思维卧底图标划除目标球，交互时播放单次划除反馈', async () => {
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.insane-mark--impostor i:nth-child\(3\)\s*\{[^}]*width:\s*38px;[^}]*transform-origin:\s*left center/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\.insane-mark i:nth-child\(3\)\s*\{\s*animation:\s*impostor-strike 380ms/);
  assert.match(css, /@keyframes impostor-strike\s*\{[^}]*scaleX\(0\)[\s\S]*?scaleX\(1\)/);
  assert.match(css, /@keyframes impostor-eliminated\s*\{[\s\S]*?opacity:\s*\.48/);
});

test('五种玩法默认收起，人数准确且未开放创建', () => {
  const html = insaneMarkup();
  assert.deepEqual([...html.matchAll(/<article class="insane-card insane-card--([\w-]+)">/g)].map(match => match[1]),
    ['blitz', 'livonym', 'shiritori', 'impostor', 'bridge']);
  assert.match(html, /data-screen="insane"/);
  assert.match(html, /data-action="home"/);
  const modes = [
    ['shiritori', '接龙', 'Shiritori', '2–4 人'],
    ['livonym', '即时竞猜', 'Livonym', '3–8 人'],
    ['impostor', '思维卧底', 'Impostor', '3–6 人'],
    ['blitz', '极速闪电', 'Blitz', '2 人'],
    ['bridge', '语义搭桥', 'Bridge', '2–4 人']
  ];
  for (const [id, name, english, players] of modes) {
    const card = html.match(new RegExp(`<article class="insane-card insane-card--${id}">[\\s\\S]*?<\\/article>`))?.[0];
    assert.ok(card, `缺少 ${name}`);
    // 即时竞猜已接入，其余玩法仍在筹备
    const open = id === 'livonym';
    const texts = [name, english, players, '创建房间', ...(open ? [] : ['暂未开放'])];
    for (const text of texts) assert.ok(card.includes(text));
    assert.match(card, /<details class="insane-details">/);
    assert.match(card, /<summary class="insane-card-row">/);
    assert.match(card, open
      ? /<button class="insane-create" type="button" data-action="create-insane-room" data-mode="livonym"/
      : /<button class="insane-create" type="button" disabled/);
  }
  assert.match(insanePreviewMarkup('impostor'), /六人局里会有两名卧底/);
  assert.match(insanePreviewMarkup('blitz'), /输入 8 秒，揭晓 3 秒/);
  assert.match(html, /class="insane-how-tag" type="button" data-action="insane-how"/);
});

test('独立路由支持返回、状态更新和对称过渡', async () => {
  const source = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /let insaneOpen = new URLSearchParams\(location\.search\)\.has\('insane'\)/);
  assert.match(source, /insaneOpen = new URLSearchParams\(location\.search\)\.has\('insane'\)/);
  assert.match(source, /if \(screen === 'insane'\) return insaneMarkup\(\)/);
  assert.match(source, /history\.pushState\(\{ insane: true \}, '', `\$\{APP_ROOT\}\?insane`\)/);
  assert.match(source, /if \(!insaneOpen && !profileOpen && !privacyOpen && !qaOpen && location\.search\) history\.replaceState\(null, '', APP_ROOT\);/);
  assert.deepEqual(sceneMotion(motionTarget('home'), motionTarget('insane')), { kind: 'depth', direction: 1 });
  assert.deepEqual(sceneMotion(motionTarget('insane'), motionTarget('home')), { kind: 'depth', direction: -1 });
});

test('狂意页面和模块可以通过现有服务访问', async (t) => {
  const { server } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/?insane`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src="\/app\.js"/);
  const module = await fetch(`${base}/insane.js`);
  assert.equal(module.status, 200);
  assert.match(await module.text(), /export function insaneMarkup/);
});

test('五种英文艺术字保留完整名称，并分别提供悬停、焦点和触屏展开动效', async () => {
  const html = insaneMarkup();
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  for (const [id, name] of [['shiritori', 'Shiritori'], ['livonym', 'Livonym'], ['impostor', 'Impostor'], ['blitz', 'Blitz'], ['bridge', 'Bridge']]) {
    assert.match(html, new RegExp(`insane-wordmark--${id}[^>]*><span class="sr-only">${name}</span>`));
    const card = html.match(new RegExp(`<article class="insane-card insane-card--${id}">[\\s\\S]*?<\\/article>`))[0];
    const art = card.match(/<span class="wordmark-art"[^>]*>([\s\S]*?)<\/span><\/span><strong>/)[1];
    const text = art.replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
    assert.equal(text, id === 'impostor' ? 'Impstor' : name);
    assert.match(css, new RegExp(`\\.insane-card--${id}:is\\([\\s\\S]*?focus-visible`));
    assert.match(css, new RegExp(`\\.insane-card--${id}:is\\([\\s\\S]*?insane-details\\[open\\]`));
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.insane-card \.insane-mark i,[\s\S]*?\.wordmark-art \*::after\s*\{\s*transition:\s*none !important;/);
});

test('狂意卡片英文主字标大于中文，搭桥图形位于球体后方偏下', async () => {
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.insane-card-title strong\s*\{[^}]*font-size:\s*14px/);
  assert.match(css, /\.insane-card-title > \.insane-wordmark\s*\{[^}]*font-size:\s*20px/);
  assert.match(css, /\.insane-mark--bridge i:first-child,\s*\.insane-mark--bridge i:nth-child\(2\)\s*\{[^}]*z-index:\s*1;[^}]*top:\s*19px/);
  assert.match(css, /\.insane-mark--bridge i:nth-child\(3\)\s*\{[^}]*z-index:\s*0;[^}]*top:\s*27px/);
});

test('字标保留新装饰结构并统一继承全站字体', async () => {
  const html = insaneMarkup();
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.insane-wordmark--[\w-]+\s*\{[^}]*font-family/);
  assert.doesNotMatch(html, /sh-chain-joint|sh-tail-hook|live-pill|stream-wave|sus-mask|imp-suspect|br-cables|cable-main/);
  assert.equal([...html.matchAll(/class="live-char[^"]*"/g)].length, 7);
  assert.match(html, /class="live-char live-i" style="--i:1"><span class="live-i-stem">i/);
  assert.match(html, /<span>Imp<\/span><span class="imp-eye"><span class="sus-eye"><\/span><\/span><span>stor<\/span>/);
  assert.match(css, /\.insane-card--impostor:is\(:hover, :has\(\.insane-card-row:focus-visible\), :has\(\.insane-details\[open\]\)\) \.wm-impostor\s*\{\s*animation:\s*impostor-shadow 2\.4s steps\(1, end\) infinite/);
  assert.match(css, /@keyframes impostor-shadow\s*\{[\s\S]*?drop-shadow/);
  assert.match(css, /animation:\s*sus-gaze 2\.4s ease-in-out infinite/);
  assert.match(html, /class="bz-text">Blit<span class="bz-bolt">z/);
  for (const [i, letter] of [...'ridg'].entries()) {
    assert.ok(html.includes(`<span class="br-letter" data-letter="${letter}" style="--i:${i}"><span class="br-leap">${letter}</span></span>`));
  }
  assert.match(css, /\.br-letter::before\s*\{[^}]*content:\s*attr\(data-letter\);[^}]*inset:\s*0;[^}]*-webkit-text-stroke:\s*\.6px[^}]*mask-image:\s*repeating-linear-gradient/);
  assert.doesNotMatch(css, /\.br-letter::before\s*\{\s*display:\s*none/);
  assert.match(css, /\.br-leap\s*\{[^}]*opacity:\s*0/);
  assert.doesNotMatch(html, /br-arch/);
  assert.match(css, /animation: sh-pass 1\.15s/);
  assert.match(css, /animation: blitz-trails \.4s linear infinite/);
  assert.match(css, /animation: bridge-leap 2\.4s calc\(var\(--i\) \* 180ms\)/);
  assert.match(css, /\.br-letter::before\s*\{\s*animation:\s*bridge-outline 2\.4s calc\(var\(--i\) \* 180ms\) ease-out infinite backwards/);
  assert.match(css, /@keyframes bridge-outline\s*\{\s*0% \{ opacity: 1; \}\s*12% \{ opacity: 0; \}\s*24%, 72% \{ opacity: 0; \}\s*88%, 100% \{ opacity: 1; \}/);
  assert.match(css, /\.br-leap\s*\{\s*animation:\s*bridge-leap/);
  assert.match(css, /0% \{ opacity: 0; transform: translate\(-\.3em, \.35em\); \}/);
  assert.match(css, /88%, 100% \{ opacity: 0; transform: translate\(0, 0\); \}/);
});

test('五种玩法拥有独立底色，悬停和展开时保留各自色相', async () => {
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.insane-card\s*\{[^}]*background:\s*var\(--mode-surface\)/);
  assert.match(css, /\.insane-card:hover,\s*\.insane-card:has\(details\[open\]\)\s*\{[^}]*background:\s*var\(--mode-surface-active\)/);
  const normal = new Set();
  const active = new Set();
  for (const id of ['shiritori', 'livonym', 'impostor', 'blitz', 'bridge']) {
    const rule = css.match(new RegExp(`\\.insane-card--${id}\\s*\\{([^}]*)\\}`))?.[1];
    assert.ok(rule, `缺少 ${id} 卡片配色`);
    const surface = rule.match(/--mode-surface:\s*(#[\da-f]{6})/i)?.[1];
    const activeSurface = rule.match(/--mode-surface-active:\s*(#[\da-f]{6})/i)?.[1];
    assert.ok(surface, `${id} 缺少默认底色`);
    assert.ok(activeSurface, `${id} 缺少交互底色`);
    assert.notEqual(surface, activeSurface, `${id} 的交互底色应有区别`);
    normal.add(surface);
    active.add(activeSurface);
  }
  assert.equal(normal.size, 5);
  assert.equal(active.size, 5);
});


test('狂意卡片的方块波逐格跳跃并交替方向，减少动态效果时保持静止', async () => {
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@property --pixel-wave-progress\s*\{\s*syntax:\s*'<percentage>';/);
  assert.match(css, /\.insane-card::before\s*\{[^}]*--pixel-wave:\s*linear-gradient\(90deg,[^}]*var\(--mode-a\)[^}]*var\(--mode-b\)[^}]*pointer-events:\s*none;[^}]*background-size:\s*100% 6\.25%;[^}]*insane-pixel-wave 6s linear infinite/);
  assert.match(css, /background-position:\s*0 0%,\s*3px 6\.6667%,\s*6px 13\.3333%,\s*9px 20%/);
  assert.match(css, /--pixel-size:\s*24px/);
  assert.match(css, /--pixel-columns:\s*linear-gradient\(90deg,\s*#000 0 20px,\s*transparent 20px 24px\)/);
  assert.match(css, /--pixel-rows:\s*linear-gradient\(#000 0 20px,\s*transparent 20px 24px\)/);
  assert.match(css, /--pixel-values:\s*conic-gradient\([^}]*#000a[^}]*#000d[^}]*#000b/);
  assert.match(css, /mask-image:\s*var\(--pixel-columns\),\s*var\(--pixel-rows\),\s*var\(--pixel-values\);[^}]*mask-composite:\s*intersect/);
  assert.match(css, /mask-size:\s*var\(--pixel-size\) 100%,\s*100% var\(--pixel-size\),\s*48px 48px/);
  assert.match(css, /transform:\s*translateX\(round\(down,\s*var\(--pixel-wave-progress\),\s*var\(--pixel-size\)\)\)/);
  assert.match(css, /\.insane-card:nth-child\(even\)::before\s*\{[^}]*--wave-mirror:\s*-1;[^}]*animation-direction:\s*reverse/);
  assert.match(css, /@keyframes insane-pixel-wave\s*\{[^}]*--pixel-wave-progress:\s*0%;[\s\S]*?--pixel-wave-progress:\s*235%/);
  assert.doesNotMatch(css, /insane-spectrum-sweep|insane-spectrum-flicker|insane-pixel-bands/);
  assert.doesNotMatch(css, /\.insane-card-title,\s*\.insane-players,\s*\.insane-disclosure,\s*\.insane-description\s*\{[^}]*text-shadow/);
  assert.doesNotMatch(css, /@keyframes live-type\s*\{[^}]*text-shadow/);
  for (const id of ['livonym', 'impostor', 'blitz', 'bridge']) {
    assert.match(css, new RegExp(`\\.insane-card--${id}\\s*\\{[^}]*--mode-phase:\\s*-`));
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.insane-card::before\s*\{\s*animation:\s*none;/);
});

test('狂意卡片折叠和返回交互适配全站动效并尊重减少动态效果', async () => {
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@supports \(interpolate-size: allow-keywords\) and selector\(::details-content\)\s*\{\s*\.insane-details\s*\{\s*interpolate-size: allow-keywords;/);
  assert.match(css, /\.insane-details::details-content\s*\{[^}]*block-size:\s*0;[^}]*opacity:\s*0;[^}]*content-visibility[^}]*allow-discrete/);
  assert.match(css, /\.insane-details\[open\]::details-content\s*\{\s*block-size:\s*auto;\s*opacity:\s*1;/);
  assert.match(css, /\.insane-disclosure \.icon\s*\{[^}]*transition:\s*transform var\(--dur-2\) var\(--ease-out\)/);
  assert.match(css, /\.insane-back:is\(:hover, :focus-visible\) \.icon\s*\{\s*transform:\s*translateX\(-3px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.insane-details::details-content, \.insane-disclosure \.icon, \.insane-card\s*\{\s*transition:\s*none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.insane-back, \.insane-back \.icon\s*\{\s*transition:\s*none;\s*\}\s*\.insane-back:is\(:hover, :focus-visible\) \.icon\s*\{\s*transform:\s*none;/);
});

test('五种狂意玩法的创建房间按钮具备各自独立样式特效与禁用态样式，并尊重减少动态效果', async () => {
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  for (const id of ['blitz', 'livonym', 'shiritori', 'impostor', 'bridge']) {
    assert.match(css, new RegExp(`\\.insane-card--${id} \\.insane-create:not\\(:disabled\\)\\s*\\{`));
    assert.match(css, new RegExp(`\\.insane-card--${id} \\.insane-create:not\\(:disabled\\):is\\(:hover, :focus-visible\\)`));
    assert.match(css, new RegExp(`@keyframes insane-btn-${id}-`));
  }
  // 禁用态独立于玩法色相，呈封锁虚线与斜纹，且关闭伪元素/光标装饰
  assert.match(css, /\.insane-create:disabled\s*\{[^}]*border:\s*1px dashed[^}]*cursor:\s*not-allowed/);
  assert.match(css, /\.insane-create:disabled::before\s*\{[^}]*repeating-linear-gradient\(\s*-45deg/);
  assert.match(css, /\.insane-create:disabled > span::after\s*\{\s*display:\s*none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.insane-create,\s*\.insane-create::before,\s*\.insane-create::after,\s*\.insane-create > span,\s*\.insane-create > span::after\s*\{[^}]*transition:\s*none !important;[^}]*animation:\s*none !important;/);
});

test('狂意大厅宽屏双列：左侧列表与右侧介绍面板同步悬停与选中状态，窄屏保持原折叠列表', async () => {
  const html = insaneMarkup();
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');

  assert.equal(INSANE_DEFAULT_MODE, 'blitz');
  assert.match(html, /<div class="insane-layout" data-selected="blitz" data-preview="blitz">/);
  assert.ok(html.indexOf('class="insane-list"') < html.indexOf('class="insane-preview insane-preview--blitz"'));

  for (const [id, lead] of [
    ['blitz', '不要停，凭直觉想到一起。'],
    ['livonym', '看着想法出现，抢先猜中答案。'],
    ['shiritori', '沿着词尾，继续靠近。'],
    ['impostor', '有人在靠近，也有人在带偏。'],
    ['bridge', '从不同的起点，走向同一个词。']
  ]) {
    const preview = insanePreviewMarkup(id);
    assert.match(preview, new RegExp(`class="insane-preview insane-preview--${id}" data-mode="${id}"`));
    assert.match(preview, /<canvas class="insane-preview-canvas" aria-hidden="true"><\/canvas>/);
    assert.ok(preview.includes(lead), `右侧面板缺少 ${id} 引语`);
    assert.doesNotMatch(preview, /<button|创建房间/);
    assert.match(css, new RegExp(`\\.insane-preview--${id}\\s*\\{`));
  }

  assert.match(css, /\.insane-preview\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /@media \(min-width: 1000px\)\s*\{[\s\S]*?\.app:has\(\.insane-page\)\s*\{\s*--app-w:\s*min\(100% - 64px, 1120px\);/);
  assert.match(css, /\.insane-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1\.08fr\) minmax\(0, 1fr\)/);
  assert.match(css, /\.insane-card \.insane-disclosure,\s*\.insane-card \.insane-description,\s*\.insane-how-tag,\s*\.insane-how-modal\s*\{\s*display:\s*none;\s*\}/);
  assert.ok(css.lastIndexOf('.insane-how-tag,') > css.indexOf('.insane-how-tag {'));
  assert.match(css, /\.insane-preview\s*\{[^}]*position:\s*sticky;[^}]*top:\s*20px;/);

  // 介绍面板的像素雨：方格细到 12px，斜带被方格切出锯齿台阶，整格朝右下错落滑动。
  assert.match(css, /@property --preview-rain-a\s*\{\s*syntax:\s*'<length>';/);
  assert.match(css, /@property --preview-rain-b\s*\{\s*syntax:\s*'<length>';/);
  assert.match(css, /\.insane-preview::after\s*\{[^}]*--pixel-size:\s*12px;[^}]*--pixel-columns:\s*linear-gradient\(90deg,\s*#000 0 9px,\s*transparent 9px 12px\);/);
  // 只用方格行列两道蒙版：去掉明暗马赛克，格子内保持纯色而不是被切成三角。
  const previewBlock = css.slice(css.indexOf('.insane-preview::after'), css.indexOf('@keyframes insane-preview-rain'));
  assert.match(previewBlock, /mask-image:\s*var\(--pixel-columns\), var\(--pixel-rows\);/);
  assert.match(previewBlock, /mask-size:\s*var\(--pixel-size\) 100%, 100% var\(--pixel-size\);/);
  assert.doesNotMatch(previewBlock, /--pixel-values|conic-gradient/);
  // 两层 135° 斜带周期不同，蒙版把斜带切成参差的方块台阶。
  assert.match(css, /\.insane-preview::after\s*\{[\s\S]*?repeating-linear-gradient\(135deg, transparent 0 26px, color-mix\(in srgb, var\(--mode-a\) 10%, transparent\) 34px 62px, transparent 70px 118\.8px\)/);
  assert.match(css, /\.insane-preview::after\s*\{[\s\S]*?repeating-linear-gradient\(135deg, transparent 0 50px, color-mix\(in srgb, var\(--mode-b\) 6%, transparent\) 58px 110px, transparent 118px 237\.6px\)/);
  // 横向与纵向位移取同一个值并按 12px 整格吸附，整体朝右下走。
  assert.match(css, /background-position:\s*round\(down, var\(--preview-rain-a\), 12px\) round\(down, var\(--preview-rain-a\), 12px\),\s*round\(down, var\(--preview-rain-b\), 12px\) round\(down, var\(--preview-rain-b\), 12px\);/);
  assert.match(css, /animation:\s*insane-preview-rain 6\.4s linear infinite;/);
  // 每次位移恰好是各自斜带周期的整数倍，循环回位时画面与原位重合。
  assert.match(css, /@keyframes insane-preview-rain\s*\{\s*from \{ --preview-rain-a: -336px; --preview-rain-b: -168px; \}\s*to \{ --preview-rain-a: 0px; --preview-rain-b: 0px; \}/);
  assert.match(css, /@supports not \(background-position: 0 round\(down, 0px, 12px\)\) \{\s*\.insane-preview::after \{ display: none; \}\s*\.insane-card::after \{ display: none; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.insane-preview \{ transition: none; \}\s*\.insane-preview::after \{ display: none; \}\s*\.insane-card::after \{ display: none; \}\s*\.insane-card-canvas \{ display: none; \}/);
  // 窄屏卡片与宽屏双列左卡/右预览均由 unified canvas 晶格渲染器接管：隐藏静态伪元素，左卡按单列收缩态渲染横向波浪、右预览按单列展开态渲染斜向像素雨，同时保留无脚本 CSS 回退。
  assert.match(css, /\.insane-card:has\(\.insane-details\[open\]\)::after,\s*\.insane-preview::after\s*\{/);
  assert.match(css, /\.insane-card-canvas,\s*\.insane-preview-canvas\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
  assert.match(css, /body\.has-insane-card-motion \.insane-card::before,\s*body\.has-insane-card-motion \.insane-card::after\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /@media \(max-width: 999px\)\s*\{\s*\.insane-preview-canvas\s*\{\s*display:\s*none;\s*\}\s*\}/);
  const wideInsaneStart = css.lastIndexOf('.app:has(.insane-page)');
  assert.ok(wideInsaneStart > 0);
  const wideInsaneCss = css.slice(wideInsaneStart);
  assert.match(wideInsaneCss, /\.insane-card::after\s*\{\s*display:\s*none;\s*\}/);
  assert.doesNotMatch(wideInsaneCss, /\.insane-card-canvas\s*\{\s*display:\s*none;/);
  // 正文始终压在扫描层之上，动画只做底纹。
  assert.match(css, /\.insane-preview > \* \{ position: relative; z-index: 1; \}/);
  assert.match(css, /\.insane-preview > \.insane-preview-canvas \{ position: absolute; z-index: 0; \}/);
  assert.match(css, /body\.has-insane-preview-motion \.insane-preview::before,\s*body\.has-insane-preview-motion \.insane-preview::after\s*\{\s*display:\s*none;\s*\}/);
  assert.match(app, /import \{ observeInsaneCardMotion \} from '\.\/insane-card-motion\.js';/);
  assert.match(app, /const previewCanvas = preview\.querySelector\(':scope > \.insane-preview-canvas'\);/);
  assert.match(app, /nextScreen === lastRenderedScreen[\s\S]*?currentPage\.dataset\.screen === nextScreen/);
  assert.match(app, /stopInsaneCardMotion = observeInsaneCardMotion\(stage\)/);
  assert.match(app, /app\.addEventListener\('mouseover'/);
  assert.match(app, /app\.addEventListener\('mouseout'/);
  assert.match(app, /app\.addEventListener\('focusin'/);
  assert.match(app, /app\.addEventListener\('focusout'/);
  assert.match(app, /if \(isInsaneSplitLayout\(\)\) event\.preventDefault\(\)/);
});

test('狂意大厅窄屏卡片与宽屏右侧预览共用像素晶格斜向像素雨画布', async () => {
  const html = insaneMarkup();
  assert.match(html, /<article class="insane-card insane-card--[^"]+">\s*<canvas class="insane-card-canvas" aria-hidden="true"><\/canvas>\s*<details class="insane-details">/);
  assert.match(html, /<aside class="insane-preview insane-preview--[^"]+"[^>]*><canvas class="insane-preview-canvas" aria-hidden="true"><\/canvas>/);

  const motion = await readFile(new URL('../../public/insane-card-motion.js', import.meta.url), 'utf8');
  assert.match(motion, /export function observeInsaneCardMotion\(stage\)/);
  assert.match(motion, /activeMotionTargets\(\)/);
  assert.match(motion, /body\.classList\.toggle\('has-insane-card-motion', active\)/);
  assert.match(motion, /body\.classList\.toggle\('has-insane-preview-motion', previewActive\)/);
  assert.match(motion, /syncPreview\(\)/);
  assert.match(motion, /fixedM: 1/);
  assert.match(motion, /const lockedM = entry\.fixedM !== null \? entry\.fixedM : \(!narrowQuery\.matches \? 0 : null\);/);
  assert.match(motion, /readHostColors\(entry\)/);
  assert.match(motion, /entry\.details\.addEventListener\('toggle', entry\.onToggle\)/);
  assert.match(motion, /wavePacketAlpha/);
  assert.match(motion, /rainGustLayerAlpha/);
  assert.match(motion, /rainDropMask/);
  assert.match(motion, /gustEnv/);
  // 刷新后同场景补丁会剥掉 canvas 的 width/height：渲染器按真实缓冲尺寸重设并整块清空，补丁也不得剥掉。
  assert.match(motion, /entry\.canvas\.width !== targetW\s*\|\|\s*entry\.canvas\.height !== targetH/);
  assert.match(motion, /ctx\.clearRect\(0, 0, entry\.canvas\.width, entry\.canvas\.height\)/);
  const dom = await readFile(new URL('../../public/dom.js', import.meta.url), 'utf8');
  assert.match(dom, /current\.tagName === 'CANVAS' && \(attribute\.name === 'width' \|\| attribute\.name === 'height'\)/);
});

test('疯人院建房密码输入接入 6 位数字过滤与前置校验', async () => {
  const app = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /\['room-password', 'join-password', 'insane-password'\]\.includes\(event\.target\.id\)/);
  assert.match(app, /if \(passwordEnabled && !\/\^\[0-9\]\{6\}\$\/\.test\(password\)\)/);
});

test('狂意建房处理函数声明 card 变量并复用读取选项', async () => {
  const app = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  const block = app.match(/if \(button\.dataset\.action === 'create-insane-room'\) \{[\s\S]*?enqueueWrite\(/)?.[0];
  assert.ok(block, '未找到 create-insane-room 分支');
  assert.match(block, /const card = button\.closest\('\.insane-card'\);/);
  assert.match(block, /card\?\.querySelector\('#insane-password, #room-password'\)/);
  assert.match(block, /insaneTransition\.start\(\{ mode, card \}\)/);
  assert.match(block, /card\?\.querySelector\('\[data-segmented="describeSeconds"\] \.selected'\)/);
  assert.match(block, /card\?\.querySelector\('\[data-segmented="roundsPerPlayer"\] \.selected'\)/);
});

test('狂意页 Livonym 说明升级为与主页一致的 story-demo 演示形态并接入动态播放', async () => {
  const html = insaneMarkup();
  const preview = insanePreviewMarkup('livonym');
  assert.match(preview, /class="story-demo livonym-demo" data-demo="livonym" data-story-demo aria-hidden="true" inert/);
  assert.match(preview, /class="surface-block livonym-stream-block"/);
  assert.match(preview, /class="surface-block game-form guess-form is-correct" data-demo-guess-form/);
  assert.match(preview, /class="surface-block livonym-score-block"/);
  assert.match(preview, /data-demo-panel="play"/);
  assert.match(preview, /data-demo-panel="score"/);
  assert.doesNotMatch(preview, /<button|创建房间/);
  const livonymCard = html.match(/<article class="insane-card insane-card--livonym">[\s\S]*?<\/article>/)?.[0] || '';
  assert.match(livonymCard, /data-action="insane-how" data-mode="livonym"[^>]*><svg[^>]*><use href="\/icons\.svg#icon-circle-help"><\/use><\/svg><span>怎么玩<\/span><\/button>/);
  assert.match(livonymCard, /data-insane-config="livonym"/);

  const app = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /stopPreviewStoryMotion\(\);/);
  assert.match(app, /hydrateAvatars\(preview\);/);
  assert.match(app, /stopPreviewStoryMotion = observeStoryMotion\(preview\);/);
  assert.match(app, /function syncInsaneHowDialogHeight\(/);
  assert.doesNotMatch(app, /if \(!dialog\.querySelector\('\[data-story-demo\]'\)\) return;/);
  assert.match(app, /function openInsaneHowModal\(/);
  assert.match(app, /stopHowStoryMotion = observeStoryMotion\(dialog\);/);

  const insane = await readFile(new URL('../../public/insane.js', import.meta.url), 'utf8');
  assert.match(insane, /const MODE_DEMOS = \{/);
  for (const id of ['blitz', 'livonym', 'shiritori', 'impostor', 'bridge']) {
    assert.match(insane, new RegExp(`\\b${id}:`));
  }

  const motion = await readFile(new URL('../../public/story-motion.js', import.meta.url), 'utf8');
  assert.match(motion, /livonym\(demo, press\)/);
  assert.match(motion, /form\?\.classList\.add\('is-cooling'\)/);
  assert.match(motion, /form\?\.classList\.add\('is-correct'\)/);
  assert.match(motion, /show\('score'\)/);

  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.insane-preview\s*\{[^}]*overflow-anchor:\s*none;/);
  assert.doesNotMatch(css, /^\.insane-preview-body\s*\{[^}]*overflow-y:\s*auto;/m);
  assert.match(css, /\.insane-how-dialog\.insane-preview\s*\{[^}]*overflow:\s*hidden;/);
  assert.match(css, /\.insane-how-dialog \.insane-preview-body\s*\{[^}]*overflow-y:\s*auto;\s*overflow-x:\s*hidden;/);
});

