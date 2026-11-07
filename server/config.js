import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const defaultPath = fileURLToPath(new URL('../synconym.config.json', import.meta.url));
const envKeys = { HOST: 'host', PORT: 'port', PUBLIC_URL: 'publicUrl', DB_PATH: 'dbPath', MAX_ROOMS: 'maxRooms', WS_MAX_PAYLOAD: 'wsMaxPayload' };
const numeric = new Set(['port', 'maxRooms', 'wsMaxPayload']);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`无法读取配置文件 ${path}: ${error.message}`); }
}
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
}
function merge(defaults, override, path = 'config') {
  object(override, path);
  const result = { ...defaults };
  for (const [key, value] of Object.entries(override)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`未知配置项 ${path}.${key}`);
    result[key] = key === 'security' ? merge(defaults[key], value, `${path}.${key}`) : value;
  }
  return result;
}
export function loadConfig({ env = process.env, path = env.SYNCONYM_CONFIG } = {}) {
  const defaults = readJson(defaultPath);
  const config = path ? merge(defaults, readJson(path)) : defaults;
  for (const [envKey, key] of Object.entries(envKeys)) {
    if (env[envKey] !== undefined) config[key] = numeric.has(key) ? Number(env[envKey]) : env[envKey];
  }
  for (const key of ['host', 'publicUrl', 'dbPath']) {
    if (typeof config[key] !== 'string' || (key === 'dbPath' && !config[key].trim())) throw new Error(`${key} 必须是${key === 'dbPath' ? '非空' : ''}字符串`);
  }
  if (config.publicUrl) {
    let url;
    try { url = new URL(config.publicUrl); } catch { throw new Error('publicUrl 必须是完整的 HTTP(S) 地址'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('publicUrl 必须是完整的 HTTP(S) 地址，不能包含凭证、查询或片段');
  }
  for (const key of numeric) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1 || (key === 'port' && config[key] > 65535)) throw new Error(`${key} 必须是有效正整数`);
  }
  object(config.security, 'security');
  for (const [key, value] of Object.entries(config.security)) {
    if (key === 'trustProxy') {
      if (typeof value !== 'boolean') throw new Error('security.trustProxy 必须是布尔值');
    } else if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error(`security.${key} 必须是有效正整数`);
  }
  return config;
}
