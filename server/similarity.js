import { normalizeWord } from './rules.js';
import { cosine, loadVectors } from './vectors.js';

// 非精确相遇的上限：保证只有相遇（精确或投票）才画到 1
const MAX_INEXACT = 0.95;

// data 为 loadVectors 的结果；为 null 时只有相同词得 1，其余一律无法计算
export function createSimilarity(data) {
  const rowOf = new Map(data ? data.vocab.map((word, row) => [word, row]) : []);
  return function similarity(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return null;
    const left = normalizeWord(a), right = normalizeWord(b);
    if (!left || !right) return null;
    if (left === right) return 1;
    const x = rowOf.get(left), y = rowOf.get(right);
    if (x === undefined || y === undefined) return null;
    // 余弦按构建时标定的 lo→0.2、hi→0.9 线性映射，再截到 [0, 0.95]
    const { lo, hi } = data.calib;
    const score = 0.2 + 0.7 * (cosine(data, x, y) - lo) / (hi - lo);
    return Math.round(Math.min(Math.max(score, 0), MAX_INEXACT) * 1000) / 1000;
  };
}

// 向量文件缺失或损坏时只警告一次，不阻塞启动
export function loadSimilarity(dir) {
  let data = null;
  try { data = loadVectors(dir); } catch (error) {
    console.warn(`词向量未加载，结算曲线将显示为无法计算：${error.message}`);
  }
  return { similarity: createSimilarity(data), info: data && { count: data.vocab.length, builtAt: data.builtAt } };
}

const loaded = loadSimilarity();
export const similarity = loaded.similarity;
export const vectorInfo = loaded.info;

export function buildChart(players, history) {
  return history.map((record) => {
    const pairs = [];
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const uids = [players[i].uid, players[j].uid];
        pairs.push({ uids, similarity: uids.every((uid) => record.marks[uid] === 'none')
          ? similarity(record.words[uids[0]], record.words[uids[1]]) : null });
      }
    }
    const aggregate = pairs.length && pairs.every((pair) => pair.similarity !== null)
      ? pairs.reduce((sum, pair) => sum + pair.similarity, 0) / pairs.length : null;
    return { n: record.n, similarity: ['exact', 'voted'].includes(record.outcome) ? 1 : aggregate, pairs };
  });
}
