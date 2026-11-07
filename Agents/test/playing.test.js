import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSynconymServer } from '../../server/index.js';
import { createDatabase } from '../../server/db.js';
import { playingText, refreshPlayingCount } from '../../public/playing.js';
import { homeMarkup } from '../../public/render.js';

test('只统计进行中对局里在线的不同玩家', async (t) => {
  const { server, manager } = createSynconymServer({ db: createDatabase(':memory:') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { manager.rooms.clear(); server.close(); });
  manager.rooms.set('1', { phase: 'writing', players: [{ uid: 'a', connected: true }, { uid: 'b', connected: false }] });
  manager.rooms.set('2', { phase: 'voting', players: [{ uid: 'a', connected: true }, { uid: 'c', connected: true }] });
  manager.rooms.set('3', { phase: 'lobby', players: [{ uid: 'd', connected: true }] });
  manager.rooms.set('4', { phase: 'result', players: [{ uid: 'e', connected: true }] });
  const url = `http://127.0.0.1:${server.address().port}/api/playing`;
  const response = await fetch(url);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { playing: 2 });
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});

test('人数文案与不可用时的回退', async () => {
  assert.equal(playingText(0), '邀请朋友，一起开始吧');
  assert.equal(playingText(1), '邀请朋友，一起开始吧');
  assert.equal(playingText(1234), '此刻 1,234 人正在游戏');
  assert.equal(playingText(-1), '');
  assert.match(homeMarkup({}), /id="playing-count" hidden/);
  for (const open of [false, true]) {
    assert.match(homeMarkup({}, open), /<button class="button primary create-submit"[^>]*>[\s\S]*id="playing-count" hidden[\s\S]*<\/button>/);
  }
  const element = { hidden: true, textContent: '' };
  await refreshPlayingCount(element, async () => ({ ok: true, json: async () => ({ playing: 2 }) }));
  assert.equal(element.textContent, '此刻 2 人正在游戏');
  assert.equal(element.hidden, false);
  await refreshPlayingCount(element, async () => { throw new Error('offline'); });
  assert.equal(element.hidden, true);
  assert.equal(element.textContent, '');
});
