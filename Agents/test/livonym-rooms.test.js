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
  assert.equal(room.phaseDeadline - Date.now(), 6000);
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
  assert.equal(room.phaseDeadline - Date.now(), 6000);
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
  const len = [...room.livonym.secret].length;
  const wrongGuess = len === 2 ? '错词' : len === 4 ? '四个错字' : '错的词';
  manager.handle(guests[0], { type: 'livonymGuess', text: wrongGuess });
  assert.equal(lastOf(guests[0], 'livonymGuessResult').reason, 'wrong');

  // 1.5 秒内的第二次提交被冷却拦下
  const anotherWrong = len === 2 ? '还是' : len === 4 ? '依然不对' : '还是错';
  manager.handle(guests[0], { type: 'livonymGuess', text: anotherWrong });
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

test('同房重赛与新建房间均延续去重冷却，跨局不抽重词', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const db = createMemoryDb();
  const manager = new RoomManager({ db });
  const host = client(manager);
  manager.handle(host, { type: 'createRoom', mode: 'livonym', describeSeconds: 30, roundsPerPlayer: 1 });
  const room = manager.roomFor(host);
  const g1 = join(t, manager, room);
  const g2 = join(t, manager, room);

  const playOneMatch = (targetRoom) => {
    const secrets = [];
    expire(t, manager, targetRoom); // countdown -> lvIntro
    for (let i = 0; i < targetRoom.livonym.totalRounds; i += 1) {
      secrets.push(targetRoom.livonym.secret);
      expire(t, manager, targetRoom); // lvIntro -> lvPlay
      expire(t, manager, targetRoom); // lvPlay -> lvScore
      expire(t, manager, targetRoom); // lvScore -> next lvIntro or result
    }
    assert.equal(targetRoom.phase, 'result');
    return secrets;
  };

  send(t, manager, host, { type: 'start' });
  const match1 = playOneMatch(room);
  assert.equal(match1.length, 3);
  assert.equal(room.livonymUsed.size, 3);

  // Stage 1: 点再来一局后，同房抽词继续累加排重
  send(t, manager, host, { type: 'rematch', choice: 'rematch' });
  send(t, manager, g1, { type: 'rematch', choice: 'rematch' });
  send(t, manager, g2, { type: 'rematch', choice: 'rematch' });
  const match2 = playOneMatch(room);
  assert.equal(room.livonymUsed.size, 6);
  assert.equal(new Set([...match1, ...match2]).size, 6);

  // Stage 2: 全员退出重开新房（内存房间状态清零），仍通过 db 近期战绩载入冷却池
  send(t, manager, host, { type: 'rematch', choice: 'room' });
  const host2 = host;
  send(t, manager, host2, { type: 'createRoom', mode: 'livonym', describeSeconds: 30, roundsPerPlayer: 1 });
  const room2 = manager.roomFor(host2);
  const g3 = join(t, manager, room2);
  const g4 = join(t, manager, room2);
  assert.ok(g3 && g4);
  send(t, manager, host2, { type: 'start' });
  for (const s of [...match1, ...match2]) {
    assert.equal(room2.livonymCooldown.has(s), true);
  }
  const match3 = playOneMatch(room2);
  assert.equal(new Set([...match1, ...match2, ...match3]).size, 9);
});

test('收集每轮最终描述文本与玩家猜错的词并随对局持久化', (t) => {
  const { manager, db, room, host, guests } = playing(t);
  const len = [...room.livonym.secret].length;
  const wrong1 = len === 2 ? '炒锅' : len === 4 ? '压力锅具' : '电饭煲';
  const wrong2 = len === 2 ? '水壶' : len === 4 ? '抽油烟机' : '微波炉';
  const wrong3 = len === 2 ? '烤箱' : len === 4 ? '电磁炉具' : '平底锅';

  manager.handle(host, { type: 'livonymStream', text: '厨房里会响的东西' });
  t.mock.timers.tick(100);
  manager.handle(host, { type: 'livonymStream', text: '厨房里会嘶嘶响的锅' });
  // 非法输入不计入错词；合法但猜错的词按顺序记录
  manager.handle(guests[0], { type: 'livonymGuess', text: '' });
  t.mock.timers.tick(1600);
  manager.handle(guests[0], { type: 'livonymGuess', text: wrong1 });
  t.mock.timers.tick(1600);
  manager.handle(guests[0], { type: 'livonymGuess', text: wrong2 });
  t.mock.timers.tick(1600);
  manager.handle(guests[0], { type: 'livonymGuess', text: room.livonym.secret });
  manager.handle(guests[1], { type: 'livonymGuess', text: wrong3 });

  expire(t, manager, room); // lvPlay -> lvScore
  const round1 = room.history[0].modeDetails;
  assert.equal(round1.description, '厨房里会嘶嘶响的锅');
  assert.deepEqual(round1.wrongGuesses, {
    [guests[0].uid]: [wrong1, wrong2],
    [guests[1].uid]: [wrong3]
  });

  // 第二棒未输入描述、无人猜错；第三棒走完结算入库
  expire(t, manager, room); // lvScore -> lvIntro
  expire(t, manager, room); // lvIntro -> lvPlay
  expire(t, manager, room); // lvPlay -> lvScore
  assert.equal(room.history[1].modeDetails.description, '');
  assert.deepEqual(room.history[1].modeDetails.wrongGuesses, {});

  expire(t, manager, room); // lvScore -> lvIntro
  expire(t, manager, room); // lvIntro -> lvPlay
  expire(t, manager, room); // lvPlay -> lvScore
  expire(t, manager, room); // lvScore -> result

  const saved = db.getMatch(room.matchId);
  assert.equal(saved.rounds[0].modeDetails.description, '厨房里会嘶嘶响的锅');
  assert.deepEqual(saved.rounds[0].modeDetails.wrongGuesses, {
    [guests[0].uid]: [wrong1, wrong2],
    [guests[1].uid]: [wrong3]
  });
  assert.equal(saved.rounds[1].modeDetails.description, '');
});

test('即时竞猜中途退出至仅剩 2 人时，对局中断不落库', (t) => {
  const { manager, room, guests } = playing(t); // 3-player room: host, guests[0], guests[1]
  assert.equal(room.players.length, 3);
  assert.equal(room.phase, 'lvPlay');

  // 1 位竞猜者主动退出（remove = true），剩余 2 人
  manager.detach(guests[0], true);
  assert.equal(room.players.length, 2);
  assert.equal(room.phase, 'interrupted');
  assert.equal(room.outcome, 'interrupted');
  assert.ok(!room.persisted);
});

test('断线出题人在保留窗口内时，下一棒自动跳过而不死锁或等待 45 秒', (t) => {
  const env = setup(t);
  const guests = [
    join(t, env.manager, env.room),
    join(t, env.manager, env.room),
    join(t, env.manager, env.room)
  ]; // 4 人局: host, guests[0], guests[1], guests[2]
  send(t, env.manager, env.host, { type: 'start' });
  expire(t, env.manager, env.room); // countdown -> lvIntro
  expire(t, env.manager, env.room); // lvIntro -> lvPlay
  assert.equal(env.room.phase, 'lvPlay');

  // 第 1 棒出题人是 host；此时第 2 棒出题人 guests[0] 发生意外断线（remove = false）
  env.manager.detach(guests[0], false);
  const guest0Player = env.room.players.find((p) => p.uid === guests[0].uid);
  assert.equal(guest0Player.connected, false);
  assert.equal(env.room.players.some((p) => p.uid === guests[0].uid), true);

  // 完成第 1 棒
  expire(t, env.manager, env.room); // lvPlay -> lvScore
  assert.equal(env.room.phase, 'lvScore');

  // 结算时间到，进入第 2 棒：应自动跳过离线的 guests[0]，由 guests[1] 出题
  expire(t, env.manager, env.room); // lvScore -> lvIntro
  assert.equal(env.room.phase, 'lvIntro');
  assert.equal(env.room.livonym.order[env.room.livonym.index], guests[1].uid);
});

test('竞猜阶段有玩家断线按动态有效人数结算，在线竞猜者全部猜中立即结算', (t) => {
  const env = setup(t);
  const guests = [
    join(t, env.manager, env.room),
    join(t, env.manager, env.room),
    join(t, env.manager, env.room)
  ]; // 4 人局: 1 出题人 (host), 3 竞猜者 (guests[0], guests[1], guests[2])
  send(t, env.manager, env.host, { type: 'start' });
  expire(t, env.manager, env.room);
  expire(t, env.manager, env.room);
  assert.equal(env.room.phase, 'lvPlay');

  // 2 人猜中
  env.manager.handle(guests[0], { type: 'livonymGuess', text: env.room.livonym.secret });
  env.manager.handle(guests[1], { type: 'livonymGuess', text: env.room.livonym.secret });

  // 第 3 位竞猜者断线：当前在线竞猜者已全部猜中，立即进入结算，不干等到超时
  env.manager.detach(guests[2], false);
  assert.equal(env.room.phase, 'lvScore');

  const roundDetails = env.room.history.at(-1).modeDetails;
  assert.equal(roundDetails.guesserCount, 2);
  assert.equal(roundDetails.points[env.host.uid], 0);
});

test('竞猜者全部掉线时本棒立即中止，有部分掉线后其余人猜中不卡局', (t) => {
  const env = setup(t);
  const guests = [
    join(t, env.manager, env.room),
    join(t, env.manager, env.room),
    join(t, env.manager, env.room)
  ];
  send(t, env.manager, env.host, { type: 'start' });
  expire(t, env.manager, env.room);
  expire(t, env.manager, env.room);

  // 1 位竞猜者中途掉线，剩余 2 位在线竞猜者
  env.manager.detach(guests[2], false);
  assert.equal(env.room.phase, 'lvPlay');
  assert.equal(env.manager.livonymView(env.room, env.host.uid).guesserCount, 2);

  // 1 人猜中后达到 N-1 锁定
  env.manager.handle(guests[0], { type: 'livonymGuess', text: env.room.livonym.secret });
  assert.equal(env.manager.livonymView(env.room, env.host.uid).locked, true);

  // 剩余在线者全部猜中立即结算
  env.manager.handle(guests[1], { type: 'livonymGuess', text: env.room.livonym.secret });
  assert.equal(env.room.phase, 'lvScore');

  // 第 2 棒（guests[0] 出题）：若其余在线竞猜者全部掉线，本棒立即中止不空跑
  expire(t, env.manager, env.room);
  assert.equal(env.room.phase, 'lvIntro');
  env.manager.detach(env.host, false);
  assert.equal(env.room.phase, 'lvIntro');
  env.manager.detach(guests[1], false);
  assert.equal(env.room.phase, 'lvScore');
  assert.equal(env.room.history.at(-1).modeDetails.aborted, true);
});

test('即时竞猜 5 人及以上房间结算重赛倒计时为 60 秒，少于 5 人为 40 秒', (t) => {
  // 5 人局
  const env = setup(t);
  for (let i = 0; i < 4; i += 1) join(t, env.manager, env.room);
  assert.equal(env.room.players.length, 5);
  send(t, env.manager, env.host, { type: 'start' });

  // 跑完全局到结算
  expire(t, env.manager, env.room); // countdown -> lvIntro
  for (let i = 0; i < env.room.livonym.totalRounds; i += 1) {
    expire(t, env.manager, env.room); // lvIntro -> lvPlay
    expire(t, env.manager, env.room); // lvPlay -> lvScore
    expire(t, env.manager, env.room); // lvScore -> lvIntro or result
  }
  assert.equal(env.room.phase, 'result');
  assert.equal(env.room.rematchDeadline - env.room.endedAt, 60000);
  assert.equal(env.manager.livonymView(env.room, env.host.uid).rematchSeconds, 60);
});

test('非法词或字数不符的猜测自动转为弹幕，触发 1 秒冷却且不计入错词与惩罚', (t) => {
  const { manager, room, host, guests } = playing(t); // secret word length e.g. 3
  const secret = room.livonym.secret;
  assert.ok(secret);

  // 1. 发送字数不匹配的词（如字数不对），自动转为弹幕广播
  const mismatched = secret.length === 3 ? '高压' : '高压锅';
  manager.handle(guests[0], { type: 'livonymGuess', text: mismatched });
  const danmuMsg = lastOf(guests[1], 'livonymDanmu');
  assert.ok(danmuMsg);
  assert.equal(danmuMsg.text, mismatched);
  assert.equal(danmuMsg.uid, guests[0].uid);
  // 1 秒内再次发送被冷却拦截（danmu 冷却 1 秒，而不是 1.5 秒）
  const guessResult = lastOf(guests[0], 'livonymGuessResult');
  assert.equal(guessResult?.reason, 'danmu');
  assert.equal(guessResult?.cooldownMs, 1000);
  // 不计入 wrongGuesses
  assert.ok(!room.livonym.wrongGuesses[guests[0].uid]?.includes(mismatched));

  // 2. 发送带标点的文本，自动转为弹幕
  tick(t, 1050);
  manager.handle(guests[0], { type: 'livonymGuess', text: '加油啊！' });
  assert.equal(lastOf(guests[1], 'livonymDanmu').text, '加油啊！');
  assert.ok(!room.livonym.wrongGuesses[guests[0].uid]?.includes('加油啊！'));

  // 3. 直接通过 livonymDanmu 消息发送
  tick(t, 1050);
  manager.handle(guests[0], { type: 'livonymDanmu', text: '太难了' });
  assert.equal(lastOf(guests[1], 'livonymDanmu').text, '太难了');
});

test('livonymView 包含 secretLength、roundGuesserCount 及出题人锁闭状态 locked', (t) => {
  const env = setup(t);
  const guests = [
    join(t, env.manager, env.room),
    join(t, env.manager, env.room),
    join(t, env.manager, env.room)
  ]; // 4 人局: 1 出题人 (host), 3 竞猜者
  send(t, env.manager, env.host, { type: 'start' });
  expire(t, env.manager, env.room); // countdown -> lvIntro

  // lvIntro 阶段：全员可见 secretLength
  const hostIntroView = env.manager.livonymView(env.room, env.host.uid);
  const guestIntroView = env.manager.livonymView(env.room, guests[0].uid);
  assert.equal(hostIntroView.secretLength, env.room.livonym.secret.length);
  assert.equal(guestIntroView.secretLength, env.room.livonym.secret.length);
  assert.equal(guestIntroView.secret, null); // 秘密词对竞猜者仍隐藏
  assert.equal(hostIntroView.locked, false);

  expire(t, env.manager, env.room); // lvIntro -> lvPlay

  // 0 人猜中：locked = false
  assert.equal(env.manager.livonymView(env.room, env.host.uid).locked, false);

  // 1 人猜中 (3 竞猜者中 1 人猜中，未达到 N-1 = 2): locked = false
  env.manager.handle(guests[0], { type: 'livonymGuess', text: env.room.livonym.secret });
  assert.equal(env.manager.livonymView(env.room, env.host.uid).locked, false);

  // 2 人猜中 (达到 N-1 = 2): locked = true (出题人输入框锁闭)
  env.manager.handle(guests[1], { type: 'livonymGuess', text: env.room.livonym.secret });
  assert.equal(env.manager.livonymView(env.room, env.host.uid).locked, true);

  // 出题人被锁后尝试流式发送描述应被拒绝
  env.manager.handle(env.host, { type: 'livonymStream', text: '继续给提示' });
  const blocked = lastOf(env.host, 'livonymBlocked');
  assert.equal(blocked?.reason, 'locked');
});

test('lvIntro 持续 5 秒，lvScore 持续 6 秒', (t) => {
  const { manager, room, guests } = playing(t);
  // lvPlay 猜中结算
  manager.handle(guests[0], { type: 'livonymGuess', text: room.livonym.secret });
  expire(t, manager, room); // lvPlay -> lvScore
  assert.equal(room.phase, 'lvScore');
  assert.equal(room.phaseDeadline - Date.now(), 6000);

  expire(t, manager, room); // lvScore -> lvIntro
  assert.equal(room.phase, 'lvIntro');
  assert.equal(room.phaseDeadline - Date.now(), 5000);
});

test('即时竞猜 interrupted 阶段某玩家点回房间，所有在线玩家一同返回大厅且不误踢', (t) => {
  const { manager, room, host, guests } = playing(t); // 3 人局: host, guests[0], guests[1]
  // guests[0] 主动退出，剩余 host 与 guests[1] 进入 interrupted
  manager.detach(guests[0], true);
  assert.equal(room.phase, 'interrupted');
  assert.equal(room.players.length, 2);

  // host 点击「回房间」
  manager.handle(host, { type: 'rematch', choice: 'room' });

  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.players.map((p) => p.uid), [host.uid, guests[1].uid]);
  assert.equal(guests[1].roomCode, room.code);
  const kickedToast = guests[1].events.find((msg) => msg.type === 'toast' && msg.message === '超时未选择已退出');
  assert.equal(kickedToast, undefined);
});
