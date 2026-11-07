import test from 'node:test';
import assert from 'node:assert/strict';
import { historyQuery, historyHref, historyFilter, historyInputs } from '../../public/match-history.js';
import { matchDetailMarkup, profileMatchMarkup } from '../../public/render.js';

test('搜索和详情地址保留条件、页码，返回链接移除详情ID', () => {
  const query = { type: 'uid', value: 'ABCDEFGH', page: 3 };
  const url = historyHref(query, 'match/1');
  assert.deepEqual(historyQuery(url), { ...query, from: '', to: '', id: 'match/1' });
  assert.equal(historyQuery(historyHref(historyQuery(url))).id, '');
  assert.deepEqual(historyFilter(historyQuery(url)), { type: 'uid', value: 'ABCDEFGH' });
});

test('日期范围使用本地时间，包含结束日期完整一天', () => {
  const filter = historyFilter({ type: 'time', from: '2026-01-01', to: '2026-01-02' });
  assert.equal(filter.from, new Date(2026, 0, 1).getTime());
  assert.equal(filter.to, new Date(2026, 0, 3).getTime());
  assert.deepEqual(historyFilter({ type: 'room', value: '' }), {});
  assert.match(historyInputs({ type: 'time' }), /type="date"/);
  assert.match(historyInputs({ type: 'uid' }), /maxlength="8"/);
});

test('详情展示历史信息、不展示实时房间操作，处理加载与无权限', () => {
  assert.match(matchDetailMarkup(null), /正在读取对局/);
  assert.match(matchDetailMarkup({ error: '对局不存在或无权查看' }), /无权查看/);
  const players = [{ uid: 'ABCDEFGH', name: '<甲>', seat: 0 }, { uid: 'BCDEFGHJ', name: '乙', seat: 1 }];
  const rounds = [{ n: 1, words: { ABCDEFGH: '苹果', BCDEFGHJ: '香蕉' }, marks: {}, outcome: 'voted', votes: { ABCDEFGH: true, BCDEFGHJ: true } }];
  const html = matchDetailMarkup({ match: { roomCode: '12345', players, rounds, chart: [], outcome: 'voted', convergedRound: 1, totalRounds: 1, maxRounds: 12, startedAt: 1, endedAt: 1000 } });
  for (const text of ['第 1 轮投票相遇', '完整词路径', '收敛曲线', '逐轮投票记录', 'ABCDEFGH', '&lt;甲&gt;', '苹果', '同意']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /data-action="(?:leave|rematch-yes|rematch-room)"/);
  assert.doesNotMatch(html, /<甲>/);
  const row = profileMatchMarkup({ id: 'm1', players: ['甲'], roomCode: '12345', startedAt: 1, outcome: 'none', totalRounds: 12 });
  assert.match(row, /<a class="profile-match-link" href="[^\"]*match=m1/);
});
