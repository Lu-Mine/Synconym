import { normalizeWord } from './rules.js';

// M3 seed only: explicit clusters and symmetric neighbouring domains, not an M7 dictionary.
const clusters = [
  ['fruit', 'food', ['苹果', '香蕉', '梨', '桃', '西瓜', '橘子']],
  ['vegetable', 'food', ['白菜', '青菜', '萝卜', '土豆']],
  ['pet', 'animal', ['猫', '小猫', '狗', '小狗']],
  ['wildlife', 'animal', ['老虎', '狮子', '豹子']],
  ['weather', 'nature', ['晴天', '雨天', '下雨', '下雪']],
  ['season', 'nature', ['春天', '夏天', '秋天', '冬天']]
];
const lexicon = new Map(clusters.flatMap(([cluster, domain, words]) =>
  words.map((word) => [normalizeWord(word), { cluster, domain }])));

export function similarity(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  const left = normalizeWord(a), right = normalizeWord(b);
  if (!left || !right) return null;
  if (left === right) return 1;
  const x = lexicon.get(left), y = lexicon.get(right);
  if (!x || !y) return null;
  return x.cluster === y.cluster ? 0.9 : x.domain === y.domain ? 0.5 : 0.2;
}

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
