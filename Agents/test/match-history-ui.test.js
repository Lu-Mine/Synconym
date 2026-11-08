import test from 'node:test';
import assert from 'node:assert/strict';
import { historyQuery, historyHref, historyFilter, historySearchMarkup, parseHistoryTime } from '../../public/match-history.js';
import { matchDetailMarkup, profileMatchMarkup } from '../../public/render.js';

test('一段输入同时参与所有维度，不再先分类再排除', () => {
  for (const raw of ['123', 'a7k2', '牛油果', '火锅', '海洋']) {
    assert.deepEqual(historyFilter(historyQuery(`?me&q=${encodeURIComponent(raw)}`)), { type: 'any', value: raw }, raw);
  }
  assert.deepEqual(historyFilter(historyQuery('?me')), {});
  assert.deepEqual(historyFilter(historyQuery('?me&q=%20%20')), {});
});

test('能解析成日期时，时间作为额外维度一起匹配', () => {
  const dayStart = (year, month, day) => new Date(year, month - 1, day).getTime();
  for (const raw of ['2026-01-01', '2026/1/1', '2026.1.1', '20260101', '2026年1月1日']) {
    assert.deepEqual(parseHistoryTime(raw), { from: dayStart(2026, 1, 1), to: dayStart(2026, 1, 2), label: '2026/01/01', short: '01/01' }, raw);
  }
  for (const raw of ['2026-01', '2026/1', '202601', '2026年1月']) {
    assert.deepEqual(parseHistoryTime(raw), { from: dayStart(2026, 1, 1), to: dayStart(2026, 2, 1), label: '2026/01', short: '01' }, raw);
  }
  assert.deepEqual(parseHistoryTime('2026'), { from: dayStart(2026, 1, 1), to: dayStart(2027, 1, 1), label: '2026', short: '2026' });
  for (const raw of ['2026-01-01~2026-01-31', '2026/01/01 至 2026/01/31', '2026年1月1日到2026年1月31日']) {
    assert.deepEqual(parseHistoryTime(raw), { from: dayStart(2026, 1, 1), to: dayStart(2026, 2, 1), label: '2026/01/01–01/31', short: '01/01–01/31' }, raw);
  }
  // 区间写反时按时间正序处理
  assert.deepEqual(parseHistoryTime('2026-01-31~2026-01-01'), { from: dayStart(2026, 1, 1), to: dayStart(2026, 2, 1), label: '2026/01/01–01/31', short: '01/01–01/31' });
  // 跨年区间保留两端年份
  assert.deepEqual([parseHistoryTime('2026-12-01~2027-01-31').label, parseHistoryTime('2026-12-01~2027-01-31').short], ['2026/12/01–2027/01/31', '12/01–2027/01/31']);
  // 无年份按今年计算
  assert.equal(parseHistoryTime('1-1').from, dayStart(new Date().getFullYear(), 1, 1));
  for (const raw of ['2026-13-01', '2026-02-30', '海洋', '牛油果']) assert.equal(parseHistoryTime(raw), null, raw);

  const filter = historyFilter(historyQuery(historyHref({ raw: '2026-01-01~2026-01-02' })));
  assert.deepEqual(filter, { type: 'any', value: '2026-01-01~2026-01-02', from: dayStart(2026, 1, 1), to: dayStart(2026, 1, 3) });
});

test('搜索条件与页码写进地址，详情链接带回原条件', () => {
  const url = historyHref({ raw: '火锅', page: 3 }, 'match/1');
  assert.match(url, /^\?me=&q=/);
  const query = historyQuery(url);
  assert.equal(query.raw, '火锅');
  assert.equal(query.value, '火锅');
  assert.equal(query.page, 3);
  assert.equal(query.id, 'match/1');
  assert.deepEqual(historyFilter(query), { type: 'any', value: '火锅' });
  assert.equal(historyQuery(historyHref(query)).id, '');
});

test('搜索框只有一个输入，输入即搜，没有按钮也不占说明文字', () => {
  const markup = historySearchMarkup({ raw: '火锅' });
  assert.match(markup, /name="q" value="火锅"/);
  assert.doesNotMatch(markup, /history-search-type|name="type"|type="date"/);
  assert.doesNotMatch(markup, /<form|<button|history-clear|history-search-hint/);
  assert.doesNotMatch(markup, /history-search-time/);

  const timed = historySearchMarkup(historyQuery(`?me&q=${encodeURIComponent('2026-01')}`));
  assert.match(timed, /class="history-search-box has-time"/);
  assert.match(timed, /<span class="history-search-time" id="history-search-time" title="按 2026\/01 匹配">按 2026\/01 匹配<\/span>/);
});

test('命中项只高亮真正搜到的那几处', () => {
  const base = { id: 'm1', roomCode: '12345', startedAt: Date.now() - 86400000, outcome: 'none', totalRounds: 12, convergedRound: null };
  const query = (raw) => historyQuery(`?me&q=${encodeURIComponent(raw)}`);

  const text = profileMatchMarkup({ ...base, players: ['总有新点子的牛油果', '橙子'], themeName: '海洋', hits: { names: [{ name: '总有新点子的牛油果', whole: false }] } }, query('牛油果'));
  assert.match(text, /总有新点子的<mark class="history-hit">牛油果<\/mark>、橙子/);
  assert.doesNotMatch(text, /history-hit">海洋/);
  assert.doesNotMatch(text, /history-hit">房号/);
  assert.doesNotMatch(text, /profile-match-date[^>]*><mark/);

  // UID 命中时整段高亮那个人的人名
  const uid = profileMatchMarkup({ ...base, players: ['甲', '乙'], hits: { names: [{ name: '甲', whole: true }] } }, query('a7k2'));
  assert.match(uid, /class="profile-match-names"><mark class="history-hit">甲<\/mark>、乙<\/span>/);

  const room = profileMatchMarkup({ ...base, players: ['甲'], hits: { room: true } }, query('12345'));
  assert.match(room, /<span><mark class="history-hit">房号 12345<\/mark><\/span>/);

  const theme = profileMatchMarkup({ ...base, players: ['甲'], themeName: '火锅', hits: { names: [], theme: true } }, query('火'));
  assert.match(theme, /class="profile-match-theme">[^]*?<mark class="history-hit">火<\/mark>锅/);

  const time = profileMatchMarkup({ ...base, players: ['甲'], hits: { time: true } }, query('2026-01-01'));
  assert.match(time, /<time class="profile-match-date" datetime="[^"]*"><mark class="history-hit">[^<]+<\/mark><\/time>/);

  // 一条记录可以同时命中多个维度
  const both = profileMatchMarkup({ ...base, players: ['甲'], themeName: '火锅', hits: { room: true, theme: true } }, query('火'));
  assert.match(both, /<span><mark class="history-hit">房号 12345<\/mark><\/span>/);
  assert.match(both, /<mark class="history-hit">火<\/mark>锅/);
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
  assert.match(row, /<a class="profile-match-link" href="[^"]*match=m1/);
});
