import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVONYM_WORDS, LIVONYM_SCORE, LIVONYM_LIMITS, describerPoints, guessPoints,
  containsSecret, pickSecret, livonymDescriberUid, validateDescribe
} from '../../server/livonym.js';
import { modeCapacity, validateSettings } from '../../server/rules.js';

test('出题人得分只看猜中人数，全员猜中归零', () => {
  // 无人猜中：0 分，不需要额外规则
  assert.equal(describerPoints({ guessedCount: 0, guesserCount: 5 }), 0);
  // 每有 1 人猜中 +perGuess
  assert.equal(describerPoints({ guessedCount: 1, guesserCount: 2 }), LIVONYM_SCORE.perGuess);
  assert.equal(describerPoints({ guessedCount: 3, guesserCount: 5 }), 3 * LIVONYM_SCORE.perGuess);
  assert.equal(describerPoints({ guessedCount: 4, guesserCount: 5 }), 4 * LIVONYM_SCORE.perGuess);
  // 全员猜中：悬崖归零
  assert.equal(describerPoints({ guessedCount: 2, guesserCount: 2 }), LIVONYM_SCORE.allGuessed);
  assert.equal(describerPoints({ guessedCount: 5, guesserCount: 5 }), LIVONYM_SCORE.allGuessed);
  // 只剩一位在线竞猜者：他一猜中即等于全中
  assert.equal(describerPoints({ guessedCount: 1, guesserCount: 1 }), 0);
  // 没有竞猜者时不产生分数
  assert.equal(describerPoints({ guessedCount: 0, guesserCount: 0 }), 0);
  assert.equal(describerPoints(), 0);
});

test('竞猜者得分按名次递减', () => {
  assert.equal(guessPoints(1), 3);
  assert.equal(guessPoints(2), 2);
  assert.equal(guessPoints(3), 1);
  assert.equal(guessPoints(7), 1);
  assert.equal(guessPoints(0), 0);
  assert.equal(guessPoints(undefined), 0);
});

test('谜底拦截只挡完整秘密词，单字与近义放行', () => {
  assert.equal(containsSecret('这是我家的高压锅', '高压锅'), true);
  // 空格只是回避，归一化后依然拼出谜底
  assert.equal(containsSecret('高压 锅 一样会响', '高压锅'), true);
  assert.equal(containsSecret('会响的锅，压力很大', '高压锅'), false);
  assert.equal(containsSecret('高\n压\n锅', '高压锅'), true);
  // 繁体与全角变体同样命中
  assert.equal(containsSecret('我家的高壓鍋', '高压锅'), true);
  assert.equal(containsSecret('ＨＩＧＨ', 'high'), true);
  // 单字谜底不拦，否则文本无法书写
  assert.equal(containsSecret('锅里煮着汤', '锅'), false);
  // 归一化后为空
  assert.equal(containsSecret('', '高压锅'), false);
  assert.equal(containsSecret('随便写点什么', ''), false);
});

test('抽词不重复，且能注入随机源', () => {
  const words = ['甲词', '乙词', '丙词'];
  assert.equal(pickSecret({ words, used: [], random: () => 0 }), '甲词');
  assert.equal(pickSecret({ words, used: ['甲词'], random: () => 0 }), '乙词');
  assert.equal(pickSecret({ words, used: ['甲词', '乙词'], random: () => 0.99 }), '丙词');
  assert.throws(() => pickSecret({ words, used: words }), /秘密词已抽完/);

  // 连续抽满整份词库不会重复
  const used = [];
  for (let i = 0; i < words.length; i += 1) used.push(pickSecret({ words, used, random: Math.random }));
  assert.equal(new Set(used).size, words.length);
});

test('出题人只由顺序与棒次推出', () => {
  const order = ['A', 'B', 'C'];
  assert.equal(livonymDescriberUid(order, 0), 'A');
  assert.equal(livonymDescriberUid(order, 2), 'C');
  // 每人两轮时回到队首
  assert.equal(livonymDescriberUid(order, 3), 'A');
  assert.equal(livonymDescriberUid(order, -1), null);
  assert.equal(livonymDescriberUid([], 0), null);
  assert.equal(livonymDescriberUid(null, 0), null);
});

test('描述长度按码点计，超限报错', () => {
  assert.equal(validateDescribe('abc'), 'abc');
  assert.equal(validateDescribe('😀'.repeat(LIVONYM_LIMITS.describeLimit)).length, LIVONYM_LIMITS.describeLimit * 2);
  assert.throws(() => validateDescribe('字'.repeat(LIVONYM_LIMITS.describeLimit + 1)), /描述超出上限/);
  assert.throws(() => validateDescribe(undefined), /描述内容无效/);
});

test('秘密词库规模与词形', () => {
  assert.ok(LIVONYM_WORDS.length >= 400, `词库过小：${LIVONYM_WORDS.length}`);
  assert.equal(new Set(LIVONYM_WORDS).size, LIVONYM_WORDS.length);
  for (const word of LIVONYM_WORDS) {
    assert.match(word, /^[\u4e00-\u9fa5]{2,4}$/u, `词形不合格：${word}`);
    assert.equal(validateDescribe(word), word);
  }
});

test('设置与容量支持即时竞猜', () => {
  assert.equal(modeCapacity('livonym'), 8);
  assert.equal(modeCapacity('free'), 4);
  assert.equal(modeCapacity('主题不存在'), 4);

  const settings = validateSettings({ mode: 'livonym', describeSeconds: 60, roundsPerPlayer: 2 });
  assert.equal(settings.mode, 'livonym');
  assert.equal(settings.describeSeconds, 60);
  assert.equal(settings.roundsPerPlayer, 2);
  // 字符串数值同样接受
  assert.equal(validateSettings({ mode: 'livonym', describeSeconds: '30' }).describeSeconds, 30);

  assert.throws(() => validateSettings({ mode: 'livonym', describeSeconds: 15 }), /时限设置无效/);
  assert.throws(() => validateSettings({ mode: 'livonym', roundsPerPlayer: 3 }), /轮数设置无效/);
  assert.throws(() => validateSettings({ mode: 'livonym', roundsPerPlayer: 1.5 }), /轮数设置无效/);
  assert.throws(() => validateSettings({ mode: 'livonymx' }), /房间模式无效/);
  // 其他模式保留字段，默认值不变
  assert.equal(validateSettings({}).describeSeconds, 45);
  assert.equal(validateSettings({}).roundsPerPlayer, 1);
});
