import test from 'node:test';
import assert from 'node:assert/strict';
import { posterMarkup } from '../../public/poster.js';
import { resultMarkup, resultSummary } from '../../public/render.js';

function room(overrides = {}) {
  const players = [{ uid: 'a', name: '甲', seat: 0 }, { uid: 'b', name: '乙', seat: 1 }];
  return {
    code: '12345',
    phase: 'result',
    round: 2,
    maxRounds: 12,
    mode: 'free',
    themeName: null,
    outcome: 'voted',
    players,
    resultPlayers: players,
    rematchEligibleUids: ['a', 'b'],
    rematchVotes: {},
    rematchDeadline: 1,
    history: [
      { n: 1, words: { a: '苹果', b: '香蕉' }, marks: { a: 'none', b: 'none' }, outcome: 'miss' },
      { n: 2, words: { a: '水果', b: '' }, marks: { a: 'none', b: 'empty' }, outcome: 'voted' }
    ],
    ...overrides
  };
}

const day = new Date(2026, 10, 9, 15, 30);
test('海报复用品牌标识、标题区与思考路径组件', () => {
  const html = posterMarkup(room(), day);
  // 品牌：顶栏与脚注都用同一个 brandMarkup
  assert.equal(html.match(/class="brand"/g).length, 2);
  assert.match(html, /brand-mark/);
  // 词过程：直接使用结算页同款思考路径
  assert.match(html, /<ol class="path-rounds">/);
  assert.match(html, /class="path-answer"/);
  assert.match(html, /class="record-round-number" aria-label="第 1 轮">1<\/span>/);
  // 对局信息放在标题区的 meta 行，不单独占一块
  assert.match(html, /class="page-heading-meta"><span>2 人<\/span><span>第 2 \/ 12 轮<\/span><span>自由联想<\/span>/);
  assert.equal(html.includes('对局概览'), false);
  // 容器与组件类来自页面样式
  assert.match(html, /<div class="poster" data-scene="result">/);
  assert.match(html, /class="surface-block result-path"/);
});

test('海报摊开每一轮每个人的词与标记', () => {
  const html = posterMarkup(room(), day);
  for (const text of ['苹果', '香蕉', '水果', '[未提交]', '第 1 轮', '第 2 轮', '完整词过程']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /class="poster-date">2026\.11\.09</);
});

test('海报不含房号，只放对局本身的信息', () => {
  const html = posterMarkup(room(), day);
  assert.equal(html.includes('12345'), false);
  assert.equal(html.includes('房号'), false);
  assert.match(html, /<span>2 人<\/span>/);
  assert.match(html, /<span>第 2 \/ 12 轮<\/span>/);
});

test('主题局复用结算页的主题标记，结论与结算页一致', () => {
  const themed = posterMarkup(room({ mode: 'theme', themeName: '海洋' }), day);
  assert.match(themed, /class="current-theme"/);
  assert.ok(themed.includes('本局主题'));
  assert.ok(themed.includes('海洋'));
  assert.equal(themed.includes('自由联想'), false);
  assert.ok(themed.includes(resultSummary(room())));
  assert.match(themed, /第 2 轮投票达成一致/);
});

test('打满轮次未相遇与崩局各有自己的结论', () => {
  const missed = posterMarkup(room({ outcome: 'miss', history: [
    { n: 1, words: { a: '苹果', b: '香蕉' }, marks: {}, outcome: 'miss' },
    { n: 2, words: { a: '水果', b: '蔬菜' }, marks: {}, outcome: 'miss' },
    { n: 3, words: { a: '甜', b: '咸' }, marks: {}, outcome: 'miss' }
  ] }), day);
  assert.ok(missed.includes('走过 3 轮，留下了这些不同的想法。'));
  const broken = posterMarkup(room({ outcome: 'break', history: [] }), day);
  assert.ok(broken.includes('崩局投票通过，本局记录不会保存。'));
  assert.match(broken, /class="path-empty"/);
});

test('结算页在完整词路径标题行提供导出海报入口', () => {
  const html = resultMarkup({ uid: 'a', room: room() });
  assert.match(html, /<details class="surface-block result-votes result-path" open><summary>[^]*?data-action="export-poster"[^]*?<\/summary>/);
  assert.match(html, /<\/button><svg class="icon result-votes-icon"/);
  assert.match(html, /导出结算海报/);
  assert.doesNotMatch(html, /海报包含品牌/);
  assert.doesNotMatch(html, /按需查看每轮选择/);
  assert.doesNotMatch(html, /按轮次查看每位玩家已揭晓的词/);
});

test('中断页没有可导出的对局', () => {
  const html = resultMarkup({ uid: 'a', room: room({ phase: 'interrupted' }) });
  assert.equal(html.includes('export-poster'), false);
});
