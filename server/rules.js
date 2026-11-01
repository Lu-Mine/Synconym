import OpenCC from 'opencc-js';

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const durations = [15, 30, 45, 60];

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true
});

export function normalizeWord(word) {
  return toSimplified(String(word).normalize('NFC').replace(/[＀-￯]/g,
    (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0)))
    .replace(/\s/g, '').toLowerCase().trim();
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

export function validateCode(code) {
  if (typeof code !== 'string' || !/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(code)) {
    throw new Error('请输入有效的 4 位房号');
  }
  return code;
}
