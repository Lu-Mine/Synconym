import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager();
  t.after(() => manager.close());
  const connect = (uid) => {
    const c = manager.connect(uid); c.messages = [];
    c.ws = { readyState: 1, send: (s) => c.messages.push(JSON.parse(s)), close() {} };
    return c;
  };
  const send = (c, message) => { t.mock.timers.tick(501); manager.handle(c, message); };
  const a = connect(), b = connect(), c = connect();
  send(a, { type: 'createRoom' });
  const room = manager.roomFor(a);
  for (const guest of [b, c]) send(guest, { type: 'joinRoom', code: room.code });
  return { manager, room, a, b, c, connect, send };
}
const phases = ['lobby', 'writing', 'voting', 'prepare', 'result', 'rematch'];
function phase(manager, room, value) {
  room.matchPlayers = room.players.map(({ uid, name, seat }) => ({ uid, name, seat }));
  room.history = [];
  room.currentRecord = { n: 1, words: {}, marks: {} };
  manager.setPhase(room, value, null);
  if (['result', 'rematch'].includes(value)) {
    room.resultPlayers = structuredClone(room.matchPlayers);
    room.rematchEligibleUids = room.players.map((p) => p.uid);
    room.rematchVotes = {};
    room.rematchDeadline = Date.now() + 30000;
  }
}
for (const value of phases) {
  test(`${value}: explicit leave permanently removes seat, not history`, (t) => {
    const { manager, room, a, b, send } = setup(t);
    phase(manager, room, value);
    const participants = structuredClone(room.matchPlayers);
    const player = manager.playerFor(room, b.uid); player.vote = true; player.submittedWord = '秘密';
    if (room.rematchVotes) room.rematchVotes[b.uid] = 'rematch';
    send(b, { type: 'leave' });
    assert.equal(room.players.some((p) => p.uid === b.uid), false);
    assert.equal(manager.restore(b, room.code), false);
    assert.deepEqual(room.matchPlayers, participants);
    assert.equal(room.rematchVotes?.[b.uid], undefined);
    assert.equal(a.messages.filter((m) => m.uid === b.uid && m.event === 'leave').length, 1);
    assert.equal(a.messages.some((m) => m.uid === b.uid && m.event === 'disconnect'), false);
    if (value === 'lobby') { send(b, { type: 'joinRoom', code: room.code }); assert.equal(manager.playerFor(room, b.uid).connected, true); }
    else assert.throws(() => send(b, { type: 'joinRoom', code: room.code }), /已经开始/);
  });
  test(`${value}: disconnect is idempotent and exposes only public presence`, (t) => {
    const { manager, room, a, b, connect } = setup(t);
    phase(manager, room, value);
    const player = manager.playerFor(room, b.uid);
    player.draft = '私密草稿'; player.submittedWord = '私密答案'; player.vote = true; player.ready = true;
    manager.disconnect(b);
    const at = player.disconnectedAt;
    t.mock.timers.tick(500);
    manager.disconnect(b);
    assert.equal(player.disconnectedAt, at); assert.equal(player.ready, false);
    const publicPlayer = a.messages.filter((m) => m.type === 'state').at(-1).room.players.find((p) => p.uid === b.uid);
    assert.equal(publicPlayer.connectionState, 'disconnected'); assert.equal(publicPlayer.disconnectedAt, at);
    assert.equal(publicPlayer.reconnectDeadline, ['result', 'rematch'].includes(value) ? room.rematchDeadline : at + 90000);
    for (const key of ['draft', 'submittedWord', 'vote', 'leftReason']) assert.equal(key in publicPlayer, false);
    const restored = connect(b.uid);
    assert.equal(manager.restore(restored, room.code), true);
    assert.equal(player.submittedWord, '私密答案'); assert.equal(player.vote, true);
    const events = a.messages.filter((m) => m.uid === b.uid && m.type === 'toast').map((m) => m.event);
    assert.deepEqual(events.slice(-2), ['disconnect', 'return']);
    const online = restored.messages.filter((m) => m.type === 'state').at(-1).room.players.find((p) => p.uid === b.uid);
    assert.equal(online.disconnectedAt, null); assert.equal(online.reconnectDeadline, null); assert.equal(online.connectionState, 'connected');
  });
}

test('90 second expiry emits expired once; all offline room survives until window', (t) => {
  const { manager, room, a, b, c } = setup(t);
  manager.disconnect(b); const deadline = manager.playerFor(room, b.uid).disconnectedAt + 90000;
  manager.cleanup(deadline - 1); assert.equal(room.players.length, 3);
  manager.cleanup(deadline); manager.cleanup(deadline);
  assert.equal(room.players.length, 2);
  assert.equal(a.messages.filter((m) => m.event === 'expired' && m.uid === b.uid).length, 1);
  manager.disconnect(a); manager.disconnect(c);
  assert.equal(manager.rooms.has(room.code), true);
  manager.cleanup(Date.now() + 90000); assert.equal(manager.rooms.has(room.code), false);
});

test('switching rooms removes old seat; stale socket close cannot detach replacement', (t) => {
  const { manager, room, a, b, connect, send } = setup(t);
  b.ws.readyState = 3;
  const replacement = connect(b.uid);
  manager.disconnect(b);
  assert.equal(manager.playerFor(room, b.uid).connected, true);
  send(replacement, { type: 'createRoom' });
  const target = manager.roomFor(replacement);
  assert.notEqual(target.code, room.code); assert.equal(room.players.some((p) => p.uid === b.uid), false);
  assert.equal(manager.restore(a, target.code), false);
  assert.equal(room.players.some((p) => p.uid === a.uid), false);
});

test('last explicit leave clears phase timer and destroys room immediately', (t) => {
  const { manager, room, a, b, c, send } = setup(t);
  manager.setPhase(room, 'writing', 60);
  const timer = room.timer;
  for (const client of [a, b, c]) send(client, { type: 'leave' });
  assert.equal(manager.rooms.has(room.code), false);
  assert.equal(timer._destroyed, true);
});

test('deadline leave removes chosen player before timeout can restart with them', (t) => {
  const { manager, room, a, b, c, send } = setup(t);
  phase(manager, room, 'rematch');
  room.rematchVotes = { [a.uid]: 'rematch', [b.uid]: 'rematch' };
  manager.disconnect(c);
  t.mock.timers.setTime(room.rematchDeadline);
  send(b, { type: 'leave' });
  assert.equal(room.phase, 'lobby'); assert.deepEqual(room.players.map((p) => p.uid), [a.uid]);
  assert.equal(manager.restore(b, room.code), false);
  assert.equal(a.messages.some((m) => m.uid === b.uid && m.event === 'disconnect'), false);
});

test('cleanup of stale old-room seat never clears a different current room', (t) => {
  const { manager, room, b, send } = setup(t);
  const stale = { ...manager.playerFor(room, b.uid), connected: false, disconnectedAt: Date.now() };
  send(b, { type: 'createRoom' }); const target = b.roomCode;
  room.players.push(stale);
  manager.cleanup(Date.now() + 90000);
  assert.equal(b.roomCode, target);
});

for (const value of ['writing', 'voting', 'prepare']) {
  test(`${value}: one remaining seat interrupts without saving and can return to lobby`, (t) => {
    const { manager, room, a, b, c, send } = setup(t);
    phase(manager, room, value);
    let saves = 0; manager.db.saveMatch = () => { saves++; };
    send(b, { type: 'leave' });
    assert.notEqual(room.phase, 'interrupted');
    send(c, { type: 'leave' });
    assert.equal(room.phase, 'interrupted');
    assert.deepEqual(room.history, []);
    assert.equal(room.phaseDeadline, null);
    assert.equal(saves, 0);
    send(a, { type: 'rematch', choice: 'room' });
    assert.equal(room.phase, 'lobby');
    assert.equal(saves, 0);
  });
}

test('掉线保席期间不中断，过期移除后中断且不保存', (t) => {
  const { manager, room, b, c, send } = setup(t);
  send(c, { type: 'leave' });
  phase(manager, room, 'writing');
  let saves = 0; manager.db.saveMatch = () => { saves++; };
  manager.disconnect(b);
  assert.notEqual(room.phase, 'interrupted');
  manager.cleanup(Date.now() + 90000);
  assert.equal(room.phase, 'interrupted');
  assert.equal(saves, 0);
});
