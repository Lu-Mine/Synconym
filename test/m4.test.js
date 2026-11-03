import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { createDatabase } from '../server/db.js';
import { writingMarkup, resultMarkup } from '../public/render.js';

function setup(t, count = 2, maxRounds = 12, db) {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db });
  t.after(() => { manager.close(); db?.close(); });
  const clients = Array.from({ length: count }, () => {
    const c = manager.connect(); c.messages = [];
    c.ws = { readyState: 1, send: (data) => c.messages.push(JSON.parse(data)) };
    return c;
  });
  const send = (c, msg) => { t.mock.timers.tick(501); manager.handle(c, msg); };
  send(clients[0], { type: 'createRoom', maxRounds });
  const room = manager.roomFor(clients[0]);
  for (const c of clients.slice(1)) { send(c, { type: 'joinRoom', code: room.code }); send(c, { type: 'setReady', ready: true }); }
  send(clients[0], { type: 'start' });
  const miss = (round) => {
    room.round = round;
    room.currentRecord = { n: round, words: {}, marks: {}, outcome: 'miss' };
    manager.finishRound(room, 'miss');
  };
  return { manager, room, clients, send, miss };
}
const snapshot = (c) => c.messages.filter((m) => m.type === 'state').at(-1).room;

test('崩局投票仅在至少 8 轮且每 5 轮未到终点触发', (t) => {
  const { manager, room, miss } = setup(t);
  for (const [max, round, expected] of [[7, 5, 'prepare'], [8, 5, 'breakVote'], [12, 10, 'breakVote'], [15, 15, 'result'], [20, 15, 'breakVote'], [20, 16, 'prepare']]) {
    room.maxRounds = max; room.history = []; room.persisted = false; room.dropped = false;
    miss(round); assert.equal(room.phase, expected, `${max}/${round}`);
    if (expected === 'breakVote') assert.equal(room.phaseDeadline - Date.now(), room.prepareSeconds * 1000);
  }
  manager.close();
});

test('两人一票通过，SQLite 无记录，且可重赛', (t) => {
  const db = createDatabase(':memory:');
  const { manager, room, clients: [a, b], send, miss } = setup(t, 2, 12, db);
  miss(5);
  send(a, { type: 'breakVote', yes: true });
  assert.equal(room.phase, 'result'); assert.equal(room.outcome, 'break');
  assert.equal(db.getMatch(room.matchId), undefined);
  const deadline = room.rematchDeadline; manager.settle(room); assert.equal(room.rematchDeadline, deadline);
  assert.match(resultMarkup({ room, uid: a.uid }), /记录不会保存/);
  send(a, { type: 'rematch', choice: 'rematch' }); send(b, { type: 'rematch', choice: 'rematch' });
  assert.equal(room.phase, 'writing'); assert.equal(room.round, 1); assert.equal(room.dropped, false);
});

test('四人未达半数、超时与断线席位', (t) => {
  const { manager, room, clients: [a, b, c, d], send, miss } = setup(t, 4);
  miss(5); send(a, { type: 'breakVote', yes: true });
  send(b, { type: 'breakVote', yes: false });
  manager.disconnect(c);
  send(d, { type: 'breakVote', yes: false });
  assert.equal(room.phase, 'breakVote');
  manager.advanceDeadline(room);
  assert.equal(room.phase, 'writing'); assert.equal(room.round, 6);
  miss(10); send(a, { type: 'breakVote', yes: true }); send(b, { type: 'breakVote', yes: true });
  assert.equal(room.phase, 'result');
  assert.equal(room.outcome, 'break'); assert.equal(manager.db.listMatches().length, 0);
});

test('崩局页面显示选择及重连后的已投状态', () => {
  const room = { code: '12345', phase: 'breakVote', round: 5, maxRounds: 12, history: [], players: [{ uid: 'a', name: '甲', seat: 0, connected: true, breakVoted: true }] };
  const html = writingMarkup({ room, uid: 'a' });
  assert.match(html, /至少半数/); assert.match(html, /data-action="break-no" disabled/);
  assert.match(html, /data-action="break-yes" disabled/); assert.match(html, /已投票/);
});

for (const [count, votes, expected] of [
  [2, [true], 'result'], [2, [false], 'breakVote'], [2, [false, false], 'writing'],
  [3, [true], 'breakVote'], [3, [true, true], 'result'], [3, [false, false], 'writing'],
  [4, [true], 'breakVote'], [4, [true, true], 'result'], [4, [false, false], 'breakVote'],
  [4, [false, false, false], 'writing']
]) {
  test(`${count} 人投票 ${votes.join(',')} 的提前计票`, (t) => {
    const { room, clients, send, miss } = setup(t, count);
    miss(5);
    votes.forEach((yes, index) => send(clients[index], { type: 'breakVote', yes }));
    assert.equal(room.phase, expected);
  });
}

test('玩家离开导致结果确定时立即计票', (t) => {
  const { manager, room, clients: [a, b, c, d], send, miss } = setup(t, 4);
  miss(5); send(a, { type: 'breakVote', yes: true });
  manager.detach(d, true); assert.equal(room.phase, 'breakVote');
  manager.detach(c, true); assert.equal(room.outcome, 'break');
});

test('未定票时隐藏选择，拒绝重复投票，断线保留已投选择', (t) => {
  const { manager, room, clients: [a, b], send, miss } = setup(t, 3);
  miss(5); send(a, { type: 'breakVote', yes: true });
  const player = snapshot(b).players.find((p) => p.uid === a.uid);
  assert.equal(player.breakVoted, true); assert.equal('breakVote' in player, false);
  assert.throws(() => send(a, { type: 'breakVote', yes: false }), /不能投票/);
  manager.disconnect(a);
  assert.equal(room.phase, 'breakVote');
  assert.equal(room.players.find((p) => p.uid === a.uid).breakVote, true);
});

test('崩局投票只剩一人时中断，不入库', (t) => {
  const { manager, room, clients: [, b], miss } = setup(t);
  miss(5); manager.detach(b, true);
  assert.equal(room.phase, 'interrupted'); assert.equal(manager.db.listMatches().length, 0);
});
