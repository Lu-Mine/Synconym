import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { homeEntryMarkup, settingsMarkup } from '../../public/render.js';
import { insaneMarkup } from '../../public/insane.js';
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

test('狂意模式标题复用入口文字故障动画并支持减少动态效果', async () => {
  const html = insaneMarkup();
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(html, /<h1><span class="insane-heading-text" data-glow="狂意模式">狂意模式<\/span><\/h1>/);
  assert.match(css, /\.insane-portal span,\s*\.insane-heading-text\s*\{[^}]*animation:\s*insane-portal-glitch 4\.2s steps\(1, end\) infinite/);
  assert.match(css, /\.insane-heading-text::before\s*\{[^}]*content:\s*attr\(data-glow\);[^}]*linear-gradient\(105deg, #416bff 0%, #73e7f4 32%, #ad8aff 64%, #f278bc 100%\)[^}]*background-clip:\s*text;[^}]*filter:\s*blur\(8px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.insane-card::before\s*\{[^}]*\}\s*\.insane-distortion\s*\{[^}]*\}\s*\.insane-portal::after,\s*\.insane-portal span,\s*\.insane-heading-text\s*\{\s*animation:\s*none;/);
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
    const open = false;
    const texts = [name, english, players, '创建房间', ...(open ? [] : ['暂未开放'])];
    for (const text of texts) assert.ok(card.includes(text));
    assert.match(card, /<details class="insane-details">/);
    assert.match(card, /<summary class="insane-card-row">/);
    assert.match(card, open
      ? /<button class="insane-create" type="button" data-action="create-insane-room" data-mode="livonym"/
      : /<button class="insane-create" type="button" disabled/);
  }
  assert.match(html, /六人局里会有两名卧底/);
  assert.match(html, /输入 8 秒，揭晓 3 秒/);
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
    const art = card.match(/<span class="wordmark-art"[^>]*>([\s\S]*?)<span class="insane-players">/)[1];
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
