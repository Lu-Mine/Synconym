import OpenCC from 'opencc-js';

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const durations = [15, 30, 45, 60];

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true
});

export function normalizeWord(word) {
  return toSimplified(String(word).normalize('NFC').replace(/[！-～]/g,
    (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0)))
    .replace(/\s/gu, '').toLowerCase();
}

export function validateWord(word, history = [], banRepeat = true) {
  if (typeof word !== 'string') throw new Error('词语无效');
  const normalized = normalizeWord(word);
  if (!normalized || [...normalized].length > 12 || !/^[\p{Script=Han}\p{L}\p{N}]+$/u.test(normalized)) {
    throw new Error('请输入 1 到 12 个汉字、字母或数字');
  }
  if (banRepeat && history.some((old) => normalizeWord(old) === normalized)) {
    throw new Error('这个词本局用过了');
  }
  return normalized;
}

export function validateSettings(settings) {
  const raw = { ...DEFAULT_SETTINGS, ...settings };
  const maxRounds = typeof raw.maxRounds === 'string' && raw.maxRounds.trim() !== ''
    ? Number(raw.maxRounds) : raw.maxRounds;
  const writeSeconds = typeof raw.writeSeconds === 'string' && raw.writeSeconds.trim() !== ''
    ? Number(raw.writeSeconds) : raw.writeSeconds;
  const prepareSeconds = typeof raw.prepareSeconds === 'string' && raw.prepareSeconds.trim() !== ''
    ? Number(raw.prepareSeconds) : raw.prepareSeconds;
  if (!['free', 'theme'].includes(raw.mode)) throw new Error('房间模式无效');
  if (!Number.isInteger(maxRounds) || maxRounds < 4 || maxRounds > 20) {
    throw new Error('轮次上限须为 4 到 20 的整数');
  }
  if (!durations.includes(writeSeconds) || !durations.includes(prepareSeconds)) {
    throw new Error('时限设置无效');
  }
  if (typeof raw.banRepeat !== 'boolean') throw new Error('重复词设置无效');
  return {
    mode: raw.mode, maxRounds, writeSeconds,
    prepareSeconds, banRepeat: raw.banRepeat
  };
}

export function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('名字不能为空');
  const value = name.trim();
  if ([...value].length > 12) throw new Error('名字最多 12 个字符');
  return value;
}

// 身份 UID：数字 + 大写字母，去掉容易看错的 0/O、1/I/L
export const UID_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const UID_LENGTH = 8;
const UID_PATTERN = new RegExp(`^[${UID_CHARS}]{${UID_LENGTH}}$`);

export function isValidUid(uid) {
  return typeof uid === 'string' && UID_PATTERN.test(uid);
}

export function validateCode(code) {
  const value = typeof code === 'string'
    ? code.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0)).trim()
    : '';
  if (!/^[0-9]{5}$/.test(value)) throw new Error('请输入 5 位数字房号');
  return value;
}
