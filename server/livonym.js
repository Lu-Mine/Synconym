import { readFileSync } from 'node:fs';
import { normalizeWord } from './rules.js';

// 词库缺失或为空时直接抛错（在服务起监听之前），不做静默降级。
const LIVONYM_WORD_DATA = (() => {
  const data = JSON.parse(readFileSync(new URL('../data/livonym-words.json', import.meta.url), 'utf8'));
  const words = data?.words;
  if (!Array.isArray(words) || words.length < 16) throw new Error('秘密词库不足');
  const categoryMap = new Map();
  if (data.categories && typeof data.categories === 'object') {
    for (const [category, list] of Object.entries(data.categories)) {
      if (!Array.isArray(list)) continue;
      for (const word of list) categoryMap.set(word, category);
    }
  }
  return { words, categoryMap };
})();

export const LIVONYM_WORDS = LIVONYM_WORD_DATA.words;
export const LIVONYM_WORD_CATEGORIES = LIVONYM_WORD_DATA.categoryMap;
export const LIVONYM_COOLDOWN_DAYS = 14;

export const LIVONYM_LIMITS = Object.freeze({ minPlayers: 3, maxPlayers: 8, describeLimit: 50 });
export const LIVONYM_PHASES = Object.freeze(['lvIntro', 'lvPlay', 'lvScore']);
export const LIVONYM_INTRO_SECONDS = 5;
export const LIVONYM_SCORE_SECONDS = 6;
export const LIVONYM_STREAM_INTERVAL_MS = 60;
export const LIVONYM_GUESS_COOLDOWN_MS = 1500;

// 计分系数：改这里就能调整松紧，其余逻辑不动。
export const LIVONYM_SCORE = Object.freeze({ perGuess: 1, allGuessed: 0 });

// 出题人每轮得分：全员猜中归零 > 每有一人猜中加 perGuess。写出谜底只拦截，不扣分。
export function describerPoints({ guessedCount = 0, guesserCount = 0 } = {}) {
  if (!guesserCount || guesserCount <= 0 || guessedCount <= 0) return 0;
  if (guessedCount >= guesserCount) return LIVONYM_SCORE.allGuessed;
  return guessedCount * LIVONYM_SCORE.perGuess;
}

// 竞猜者每轮得分：名次越靠前越高，未猜中不进这里。
// 动态计分阶梯：第 1 名得 totalPlayers 分，第 2 名 totalPlayers - 1 分...保底 1 分。
export function guessPoints(order, totalPlayers = 3) {
  if (!Number.isInteger(order) || order < 1) return 0;
  const count = Number.isInteger(totalPlayers) && totalPlayers >= 3 ? totalPlayers : 3;
  return Math.max(1, count - order + 1);
}

function normalizeForSecretMatching(value) {
  const stripped = String(value ?? '')
    .normalize('NFC')
    .replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, '');
  return normalizeWord(stripped);
}

// 拦截「直接写出谜底」：剔除标点与符号后，归一化包含完整秘密词才算命中，单字天然放行。
export function containsSecret(text, secret) {
  const target = normalizeForSecretMatching(secret ?? '');
  if (target.length < 2) return false;
  return normalizeForSecretMatching(text).includes(target);
}

// 同局不重复抽词；词库少于本局所需时由调用方先校验。
export function pickSecret({ words = LIVONYM_WORDS, used = [], random = Math.random } = {}) {
  const taken = new Set(used);
  const pool = words.filter((word) => !taken.has(word));
  if (!pool.length) throw new Error('秘密词已抽完');
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

// 房间级洗牌袋 + 多人近期战绩冷却（LRU 降级）+ 防连续同类词。
export function drawSecret({
  words = LIVONYM_WORDS,
  roomUsed = new Set(),
  cooldown = new Map(),
  lastSecret = null,
  lastCategory = null,
  wordCategories = LIVONYM_WORD_CATEGORIES,
  random = Math.random
} = {}) {
  if (!Array.isArray(words) || !words.length) throw new Error('秘密词已抽完');
  const usedSet = roomUsed instanceof Set ? roomUsed : new Set(roomUsed);
  const cooldownMap = cooldown instanceof Map ? cooldown : new Map(Object.entries(cooldown || {}));

  // Stage 1: 优先从本房洗牌袋尚未抽过的词里挑；全库抽空时自动重洗并避开上一轮末词。
  let pool = words.filter((word) => !usedSet.has(word));
  let reshuffled = false;
  if (!pool.length) {
    usedSet.clear();
    pool = lastSecret && words.length > 1 ? words.filter((word) => word !== lastSecret) : [...words];
    reshuffled = true;
  }

  // Stage 2: 避开在场玩家近期在历史对局中抽到过的词；全都在冷却期内则按最久未见兜底。
  let candidates = pool.filter((word) => !cooldownMap.has(word));
  if (!candidates.length) {
    let oldest = Infinity;
    for (const word of pool) {
      const seenAt = cooldownMap.get(word) ?? 0;
      if (seenAt < oldest) oldest = seenAt;
    }
    candidates = pool.filter((word) => (cooldownMap.get(word) ?? 0) === oldest);
  }

  // Stage 3: 候选内有不同主题时，避开与上一轮同分类的词以降低主观重复感。
  if (lastCategory && wordCategories?.size) {
    const varied = candidates.filter((word) => wordCategories.get(word) !== lastCategory);
    if (varied.length) candidates = varied;
  }

  const secret = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  usedSet.add(secret);
  if (Array.isArray(roomUsed)) {
    if (reshuffled) roomUsed.length = 0;
    roomUsed.push(secret);
  }
  return { secret, category: wordCategories?.get(secret) ?? null, reshuffled };
}

// 出题人只由顺序与棒次推出，不另存角色字段。
export function livonymDescriberUid(order, index) {
  if (!Array.isArray(order) || !order.length || !Number.isInteger(index) || index < 0) return null;
  return order[index % order.length];
}

export function validateDescribe(text, limit = LIVONYM_LIMITS.describeLimit) {
  if (typeof text !== 'string') throw new Error('描述内容无效');
  if ([...text].length > limit) throw new Error('描述超出上限');
  return text;
}
