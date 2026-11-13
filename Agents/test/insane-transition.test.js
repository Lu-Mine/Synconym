import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { INSANE_MODES, wordmarkArt } from '../../public/render.js';
import { insaneMarkup } from '../../public/insane.js';
import { INSANE_PALETTES } from '../../public/insane-background.js';
import {
  PIXEL_CELL,
  INSANE_WAVE_DIRECTION,
  pixelWaveDirectionForCard,
  buildPixelWaveMask
} from '../../public/insane-transition.js';

test('五种玩法的像素波方向与卡片奇偶排布保持同向', () => {
  const cards = [
    { id: 'blitz' },
    { id: 'livonym' },
    { id: 'shiritori' },
    { id: 'impostor' },
    { id: 'bridge' }
  ];
  const parent = { children: cards };
  for (const card of cards) card.parentElement = parent;

  assert.equal(pixelWaveDirectionForCard(cards[0], 'blitz'), 'ltr');
  assert.equal(pixelWaveDirectionForCard(cards[1], 'livonym'), 'rtl');
  assert.equal(pixelWaveDirectionForCard(cards[2], 'shiritori'), 'ltr');
  assert.equal(pixelWaveDirectionForCard(cards[3], 'impostor'), 'rtl');
  assert.equal(pixelWaveDirectionForCard(cards[4], 'bridge'), 'ltr');

  for (const mode of INSANE_MODES) {
    assert.ok(['ltr', 'rtl'].includes(INSANE_WAVE_DIRECTION[mode]), `缺少 ${mode} 像素波方向`);
    assert.equal(pixelWaveDirectionForCard(null, mode), INSANE_WAVE_DIRECTION[mode]);
    assert.ok(wordmarkArt[mode], `缺少 ${mode} 艺术字`);
  }
});

test('双向（ltr 与 rtl）像素波全屏遮罩蒙版对齐 24px 网格且含同向弧形过渡边缘', () => {
  for (const direction of ['rtl', 'ltr']) {
    const mask = buildPixelWaveMask({ width: 1280, height: 720, direction });
    assert.equal(mask.maskHeight, 30 * PIXEL_CELL);
    assert.ok(mask.solidWidth >= 1280 + PIXEL_CELL * 6);
    assert.ok(mask.dataUri.startsWith('url("data:image/svg+xml,'));
    const decoded = decodeURIComponent(mask.dataUri.slice('url("data:image/svg+xml,'.length, -2));
    assert.match(decoded, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(decoded, /width="20" height="20"/);
    assert.match(decoded, new RegExp(`height="${mask.maskHeight}"`));
  }
});

test('insane-background 为全部五种狂意玩法提供独立色调并支持 setMode 切换', async () => {
  const source = await readFile(new URL('../../public/insane-background.js', import.meta.url), 'utf8');
  assert.match(source, /uniform vec3 uViolet;/);
  assert.match(source, /setMode\(mode, \{ immediate = false \} = \{\}\)/);
  const signatures = new Set();
  for (const mode of ['default', ...INSANE_MODES]) {
    assert.ok(INSANE_PALETTES[mode], `缺少 ${mode} 背景调色板`);
    signatures.add(JSON.stringify(INSANE_PALETTES[mode]));
  }
  assert.equal(signatures.size, 6, '五种玩法与默认背景应各具独立色板');
});

test('app.js 与 styles.css 接入五种玩法过场、艺术字动画与色调回退，且卡片暂未开放创建房间', async () => {
  const app = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const transition = await readFile(new URL('../../public/insane-transition.js', import.meta.url), 'utf8');

  assert.match(transition, /wordmarkArt\[mode\]/);
  assert.match(transition, /sheet\.style\.maskImage = maskMetrics\.dataUri/);
  assert.match(app, /createInsaneTransitionController\(/);
  assert.match(app, /insaneBackground\.setMode\?\.\(insane && isInsaneMode\(mode\) \? mode : ''/);

  for (const mode of INSANE_MODES) {
    assert.match(css, new RegExp(`body\\[data-insane\\]\\[data-insane-mode="${mode}"\\]\\s*\\{`));
    assert.match(css, new RegExp(`body\\[data-insane\\]\\[data-insane-mode="${mode}"\\]::before\\s*\\{`));
    assert.match(css, new RegExp(`\\.insane-curtain--${mode}\\s*\\{`));
    assert.match(css, new RegExp(`\\.insane-curtain--${mode} `));
  }
  assert.match(css, /\.insane-curtain\.is-ltr \.insane-curtain-waves/);
  assert.match(css, /\.insane-curtain-sheet\s*\{[\s\S]*mask-repeat:\s*no-repeat/);

  const html = insaneMarkup();
  for (const mode of INSANE_MODES) {
    const card = html.match(new RegExp(`<article class="insane-card insane-card--${mode}">[\\s\\S]*?<\\/article>`))?.[0];
    assert.ok(card, `缺少 ${mode} 卡片`);
    assert.match(card, /<button class="insane-create" type="button" disabled/);
    assert.doesNotMatch(card, /data-action="create-insane-room"/);
  }
});
