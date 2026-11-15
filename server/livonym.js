import { readFileSync } from 'node:fs';
import { normalizeWord } from './rules.js';

// 词库缺失或为空时直接抛错（在服务起监听之前），不做静默降级。
export const LIVONYM_WORDS = (() => {
  const words = JSON.parse(readFileSync(new URL('../data/livonym-words.json', import.meta.url), 'utf8')).words;
  if (!Array.isArray(words) || words.length < 16) throw new Error('秘密词库不足');
  return words;
})();

export const LIVONYM_LIMITS = Object.freeze({ minPlayers: 3, maxPlayers: 8, describeLimit: 50 });
export const LIVONYM_PHASES = Object.freeze(['lvIntro', 'lvPlay', 'lvScore']);
export const LIVONYM_INTRO_SECONDS = 3;
export const LIVONYM_SCORE_SECONDS = 5;
export const LIVONYM_STREAM_INTERVAL_MS = 60;
export const LIVONYM_GUESS_COOLDOWN_MS = 1500;

// 计分系数：改这里就能调整松紧，其余逻辑不动。
export const LIVONYM_SCORE = Object.freeze({ perGuess: 1, allGuessed: 0 });

// 出题人每轮得分：全员猜中归零 > 每有一人猜中加 perGuess。写出谜底只拦截，不扣分。
export function describerPoints({ guessedCount = 0, guesserCount = 0 } = {}) {
  if (!guesserCount || guessedCount <= 0) return 0;
  if (guessedCount >= guesserCount) return LIVONYM_SCORE.allGuessed;
  return guessedCount * LIVONYM_SCORE.perGuess;
}

// 竞猜者每轮得分：名次越靠前越高，未猜中不进这里。
export function guessPoints(order) {
  if (!Number.isInteger(order) || order < 1) return 0;
  return order === 1 ? 3 : order === 2 ? 2 : 1;
}

// 拦截「直接写出谜底」：归一化后包含完整秘密词才算命中，单字天然放行。
export function containsSecret(text, secret) {
  const target = normalizeWord(secret ?? '');
  if (target.length < 2) return false;
  return normalizeWord(text).includes(target);
}

// 同局不重复抽词；词库少于本局所需时由调用方先校验。
export function pickSecret({ words = LIVONYM_WORDS, used = [], random = Math.random } = {}) {
  const taken = new Set(used);
  const pool = words.filter((word) => !taken.has(word));
  if (!pool.length) throw new Error('秘密词已抽完');
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
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
