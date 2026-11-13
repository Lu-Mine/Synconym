import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { qaMarkup, shellMarkup } from '../../public/render.js';
import { createSynconymServer } from '../../server/index.js';
import { createDatabase } from '../../server/db.js';

test('Q&A 使用站内路由，房间内从新标签打开', () => {
  const home = shellMarkup(false);
  const room = shellMarkup(true);
  assert.match(home, /href="\/\?qa" data-action="open-qa"/);
  assert.match(room, /href="\/\?qa" target="_blank" rel="noopener"/);
  assert.match(home, /icon-circle-help[\s\S]*?Q&amp;A/);
});

test('Q&A 逐条折叠，默认全部收起', () => {
  const html = qaMarkup();
  assert.equal((html.match(/<details class="qa-item" name="qa">/g) || []).length, 11);
  assert.doesNotMatch(html, /<details[^>]*\sopen[\s>]/);
  assert.match(html, /<summary><span class="qa-question">第一次来，怎么开一局？<\/span>/);
  assert.match(html, /<h1>常见问题<\/h1>/);
});

test('Q&A 保留返回上一页入口与反馈出口', () => {
  const html = qaMarkup();
  assert.equal((html.match(/class="button secondary privacy-back(?: privacy-back-bottom)?" href="\/" data-action="back"/g) || []).length, 2);
  assert.equal((html.match(/<span>返回<\/span>/g) || []).length, 2);
  assert.match(html, /href="https:\/\/github\.com\/Lu-Mine\/Synconym\/issues"/);
  assert.match(html, /去 GitHub 提 issue/);
});

test('Q&A 答案与现行规则一致', () => {
  const html = qaMarkup();
  for (const text of ['5 位房号', '5 秒投票', '1–12 个字', '4–20 轮', '90 秒', '每满 5 轮', '每页 10 局']) {
    assert.ok(html.includes(text), `缺少规则说明：${text}`);
  }
});

test('应用把 ?qa 当作站内页面，并兜底折叠互斥', async () => {
  const source = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /let qaOpen = new URLSearchParams\(location\.search\)\.has\('qa'\);/);
  assert.match(source, /return privacyOpen \? 'privacy' : qaOpen \? 'qa'/);
  assert.match(source, /if \(screen === 'qa'\) return qaMarkup\(\);/);
  assert.match(source, /history\.pushState\(\{ qa: true \}, '', `\$\{APP_ROOT\}\?qa`\);/);
  assert.match(source, /app\.addEventListener\('toggle', \(event\) => \{/);
});

test('Q&A 路由返回应用入口，样式随页面加载', async (t) => {
  const { server } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/?qa`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /src="\/app\.js"/);
  const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.qa-item > summary/);
  assert.match(css, /\.app:has\(\.qa-content\)\s*\{\s*--app-w/);
  // 列表最后一条自带下边框，末尾不再叠一条分割线；反馈出口整行居中
  assert.match(css, /\.qa-more\s*\{[^}]*justify-content: center/);
  assert.doesNotMatch(css, /\.qa-more\s*\{[^}]*border-top/);
  // 当前页不在顶栏和页脚重复出现自己的入口
  assert.match(css, /body\[data-scene="qa"\] a\[href="\/\?qa"\]/);
  assert.match(css, /body\[data-scene="privacy"\] a\[href="\/\?privacy"\]/);
});
