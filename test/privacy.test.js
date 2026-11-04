import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { homeMarkup } from '../public/render.js';
import { createSynconymServer } from '../server/index.js';
import { createDatabase } from '../server/db.js';
import { DEFAULT_SETTINGS } from '../server/rules.js';

test('首页提供隐私说明入口', () => {
  assert.match(homeMarkup(DEFAULT_SETTINGS), /href="\/privacy\.html"[^>]*>隐私说明<\/a>/);
});

test('隐私说明可直接访问并如实说明身份重置', async (t) => {
  const { server } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/privacy.html`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /不会删除旧身份或旧对局记录/);
  assert.match(html, /没有自助删除服务器记录/);
  assert.match(html, /href="\/"/);
});

test('版权声明保留独立词向量许可', async () => {
  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /All rights reserved/);
  assert.match(license, /CC BY-SA 3\.0/);
});
