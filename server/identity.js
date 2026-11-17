import { createHash } from 'node:crypto';

// 设备指纹只取设备自身的稳定特征：不含 IP（反向代理后所有用户同一个地址），
// 不含 Canvas / 音频 / 字体枚举（跨内核不稳定，会把同一设备拆成两个人）。
const DAY = 24 * 60 * 60 * 1000;

const FIELDS = Object.freeze({
  os: 16, osVersion: 12, model: 48, screen: 16, dpr: 8, timezone: 48,
  languages: 40, cores: 4, memory: 4, touch: 4, gpu: 80, browser: 16, browserVersion: 12
});

// 系统或浏览器升级会让它变，用来判断「同一台设备但升级过」。
const STRONG_FIELDS = Object.freeze(['os', 'osVersion', 'model', 'screen', 'dpr', 'timezone', 'languages', 'cores', 'memory', 'touch', 'gpu', 'browser', 'browserVersion']);
// 升级后仍然一致，用来兜住升级带来的指纹漂移。
const WEAK_FIELDS = Object.freeze(['os', 'model', 'screen', 'dpr', 'timezone', 'languages', 'gpu']);

const ALIASES = Object.freeze({
  osversion: 'osVersion', osver: 'osVersion',
  browser: 'browser', uafamily: 'browser',
  browserversion: 'browserVersion', uaversion: 'browserVersion',
  tz: 'timezone', langs: 'languages',
  cores: 'cores', hardwareconcurrency: 'cores',
  memory: 'memory', devicememory: 'memory',
  touch: 'touch', maxtouchpoints: 'touch'
});

const clean = (value, limit) => {
  if (value == null) return '';
  if (Array.isArray(value)) value = value.join(',');
  if (typeof value === 'number') value = Number.isFinite(value) ? String(value) : '';
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, limit);
};

const digest = (values) => createHash('sha256').update(values.join('\u0001')).digest('hex');

// 客户端上报的特征里只保留白名单字段；拿不到最小可用信息时返回 null，退回「没有设备线索」。
export function normalizeDeviceProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const profile = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = FIELDS[key] ? key : ALIASES[String(key).toLowerCase()];
    if (!field || profile[field] !== undefined) continue;
    profile[field] = clean(value, FIELDS[field]);
  }
  for (const field of Object.keys(FIELDS)) profile[field] ??= '';
  if (!profile.os || !profile.screen) return null;
  return {
    deviceKey: digest(STRONG_FIELDS.map((field) => profile[field])),
    weakKey: digest(WEAK_FIELDS.map((field) => profile[field])),
    profile: JSON.stringify(profile)
  };
}

const lastSeenOf = (link) => Number(link.last_seen ?? link.lastSeen ?? 0);

// 采纳设备上已有的身份：
// - auto：指纹命中就沿用，只在同设备多身份、或该身份正在房间里游玩时才让人挑；
// - confirm：一律让人挑。
export function decideAdoption({ links = [], playing = () => false, rejected = () => false,
  adopt = 'auto', adoptMaxIdleDays = 30, now = Date.now() } = {}) {
  const fresh = (Array.isArray(links) ? links : [])
    .filter((link) => link && typeof link.uid === 'string')
    .filter((link) => !rejected(link.uid))
    .filter((link) => now - lastSeenOf(link) <= adoptMaxIdleDays * DAY)
    .sort((left, right) => lastSeenOf(right) - lastSeenOf(left));
  if (!fresh.length) return { action: 'none', candidates: [] };
  const candidates = fresh.map((link) => link.uid);
  if (adopt !== 'auto') return { action: 'choose', reason: 'confirm', candidates };
  if (candidates.length > 1) return { action: 'choose', reason: 'multiple', candidates };
  const [uid] = candidates;
  // 这个身份正在房间里玩：静默沿用会把正在玩的那一端踢掉。
  if (playing(uid)) return { action: 'choose', reason: 'playing', candidates };
  return { action: 'adopt', uid, candidates };
}
export function collectDeviceKeys(database, device) {
  if (!device?.deviceKey) return [];
  const keys = [device.deviceKey];
  const seen = new Set(keys);
  const weakKey = device.weakKey || database.getDevice?.(device.deviceKey)?.weak_key || database.getDevice?.(device.deviceKey)?.weakKey;
  if (!weakKey) return keys;
  for (const other of database.devicesByWeakKey(weakKey) || []) {
    const key = other.device_key ?? other.deviceKey;
    if (key && !seen.has(key)) { keys.push(key); seen.add(key); }
  }
  return keys;
}

// 强指纹命中的设备优先，再补上「同设备但系统升级过」的弱指纹设备，按 uid 去重。
export function collectDeviceLinks(database, device) {
  const links = [];
  const seen = new Set();
  for (const key of collectDeviceKeys(database, device)) {
    for (const link of database.getDeviceLinks(key) || []) {
      if (!seen.has(link.uid)) { links.push(link); seen.add(link.uid); }
    }
  }
  return links;
}
