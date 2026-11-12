import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeEntryMarkup, homeMarkup, shellMarkup } from '../../public/render.js';

const settings = { mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true };
const css = () => readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
const app = () => readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');

test('顶栏用开始游戏按钮作为主入口', () => {
  const header = shellMarkup(false).match(/<nav class="header-nav"[\s\S]*?<\/nav>/)[0];
  assert.match(header, /<button class="header-start" type="button" data-action="open-start"><svg class="icon "[\s\S]*?icon-play[\s\S]*?<span>开始游戏<\/span><\/button>/);
  // 开始按钮夹在 GitHub 与 Q&A 中间，窄屏只剩它时正好居中
  const order = ['Lu-Mine/Synconym', 'header-start', 'Q&amp;A'].map((token) => header.indexOf(token));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.doesNotMatch(header, /\?privacy/);
});

test('开始游戏弹窗没有标题与关闭按钮，点空白处关闭', () => {
  const html = shellMarkup(false);
  const modal = html.slice(html.indexOf('id="start-modal"') - 40);
  const dialog = modal.slice(0, modal.indexOf('<footer'));
  assert.match(dialog, /class="rename-modal start-modal" id="start-modal" inert/);
  assert.match(dialog, /class="rename-modal-backdrop" type="button" data-action="close-start"/);
  assert.match(dialog, /<div class="start-entry scrollbars-hidden" id="start-entry"><\/div>/);
  assert.match(dialog, /点击空白处关闭/);
  // 没有标题区，也没有叉叉关闭按钮
  assert.doesNotMatch(dialog, /rename-dialog-heading|<h2|icon-x/);
});

test('弹窗内容与首页入口区共用同一份结构', () => {
  const entry = homeEntryMarkup(settings);
  assert.match(entry, /^<div class="home-entry">/);
  assert.match(entry, /class="intro"[\s\S]*id="create-form"[\s\S]*id="join-form"/);
  assert.ok(homeMarkup(settings).includes(entry));
  assert.match(homeEntryMarkup(settings, true), /aria-expanded="true"/);
});

test('首页借出现成的入口区，其余页面按当前设置现渲，重渲染时收回', () => {
  const source = app();
  assert.match(source, /function openStartEntry\(trigger\) \{[\s\S]*?const featured = app\.querySelector\('#stage \.home-page \.home-entry'\);/);
  assert.match(source, /body\.innerHTML = homeEntryMarkup\(settings, homeSettingsOpen\);/);
  assert.match(source, /if \(button\.dataset\.action === 'open-start'\) \{/);
  assert.match(source, /if \(button\.dataset\.action === 'close-start'\) \{/);
  assert.match(source, /if \(startOpen\) \{\s*if \(event\.key === 'Escape'\) \{ event\.preventDefault\(\); closeStartEntry\(\); return; \}/);
  assert.match(source, /function render\(\{ forceFull = false, initialSync = false \} = \{\}\) \{\s*\/\/[^\n]*\n  closeStartEntry\(\{ focus: false, immediate: true \}\);\s*\n  clearStartEntry\(\);/);
  assert.match(source, /Boolean\(inviteTrigger\) \|\| pathOpen \|\| startOpen\)/);
});

test('收起弹窗等淡出结束再清空，卡片不会先坍缩', () => {
  const source = app();
  assert.match(source, /function clearStartEntry\(\) \{[\s\S]*?app\.querySelector\('#start-entry'\)\?\.replaceChildren\(\);/);
  assert.match(source, /function closeStartEntry\(\{ focus = true, immediate = false \} = \{\}\) \{/);
  assert.match(source, /if \(immediate\) clearStartEntry\(\);\s*else startCleanupTimer = setTimeout\(clearStartEntry, 320\);/);
  // 借出去的入口区立即归位，弹窗里留一份快照撑住淡出时的形状
  assert.match(source, /body\?\.replaceChildren\(node\.cloneNode\(true\)\);/);
  assert.match(source, /if \(parent\?\.isConnected\) parent\.insertBefore\(node, next\?\.isConnected \? next : null\);/);
});

test('弹窗里的入口区脱离首页宽屏定位，按弹窗宽度排布', () => {
  const source = css();
  // 卡片本身不滚动：滚动交给内缩在 padding 里的入口区
  assert.match(source, /\.start-dialog\s*\{[^}]*display: flex;[^}]*width: min\(100%, 440px\)[^}]*max-height: min\(90dvh, 760px\)[^}]*padding: 20px 20px 14px;[^}]*overflow: hidden/);
  assert.match(source, /\.start-entry\s*\{[^}]*overflow-y: auto/);
  // 创建房间与设置并排（.create-card 561px 两列档）时才放宽，且只放宽这一档
  assert.match(source, /@media \(min-width: 561px\) \{ \.start-dialog \{ width: min\(100%, 640px\); \} \}/);
  assert.equal(source.match(/\.start-dialog \{ width:/g).length, 1);
  assert.match(source, /\.start-dialog \.home-entry,\s*\.start-dialog \.home-entry:has\(\.drawer-grid\.is-open\)\s*\{[^}]*position: static;[^}]*height: auto/);
  assert.match(source, /\.start-hint\s*\{[^}]*text-align: center/);
});

test('弹窗顶部留白随卡片宽度成比例，不继承首页 64px 留白', () => {
  assert.match(css(), /\.start-dialog \.home-entry \.intro \{ padding: clamp\(20px, 4\.5cqw, 34px\) 0 24px; \}/);
});

test('开始游戏弹窗不画滚动条轨道', () => {
  const scrollbars = readFileSync(new URL('../../public/scrollbars.js', import.meta.url), 'utf8');
  assert.match(scrollbars, /if \(element\.classList\?\.contains\('scrollbars-hidden'\)\) continue;/);
  assert.match(shellMarkup(false), /class="start-entry scrollbars-hidden"/);
});

test('顶栏开始按钮沿用创建房间的渐变，且没有会露出反向色线的边框', () => {
  const source = css();
  const button = source.match(/\.header-start \{[^}]*\}/)[0];
  assert.match(button, /background: linear-gradient\(90deg, var\(--accent\), var\(--vermilion\)\)/);
  assert.match(button, /border: 0;/);
  assert.match(source, /\.create-submit \{[^}]*background: linear-gradient\(90deg, var\(--accent\), var\(--vermilion\)\)/);
});
