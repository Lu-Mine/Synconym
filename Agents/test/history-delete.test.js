import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const db = createDatabase(':memory:');
  const manager = new RoomManager({ db });
  t.after(() => { manager.close(); db.close(); });
  const client = () => {
    const c = manager.connect(); c.messages = [];
    c.ws = { readyState: 1, send: (data) => c.messages.push(JSON.parse(data)) };
    return c;
  };
  const lastProfile = (c) => c.messages.filter((m) => m.type === 'profile').at(-1).profile;
  return { manager, db, client, lastProfile };
}

function saveMatch(db, id, uid, partner, index = 0) {
  db.saveMatch({
    id, roomCode: '12345', mode: 'free', themeId: null,
    maxRounds: 12, totalRounds: 3 + index, convergedRound: 2, outcome: 'exact',
    startedAt: 1000 + index * 1000, endedAt: 1500 + index * 1000,
    players: [{ uid, seat: 0, name: '甲' }, { uid: partner, seat: 1, name: '乙' }],
    rounds: [{ n: 1, words: { [uid]: '海', [partner]: '天' }, marks: { [uid]: 'none', [partner]: 'none' }, outcome: 'miss' }]
  });
}

test('移除一条记录只影响自己，同一局在别人档案里照旧', (t) => {
  const { manager, db, client, lastProfile } = setup(t);
  const a = client();
  const b = manager.connect(); b.messages = [];
  b.ws = { readyState: 1, send: (data) => b.messages.push(JSON.parse(data)) };
  saveMatch(db, 'm1', a.uid, b.uid, 0);
  saveMatch(db, 'm2', a.uid, b.uid, 1);

  manager.handle(a, { type: 'deleteMatch', id: 'm1' });
  const profile = lastProfile(a);
  assert.equal(profile.total, 1);
  assert.deepEqual(profile.matches.map((match) => match.id), ['m2']);
  assert.equal(profile.removed, 1);

  manager.handle(b, { type: 'openProfile' });
  const other = lastProfile(b);
  assert.equal(other.total, 2);
  assert.deepEqual(other.matches.map((match) => match.id).sort(), ['m1', 'm2']);
});

test('移除后直达详情也拿不到，恢复后又能看到', (t) => {
  const { manager, db, client, lastProfile } = setup(t);
  const a = client();
  saveMatch(db, 'm1', a.uid, 'PARTNER', 0);

  manager.handle(a, { type: 'deleteMatch', id: 'm1' });
  manager.handle(a, { type: 'openMatch', id: 'm1' });
  const hidden = a.messages.filter((m) => m.type === 'matchDetail').at(-1);
  assert.equal(hidden.match, null);
  assert.match(hidden.error, /不存在或无权查看/);

  manager.handle(a, { type: 'restoreMatch', id: 'm1' });
  assert.equal(lastProfile(a).total, 1);
  manager.handle(a, { type: 'openMatch', id: 'm1' });
  assert.equal(a.messages.filter((m) => m.type === 'matchDetail').at(-1).match.id, 'm1');
});

test('清空记录把全部对局移到已移除，另一身份不受影响', (t) => {
  const { manager, db, client, lastProfile } = setup(t);
  const a = client();
  const b = client();
  for (let index = 0; index < 3; index += 1) saveMatch(db, `a-${index}`, a.uid, 'PARTNER', index);
  saveMatch(db, 'b-0', b.uid, 'PARTNER', 9);

  manager.handle(a, { type: 'clearHistory' });
  const profile = lastProfile(a);
  assert.equal(profile.total, 0);
  assert.equal(profile.removed, 3);
  assert.match(a.messages.filter((m) => m.type === 'toast').at(-1).message, /已移除 3 局/);

  manager.handle(b, { type: 'openProfile' });
  assert.equal(lastProfile(b).total, 1);
});

test('已移除的记录可以分页取回，恢复后从列表消失', (t) => {
  const { manager, db, client } = setup(t);
  const a = client();
  for (let index = 0; index < 13; index += 1) saveMatch(db, `m-${index}`, a.uid, 'PARTNER', index);
  manager.handle(a, { type: 'clearHistory' });

  manager.handle(a, { type: 'openRemoved', page: 1 });
  const first = a.messages.filter((m) => m.type === 'removedMatches').at(-1).removed;
  assert.equal(first.total, 13);
  assert.equal(first.matches.length, 10);
  assert.equal(first.page, 1);

  const target = first.matches[0].id;
  manager.handle(a, { type: 'restoreMatch', id: target });
  manager.handle(a, { type: 'openRemoved', page: 1 });
  const second = a.messages.filter((m) => m.type === 'removedMatches').at(-1).removed;
  assert.equal(second.total, 12);
  assert.ok(!second.matches.some((match) => match.id === target));
});

test('移除不存在的对局会被拒绝', (t) => {
  const { manager, client } = setup(t);
  const a = client();
  assert.throws(() => manager.handle(a, { type: 'deleteMatch', id: 'missing' }), /不存在或无权操作/);
  assert.throws(() => manager.handle(a, { type: 'deleteMatch', id: '' }), /不存在或无权操作/);
});
