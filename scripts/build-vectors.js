// 离线裁剪 fastText 中文词向量：原始 cc.zh.300.vec(.gz) + data/wordlist.txt → data/vectors/
// 用法：npm run build:vectors -- <cc.zh.300.vec 或 .vec.gz> [--count 20000] [--out data/vectors]
// 原始文件按词频降序排列：先取前 count 个纯汉字词（1–4 字），再补上必收词清单里的词。
// 接受被截断的 .gz 前缀，末尾残缺的一行会被丢弃。
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, createGunzip } from 'node:zlib';
import { normalizeWord } from '../server/rules.js';
import { cosine, VECTOR_DIR } from '../server/vectors.js';

// M3 的种子簇：同簇词对余弦的中位数即 hi（映射到 0.9）
const SEED_CLUSTERS = [
  ['苹果', '香蕉', '梨', '桃', '西瓜', '橘子'],
  ['白菜', '青菜', '萝卜', '土豆'],
  ['猫', '小猫', '狗', '小狗'],
  ['老虎', '狮子', '豹子'],
  ['晴天', '雨天', '下雨', '下雪'],
  ['春天', '夏天', '秋天', '冬天']
];
const WORD = /^[\p{Script=Han}\p{L}\p{N}]{1,12}$/u;
const FREQUENT = /^\p{Script=Han}{1,4}$/u;
const RANDOM_PAIRS = 20000;
// 后处理去掉的主成分个数（约 dim / 100），见 postprocess
const TOP_COMPONENTS = 3;

function parseArgs(argv) {
  const options = { input: null, count: 20000, out: VECTOR_DIR,
    wordlist: fileURLToPath(new URL('../data/wordlist.txt', import.meta.url)) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--count') options.count = Number(argv[++i]);
    else if (arg === '--out') options.out = resolve(argv[++i]);
    else if (arg === '--wordlist') options.wordlist = resolve(argv[++i]);
    else if (!options.input) options.input = resolve(arg);
    else throw new Error(`未知参数：${arg}`);
  }
  if (!options.input) throw new Error('用法：npm run build:vectors -- <cc.zh.300.vec[.gz]> [--count 20000] [--out data/vectors]');
  if (!Number.isInteger(options.count) || options.count < 1) throw new Error('--count 必须是正整数');
  return options;
}

function readWordlist(file) {
  const words = [];
  for (const [i, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    for (const raw of line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean)) {
      const word = normalizeWord(raw);
      if (!WORD.test(word)) throw new Error(`${file}:${i + 1} 不是合法词：${raw}`);
      words.push(word);
    }
  }
  return [...new Set(words)];
}

async function readVectors(input, count, required) {
  const raw = createReadStream(input);
  const stream = input.endsWith('.gz') ? raw.pipe(createGunzip({ finishFlush: constants.Z_SYNC_FLUSH })) : raw;
  const missing = new Set(required);
  const taken = new Map();
  let dim = 0, frequent = 0, lines = 0;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    lines += 1;
    if (lines === 1) {
      dim = Number(line.trim().split(/\s+/)[1]);
      if (!Number.isInteger(dim) || dim < 1) throw new Error(`首行不是 “词数 维度”：${line.slice(0, 40)}`);
      continue;
    }
    const space = line.indexOf(' ');
    if (space <= 0) continue;
    const word = normalizeWord(line.slice(0, space));
    if (!word || taken.has(word)) continue;  // 繁简等归一后重复的词只保留词频最高的一个
    const isRequired = missing.has(word);
    if (!isRequired && (frequent >= count || !FREQUENT.test(word))) continue;
    const values = line.slice(space + 1).trim().split(' ').map(Number);
    if (values.length !== dim || !values.every(Number.isFinite)) continue;
    const norm = Math.hypot(...values);
    if (!norm) continue;
    taken.set(word, values.map((value) => value / norm));
    if (isRequired) missing.delete(word); else frequent += 1;
    if (frequent >= count && missing.size === 0) break;
  }
  stream.destroy(); raw.destroy();
  return { dim, taken, missing: [...missing], lines, frequent };
}

function quantize(rows, dim) {
  const maxAbs = rows.reduce((max, row) => row.reduce((m, value) => Math.max(m, Math.abs(value)), max), 0);
  const scale = 127 / maxAbs;
  const vectors = new Int8Array(rows.length * dim);
  rows.forEach((row, r) => row.forEach((value, i) => { vectors[r * dim + i] = Math.round(value * scale); }));
  return { vectors, scale };
}

// 后处理（Mu & Viswanath 2018，All-but-the-Top）：减去全体均值，再去掉前 k 个主成分。
// 原始向量里所有词共享几个公共方向，会把无关词对的余弦整体抬高，
// 并让“苹果-猫”高于“苹果-白菜”；去掉后无关词对更接近 0，同领域词对重新排在前面。
function postprocess(rows, dim, k) {
  const mean = new Float64Array(dim);
  for (const row of rows) for (let i = 0; i < dim; i += 1) mean[i] += row[i] / rows.length;
  const centered = rows.map((row) => Float64Array.from(row, (value, i) => value - mean[i]));
  const dot = (a, b) => { let sum = 0; for (let i = 0; i < dim; i += 1) sum += a[i] * b[i]; return sum; };
  const unit = (v) => { const norm = Math.hypot(...v); return v.map((value) => value / norm); };
  const components = [];
  for (let c = 0; c < k; c += 1) {
    // 幂迭代求协方差矩阵的第 c 个主方向；初值固定，保证同一输入结果可复现
    let v = unit(Float64Array.from({ length: dim }, (_, i) => Math.sin(i * 7.3 + c)));
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const next = new Float64Array(dim);
      for (const row of centered) { const p = dot(row, v); for (let i = 0; i < dim; i += 1) next[i] += p * row[i]; }
      for (const u of components) { const p = dot(next, u); for (let i = 0; i < dim; i += 1) next[i] -= p * u[i]; }
      v = unit(next);
    }
    components.push(v);
  }
  return centered.map((row) => {
    for (const u of components) { const p = dot(row, u); for (let i = 0; i < dim; i += 1) row[i] -= p * u[i]; }
    return unit(row);
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 固定种子的伪随机数，保证同一输入的标定结果可复现
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function calibrate(data, rowOf) {
  const random = mulberry32(2026);
  const count = data.vocab.length;
  const unrelated = [];
  while (unrelated.length < RANDOM_PAIRS) {
    const x = Math.floor(random() * count), y = Math.floor(random() * count);
    if (x !== y) unrelated.push(cosine(data, x, y));
  }
  const related = [];
  for (const cluster of SEED_CLUSTERS) {
    const rows = cluster.map((word) => rowOf.get(normalizeWord(word)));
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) related.push(cosine(data, rows[i], rows[j]));
    }
  }
  const calib = { lo: median(unrelated), hi: median(related) };
  if (!(calib.hi > calib.lo)) throw new Error(`标定失败：hi ${calib.hi} 不大于 lo ${calib.lo}`);
  return calib;
}

function notice(count, frequent, extra) {
  return `# 词向量数据说明

本目录（\`data/vectors/\`）中的 \`vocab.json\`、\`vectors.bin\`、\`meta.json\` 是由以下作品改编而来的衍生数据。

- 作品：Word vectors for 157 languages 中的中文词向量 \`cc.zh.300\`（fastText）
- 来源：https://fasttext.cc/docs/en/crawl-vectors
- 作者：E. Grave, P. Bojanowski, P. Gupta, A. Joulin, T. Mikolov
- 许可：Creative Commons Attribution-ShareAlike 3.0（CC BY-SA 3.0），https://creativecommons.org/licenses/by-sa/3.0/

改动：从原始向量中选取 ${count} 个词（按原文件词频顺序取前 ${frequent} 个 1–4 字的纯汉字词，另加 \`data/wordlist.txt\` 中的 ${extra} 个词）；词形按繁转简、全角转半角、去空白、转小写归一，归一后重复的只保留词频最高的一个；每个向量先做 L2 归一化，再减去全体均值、去掉前 ${TOP_COMPONENTS} 个主成分，重新 L2 归一化后量化为 int8。

本目录下的衍生数据同样以 CC BY-SA 3.0 发布。
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const required = readWordlist(options.wordlist);
  const seeds = SEED_CLUSTERS.flat().map(normalizeWord);
  const missingSeeds = seeds.filter((word) => !required.includes(word));
  if (missingSeeds.length) throw new Error(`必收词清单缺少种子词：${missingSeeds.join(' ')}`);

  const started = Date.now();
  const { dim, taken, missing, lines, frequent } = await readVectors(options.input, options.count, required);
  const absentSeeds = seeds.filter((word) => !taken.has(word));
  if (absentSeeds.length) throw new Error(`原始向量里找不到种子词：${absentSeeds.join(' ')}`);
  if (frequent < options.count) console.warn(`原始文件只提供了 ${frequent} 个高频词，少于 --count ${options.count}`);

  const vocab = [...taken.keys()];
  const rowOf = new Map(vocab.map((word, row) => [word, row]));
  const { vectors, scale } = quantize(postprocess([...taken.values()], dim, TOP_COMPONENTS), dim);
  const calib = calibrate({ vectors, dim, scale, vocab }, rowOf);
  const meta = { dim, count: vocab.length, scale, calib, builtAt: new Date().toISOString() };

  mkdirSync(options.out, { recursive: true });
  writeFileSync(join(options.out, 'vocab.json'), `[\n${vocab.map((word) => JSON.stringify(word)).join(',\n')}\n]\n`);
  writeFileSync(join(options.out, 'vectors.bin'), vectors);
  writeFileSync(join(options.out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(join(options.out, 'NOTICE.md'), notice(vocab.length, frequent, vocab.length - frequent));

  console.log(`读取 ${lines} 行，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
  console.log(`收录 ${vocab.length} 个词（高频 ${frequent}，必收补充 ${vocab.length - frequent}），${dim} 维，${vectors.length} 字节`);
  console.log(`标定 lo=${calib.lo.toFixed(4)} hi=${calib.hi.toFixed(4)} scale=${scale.toFixed(2)}`);
  if (missing.length) console.log(`必收词在原始向量中找不到（${missing.length} 个）：${missing.join(' ')}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
