import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';
import { similarity, buildChart } from '../../server/similarity.js';

function setup(t, count = 2, db) {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db });
  t.after(() => { manager.close(); db?.close(); });
  const connect = (uid) => {
    const c = manager.connect(uid); c.messages = [];
    c.ws = { readyState: 1, send: (s) => c.messages.push(JSON.parse(s)), close() {} };
    return c;
  };
  const send = (c, message) => { t.mock.timers.tick(501); manager.handle(c, message); };
  const clients = Array.from({ length: count }, () => connect());
  const [a] = clients;
  send(a, { type: 'createRoom' });
  const room = manager.roomFor(a);
  for (const c of clients.slice(1)) {
    send(c, { type: 'joinRoom', code: room.code });
    send(c, { type: 'setReady', ready: true });
  }
  send(a, { type: 'start' });
  const exact = () => { for (const c of clients) send(c, { type: 'submitWord', word: '苹果' }); };
  return { manager, room, clients, send, connect, exact };
}
const snapshot = (c) => c.messages.filter((m) => m.type === 'state').at(-1).room;
// 6 字纯汉字串：高频词只取 1–4 字，必收词清单里也没有，保证不在词表里
const UNKNOWN = '未收录的词语';

test('similarity: normalized exact, word-vector ordering and unknown', () => {
  assert.equal(similarity(' Ａ臺灣 ', 'a台湾'), 1);
  const fruit = similarity('苹果', '香蕉'), food = similarity('苹果', '白菜'), other = similarity('苹果', '猫');
  assert.ok(fruit > food && food > other, `${fruit} > ${food} > ${other}`);
  for (const score of [fruit, food, other]) assert.ok(score >= 0 && score < 1);
  assert.equal(similarity(UNKNOWN, '苹果'), null);
  assert.equal(similarity('', ''), null);
});

test('pairwise 2–4 players: complete mean only, invalid/unknown null, voted never fabricates pair semantics', () => {
  const players = ['a', 'b', 'c', 'd'].map((uid) => ({ uid }));
  const record = { n: 1, words: { a: '苹果', b: '香蕉', c: '白菜', d: '猫' },
    marks: { a: 'none', b: 'none', c: 'none', d: 'none' }, outcome: 'miss' };
  for (const count of [2, 3, 4]) {
    const chart = buildChart(players.slice(0, count), [record])[0];
    assert.equal(chart.pairs.length, count * (count - 1) / 2);
    assert.equal(chart.similarity, chart.pairs.reduce((n, p) => n + p.similarity, 0) / chart.pairs.length);
  }
  record.words.c = UNKNOWN;
  assert.equal(buildChart(players, [record])[0].similarity, null);
  record.outcome = 'voted';
  const voted = buildChart(players, [record])[0];
  assert.equal(voted.similarity, 1);
  assert.equal(voted.pairs.find((p) => p.uids.includes('c')).similarity, null);
  record.marks.a = 'invalid';
  assert.equal(buildChart(players, [record])[0].pairs[0].similarity, null);
});

test('result snapshot and in-memory persistence computed once; unanimous rematch resets every match field', (t) => {
  const { manager, room, clients: [a, b], send, exact } = setup(t);
  const id = room.matchId, startedAt = room.startedAt;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(manager.db.listMatches().length, 0);
  exact();
  const deadline = room.rematchDeadline, timer = room.timer;
  assert.equal(room.phase, 'result');
  assert.equal(deadline, room.endedAt + 30000);
  assert.equal(room.phaseDeadline, deadline);
  assert.deepEqual(new Set(room.rematchEligibleUids), new Set([a.uid, b.uid]));
  assert.deepEqual(room.rematchVotes, {});
  assert.equal(snapshot(a).chart[0].similarity, 1);
  assert.deepEqual(snapshot(a).resultPlayers, room.matchPlayers);
  const chart = room.chart;
  manager.settle(room); manager.finishRound(room, 'exact');
  assert.equal(room.chart, chart);
  assert.equal(manager.db.listMatches().length, 1);
  assert.equal(room.rematchDeadline, deadline); assert.equal(room.timer, timer);
  const saved = manager.db.getMatch(id);
  assert.equal(saved.startedAt, startedAt); assert.equal(saved.outcome, 'exact');
  assert.equal(saved.players.length, 2); assert.equal(saved.rounds.length, 1);
  assert.throws(() => send(a, { type: 'rematch', accept: 'true' }), /无效/);
  send(a, { type: 'rematch', accept: true });
  assert.equal(room.phase, 'rematch');
  assert.equal(room.rematchDeadline, deadline); assert.equal(room.timer, timer);
  assert.deepEqual(snapshot(b).rematchVotes, { [a.uid]: 'rematch' });
  const settings = Object.fromEntries(['mode', 'themeId', 'maxRounds', 'writeSeconds', 'prepareSeconds', 'banRepeat'].map((key) => [key, room[key]]));
  send(b, { type: 'rematch', choice: 'rematch' });
  assert.equal(room.phase, 'writing'); assert.equal(room.round, 1); assert.deepEqual(room.history, []);
  for (const key of ['endedAt', 'resultPlayers', 'chart', 'outcome', 'persisted', 'rematchEligibleUids', 'rematchVotes', 'rematchDeadline']) assert.equal(room[key], undefined, key);
  assert.equal(room.currentRecord, null);
  assert.deepEqual(room.matchPlayers, saved.players);
  assert.equal(room.phaseDeadline - Date.now(), room.writeSeconds * 1000);
  for (const [key, value] of Object.entries(settings)) assert.equal(room[key], value, key);
  assert.ok(room.players.every((p) => !p.ready && p.draft === '' && p.submittedWord === undefined && p.vote === undefined));
  assert.equal(snapshot(a).chart, null);
  assert.notEqual(room.matchId, id); assert.ok(room.startedAt > startedAt);
  assert.deepEqual(manager.db.getMatch(id), saved);
  assert.equal(manager.db.getMatch(room.matchId), undefined);
  exact();
  assert.equal(manager.db.listMatches().length, 2);
  assert.deepEqual(manager.db.getMatch(id), saved);
});

for (const first of [true, false]) test(`room choice preserves everyone and never auto-starts (initiator=${!first})`, (t) => {
  const { manager, room, clients: [a, b], send, exact } = setup(t);
  exact();
  if (first) send(a, { type: 'rematch', choice: 'rematch' });
  send(b, { type: 'rematch', accept: false });
  if (!first) {
    assert.equal(room.phase, 'rematch');
    assert.deepEqual(snapshot(a).rematchVotes, { [b.uid]: 'room' });
    assert.throws(() => send(a, { type: 'rematch', choice: 'rematch' }), /已有玩家选择回房间/);
    send(a, { type: 'rematch', choice: 'room' });
  }
  assert.equal(manager.rooms.has(room.code), true);
  assert.equal(room.phase, 'lobby'); assert.equal(room.round, 0);
  assert.deepEqual(room.history, []);
  for (const c of [a, b]) { assert.equal(c.roomCode, room.code); assert.equal(snapshot(c).phase, 'lobby'); }
});

test('pending rematch choice can change to room without extending deadline', (t) => {
  const { room, clients: [a, b, c], send, exact } = setup(t, 3);
  exact(); send(a, { type: 'rematch', choice: 'rematch' });
  const deadline = room.rematchDeadline;
  send(b, { type: 'rematch', choice: 'rematch' });
  send(a, { type: 'rematch', choice: 'room' });
  assert.equal(room.rematchVotes[a.uid], 'room'); assert.equal(room.rematchDeadline, deadline);
  send(c, { type: 'rematch', choice: 'room' });
  assert.equal(room.phase, 'lobby'); assert.equal(room.players.length, 3);
});

for (const mode of ['timer', 'message', 'cleanup']) test(`rematch timeout via ${mode} cannot revive`, (t) => {
  const { manager, room, clients: [a, b], send, exact } = setup(t);
  let timeout;
  if (mode === 'timer') t.mock.method(globalThis, 'setTimeout', (callback) => { timeout = callback; return { unref() {} }; });
  exact();
  send(a, { type: 'rematch', accept: true });
  if (mode === 'timer') { t.mock.timers.tick(30000); timeout(); }
  else {
    t.mock.timers.setTime(room.rematchDeadline);
    if (mode === 'message') assert.throws(() => send(b, { type: 'rematch', choice: 'rematch' }), /超时/);
    else manager.cleanup();
  }
  assert.equal(manager.rooms.has(room.code), true);
  assert.equal(snapshot(a).phase, 'lobby'); assert.equal(snapshot(b), null);
  assert.deepEqual(room.players.map((p) => p.uid), [a.uid]);
  assert.equal(b.roomCode, null); assert.match(b.messages.at(-1).message, /超时未选择已退出/);
  assert.throws(() => send(a, { type: 'rematch', choice: 'rematch' }), /不能重赛/);
  assert.throws(() => send(b, { type: 'rematch', choice: 'rematch' }), /加入/);
});

test('active leave removes vote permanently; disconnect preserves eligibility and blocks early start', (t) => {
  const { manager, room, clients: [a, b, c, d], send, connect, exact } = setup(t, 4);
  exact(); send(a, { type: 'rematch', accept: true }); send(b, { type: 'rematch', accept: true });
  send(b, { type: 'leave' });
  assert.ok(!room.rematchEligibleUids.includes(b.uid)); assert.equal(room.rematchVotes[b.uid], undefined);
  assert.equal(manager.restore(b, room.code), false);
  manager.disconnect(c);
  assert.ok(room.rematchEligibleUids.includes(c.uid));
  send(d, { type: 'rematch', accept: true });
  assert.equal(room.phase, 'rematch');
  const restored = connect(c.uid);
  assert.equal(manager.restore(restored, room.code), true);
  send(restored, { type: 'rematch', accept: true });
  assert.equal(room.phase, 'writing'); assert.equal(room.players.length, 3);
  assert.equal(manager.restore(b, room.code), false);
});

test('unvoted departure lets all remaining yes voters return to lobby', (t) => {
  const { room, clients: [a, b], send, exact } = setup(t);
  exact(); send(a, { type: 'rematch', accept: true }); send(b, { type: 'leave' });
  assert.equal(room.phase, 'lobby'); assert.deepEqual(room.players.map((p) => p.uid), [a.uid]);
});

test('all disconnected voters keep seats and choices until deadline then room is destroyed', (t) => {
  const { manager, room, clients: [a, b], send, exact } = setup(t);
  exact(); send(a, { type: 'rematch', accept: true });
  manager.disconnect(a); manager.disconnect(b);
  assert.deepEqual(room.rematchVotes, { [a.uid]: 'rematch' });
  assert.equal(room.players.length, 2); assert.equal(manager.rooms.has(room.code), true);
  manager.cleanup(room.rematchDeadline);
  assert.equal(manager.rooms.has(room.code), false);
});

test('result disconnect restores, result leave permanently removes seat but not historical snapshot', (t) => {
  const { manager, room, clients: [a, b], send, connect, exact } = setup(t);
  exact(); const participants = structuredClone(room.resultPlayers);
  manager.disconnect(b);
  const restored = connect(b.uid);
  assert.equal(manager.restore(restored, room.code), true);
  send(restored, { type: 'leave' });
  assert.equal(manager.restore(restored, room.code), false);
  assert.equal(room.players.length, 1); assert.deepEqual(room.resultPlayers, participants);
  assert.ok(a.messages.some((m) => m.event === 'leave' && m.uid === b.uid));
  assert.equal(snapshot(a).history[0].words[b.uid], '苹果');
});

test('offline result player retains seat and restores during rematch', (t) => {
  const { manager, room, clients: [a, b], send, connect, exact } = setup(t);
  exact(); manager.disconnect(b); send(a, { type: 'rematch', accept: true });
  assert.equal(room.phase, 'rematch'); assert.equal(room.players.length, 2);
  const restored = connect(b.uid);
  assert.equal(manager.restore(restored, room.code), true);
  send(restored, { type: 'rematch', choice: 'rematch' });
  assert.equal(room.phase, 'writing');
});

test('90s cleanup retains all original names/seats and full marked word path at settlement', (t) => {
  const { manager, room, clients: [a, b, c], send } = setup(t, 3);
  const original = structuredClone(room.matchPlayers);
  send(a, { type: 'submitWord', word: '苹果' }); send(b, { type: 'submitWord', word: '香蕉' });
  send(c, { type: 'submitWord', word: '猫' }); manager.advanceDeadline(room);
  manager.disconnect(c);
  // Freeze phase timeout; test the cleanup clock independently from round timers.
  clearTimeout(room.timer); t.mock.timers.tick(90000); manager.cleanup();
  assert.equal(room.players.length, 2);
  manager.advanceDeadline(room);
  send(a, { type: 'submitWord', word: '梨' }); send(b, { type: 'submitWord', word: '梨' });
  assert.equal(room.phase, 'result'); assert.deepEqual(room.resultPlayers, original);
  assert.equal(room.history[0].words[c.uid], '猫');
  assert.equal(room.history[1].words[c.uid], '[未提交]'); assert.equal(room.history[1].marks[c.uid], 'empty');
  assert.equal(room.chart[1].similarity, 1); assert.ok(room.chart[1].pairs.some((p) => p.similarity === null));
  assert.equal(manager.db.getMatch(room.matchId).players.length, 3);
});

test('voted result keeps real pair score, vote history, and persisted voted outcome', (t) => {
  const { manager, room, clients: [a, b], send } = setup(t);
  send(a, { type: 'submitWord', word: '苹果' }); send(b, { type: 'submitWord', word: '猫' });
  send(a, { type: 'vote', yes: true }); send(b, { type: 'vote', yes: true }); manager.advanceDeadline(room);
  manager.broadcast(room);
  assert.equal(room.chart[0].similarity, 1);
  const pair = room.chart[0].pairs[0].similarity;
  assert.equal(pair, similarity('苹果', '猫')); assert.ok(pair < 1);
  assert.deepEqual(snapshot(a).history[0].votes, { [a.uid]: true, [b.uid]: true });
  assert.equal(manager.db.getMatch(room.matchId).outcome, 'voted');
});

test('SQLite stores completed matches atomically and idempotently; unfinished matches absent', (t) => {
  const db = createDatabase(':memory:');
  const { room, exact } = setup(t, 2, db);
  assert.equal(db.getMatch(room.matchId), undefined);
  exact(); const saved = db.getMatch(room.matchId);
  assert.equal(saved.players.length, 2); assert.equal(saved.rounds.length, 1);
  assert.equal(saved.outcome, 'exact'); assert.deepEqual(saved.rounds, room.history);
  db.saveMatch(saved); assert.deepEqual(db.getMatch(saved.id), saved);
  const bad = { ...saved, id: 'rollback-test', players: [saved.players[0], saved.players[0]] };
  assert.throws(() => db.saveMatch(bad), /UNIQUE/);
  assert.equal(db.getMatch(bad.id), undefined);
  db.saveMatch({ ...bad, players: saved.players });
  assert.equal(db.getMatch(bad.id).players.length, 2);
});

test('round-limit nonconvergence persists null convergence and unknown/invalid curve gaps', (t) => {
  const { manager, room, clients: [a], send } = setup(t);
  send(a, { type: 'typing', word: 'bad!' });
  for (let n = 1; n <= room.maxRounds; n += 1) {
    manager.advanceDeadline(room); manager.advanceDeadline(room);
    if (n < room.maxRounds) manager.advanceDeadline(room);
  }
  const saved = manager.db.getMatch(room.matchId);
  assert.equal(saved.outcome, 'none'); assert.equal(saved.convergedRound, null);
  assert.equal(saved.rounds.length, room.maxRounds);
  assert.equal(saved.rounds[0].marks[a.uid], 'invalid');
  assert.ok(room.chart.every((point) => point.similarity === null));
});

for (const choice of ['rematch', 'room']) test(`timeout retains multiple ${choice} voters with appropriate next phase`, (t) => {
  const { manager, room, clients: [a, b, c], send, exact } = setup(t, 3);
  exact(); send(a, { type: 'rematch', choice }); send(b, { type: 'rematch', choice });
  t.mock.timers.setTime(room.rematchDeadline);
  assert.throws(() => send(a, { type: 'rematch', choice: 'rematch' }), /超时/);
  const phase = choice === 'rematch' ? 'writing' : 'lobby';
  assert.equal(room.phase, phase);
  if (phase === 'lobby') assert.equal(room.matchId, undefined);
  assert.deepEqual(new Set(room.players.map((p) => p.uid)), new Set([a.uid, b.uid]));
  assert.equal(snapshot(a).phase, phase); assert.equal(snapshot(b).phase, phase);
  assert.equal(snapshot(c), null); assert.equal(c.roomCode, null);
  assert.equal(manager.restore(c, room.code), false);
  assert.equal(room.rematchVotes, undefined); assert.deepEqual(room.history, []);
});

for (const action of ['leave', 'disconnect']) test(`last pending player ${action}: only leave can start immediately`, (t) => {
  const { manager, room, clients: [a, b, c], send, exact } = setup(t, 3);
  exact(); const id = room.matchId;
  send(a, { type: 'rematch', choice: 'rematch' }); send(b, { type: 'rematch', choice: 'rematch' });
  if (action === 'leave') send(c, { type: 'leave' });
  else {
    manager.disconnect(c);
    assert.equal(room.phase, 'rematch'); assert.equal(room.matchId, id);
    manager.cleanup(room.rematchDeadline);
  }
  assert.equal(room.phase, 'writing'); assert.equal(room.round, 1); assert.notEqual(room.matchId, id);
  assert.deepEqual(room.matchPlayers.map((p) => p.uid), [a.uid, b.uid]);
  assert.equal(manager.restore(c, room.code), false);
});

test('pending departure with a room choice returns remaining players to lobby', (t) => {
  const { room, clients: [a, b, c], send, exact } = setup(t, 3);
  exact(); send(a, { type: 'rematch', choice: 'rematch' }); send(b, { type: 'rematch', choice: 'room' });
  send(c, { type: 'leave' });
  assert.equal(room.phase, 'lobby'); assert.equal(room.players.length, 2); assert.equal(snapshot(c), null);
});

test('timeout with no remaining choices destroys room rather than reviving seats', (t) => {
  const { manager, room, clients: [a, b, c], send, exact } = setup(t, 3);
  exact(); send(a, { type: 'rematch', choice: 'rematch' }); send(a, { type: 'leave' });
  assert.deepEqual(room.rematchVotes, {});
  manager.cleanup(room.rematchDeadline);
  assert.equal(manager.rooms.has(room.code), false);
  for (const client of [b, c]) { assert.equal(client.roomCode, null); assert.equal(snapshot(client), null); }
});

for (const mode of ['timer', 'message', 'cleanup']) test(`result countdown expires without any clicks via ${mode}`, (t) => {
  const { manager, room, clients: [a, b], send, exact } = setup(t);
  let timeout;
  if (mode === 'timer') t.mock.method(globalThis, 'setTimeout', (callback) => { timeout = callback; return { unref() {} }; });
  exact();
  assert.equal(room.phase, 'result');
  assert.equal(snapshot(a).phaseDeadline, room.endedAt + 30000);
  assert.equal(snapshot(a).rematchDeadline, room.phaseDeadline);
  t.mock.timers.setTime(room.rematchDeadline);
  if (mode === 'timer') timeout();
  else if (mode === 'cleanup') manager.cleanup();
  else assert.throws(() => send(a, { type: 'rematch', choice: 'rematch' }), /超时/);
  assert.equal(manager.rooms.has(room.code), false);
  for (const c of [a, b]) { assert.equal(c.roomCode, null); assert.equal(snapshot(c), null); }
});

test('disconnected yes vote persists; restoring final voter triggers unanimous start', (t) => {
  const { manager, room, clients: [a, b, c], send, connect, exact } = setup(t, 3);
  exact(); const deadline = room.rematchDeadline;
  send(c, { type: 'rematch', choice: 'rematch' }); manager.disconnect(c);
  send(a, { type: 'rematch', choice: 'rematch' }); send(b, { type: 'rematch', choice: 'rematch' });
  assert.equal(room.phase, 'rematch'); assert.equal(room.rematchVotes[c.uid], 'rematch');
  manager.checkRematch(room); manager.finishRematch(room);
  assert.equal(room.phase, 'rematch'); assert.equal(room.rematchDeadline, deadline);
  assert.equal(manager.restore(connect(c.uid), room.code), true);
  assert.equal(room.phase, 'writing'); assert.equal(room.players.length, 3);
});

for (const choice of [undefined, 'rematch']) test(`deadline reconnect cannot rescue offline ${choice ?? 'unselected'} player`, (t) => {
  const { manager, room, clients: [a, b, c], send, connect, exact } = setup(t, 3);
  exact();
  if (choice) send(c, { type: 'rematch', choice });
  manager.disconnect(c);
  send(a, { type: 'rematch', choice: 'rematch' }); send(b, { type: 'rematch', choice: 'rematch' });
  t.mock.timers.setTime(room.rematchDeadline);
  assert.equal(manager.restore(connect(c.uid), room.code), false);
  assert.equal(room.phase, 'writing'); assert.equal(room.players.length, 2);
  assert.equal(room.players.some((p) => p.uid === c.uid), false);
});

test('player leaving during play is excluded from electorate but remains in result history', (t) => {
  const { manager, room, clients: [a, b, c], send } = setup(t, 3);
  send(c, { type: 'leave' });
  send(a, { type: 'submitWord', word: '苹果' }); send(b, { type: 'submitWord', word: '苹果' });
  assert.equal(room.phase, 'result');
  assert.deepEqual(new Set(room.rematchEligibleUids), new Set([a.uid, b.uid]));
  assert.equal(room.players.some((p) => p.uid === c.uid), false);
  assert.ok(room.resultPlayers.some((p) => p.uid === c.uid));
  assert.equal(room.history[0].marks[c.uid], 'empty');
  assert.equal(manager.restore(c, room.code), false);
});

test('late gameplay message cannot submit into automatically restarted match', (t) => {
  const { room, clients: [a, b], send, exact } = setup(t, 3);
  exact(); send(a, { type: 'rematch', choice: 'rematch' }); send(b, { type: 'rematch', choice: 'rematch' });
  t.mock.timers.setTime(room.rematchDeadline);
  assert.throws(() => send(a, { type: 'submitWord', word: '旧消息' }), /超时/);
  assert.equal(room.phase, 'writing');
  assert.ok(room.players.every((p) => p.submittedWord === undefined && p.draft === ''));
});
