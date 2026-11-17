import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createSynconymServer } from '../../server/index.js';
import { createDatabase } from '../../server/db.js';
import { canApplyNow, createUpdateWatcher, updateUrl } from '../../public/update-check.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function stubPage({ build = '', visibility = 'visible' } = {}) {
  const listeners = [];
  globalThis.document = {
    documentElement: { dataset: build ? { build } : {} },
    visibilityState: visibility,
    addEventListener: (name, handler) => listeners.push([name, handler]),
    removeEventListener: (name, handler) => {
      const index = listeners.findIndex(([key, value]) => key === name && value === handler);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  globalThis.location = { href: 'https://game.example.com/?r=12345' };
  return {
    listeners,
    hide: () => { globalThis.document.visibilityState = 'hidden'; },
    show: () => {
      globalThis.document.visibilityState = 'visible';
      for (const [name, handler] of listeners) if (name === 'visibilitychange') handler();
    }
  };
}

test('只有大厅和结算允许直接换地址重进', () => {
  assert.equal(canApplyNow(null), true);
  assert.equal(canApplyNow({ phase: 'lobby' }), true);
  assert.equal(canApplyNow({ phase: 'result' }), true);
  for (const phase of ['countdown', 'writing', 'voting', 'prepare', 'breakVote', 'lvPlay', 'lvScore']) {
    assert.equal(canApplyNow({ phase }), false, phase);
  }
});

test('重新进入的地址带上版本号并保留房间参数', () => {
  const stub = stubPage({ build: 'a'.repeat(40) });
  assert.equal(updateUrl('b'.repeat(40)), 'https://game.example.com/?r=12345&v=' + 'b'.repeat(12));
  assert.equal(stub.listeners.length, 0);
});

test('页面没有构建号时不探测', async () => {
  stubPage();
  let calls = 0;
  const watcher = createUpdateWatcher({ fetchRevision: async () => { calls += 1; return 'x'; }, delay: 0 });
  await settle();
  watcher.stop();
  assert.equal(calls, 0);
});

test('服务器换了版本才回调一次，回调后停止轮询', async () => {
  const stub = stubPage({ build: 'a'.repeat(40) });
  const seen = [];
  const watcher = createUpdateWatcher({
    fetchRevision: async () => 'b'.repeat(40), onUpdate: (revision) => seen.push(revision), delay: 0
  });
  await settle();
  stub.show();
  await settle();
  watcher.stop();
  assert.deepEqual(seen, ['b'.repeat(40)]);
  assert.equal(stub.listeners.length, 0, '回调后不再监听切页');
});

test('版本一致、请求失败或返回空值时都不回调', async () => {
  stubPage({ build: 'a'.repeat(40) });
  const seen = [];
  const build = 'a'.repeat(40);
  for (const fetchRevision of [async () => build, async () => { throw new Error('offline'); }, async () => '']) {
    const watcher = createUpdateWatcher({ fetchRevision, onUpdate: (revision) => seen.push(revision), delay: 0 });
    await settle();
    watcher.stop();
  }
  assert.deepEqual(seen, []);
});

test('回到前台时立即重新探测', async () => {
  const stub = stubPage({ build: 'a'.repeat(40), visibility: 'hidden' });
  const seen = [];
  const watcher = createUpdateWatcher({
    fetchRevision: async () => 'c'.repeat(40), onUpdate: (revision) => seen.push(revision), delay: 60000, interval: 60000
  });
  await settle();
  assert.deepEqual(seen, [], '后台不主动探测');
  stub.show();
  await settle();
  watcher.stop();
  assert.deepEqual(seen, ['c'.repeat(40)]);
});

test('首页响应带上构建号并禁止缓存', async (t) => {
  const { server } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/`);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  const build = html.match(/<html lang="zh-CN" data-build="([0-9a-f]{40})">/);
  assert.ok(build, '首页要带构建号');
  // 探测靠比对这个号，重复请求必须稳定。
  const again = await (await fetch(`${base}/`)).text();
  assert.match(again, new RegExp(`data-build="${build[1]}"`));
});

test('客户端脚本按部署路径加载探测模块', () => {
  const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-build/, 'index.html 本体不带构建号，由部署时写入');
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /import \{ createUpdateWatcher, canApplyNow, updateUrl \} from '\.\/update-check\.js';/);
  assert.match(app, /createUpdateWatcher\(\{ onUpdate: noteUpdate \}\);/);
  assert.match(app, /'游戏已更新，本局结束后自动刷新'/);
});
