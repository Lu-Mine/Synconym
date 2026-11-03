import test from 'node:test';
import assert from 'node:assert/strict';
import { profileMarkup, shellMarkup } from '../public/render.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture(overrides = {}) {
  return {
    profile: {
      user: { uid: 'A7K2M9QX', name: '<甲>', createdAt: 1790000000000 },
      nameHistory: [{ name: '<甲>', changedAt: 2 }, { name: '旧名字', changedAt: 1 }],
      matches: [
        { id: 'm2', roomCode: '12345', outcome: 'exact', totalRounds: 12, convergedRound: 3,
          themeName: '火锅', startedAt: 1790000000000, players: ['<甲>', '乙'] },
        { id: 'm1', roomCode: '54321', outcome: 'none', totalRounds: 8, convergedRound: null,
          themeName: null, startedAt: 1780000000000, players: ['甲'] }
      ],
      page: 1, pageSize: 10, total: 12,
      ...overrides
    }
  };
}

test('档案展示身份、曾用名、对局与隐私说明，并转义所有文本', () => {
  const html = profileMarkup(fixture());
  for (const text of ['UID：A7K2M9QX', '加入于', '曾用名 旧名字', '第 3 轮相遇', '打满 8 轮未相遇',
    '房号 12345', '主题 · 火锅', '自由模式', '12 局', '对局记录', '我是新人', 'data-action="reset-identity"']) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(html.includes('&lt;甲&gt;'));
  assert.match(html, /本设备保存随机 UID；服务器保存名字和完成过的对局记录/);
  assert.ok(!html.includes('<甲>'));
  assert.ok(!html.includes('>乙、'));
  for (const button of html.matchAll(/<button\b[^>]*>/g)) assert.match(button[0], /\btype="button"/);
});

test('没有对局时显示空态，不渲染分页', () => {
  const html = profileMarkup(fixture({ matches: [], total: 0 }));
  assert.ok(html.includes('还没有完成的对局'));
  assert.ok(html.includes('0 局'));
  assert.ok(!html.includes('profile-pager'));
  assert.ok(!html.includes('profile-matches'));
});

test('分页按钮按当前页决定是否可用', () => {
  const first = profileMarkup(fixture());
  assert.ok(first.includes('第 1 / 2 页'));
  assert.match(first, /data-action="profile-prev" disabled/);
  assert.match(first, /data-action="profile-next" ><span>下一页/);

  const second = profileMarkup(fixture({ page: 2 }));
  assert.ok(second.includes('第 2 / 2 页'));
  assert.doesNotMatch(second, /data-action="profile-prev" disabled/);
  assert.match(second, /data-action="profile-next" disabled/);

  const single = profileMarkup(fixture({ total: 10, page: 1 }));
  assert.ok(!single.includes('profile-pager'));
});

test('读取中显示占位，首页名字区只在首页可点进档案', () => {
  assert.ok(profileMarkup({ profile: null }).includes('正在读取档案'));

  const home = shellMarkup(false, { uid: 'A7K2M9QX', name: '甲' });
  assert.match(home, /<button class="header-profile-trigger" type="button" data-action="open-profile" aria-label="查看我的档案"/);
  assert.match(home, /header-user-name[^>]*>甲</);

  const inRoom = shellMarkup(true, { uid: 'A7K2M9QX', name: '甲' });
  assert.ok(!inRoom.includes('open-profile'));
  assert.match(inRoom, /header-user-name[^>]*>甲</);
});

test('浏览器后退和前进按地址切换档案，并仅在连接就绪时请求数据', async () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const handler = source.match(/window\.addEventListener\('popstate', async \(\) => \{[\s\S]*?\n\}\);/)[0];
  let listener;
  const requests = [];
  let renders = 0;
  const context = {
    window: { addEventListener: (_, callback) => { listener = callback; } },
    state: { room: null, profile: { page: 2 } }, profileOpen: true,
    location: { search: '' }, URLSearchParams, socket: { ready: true },
    requestProfile: (page) => requests.push(page), render: () => { renders++; }
  };
  runInNewContext(handler, context);
  await listener();
  assert.equal(context.profileOpen, false);
  assert.equal(context.state.profile, null);
  context.location.search = '?me';
  await listener();
  assert.equal(context.profileOpen, true);
  assert.deepEqual(requests, [1]);
  context.socket.ready = false;
  await listener();
  assert.deepEqual(requests, [1]);
  assert.equal(renders, 3);
});
