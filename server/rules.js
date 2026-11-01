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
  const value = { ...DEFAULT_SETTINGS, ...settings };
  if (!['free', 'theme'].includes(value.mode)) throw new Error('房间模式无效');
  if (!Number.isInteger(value.maxRounds) || value.maxRounds < 4 || value.maxRounds > 20) {
    throw new Error('轮次上限须为 4 到 20 的整数');
  }
  if (!durations.includes(value.writeSeconds) || !durations.includes(value.prepareSeconds)) {
    throw new Error('时限设置无效');
  }
  if (typeof value.banRepeat !== 'boolean') throw new Error('重复词设置无效');
  return {
    mode: value.mode, maxRounds: value.maxRounds, writeSeconds: value.writeSeconds,
    prepareSeconds: value.prepareSeconds, banRepeat: value.banRepeat
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
