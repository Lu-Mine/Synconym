import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDatabase } from '../../server/db.js';
import { RoomManager } from '../../server/rooms.js';
import { buildChart } from '../../server/similarity.js';

const A = 'AAAAAAAA', B = 'BBBBBBBB', C = 'CCCCCCCC';
const theme = JSON.parse(readFileSync(new URL('../../data/themes.json', import.meta.url), 'utf8'))[0];
function fixture(t, sqlite) {
  const manager = sqlite ? new RoomManager({ db: createDatabase(':memory:') }) : new RoomManager();
  const db = manager.db;
  t.after(() => { manager.close(); db.close(); });
  for (const uid of [A, B, C]) db.createPlayer(uid, uid);
  const save = (id, startedAt, roomCode, uids) => db.saveMatch({
    id, startedAt, endedAt: startedAt + 100, roomCode, mode: 'theme', themeId: theme.id,
    maxRounds: 8, totalRounds: 2, convergedRound: 2, outcome: 'voted',
    players: uids.map((uid, seat) => ({ uid, seat, name: `旧名${uid}` })),
    rounds: [
      { n: 1, words: Object.fromEntries(uids.map((uid) => [uid, ' Ａ臺灣 '])),
        marks: Object.fromEntries(uids.map((uid, i) => [uid, i ? 'invalid' : 'none'])), outcome: 'miss',
        voteChoices: { [uids[0]]: 'yes', [uids[1]]: 'timeout' }, breakVote: { passed: false, choices: { [uids[0]]: 'no', [uids[1]]: 'timeout' } } },
      { n: 2, words: Object.fromEntries(uids.map((uid) => [uid, '苹果'])),
        marks: Object.fromEntries(uids.map((uid) => [uid, 'none'])),
        votes: Object.fromEntries(uids.map((uid) => [uid, true])), outcome: 'voted' }
    ]
  });
  for (let i = 0; i < 12; i++) save(`match-${String(i).padStart(2, '0')}`, 1000 + i, '12345', [A, B]);
  save('other-room', 2000, '54321', [A, C]);
  save('private', 3000, '12345', [B, C]);
  save('tie-a', 4000, '54321', [A, C]);
  save('tie-z', 4000, '54321', [A, C]);
  const messages = [];
  const connection = { uid: A, lastWrite: Date.now(), ws: { readyState: 1, send: (s) => messages.push(JSON.parse(s)) } };
  return { manager, db, connection, messages };
}

for (const sqlite of [true, false]) {
  test(`${sqlite ? 'SQLite' : 'memory'}: 投票明细与崩局记录可往返`, (t) => {
    const { db } = fixture(t, sqlite);
    const first = db.getMatch('match-00').rounds[0];
    assert.deepEqual(first.voteChoices, { [A]: 'yes', [B]: 'timeout' });
    assert.deepEqual(first.breakVote, { passed: false, choices: { [A]: 'no', [B]: 'timeout' } });
  });
}

for (const sqlite of [true, false]) {
  const label = sqlite ? 'SQLite' : 'memory';
  test(`${label}: 所有维度一起匹配，房号与 UID 按前缀，时间按半开区间`, (t) => {
    const { manager, db, connection, messages } = fixture(t, sqlite);
    const cases = [
      [undefined, 15], [null, 15], [{}, 15], [{ type: 'any', value: '   ' }, 15],
      // 房号前缀
      [{ type: 'any', value: '12345' }, 12], [{ type: 'any', value: '123' }, 12],
      [{ type: 'any', value: '1' }, 12], [{ type: 'any', value: '5' }, 3],
      [{ type: 'any', value: '99999' }, 0], [{ type: 'any', value: '01234' }, 0],
      // 参与者 UID 前缀
      [{ type: 'any', value: ' bbbbbbbb ' }, 12], [{ type: 'any', value: A }, 15],
      [{ type: 'any', value: 'BBBB' }, 12], [{ type: 'any', value: 'b' }, 12],
      [{ type: 'any', value: C }, 3], [{ type: 'any', value: 'DDDDDDDD' }, 0],
      // 名字与主题按包含，和上面的维度是并集
      [{ type: 'any', value: '旧名bbb' }, 12], [{ type: 'any', value: '王者' }, 15],
      [{ type: 'any', value: '火锅' }, 0],
      // 时间也在同一组 OR 里，可以和文字同时命中
      [{ type: 'any', value: '', from: 1000, to: 1011 }, 11],
      [{ type: 'any', value: '', from: 1011, to: 2000 }, 1],
      [{ type: 'any', value: '', to: 1000 }, 0], [{ type: 'any', value: '', from: 2000 }, 3],
      [{ type: 'any', value: '54321', from: 1000, to: 1011 }, 14],
      [{ type: 'any', value: '12345', from: 4000, to: 5000 }, 14]
    ];
    for (const [filter, count] of cases) {
      assert.equal(db.countMatchesFor(A, filter), count, JSON.stringify(filter));
      const rows = db.listMatchesFor(A, { filter, limit: 100 });
      assert.equal(rows.length, count);
      assert.ok(rows.every((row) => row.players.some((p) => p.uid === A)));
      assert.deepEqual(db.listMatchesFor(A, { filter, offset: 1, limit: 2 }), rows.slice(1, 3));
    }
    assert.deepEqual(db.listMatchesFor(A, { limit: 2 }).map((row) => row.id), ['tie-z', 'tie-a']);
    manager.handle(connection, { type: 'openProfile', page: 99, filter: { type: 'any', value: ' bbbbbbbb ' } });
    const { profile } = messages.at(-1);
    assert.deepEqual(profile.filter, { type: 'any', value: 'bbbbbbbb', themeIds: [] });
    assert.equal(profile.total, 12);
    assert.equal(profile.page, 2);
    assert.equal(profile.pageSize, 10);
    assert.deepEqual(profile.matches.map((row) => row.id), ['match-01', 'match-00']);
    assert.equal(manager.profileFor(A, 1, { type: 'any', value: '12345' }).matches.length, 10);
    assert.equal(manager.profileFor(A).filter, null);
    const empty = manager.profileFor(A, 99, { type: 'any', value: '99999' });
    assert.equal(empty.page, 1); assert.equal(empty.total, 0); assert.deepEqual(empty.matches, []);
  });

  test(`${label}: 命中索引标出真正搜到的维度，供条目标高亮`, (t) => {
    const { manager, db } = fixture(t, sqlite);
    // 名字里不含 UID 时，UID 前缀命中应整段高亮那个人的人名
    db.saveMatch({
      id: 'nick', startedAt: 9000, endedAt: 9100, roomCode: '88888', mode: 'free', themeId: null,
      maxRounds: 8, totalRounds: 1, convergedRound: 1, outcome: 'voted',
      players: [{ uid: A, seat: 0, name: '甲' }, { uid: B, seat: 1, name: '认真思考的橙子' }],
      rounds: [{ n: 1, words: { [A]: '苹果', [B]: '苹果' }, marks: {}, votes: { [A]: true, [B]: true }, outcome: 'voted' }]
    });
    const hitsOf = (filter, id) => manager.profileFor(A, 1, filter).matches.find((match) => match.id === id).hits;
    assert.deepEqual(hitsOf({ type: 'any', value: 'bbbb' }, 'nick'), { room: false, theme: false, time: false, names: [{ name: '认真思考的橙子', whole: true }] });
    assert.deepEqual(hitsOf({ type: 'any', value: '旧名ccc' }, 'tie-z'), { room: false, theme: false, time: false, names: [{ name: '旧名CCCCCCCC', whole: false }] });
    assert.deepEqual(hitsOf({ type: 'any', value: '王者' }, 'tie-z'), { room: false, theme: true, time: false, names: [] });
    assert.deepEqual(hitsOf({ type: 'any', value: '54321' }, 'tie-z'), { room: true, theme: false, time: false, names: [] });
    assert.deepEqual(hitsOf({ type: 'any', value: '', from: 2000 }, 'tie-z'), { room: false, theme: false, time: true, names: [] });
    // 一段输入可以同时在多个维度命中
    assert.deepEqual(hitsOf({ type: 'any', value: '54321', from: 1000, to: 5000 }, 'tie-z'),
      { room: true, theme: false, time: true, names: [] });
  });

  test(`${label}: malformed filters never fall back to unfiltered history`, (t) => {
    const { manager, db } = fixture(t, sqlite);
    const bad = [false, '', [], 1, { type: 'unknown' },
      { type: 'room', value: '123' }, { type: 'uid', value: 'B' }, { type: 'text', value: 'x' },
      { type: 'any' }, { type: 'any', value: 123 }, { type: 'any', value: 'x'.repeat(33) },
      { type: 'any', value: 'a', from: 2, to: 1 }, { type: 'any', value: 'a', from: 1, to: 1 }];
    for (const value of [null, '1000', NaN, Infinity, -Infinity, -1, 0.5, 8640000000000001, {}, []]) {
      bad.push({ type: 'any', value: 'a', from: value }, { type: 'any', value: 'a', to: value });
    }
    for (const filter of bad) {
      assert.throws(() => db.countMatchesFor(A, filter), /无效/);
      assert.throws(() => db.listMatchesFor(A, { filter }), /无效/);
      assert.throws(() => manager.profileFor(A, 1, filter), /无效/);
    }
  });

  test(`${label}: participant-only detail restores full records, normalized history and chart`, (t) => {
    const { manager, db, connection, messages } = fixture(t, sqlite);
    const original = db.getMatch('match-00');
    db.rename(B, '新名');
    manager.handle(connection, { type: 'openMatch', id: 'match-00' });
    const response = messages.at(-1);
    assert.equal(response.type, 'matchDetail'); assert.equal(response.id, original.id);
    const { history, chart, themeName, ...stored } = response.match;
    assert.deepEqual(stored, original);
    assert.equal(themeName, theme.name);
    assert.deepEqual(chart, buildChart(original.players, original.rounds));
    assert.equal(chart[0].similarity, null); assert.equal(chart[1].similarity, 1);
    assert.deepEqual(history.map(({ wordKeys, ...round }) => round), original.rounds);
    assert.deepEqual(history[0].wordKeys, { [A]: 'a台湾' });
    assert.deepEqual(db.getMatch(original.id), original);
    for (const id of ['private', 'missing', '', {}, 123, null, 'x'.repeat(129)]) {
      manager.handle(connection, { type: 'openMatch', id });
      assert.deepEqual(messages.at(-1), { type: 'matchDetail', id, match: null, error: '对局不存在或无权查看' });
    }
    manager.handle(connection, { type: 'openMatch' });
    assert.deepEqual(messages.at(-1), { type: 'matchDetail', id: null, match: null, error: '对局不存在或无权查看' });
  });
}
