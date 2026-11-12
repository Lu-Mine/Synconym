import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { homeMarkup, shellMarkup, privacyMarkup } from '../../public/render.js';
import { createSynconymServer } from '../../server/index.js';
import { createDatabase } from '../../server/db.js';
import { DEFAULT_SETTINGS } from '../../server/rules.js';

test('隐私政策使用站内路由，房间内从新标签打开', () => {
  const home = shellMarkup(false);
  const room = shellMarkup(true);
  assert.match(home, /href="\/\?privacy" data-action="open-privacy"/);
  assert.match(room, /href="\/\?privacy" target="_blank" rel="noopener"/);
  assert.match(home, /icon-shield-check[\s\S]*隐私政策/);
  assert.doesNotMatch(homeMarkup(DEFAULT_SETTINGS), /隐私政策/);
});

test('隐私说明保留原文、目录及返回入口', () => {
  const html = privacyMarkup();
  assert.match(html, /不会删除旧身份或旧对局记录/);
  assert.match(html, /没有自助删除服务器记录/);
  assert.equal((html.match(/class="button secondary privacy-back(?: privacy-back-bottom)?" href="\/" data-action="home"/g) || []).length, 2);
  assert.match(html, /<nav class="privacy-nav" aria-label="隐私说明目录">/);
  for (const id of ['identity', 'records', 'deletion', 'hosting']) {
    assert.match(html, new RegExp(`href="#${id}"`));
    assert.match(html, new RegExp(`<section id="${id}">`));
  }
});

test('章节目录平滑滚动，并遵守减少动态效果设置', async () => {
  const source = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  const handler = source.match(/  const privacySection = event\.target\.closest\('\.privacy-nav a'\);[\s\S]*?\n  }/)[0];
  for (const reduced of [false, true]) {
    let options;
    let prevented = false;
    const context = {
      event: { target: { closest: () => ({ hash: '#records' }) }, button: 0, preventDefault: () => { prevented = true; } },
      window: { matchMedia: () => ({ matches: reduced }) },
      document: { getElementById: (id) => { assert.equal(id, 'records'); return { scrollIntoView: (value) => { options = value; } }; } }
    };
    runInNewContext(`(function () {${handler}\n})()`, context);
    assert.equal(prevented, true);
    assert.equal(options.behavior, reduced ? 'instant' : 'smooth');
    assert.equal(options.block, 'start');
  }
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.privacy-in-app\s*\{[^}]*margin-top:\s*clamp\(28px, 5vw, 36px\)/);
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

test('许可声明：代码 AGPL-3.0', async () => {
  const license = await readFile(new URL('../../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 19 November 2007/);
  assert.doesNotMatch(license, /All rights reserved/);
  const notice = await readFile(new URL('../../NOTICE.md', import.meta.url), 'utf8');
  assert.match(notice, /AGPL-3\.0-only/);
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.license, 'AGPL-3.0-only');
});
