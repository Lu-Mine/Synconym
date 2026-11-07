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
        marks: Object.fromEntries(uids.map((uid, i) => [uid, i ? 'invalid' : 'none'])), outcome: 'miss' },
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
  const label = sqlite ? 'SQLite' : 'memory';
  test(`${label}: shared filters, exact membership, time boundaries and stable pagination`, (t) => {
    const { manager, db, connection, messages } = fixture(t, sqlite);
    const cases = [
      [undefined, 15], [null, 15], [{}, 15], [{ type: 'room', value: ' ' }, 15],
      [{ type: 'room', value: '12345' }, 12], [{ type: 'room', value: '99999' }, 0],
      [{ type: 'uid', value: ' bbbbbbbb ' }, 12], [{ type: 'uid', value: A }, 15],
      [{ type: 'uid', value: C }, 3], [{ type: 'uid', value: 'DDDDDDDD' }, 0],
      [{ type: 'time', from: 1000, to: 1011 }, 11],
      [{ type: 'time', from: 1011, to: 2000 }, 1],
      [{ type: 'time', to: 1000 }, 0], [{ type: 'time', from: 2000 }, 3]
    ];
    for (const [filter, count] of cases) {
      assert.equal(db.countMatchesFor(A, filter), count);
      const rows = db.listMatchesFor(A, { filter, limit: 100 });
      assert.equal(rows.length, count);
      assert.ok(rows.every((row) => row.players.some((p) => p.uid === A)));
      assert.deepEqual(db.listMatchesFor(A, { filter, offset: 1, limit: 2 }), rows.slice(1, 3));
    }
    assert.deepEqual(db.listMatchesFor(A, { limit: 2 }).map((row) => row.id), ['tie-z', 'tie-a']);
    manager.handle(connection, { type: 'openProfile', page: 99, filter: { type: 'uid', value: ' bbbbbbbb ' } });
    const { profile } = messages.at(-1);
    assert.deepEqual(profile.filter, { type: 'uid', value: B });
    assert.equal(profile.total, 12);
    assert.equal(profile.page, 2);
    assert.equal(profile.pageSize, 10);
    assert.deepEqual(profile.matches.map((row) => row.id), ['match-01', 'match-00']);
    assert.equal(manager.profileFor(A, 1, { type: 'room', value: '12345' }).matches.length, 10);
    assert.equal(manager.profileFor(A).filter, null);
    const empty = manager.profileFor(A, 99, { type: 'room', value: '99999' });
    assert.equal(empty.page, 1); assert.equal(empty.total, 0); assert.deepEqual(empty.matches, []);
  });

  test(`${label}: malformed filters never fall back to unfiltered history`, (t) => {
    const { manager, db } = fixture(t, sqlite);
    const bad = [false, '', [], 1, { type: 'unknown' },
      { type: 'room', value: '1234' }, { type: 'room', value: '01234' }, { type: 'room', value: 12345 },
      { type: 'uid', value: 'BBBB' }, { type: 'uid', value: "' OR 1=1" },
      { type: 'time' }, { type: 'time', from: 2, to: 1 }, { type: 'time', from: 1, to: 1 }];
    for (const value of [null, '1000', NaN, Infinity, -Infinity, -1, 0.5, 8640000000000001, {}, []]) {
      bad.push({ type: 'time', from: value }, { type: 'time', to: value });
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
