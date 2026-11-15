import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, createMemoryDb } from '../../server/rooms.js';
import { DEFAULT_SETTINGS } from '../../server/rules.js';

function client(manager) {
  const connection = manager.connect();
  connection.events = [];
  connection.ws = {
    readyState: 1,
    send(payload) { connection.events.push(JSON.parse(payload)); },
    close() {}
  };
  return connection;
}

function lastOf(connection, type) {
  return [...connection.events].reverse().find((message) => message.type === type);
}

function tick(t, ms) { t.mock.timers.tick(ms); }

// 消息限流按连接计：同一连接连发要跨过 500ms，不同连接互不影响。
function send(t, manager, connection, message) {
  tick(t, 501);
  manager.handle(connection, message);
}

function expire(t, manager, room) {
  t.mock.timers.setTime(room.phaseDeadline);
  manager.advanceDeadline(room);
}

function setup(t, settings = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const db = createMemoryDb();
  const manager = new RoomManager({ db });
  const host = client(manager);
  manager.handle(host, {
    type: 'createRoom', mode: 'livonym', describeSeconds: 30, roundsPerPlayer: 1, ...settings
  });
  return { manager, db, host, room: manager.roomFor(host) };
}

function join(t, manager, room, ready = true) {
  const connection = client(manager);
  manager.handle(connection, { type: 'joinRoom', code: room.code });
  if (ready) send(t, manager, connection, { type: 'setReady', ready: true });
  return connection;
}

// 三人局：出题人 + 2 位竞猜者，直接进入 lvPlay。
function playing(t, settings = {}) {
  const env = setup(t, settings);
  const guests = [join(t, env.manager, env.room), join(t, env.manager, env.room)];
  send(t, env.manager, env.host, { type: 'start' });
  expire(t, env.manager, env.room);
  expire(t, env.manager, env.room);
  assert.equal(env.room.phase, 'lvPlay');
  return { ...env, guests, describer: env.host, guessers: guests };
}

test('三人局按顺序轮流出题，走完三棒进入结算并落库', (t) => {
  const { manager, db, room, host, guests } = playing(t);
  const order = room.livonym.order;
  assert.deepEqual(order, [host.uid, guests[0].uid, guests[1].uid]);
  assert.equal(room.round, 1);
  assert.equal(room.livonym.totalRounds, 3);

  // 第一棒：一位猜中，出题人得 1 分，猜中者得 3 分
  const secret = room.livonym.secret;
  assert.ok(secret);
  manager.handle(guests[0], { type: 'livonymGuess', text: secret });
  const ok = lastOf(guests[0], 'livonymGuessResult');
  assert.deepEqual({ ok: ok.ok, order: ok.order, points: ok.points }, { ok: true, order: 1, points: 3 });
  assert.equal(lastOf(guests[1], 'livonymGuessed').uid, guests[0].uid);

  expire(t, manager, room);
  assert.equal(room.phase, 'lvScore');
  assert.equal(room.livonym.scores[host.uid], 1);
  assert.equal(room.livonym.scores[guests[0].uid], 3);
  assert.equal(room.history.length, 1);
  assert.equal(room.history[0].modeDetails.guesserCount, 2);
  assert.equal(room.history[0].modeDetails.points[host.uid], 1);

  expire(t, manager, room);
  assert.equal(room.phase, 'lvIntro');
  assert.equal(room.round, 2);
  assert.equal(room.livonym.order[room.livonym.index], guests[0].uid);

  // 第二棒：两人全中，出题人 0 分（悬崖）
  expire(t, manager, room);
  manager.handle(guests[1], { type: 'livonymGuess', text: room.livonym.secret });
  manager.handle(host, { type: 'livonymGuess', text: room.livonym.secret });
  assert.equal(room.phase, 'lvScore');
  assert.equal(room.history.at(-1).modeDetails.points[guests[0].uid], 0);

  // 第三棒：无人猜中，出题人 0 分，出题人自己也拿不到分
  expire(t, manager, room);
  expire(t, manager, room);
  assert.equal(room.round, 3);
  assert.equal(room.livonym.order[room.livonym.index], guests[1].uid);
  expire(t, manager, room);
  assert.equal(room.phase, 'lvScore');
  assert.equal(room.history.at(-1).modeDetails.points[guests[1].uid], 0);

  // 三棒走完进入结算
  expire(t, manager, room);
  assert.equal(room.phase, 'result');
  assert.equal(room.outcome, 'played');
  assert.equal(room.history.length, 3);

  const saved = db.getMatch(room.matchId);
  assert.equal(saved.mode, 'livonym');
  assert.equal(saved.rounds.length, 3);
  assert.equal(saved.rounds[0].modeDetails.secret, room.history[0].modeDetails.secret);
  assert.equal(saved.rounds[0].modeDetails.guesserCount, 2);
  assert.deepEqual(saved.rounds[0].modeDetails.points, room.history[0].modeDetails.points);
});

test('人数校验：两人不能开局，第九人不能加入', (t) => {
  const { manager, room, host } = setup(t);
  join(t, manager, room);
  assert.throws(() => send(t, manager, host, { type: 'start' }), /需要 3 到 8 人才能开始/);

  // 补到 8 人后第九人被容量挡住
  for (let i = 0; i < 6; i += 1) join(t, manager, room);
  assert.equal(room.players.length, 8);
  assert.equal(Math.max(...room.players.map((player) => player.seat)), 7);
  const extra = client(manager);
  assert.throws(() => manager.handle(extra, { type: 'joinRoom', code: room.code }), /房间已满/);
});

test('出题人掉线即中止本轮并按已猜中结算，下一棒顺延', (t) => {
  const { manager, room, host, guests } = playing(t);
  manager.handle(guests[0], { type: 'livonymGuess', text: room.livonym.secret });
  manager.detach(host);
  assert.equal(room.phase, 'lvScore');
  assert.equal(room.history.at(-1).modeDetails.aborted, true);
  // 已猜中的 1 人仍然计分，出题人得 1 分
  assert.equal(room.history.at(-1).modeDetails.points[host.uid], 1);
  assert.equal(room.history.at(-1).modeDetails.points[guests[0].uid], 3);

  expire(t, manager, room);
  assert.equal(room.phase, 'lvIntro');
  assert.equal(room.livonym.order[room.livonym.index], guests[0].uid);
});

test('只剩一位玩家时中断，不落库', (t) => {
  const { manager, room, guests } = playing(t);
  manager.detach(guests[0], true);
  manager.detach(guests[1], true);
  assert.equal(room.phase, 'interrupted');
  assert.equal(room.outcome, 'interrupted');
  assert.ok(!room.persisted);
});

test('描述流只发给其他玩家，快照对竞猜者隐藏秘密词', (t) => {
  const { manager, room, host, guests } = playing(t);
  const secret = room.livonym.secret;

  manager.handle(host, { type: 'livonymStream', text: '用来煮东西' });
  const pushed = lastOf(guests[0], 'livonymStream');
  assert.equal(pushed.text, '用来煮东西');
  assert.equal(pushed.rev, 1);
  assert.equal(lastOf(guests[1], 'livonymStream').rev, 1);
  // 出题人本人不回显
  assert.equal(host.events.filter((message) => message.type === 'livonymStream').length, 0);

  // 60ms 内的第二帧被静默丢弃，不报错也不推进 rev
  manager.handle(host, { type: 'livonymStream', text: '用来煮东西的' });
  assert.equal(room.livonym.stream.rev, 1);
  assert.equal(room.livonym.stream.text, '用来煮东西');
  assert.equal(host.events.filter((message) => message.type === 'error').length, 0);

  // 快照可见性
  manager.sendState(host);
  manager.sendState(guests[0]);
  assert.equal(lastOf(host, 'state').room.livonym.secret, secret);
  assert.equal(lastOf(guests[0], 'state').room.livonym.secret, null);
  assert.equal(lastOf(guests[0], 'state').room.livonym.describerUid, host.uid);
  assert.equal(lastOf(host, 'state').room.livonym.guesserCount, 2);

  // 本轮结束后全员可见
  expire(t, manager, room);
  manager.sendState(guests[0]);
  assert.equal(lastOf(guests[0], 'state').room.livonym.secret, secret);
});

test('写出谜底只被拦下，本轮得分不受影响', (t) => {
  const { manager, room, host, guests } = playing(t);
  const secret = room.livonym.secret;
  manager.handle(host, { type: 'livonymStream', text: `就是${secret}` });
  const blocked = lastOf(host, 'livonymBlocked');
  assert.equal(blocked.reason, 'secret');
  assert.equal(room.livonym.stream.text, '');
  assert.equal(guests[0].events.filter((message) => message.type === 'livonymStream').length, 0);

  // 有人猜中时出题人照常得 1 分，拦截不再扣分
  manager.handle(guests[0], { type: 'livonymGuess', text: secret });
  expire(t, manager, room);
  assert.equal(room.history.at(-1).modeDetails.points[host.uid], 1);
});

test('描述超长回执 tooLong，不改变流文本', (t) => {
  const { manager, room, host } = playing(t);
  manager.handle(host, { type: 'livonymStream', text: '字'.repeat(401) });
  assert.equal(lastOf(host, 'livonymBlocked').reason, 'tooLong');
  assert.equal(room.livonym.stream.text, '');
});

test('猜测冷却与重复猜中', (t) => {
  const { manager, room, host, guests } = playing(t);
  manager.handle(guests[0], { type: 'livonymGuess', text: '完全不对' });
  assert.equal(lastOf(guests[0], 'livonymGuessResult').reason, 'wrong');

  // 1.5 秒内的第二次提交被冷却拦下
  manager.handle(guests[0], { type: 'livonymGuess', text: '还是不对' });
  assert.equal(lastOf(guests[0], 'livonymGuessResult').reason, 'cooldown');

  tick(t, 1600);
  manager.handle(guests[0], { type: 'livonymGuess', text: room.livonym.secret });
  assert.equal(lastOf(guests[0], 'livonymGuessResult').ok, true);

  // 已经猜中的人再提交只会收到 closed，不会重复计分
  tick(t, 1600);
  manager.handle(guests[0], { type: 'livonymGuess', text: room.livonym.secret });
  assert.equal(lastOf(guests[0], 'livonymGuessResult').reason, 'closed');
  assert.equal(room.livonym.guessed.length, 1);

  // 出题人不能猜自己的词
  tick(t, 1600);
  assert.throws(() => manager.handle(host, { type: 'livonymGuess', text: room.livonym.secret }), /这一轮由你出题/);
});

test('每人两轮时总棒次翻倍，重赛按当前配置重开', (t) => {
  const { manager, room, host, guests } = playing(t, { roundsPerPlayer: 2 });
  assert.equal(room.livonym.totalRounds, 6);
  for (let index = 0; index < 5; index += 1) {
    expire(t, manager, room);
    assert.notEqual(room.phase, 'result');
    expire(t, manager, room);
    expire(t, manager, room);
  }
  expire(t, manager, room);
  expire(t, manager, room);
  assert.equal(room.phase, 'result');
  assert.equal(room.history.length, 6);

  send(t, manager, host, { type: 'rematch', choice: 'rematch' });
  send(t, manager, guests[0], { type: 'rematch', choice: 'rematch' });
  send(t, manager, guests[1], { type: 'rematch', choice: 'rematch' });
  assert.equal(room.phase, 'countdown');
  assert.equal(room.livonym.index, -1);
  assert.equal(room.livonym.totalRounds, 6);
  assert.deepEqual(room.livonym.scores, { [host.uid]: 0, [guests[0].uid]: 0, [guests[1].uid]: 0 });
});

test('默认设置不含即时竞猜字段的旧房间也能开局', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db: createMemoryDb() });
  const host = client(manager);
  manager.handle(host, { type: 'createRoom', mode: 'livonym' });
  const room = manager.roomFor(host);
  assert.equal(room.describeSeconds, 45);
  assert.equal(room.roundsPerPlayer, 1);
  // 经典模式不受影响
  assert.equal(DEFAULT_SETTINGS.mode, 'free');
});

test('猜中名单带上全部在线竞猜者，出题人不在其中', (t) => {
  const { manager, room, host, guests } = playing(t);
  const nameOf = (uid) => room.players.find((player) => player.uid === uid).name;
  // lvPlay 的推进不广播快照，这里直接读按连接裁剪的视图
  const before = manager.livonymView(room, host.uid);
  // 名单与计分分母同源：只有在线竞猜者，出题人不在列表里
  assert.deepEqual(before.guessers.map((player) => player.uid), [guests[0].uid, guests[1].uid]);
  assert.equal(before.guessers[0].name, nameOf(guests[0].uid));
  assert.equal(before.guesserCount, before.guessers.length);

  // 有人猜中后名单不变，只是该人进入 guessed
  manager.handle(guests[1], { type: 'livonymGuess', text: room.livonym.secret });
  const after = lastOf(host, 'state').room.livonym;
  assert.deepEqual(after.guessers.map((player) => player.uid), [guests[0].uid, guests[1].uid]);
  assert.deepEqual(after.guessed.map((item) => item.uid), [guests[1].uid]);
  // 每条带上本轮得分：第一个猜中的人 3 分，列表直接显示，不必在客户端重算
  assert.deepEqual(after.guessed.map((item) => item.order), [1]);
  assert.deepEqual(after.guessed.map((item) => item.points), [3]);
});
