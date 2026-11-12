import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeMarkup } from '../../public/render.js';

const css = () => readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
const app = () => readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
const settings = { mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true };

test('落地介绍末尾的收尾引导回到开始游戏的位置', () => {
  const html = homeMarkup(settings);
  const ctaStart = html.indexOf('class="home-story-cta"');
  const cta = html.slice(ctaStart);
  assert.ok(ctaStart > html.indexOf('class="home-feature-list"'), '引导应在介绍内容之后');
  assert.ok(ctaStart < html.lastIndexOf('</section>'), '引导应在介绍区内');
  assert.match(cta, /<a class="button primary home-story-cta-button" href="#create-form" data-action="home-to-entry"/);
  assert.match(cta, /<span>开始游戏<\/span>[\s\S]*?icon-arrow-right/);

  const source = app();
  const handler = source.match(/  const entryLink = event\.target\.closest\('\[data-action="home-to-entry"\]'\);[\s\S]*?\n  }/)[0];
  assert.match(handler, /app\.scrollTo\(\{ top: 0/);
  assert.match(handler, /#create-form \.create-submit'\)\?\.focus/);
  assert.match(handler, /prefers-reduced-motion: reduce/);
});

test('首页顶栏不重复开始游戏，双列时不再显示引导', () => {
  const sheet = css();
  assert.match(sheet, /body\[data-scene="home"\] \.header-start \{ display: none; \}/);
  // 与「了解玩法」跳转入口共用同一个双列断点
  assert.match(sheet, /@media \(min-width: 1200px\) \{ \.home-story-cta \{ display: none; \} \}/);
  assert.match(sheet, /\.home-story-link \{ display: none; \}/);
});

test('收尾引导的按钮用渐变，底部留出不贴视口底边的空白', () => {
  const sheet = css();
  assert.match(sheet, /\.home-story-cta \{[^}]*padding-bottom: clamp\(88px, 12vw, 140px\)/);
  assert.match(sheet, /\.home-story-cta-button \{[^}]*background: linear-gradient\(90deg, var\(--accent\), var\(--vermilion\)\)/);
  // 渐变要从边框盒起铺：否则 1px 透明边框里会重复出渐变另一端的颜色，看起来像两条描边
  assert.match(sheet, /\.home-story-cta-button \{[^}]*background-origin: border-box/);
  // 箭头在文字右侧，不旋转
  assert.doesNotMatch(sheet, /\.home-story-cta-icon \{[^}]*transform: rotate/);
});
