import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';
import { createSimilarity, loadSimilarity, similarity, vectorInfo } from '../../server/similarity.js';
import { loadVectors, VECTOR_DIR } from '../../server/vectors.js';

const SEEDS = ['苹果', '香蕉', '梨', '桃', '西瓜', '橘子', '白菜', '青菜', '萝卜', '土豆',
  '猫', '小猫', '狗', '小狗', '老虎', '狮子', '豹子', '晴天', '雨天', '下雨', '下雪', '春天', '夏天', '秋天', '冬天'];

// 夹具：4 维、已单位化的整数向量，scale = 100，cos(苹果, 香蕉) = 0.8，cos(苹果, 白菜) = 0.6，cos(苹果, 猫) = 0
function fixture() {
  const vocab = ['苹果', '香蕉', '白菜', '猫', '台湾', '同义'];
  const rows = [[100, 0, 0, 0], [80, 60, 0, 0], [60, 0, 80, 0], [0, 0, 0, 100], [0, 100, 0, 0], [100, 0, 0, 0]];
  return { vocab, vectors: Int8Array.from(rows.flat()), dim: 4, scale: 100, calib: { lo: 0, hi: 0.8 } };
}

test('夹具向量：精确为 1、未收录与空串为 null、繁简全角先归一', () => {
  const sim = createSimilarity(fixture());
  assert.equal(sim('苹果', '苹果'), 1);
  assert.equal(sim('臺灣', '台湾'), 1);
  assert.equal(sim(' Ａ ', 'a'), 1);
  assert.equal(sim('苹果', '未收录'), null);
  assert.equal(sim('', ''), null);
  assert.equal(sim('苹果', null), null);
});

test('夹具向量：lo→0.2、hi→0.9 线性映射，截到 [0, 0.95]', () => {
  const sim = createSimilarity(fixture());
  assert.equal(sim('苹果', '香蕉'), 0.9);           // cos 0.8 = hi
  assert.equal(sim('苹果', '白菜'), 0.725);         // cos 0.6
  assert.equal(sim('苹果', '猫'), 0.2);             // cos 0 = lo
  assert.equal(sim('苹果', '同义'), 0.95);          // cos 1 映射到 1.075，截到 0.95
  assert.equal(sim('苹果', '同义') < 1, true);
  assert.equal(sim('香蕉', '台湾'), 0.725);         // cos 0.6
  assert.equal(createSimilarity({ ...fixture(), calib: { lo: 0.9, hi: 1 } })('苹果', '猫'), 0);
});

test('向量文件缺失时降级：只警告一次，非相同词一律 null', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'synconym-novec-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { similarity: sim, info } = loadSimilarity(dir);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(info, null);
  assert.equal(sim('苹果', '香蕉'), null);
  assert.equal(sim('苹果', '苹果'), 1);
});

test('随仓库发布的词向量：覆盖常用词与全部种子词，排序合理，署名文件齐全', () => {
  const data = loadVectors();
  assert.ok(data.vocab.length >= 10000, `只有 ${data.vocab.length} 个词`);
  assert.deepEqual(vectorInfo, { count: data.vocab.length, builtAt: data.builtAt });
  const words = new Set(data.vocab);
  assert.equal(words.size, data.vocab.length);
  // normalizeWord 不一定幂等（OpenCC 把“么”当作“幺”的繁体），只检查空白、大写与全角已去掉
  for (const word of data.vocab) assert.ok(!/[\s！-～]/u.test(word) && word === word.toLowerCase(), `未归一：${word}`);
  for (const word of SEEDS) assert.ok(words.has(word), `缺少种子词 ${word}`);
  for (const word of ['火锅', '高铁', '春节', '咖啡', '熊猫', '手机']) assert.ok(words.has(word), `缺少 ${word}`);

  assert.ok(similarity('苹果', '香蕉') > similarity('苹果', '白菜'));
  assert.ok(similarity('苹果', '白菜') > similarity('苹果', '猫'));
  assert.ok(similarity('猫', '狗') > similarity('猫', '高铁'));
  for (const [a, b] of [['苹果', '香蕉'], ['猫', '狗'], ['春天', '夏天'], ['皇帝', '手机']]) {
    const score = similarity(a, b);
    assert.ok(score >= 0 && score <= 0.95, `${a}-${b} = ${score}`);
  }

  const notice = readFileSync(join(VECTOR_DIR, 'NOTICE.md'), 'utf8');
  assert.match(notice, /fasttext\.cc\/docs\/en\/crawl-vectors/);
  assert.match(notice, /Grave/);
  assert.match(notice, /creativecommons\.org\/licenses\/by-sa\/3\.0/);
  assert.match(notice, new RegExp(`选取 ${data.vocab.length} 个词`));
});

test('文件型数据库：关闭后重新打开，同一 uid 的档案与对局仍在', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const dir = mkdtempSync(join(tmpdir(), 'synconym-db-'));
  const file = join(dir, 'synconym.db');
  let db, manager;
  // 只注册一个清理钩子：先关库再删目录，否则 Windows 上文件仍被占用
  t.after(() => { manager?.close(); db?.close(); rmSync(dir, { recursive: true, force: true }); });

  db = createDatabase(file);
  manager = new RoomManager({ db });
  const connect = (uid) => {
    const c = manager.connect(uid); c.messages = [];
    c.ws = { readyState: 1, send: (s) => c.messages.push(JSON.parse(s)), close() {} };
    return c;
  };
  const send = (c, message) => { t.mock.timers.tick(501); manager.handle(c, message); };
  const a = connect(), b = connect();
  send(a, { type: 'createRoom' });
  const room = manager.roomFor(a);
  send(b, { type: 'joinRoom', code: room.code }); send(b, { type: 'setReady', ready: true });
  send(a, { type: 'start' });
  send(a, { type: 'submitWord', word: '苹果' }); send(b, { type: 'submitWord', word: '苹果' });
  assert.equal(room.phase, 'result');
  const matchId = room.matchId;
  manager.close(); db.close();
  assert.ok(existsSync(file));

  db = createDatabase(file);
  manager = new RoomManager({ db });
  const again = connect(a.uid);
  assert.equal(again.uid, a.uid);
  const profile = manager.profileFor(a.uid);
  assert.equal(profile.total, 1);
  assert.equal(profile.matches[0].id, matchId);
  assert.equal(profile.matches[0].convergedRound, 1);
  assert.equal(db.getMatch(matchId).rounds[0].words[b.uid], '苹果');
});
