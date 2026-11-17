// 版本探测：页面自身的构建号在 <html data-build> 上，服务器当前的构建号从首页响应里现读。
// 两者不一致就换一个带 query 的地址重新进入——微信内核只认 URL，不换地址它会一直用缓存里的那份 HTML。
const BUILD_PATTERN = /<html[^>]*\sdata-build="([0-9a-f]{6,40})"/i;
const PAGE_URL = '/';
const POLL_INTERVAL = 5 * 60 * 1000;

export function pageRevision() {
  return document.documentElement.dataset.build || '';
}

// 大厅和结算是安全刷新点：手上没有正在写的词，也没有等着投的票。
export function canApplyNow(room) {
  return !room || room.phase === 'lobby' || room.phase === 'result';
}

export function updateUrl(revision) {
  const url = new URL(location.href);
  url.searchParams.set('v', revision.slice(0, 12));
  return url.toString();
}

async function requestRevision() {
  const response = await fetch(PAGE_URL, { cache: 'no-store', headers: { accept: 'text/html' } });
  if (!response.ok) return '';
  return BUILD_PATTERN.exec(await response.text())?.[1] || '';
}

// 只有拿到页面构建号才探测；模拟面板与本地开发没有这个标记，直接不启动。
export function createUpdateWatcher({ build = pageRevision(), interval = POLL_INTERVAL,
  fetchRevision = requestRevision, onUpdate = () => {}, delay = 2000 } = {}) {
  if (!build) return { stop() {} };
  let stopped = false;
  let timer;
  let firstCheck;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(firstCheck);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  const check = async () => {
    if (stopped) return;
    let revision;
    try { revision = await fetchRevision(); } catch { return; }
    if (stopped || !revision || revision === build) return;
    stop();
    onUpdate(revision);
  };
  const onVisibility = () => { if (document.visibilityState === 'visible') check(); };
  // 首屏先让页面画完再探一次：进页面时 HTML 被换成缓存版本的情况，要立刻纠正。
  firstCheck = setTimeout(check, delay);
  timer = setInterval(check, interval);
  document.addEventListener('visibilitychange', onVisibility);
  return { stop };
}
