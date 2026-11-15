import OpenCC from 'opencc-js';

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const durations = [15, 30, 45, 60];
const describeDurations = [30, 45, 60];
const roundsPerPlayerOptions = [1, 2];

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true,
  describeSeconds: 45, roundsPerPlayer: 1
});

// 各模式的最大人数：即时竞猜一人出题、其余抢猜，需要更多座位。
export const MODE_CAPACITY = Object.freeze({ free: 4, theme: 4, livonym: 8 });

export function modeCapacity(mode) {
  return MODE_CAPACITY[mode] ?? MODE_CAPACITY.free;
}

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
  const numeric = (key) => (typeof raw[key] === 'string' && raw[key].trim() !== '' ? Number(raw[key]) : raw[key]);
  const maxRounds = numeric('maxRounds');
  const writeSeconds = numeric('writeSeconds');
  const prepareSeconds = numeric('prepareSeconds');
  const describeSeconds = numeric('describeSeconds');
  const roundsPerPlayer = numeric('roundsPerPlayer');
  if (!['free', 'theme', 'livonym'].includes(raw.mode)) throw new Error('房间模式无效');
  if (!Number.isInteger(maxRounds) || maxRounds < 4 || maxRounds > 20) {
    throw new Error('轮次上限须为 4 到 20 的整数');
  }
  if (!durations.includes(writeSeconds) || !durations.includes(prepareSeconds)) {
    throw new Error('时限设置无效');
  }
  // 即时竞猜用描述时限与每人轮数；其余模式只保留字段，不参与流程。
  if (!describeDurations.includes(describeSeconds)) throw new Error('时限设置无效');
  if (!roundsPerPlayerOptions.includes(roundsPerPlayer)) throw new Error('轮数设置无效');
  if (typeof raw.banRepeat !== 'boolean') throw new Error('重复词设置无效');
  const passwordEnabled = raw.passwordEnabled ?? false;
  if (typeof passwordEnabled !== 'boolean') throw new Error('密码设置无效');
  if (passwordEnabled && (typeof raw.password !== 'string' || !/^[0-9]{6}$/.test(raw.password))) {
    throw new Error('请输入 6 位数字密码');
  }
  return {
    mode: raw.mode, maxRounds, writeSeconds,
    prepareSeconds, banRepeat: raw.banRepeat,
    describeSeconds, roundsPerPlayer,
    passwordEnabled, password: passwordEnabled ? raw.password : ''
  };
}

// 注销身份的展示名：由服务端写入，昵称校验里禁止普通人使用。
export const DELETED_NAME = '[注销用户]';

export function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('名字不能为空');
  const value = name.trim();
  if ([...value].length > 12) throw new Error('名字最多 12 个字符');
  if (value.includes(DELETED_NAME) || value.includes('注销用户')) throw new Error('这个名字不能用');
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
