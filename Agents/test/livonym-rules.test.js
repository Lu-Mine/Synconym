import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVONYM_WORDS, LIVONYM_WORD_CATEGORIES, LIVONYM_SCORE, LIVONYM_LIMITS,
  LIVONYM_INTRO_SECONDS, LIVONYM_SCORE_SECONDS,
  describerPoints, guessPoints, containsSecret, pickSecret, drawSecret,
  livonymDescriberUid, validateDescribe
} from '../../server/livonym.js';
import { modeCapacity, normalizeWord, validateSettings } from '../../server/rules.js';

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
  assert.ok(LIVONYM_WORDS.length >= 1000, `词库过小：${LIVONYM_WORDS.length}`);
  assert.equal(new Set(LIVONYM_WORDS).size, LIVONYM_WORDS.length);
  assert.equal(new Set(LIVONYM_WORDS.map(normalizeWord)).size, LIVONYM_WORDS.length);
  const byLength = {};
  for (const word of LIVONYM_WORDS) {
    assert.match(word, /^[\u4e00-\u9fa5]{2,6}$/u, `词形不合格：${word}`);
    assert.equal(validateDescribe(word), word);
    byLength[word.length] = (byLength[word.length] || 0) + 1;
  }
  assert.ok(byLength[2] >= 100 && byLength[3] >= 100 && byLength[4] >= 100 && byLength[5] >= 1, `各字数覆盖不足：${JSON.stringify(byLength)}`);
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

test('词库全量归类完整，无漏词或多词', () => {
  assert.equal(LIVONYM_WORD_CATEGORIES.size, LIVONYM_WORDS.length);
  for (const word of LIVONYM_WORDS) {
    assert.ok(LIVONYM_WORD_CATEGORIES.get(word), `缺少分类：${word}`);
  }
});

test('三级抽词：洗牌重洗避尾词、LRU 冷却兜底、避开连续同类', () => {
  // Stage 1: 洗牌袋抽完后自动重洗，且第一抽避开 lastSecret
  const words = ['甲词', '乙词'];
  const roomUsed = new Set(['甲词', '乙词']);
  const firstAfterReset = drawSecret({
    words, roomUsed, lastSecret: '乙词', wordCategories: new Map(), random: () => 0.99
  });
  assert.equal(firstAfterReset.secret, '甲词');
  assert.equal(firstAfterReset.reshuffled, true);
  assert.deepEqual([...roomUsed], ['甲词']);

  // Stage 2: 优先抽未见过的词；全部都在冷却期内时选最早见过的（LRU）
  const cooledWords = ['热词', '较旧词', '更旧词'];
  const cooldown = new Map([['更旧词', 100], ['较旧词', 200], ['热词', 300]]);
  const lruPick = drawSecret({
    words: cooledWords, roomUsed: new Set(), cooldown, wordCategories: new Map(), random: () => 0.5
  });
  assert.equal(lruPick.secret, '更旧词');

  // Stage 3: 候选里存在不同主题时避开上一轮同分类；只剩同分类时正常放行
  const cats = new Map([['奶茶', '饮品'], ['咖啡', '饮品'], ['熊猫', '动物']]);
  const antiStreak = drawSecret({
    words: ['奶茶', '咖啡', '熊猫'],
    roomUsed: new Set(),
    lastCategory: '饮品',
    wordCategories: cats,
    random: () => 0
  });
  assert.equal(antiStreak.secret, '熊猫');
  assert.equal(antiStreak.category, '动物');

  const sameCatFallback = drawSecret({
    words: ['奶茶', '咖啡'],
    roomUsed: new Set(),
    lastCategory: '饮品',
    wordCategories: cats,
    random: () => 0
  });
  assert.equal(sameCatFallback.secret, '奶茶');
});

test('即时竞猜各阶段时长契约', () => {
  assert.equal(LIVONYM_INTRO_SECONDS, 5);
  assert.equal(LIVONYM_SCORE_SECONDS, 6);
});

test('动态计分：3 至 8 人局竞猜者按名次阶梯计分，越早猜中得分越高，出题人按猜中人数计分且全中归零', () => {
  // 竞猜者阶梯：1st = totalPlayers, 2nd = totalPlayers - 1, ..., 兜底最低 1 分
  for (let totalPlayers = 3; totalPlayers <= 8; totalPlayers += 1) {
    for (let order = 1; order <= totalPlayers; order += 1) {
      const expected = Math.max(1, totalPlayers - order + 1);
      assert.equal(guessPoints(order, totalPlayers), expected, `${totalPlayers}人局第${order}名得分应为${expected}`);
    }
    // 超过人数的排名依然兜底 1 分
    assert.equal(guessPoints(totalPlayers + 1, totalPlayers), 1);
  }
  // 缺省参数兼容旧调用（默认 3 人局）
  assert.equal(guessPoints(1), 3);
  assert.equal(guessPoints(2), 2);
  assert.equal(guessPoints(3), 1);
  assert.equal(guessPoints(0), 0);
  assert.equal(guessPoints(-1), 0);
  assert.equal(guessPoints(1.5, 5), 0);
  assert.equal(guessPoints('1', 5), 0);
  assert.equal(guessPoints(undefined), 0);
  assert.equal(guessPoints(null, 5), 0);

  // 出题人：每猜中 1 人 +1，全员猜中归零
  for (let guesserCount = 2; guesserCount <= 7; guesserCount += 1) {
    assert.equal(describerPoints({ guessedCount: 0, guesserCount }), 0);
    for (let guessed = 1; guessed < guesserCount; guessed += 1) {
      assert.equal(describerPoints({ guessedCount: guessed, guesserCount }), guessed);
    }
    assert.equal(describerPoints({ guessedCount: guesserCount, guesserCount }), 0);
  }
});

test('containsSecret 过滤非汉字及非字母数字符号后再做繁简比对', () => {
  // 中文标点
  assert.equal(containsSecret('这是我家的高，压。锅！', '高压锅'), true);
  // 英文标点与连字符
  assert.equal(containsSecret('高-压-锅', '高压锅'), true);
  assert.equal(containsSecret('高_压_锅', '高压锅'), true);
  assert.equal(containsSecret('高.压.锅', '高压锅'), true);
  assert.equal(containsSecret('高~压~锅', '高压锅'), true);
  // Emoji 与特殊符号
  assert.equal(containsSecret('高💥压✨锅', '高压锅'), true);
  assert.equal(containsSecret('高【压】锅', '高压锅'), true);
  assert.equal(containsSecret('「高」「壓」「鍋」', '高压锅'), true);
  assert.equal(containsSecret('高\u200B压\u200B锅', '高压锅'), true);
  // 繁体与标点组合
  assert.equal(containsSecret('我家的高-壓-鍋会响', '高压锅'), true);
  // 秘密词自身带标点也能正确识别
  assert.equal(containsSecret('高压锅', '高-压-锅'), true);
  // 纯符号不误报
  assert.equal(containsSecret('，。？！-——', '高压锅'), false);
  // 跨字被打散不命中
  assert.equal(containsSecret('高很压也锅', '高压锅'), false);
});
