// 设备特征采集：只取同一台设备上各种浏览器都一致、且不随网络变化的项。
// 算法与阈值由服务端 server/identity.js 统一裁决，这里只负责如实上报。
const MAX_STRING = 120;

const safe = (read, fallback = '') => {
  try {
    const value = read();
    return value == null ? fallback : value;
  } catch { return fallback; }
};

// `iPhone OS 17_5 like Mac OS X` 里取出 `17.5`；下划线是 UA 的历史写法。
const versionAfter = (text, marker) => {
  const index = text.indexOf(marker);
  if (index < 0) return '';
  const rest = text.slice(index + marker.length).trim();
  const token = rest.split(/[;)]/)[0].trim();
  return token.replace(/_/g, '.');
};

// 只保留主版本：浏览器与系统的小版本升级不该换一个身份。
const majorVersion = (value) => {
  const [first, second] = String(value).split('.');
  if (!first) return '';
  if (second === undefined) return first;
  return `${first}.${second}`;
};

// Android 的 UA 形如 `Android 14; SM-S918B Build/UP1A...`；Chrome 缩减 UA 会给 `K`，此时交给 UA-CH 补。
const androidModel = (text) => {
  const index = text.indexOf('Android');
  if (index < 0) return '';
  const parts = text.slice(index).split(';').map((part) => part.trim());
  const candidate = parts[1] || '';
  if (!candidate) return '';
  const model = candidate.split(')')[0].split('Build/')[0].trim();
  return model === 'K' ? '' : model.slice(0, 48);
};

const androidVersion = (text) => {
  const index = text.indexOf('Android');
  if (index < 0) return '';
  const rest = text.slice(index + 'Android'.length).trim();
  return majorVersion(rest.split(/[;)]/)[0].trim());
};

const browserOf = (text) => {
  if (text.includes('MicroMessenger')) return { browser: 'wechat', browserVersion: majorVersion(versionAfter(text, 'MicroMessenger/')) };
  if (text.includes('Edg/')) return { browser: 'edge', browserVersion: majorVersion(versionAfter(text, 'Edg/')) };
  if (text.includes('OPR/')) return { browser: 'opera', browserVersion: majorVersion(versionAfter(text, 'OPR/')) };
  if (text.includes('Firefox/')) return { browser: 'firefox', browserVersion: majorVersion(versionAfter(text, 'Firefox/')) };
  if (text.includes('Chrome/')) return { browser: 'chrome', browserVersion: majorVersion(versionAfter(text, 'Chrome/')) };
  if (text.includes('Version/') && text.includes('Safari/')) return { browser: 'safari', browserVersion: majorVersion(versionAfter(text, 'Version/')) };
  return { browser: 'unknown', browserVersion: '' };
};

// 把 UA 归约成 `系统 + 系统版本 + 机型 + 浏览器`，同一台设备的不同浏览器只会在浏览器这一项上不同。
export function normalizeUa(ua = '') {
  const text = String(ua).slice(0, 400);
  const browserInfo = browserOf(text);
  if (text.includes('iPhone')) {
    return { os: 'ios', osVersion: majorVersion(versionAfter(text, 'iPhone OS ')), model: '', ...browserInfo };
  }
  if (text.includes('iPad')) {
    return { os: 'ipados', osVersion: majorVersion(versionAfter(text, 'CPU OS ')), model: '', ...browserInfo };
  }
  if (text.includes('Android')) {
    return { os: 'android', osVersion: androidVersion(text), model: androidModel(text), ...browserInfo };
  }
  if (text.includes('Windows NT ')) {
    return { os: 'windows', osVersion: versionAfter(text, 'Windows NT '), model: '', ...browserInfo };
  }
  if (text.includes('Mac OS X ')) {
    return { os: 'macos', osVersion: versionAfter(text, 'Mac OS X '), model: '', ...browserInfo };
  }
  if (text.includes('Linux')) {
    return { os: 'linux', osVersion: '', model: '', ...browserInfo };
  }
  return { os: 'unknown', osVersion: '', model: '', ...browserInfo };
}

// UA-CH 能补出 Android 机型（缩减 UA 只给 `K`）；拿不到就当作没有。
function highEntropyModel(nav) {
  const data = nav?.userAgentData;
  if (!data || typeof data.getHighEntropyValues !== 'function') return Promise.resolve('');
  const read = Promise.resolve(data.getHighEntropyValues(['model']))
    .then((values) => (values && typeof values.model === 'string' ? values.model : ''))
    .catch(() => '');
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(''), 500); });
  return Promise.race([read, timeout]);
}

// 显卡型号在系统层面是一致的（同型号设备相同），用来区分不同机型，不用于区分浏览器。
function readGpu() {
  return String(safe(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  })).slice(0, MAX_STRING);
}

export async function collectDeviceProfile(env = globalThis) {
  const nav = safe(() => env.navigator, null);
  const screenInfo = safe(() => env.screen, null);
  const ua = String(safe(() => nav?.userAgent, '') || '');
  const profile = normalizeUa(ua);
  const model = await highEntropyModel(nav);
  return {
    ...profile,
    model: String(model || profile.model || '').slice(0, 48),
    screen: screenInfo ? `${screenInfo.width}x${screenInfo.height}` : '',
    dpr: String(safe(() => env.devicePixelRatio, '') || ''),
    timezone: String(safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, '') || ''),
    languages: (() => {
      const list = safe(() => nav?.languages, null);
      if (Array.isArray(list) && list.length) return list.slice(0, 3).join(',');
      return String(safe(() => nav?.language, '') || '');
    })(),
    cores: String(safe(() => nav?.hardwareConcurrency, '') || ''),
    memory: String(safe(() => nav?.deviceMemory, '') || ''),
    touch: String(safe(() => nav?.maxTouchPoints, '') ?? ''),
    gpu: readGpu()
  };
}
