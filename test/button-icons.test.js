import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeMarkup, shellMarkup, lobbyMarkup, writingMarkup, resultMarkup } from '../public/render.js';

const settings = { mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true };
const state = (phase) => ({ uid: 'a', room: { code: '12345', phase, round: 1, maxRounds: 12, players: [{ uid: 'a', name: '甲', seat: 0 }] } });
const svg = (icon) => `<svg class="icon " aria-hidden="true"><use href="/icons.svg#icon-${icon}"></use></svg>`;
function rightIcon(html, label, icon) {
  assert.ok(html.includes(`<span>${label}</span>${svg(icon)}`), `${label}: ${icon}`);
}
function leftIcon(html, label, icon) {
  assert.ok(html.includes(`${svg(icon)}<span>${label}</span>`), `${label}: ${icon}`);
}

test('首页默认收起设置，演示写词显示输入提示', () => {
  const html = homeMarkup(settings);
  assert.match(html, /data-action="toggle-settings" aria-expanded="false"/);
  assert.match(html, /id="home-settings-panel" inert/);
  assert.match(homeMarkup(settings, true), /data-action="toggle-settings" aria-expanded="true"/);
  assert.match(html, /data-demo-typed>[\s\S]*?<p class="game-hint">可使用空格；超时将提交输入框中的内容<\/p>/);
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /if \(nextScreen === 'home' && currentScreen !== 'home'\) homeSettingsOpen = false/);
});

test('首页介绍的装饰图标各不重复且存在于图标资源中', () => {
  const html = homeMarkup(settings).split('<a class="home-story-link"')[1];
  const link = html.match(/^[^>]*>[^<]*<svg class="icon "[^>]*><use href="\/icons\.svg#icon-([\w-]+)"/)[1];
  // 演示区复用真实组件，组件自带图标不计入；只检查介绍区自己的标题与条目图标。
  const decorative = [...html.matchAll(/class="icon (?:story-icon|story-heading-icon)"[^>]*><use href="\/icons\.svg#icon-([\w-]+)"/g)].map((match) => match[1]);
  const names = [link, ...decorative];
  assert.equal(names.length, 13);
  assert.equal(new Set(names).size, names.length);
  const sprite = readFileSync(new URL('../public/icons.svg', import.meta.url), 'utf8');
  for (const name of names) assert.ok(sprite.includes(`id="icon-${name}"`), name);
});

test('按钮图标按指定顺序排列', () => {
  const home = homeMarkup(settings);
  assert.match(home, /<span>创建房间<\/span><span class="playing-count" id="playing-count" hidden><\/span><\/span><svg class="icon create-submit-arrow"[^>]*><use href="\/icons\.svg#icon-arrow-right"><\/use><\/svg>/);
  const shell = shellMarkup();
  for (const [label, icon] of [['取消', 'x'], ['保存', 'check'], ['退出房间', 'check']]) rightIcon(shell, label, icon);
  leftIcon(shell, '转让房主', 'user');
  for (const [phase, pairs] of [
    ['writing', [['提交', 'check']]], ['voting', [['是', 'check'], ['否', 'x']]],
    ['prepare', [['准备下一轮', 'check']]], ['breakVote', [['玩崩了', 'x']]]
  ]) for (const [label, icon] of pairs) rightIcon(writingMarkup(state(phase)), label, icon);
  rightIcon(writingMarkup(state('writing'), { submitted: true }), '已提交，等待其他玩家', 'check');
  rightIcon(writingMarkup(state('prepare'), { ready: true }), '已准备，等待其他玩家', 'check');
  leftIcon(writingMarkup(state('breakVote')), '下一轮', 'arrow-right');
  leftIcon(writingMarkup(state('writing')), '退出房间', 'log-out');
  const interrupted = resultMarkup(state('interrupted'));
  leftIcon(interrupted, '回房间', 'users');
  leftIcon(interrupted, '回主页', 'arrow-right');
});

test('大厅和结算状态变更保持对应图标顺序', () => {
  const lobby = state('lobby');
  Object.assign(lobby.room, { ...settings, hostUid: 'a' });
  leftIcon(lobbyMarkup(lobby), '开始', 'play');
  leftIcon(lobbyMarkup(lobby), '退出', 'log-out');
  lobby.room.hostUid = 'b';
  rightIcon(lobbyMarkup(lobby), '准备', 'check');
  lobby.room.players[0].ready = true;
  rightIcon(lobbyMarkup(lobby), '取消准备', 'x');
  const result = state('result');
  Object.assign(result.room, { rematchDeadline: 123, rematchEligibleUids: ['a'], rematchVotes: {} });
  leftIcon(resultMarkup(result), '重赛', 'play');
  leftIcon(resultMarkup(result), '回房间', 'users');
  leftIcon(resultMarkup(result), '回主页', 'arrow-right');
  result.room.rematchVotes.a = 'rematch';
  leftIcon(resultMarkup(result), '已选重赛', 'play');
  result.room.rematchVotes.a = 'room';
  leftIcon(resultMarkup(result), '已选回房间', 'users');
});

test('大厅动态更新及确认和提交保留图标顺序', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(source.includes("${icon('play')}<span>开始</span>"));
  for (const [label, glyph] of [['准备', 'check'], ['取消准备', 'x']]) {
    assert.ok(source.includes(`<span>${label}</span>\${icon('${glyph}')}`), label);
  }
  assert.match(source, /querySelector\('\[data-action="accept-confirm"\] span'\)\.textContent = resetting/);
  assert.match(source, /button\.querySelector\('span'\)\.textContent = submitted/);
  assert.doesNotMatch(source, /button\.textContent = submitted|querySelector\('\[data-action="accept-confirm"\]'\)\.textContent/);
});
