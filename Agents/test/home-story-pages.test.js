import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeMarkup } from '../../public/render.js';

const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');

test('首页介绍按概览、流程和各个功能分页', () => {
  const html = homeMarkup({ mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true });
  assert.match(html, /class="home-story-pages"[^>]*tabindex="0"/);
  assert.equal((html.match(/<article><div class="feature-copy">/g) || []).length, 6);
  assert.match(html, /data-story-step="-1"[^>]*disabled/);
  assert.match(html, /class="home-story-page-count"[^>]*>1 \/ 9/);
  assert.ok(html.indexOf('class="home-story-cta"') < html.indexOf('class="home-story-pagination"'));
  assert.match(html, /data-story-step="1"/);
});

test('单列横向吸附、双列纵向吸附，支持键盘和减少动态效果', () => {
  assert.match(css, /\.home-story-pages\s*\{[^}]*scroll-snap-type: x mandatory/);
  assert.match(css, /@media \(min-width: 1200px\)\s*\{\s*\.home-story-pages\s*\{[^}]*scroll-snap-type: y mandatory/);
  assert.match(css, /\.home-feature-list article \{ align-content: center; gap: 18px/);
  assert.match(css, /\.home-story-pages \* \{ scrollbar-width: none/);
  assert.match(app, /filter\(\(slide\) => getComputedStyle\(slide\)\.display !== 'none'\)/);
  assert.match(app, /event\.key === \(vertical \? 'ArrowDown' : 'ArrowRight'\)/);
  assert.match(app, /prefers-reduced-motion: reduce[^\n]*instant[^\n]*smooth/);
});
