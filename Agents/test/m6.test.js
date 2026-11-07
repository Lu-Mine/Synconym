import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';
import { isValidUid } from '../../server/rules.js';

const themes = JSON.parse(readFileSync(new URL('../../data/themes.json', import.meta.url), 'utf8'));
const lastProfile = (c) => c.messages.filter((m) => m.type === 'profile').at(-1).profile;

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
  const send = (c, msg) => { t.mock.timers.tick(501); manager.handle(c, msg); };
  return { manager, db, client, send };
}

function saveMatch(db, uid, index, { theme = false } = {}) {
  db.saveMatch({
    id: `match-${index}`, roomCode: '12345',
    mode: theme ? 'theme' : 'free', themeId: theme ? themes[0].id : null,
    maxRounds: 12, totalRounds: 6 + index, convergedRound: index % 3 === 0 ? null : 3,
    outcome: ['exact', 'voted', 'none'][index % 3],
    startedAt: 1000 + index * 1000, endedAt: 1500 + index * 1000,
    players: [{ uid, seat: 0, name: '甲' }, { uid: 'PARTNER', seat: 1, name: '乙' }],
    rounds: []
  });
}

test('档案返回同一 uid 的身份、加入时间与倒序改名历史', (t) => {
  const { manager, client, send } = setup(t);
  const a = client();
  const createdAt = Date.now();
  send(a, { type: 'rename', name: '甲' });
  send(a, { type: 'rename', name: '乙' });
  send(a, { type: 'openProfile', page: 1 });

  const profile = lastProfile(a);
  assert.equal(profile.user.uid, a.uid);
  assert.equal(profile.user.name, '乙');
  assert.equal(profile.user.createdAt, createdAt);
  assert.deepEqual(profile.nameHistory.map((item) => item.name).slice(0, 2), ['乙', '甲']);
  assert.equal(profile.nameHistory.length, 3);
  assert.match(profile.nameHistory[2].name, /的/);
  assert.deepEqual(profile.matches, []);
  assert.equal(profile.total, 0);
  assert.equal(manager.db.getPlayer(a.uid).name, '乙');
});

test('对局记录每页十条、按时间倒序并可翻到最后一页', (t) => {
  const { manager, db, client, send } = setup(t);
  const a = client();
  for (let index = 0; index < 12; index += 1) saveMatch(db, a.uid, index, { theme: index === 11 });

  send(a, { type: 'openProfile', page: 1 });
  const first = lastProfile(a);
  assert.equal(first.total, 12);
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 10);
  assert.equal(first.matches.length, 10);
  assert.equal(first.matches[0].id, 'match-11');
  assert.equal(first.matches[0].themeName, themes[0].name);
  assert.equal(first.matches[1].themeName, null);
  assert.deepEqual(first.matches[1].players, ['甲', '乙']);

  send(a, { type: 'openProfile', page: 2 });
  const second = lastProfile(a);
  assert.equal(second.page, 2);
  assert.deepEqual(second.matches.map((match) => match.id), ['match-1', 'match-0']);

  send(a, { type: 'openProfile', page: 99 });
  assert.equal(lastProfile(a).page, 2);
  send(a, { type: 'openProfile', page: 0 });
  assert.equal(lastProfile(a).page, 1);
  assert.equal(manager.db.countMatchesFor(a.uid), 12);
});

test('档案只回给请求者，不影响房间活动与广播', (t) => {
  const { manager, client, send } = setup(t);
  const [a, b] = [client(), client()];
  send(a, { type: 'createRoom' });
  const room = manager.roomFor(a);
  send(b, { type: 'joinRoom', code: room.code });
  const activeAt = room.lastActiveAt;
  b.messages = [];

  send(a, { type: 'openProfile' });
  assert.equal(lastProfile(a).user.uid, a.uid);
  assert.equal(b.messages.filter((m) => m.type === 'profile').length, 0);
  assert.equal(room.lastActiveAt, activeAt);
  assert.equal(lastProfile(a).matches.length, 0);
});

test('房间内改名即时同步给其他玩家，uid 与历史不变', (t) => {
  const { manager, client, send } = setup(t);
  const [a, b] = [client(), client()];
  send(a, { type: 'createRoom' });
  const room = manager.roomFor(a);
  send(b, { type: 'joinRoom', code: room.code });
  send(b, { type: 'rename', name: '新名字' });

  const snapshot = b.messages.filter((m) => m.type === 'state').at(-1).room;
  assert.equal(snapshot.players.find((player) => player.uid === b.uid).name, '新名字');
  assert.equal(manager.db.getPlayer(b.uid).name, '新名字');
  assert.equal(manager.db.getNameHistory(b.uid)[0].name, '新名字');
  assert.equal(manager.db.getNameHistory(b.uid).length, 2);
});

test('我是新人换新 uid，旧身份与旧对局留在库里', (t) => {
  const { manager, db, client, send } = setup(t);
  const a = client();
  const previous = a.uid;
  const name = db.getPlayer(previous).name;
  saveMatch(db, previous, 1);
  send(a, { type: 'resetIdentity' });

  const identity = a.messages.find((message) => message.type === 'identity');
  assert.ok(isValidUid(identity.uid));
  assert.notEqual(identity.uid, previous);
  assert.equal(a.uid, identity.uid);
  assert.equal(manager.clients.get(identity.uid), a);
  assert.equal(manager.clients.has(previous), false);
  assert.equal(db.getPlayer(previous).name, name);
  assert.equal(db.countMatchesFor(previous), 1);
  assert.equal(db.countMatchesFor(identity.uid), 0);
  assert.equal(a.messages.filter((message) => message.type === 'state').at(-1).room, null);

  send(a, { type: 'openProfile' });
  assert.equal(lastProfile(a).total, 0);
  assert.equal(lastProfile(a).user.name, identity.name);
});

test('房间内重置身份按主动退出处理并提示其他玩家', (t) => {
  const { manager, client, send } = setup(t);
  const [a, b] = [client(), client()];
  send(a, { type: 'createRoom' });
  const room = manager.roomFor(a);
  send(b, { type: 'joinRoom', code: room.code });
  b.messages = [];

  send(a, { type: 'resetIdentity' });
  assert.equal(room.players.some((player) => player.uid === a.uid), false);
  assert.equal(room.hostUid, b.uid);
  assert.equal(b.messages.some((message) => message.type === 'toast' && message.event === 'leave'), true);
  assert.equal(manager.clients.get(a.uid), a);
});
