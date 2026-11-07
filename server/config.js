import { readFileSync, mkdirSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_CONFIG = {
  host: '', port: 3000, publicUrl: '', dbPath: 'data/synconym.db', maxRooms: 500, wsMaxPayload: 65536,
  security: { trustProxy: false, maxGlobalConnections: 1000, maxConnectionsPerSource: 50,
    maxAccountsPerSource: 20, accountWindowMs: 60000, messageBurst: 60, messageRefillPerSecond: 30,
    globalMessageBurst: 1000, globalMessageRefillPerSecond: 500, handshakeTimeoutMs: 10000 }
};

function ensureConfig(path) {
  try { readFileSync(path); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const directory = dirname(resolve(path));
  mkdirSync(directory, { recursive: true });
  const temporary = resolve(directory, `.synconym-config-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    try { linkSync(temporary, path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}

export function configPath(env = process.env, cwd = process.cwd()) {
  return env.SYNCONYM_CONFIG || (env.DB_PATH && env.DB_PATH !== ':memory:'
    ? resolve(cwd, dirname(env.DB_PATH), 'synconym.config.json') : resolve(cwd, 'synconym.config.json'));
}
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
export function loadConfig({ env = process.env, path = configPath(env) } = {}) {
  ensureConfig(path);
  const config = merge(DEFAULT_CONFIG, readJson(path));
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
