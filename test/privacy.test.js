import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { homeMarkup, shellMarkup, privacyMarkup } from '../public/render.js';
import { createSynconymServer } from '../server/index.js';
import { createDatabase } from '../server/db.js';
import { DEFAULT_SETTINGS } from '../server/rules.js';

test('隐私说明使用站内路由，房间内从新标签打开', () => {
  const home = shellMarkup(false);
  const room = shellMarkup(true);
  assert.match(home, /href="\/\?privacy" data-action="open-privacy"/);
  assert.match(room, /href="\/\?privacy" target="_blank" rel="noopener"/);
  assert.match(home, /icon-shield-check[\s\S]*隐私说明/);
  assert.doesNotMatch(homeMarkup(DEFAULT_SETTINGS), /隐私说明/);
});

test('隐私说明保留原文、目录及返回入口', () => {
  const html = privacyMarkup();
  assert.match(html, /不会删除旧身份或旧对局记录/);
  assert.match(html, /没有自助删除服务器记录/);
  assert.match(html, /href="\/" data-action="home"/);
  assert.match(html, /<nav class="privacy-nav" aria-label="隐私说明目录">/);
  for (const id of ['identity', 'records', 'deletion', 'hosting']) {
    assert.match(html, new RegExp(`href="#${id}"`));
    assert.match(html, new RegExp(`<section id="${id}">`));
  }
});

test('隐私路由返回应用入口，旧独立页面不存在', async (t) => {
  const { server } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/?privacy`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /src="\/app.js"/);
  assert.equal((await fetch(`${base}/privacy.html`)).status, 404);
});

test('版权声明保留独立词向量许可', async () => {
  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /All rights reserved/);
  assert.match(license, /CC BY-SA 3\.0/);
});
