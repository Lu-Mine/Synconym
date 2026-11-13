import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, createMemoryDb } from '../../server/rooms.js';
import { DEFAULT_SETTINGS, isValidUid, normalizeWord, validateCode, validateName, validateSettings } from '../../server/rules.js';
import { avatarDetails, homeMarkup, lobbyMarkup, lobbyPlayersMarkup, playerItemMarkup, shellMarkup, thoughtPathMarkup, writingMarkup } from '../../public/render.js';
import { parseRoomCode } from '../../public/room-code.js';

function client(manager, uid) {
  const connection = manager.connect(uid);
  connection.ws = { readyState: 1, send() {}, close() {} };
  return connection;
}
function passRateLimit(t) { t.mock.timers.tick(501); }

test('房间玩家列表始终显示四个席位，离线玩家保留席位', () => {
  const players = Array.from({ length: 4 }, (_, seat) => ({ uid: `player${seat}`, name: `玩家${seat}`, seat, connected: seat !== 1 }));
  for (let count = 1; count <= 4; count++) {
    const room = { code: '12345', phase: 'lobby', hostUid: players[0].uid, players: players.slice(0, count), settings: {} };
    const list = lobbyPlayersMarkup(room, players[0].uid);
    assert.equal((list.match(/<li class="player /g) || []).length, 4);
    assert.equal((list.match(/player-empty"/g) || []).length, 4 - count);
    assert.match(lobbyMarkup({ room, uid: players[0].uid }), new RegExp(`${count} / 4`));
    if (count < 4) assert.match(list, /2–4 人即可开玩/);
    if (count > 1) assert.match(list, /连接中断/);
  }
});

test('人数上限大于 4 的房间自动折叠多余空位并显示省略提示', () => {
  const players = Array.from({ length: 8 }, (_, seat) => ({ uid: `player${seat}`, name: `玩家${seat}`, seat, connected: true }));
  for (const [mode, capacity] of [['impostor', 6], ['livonym', 8]]) {
    for (let count = 1; count <= capacity; count++) {
      const room = { code: '12345', mode, phase: 'lobby', hostUid: players[0].uid, players: players.slice(0, count), settings: {} };
      const list = lobbyPlayersMarkup(room, players[0].uid);
      const emptyCount = capacity - count;
      assert.equal((list.match(/<li class="player (?!player-empty-more)/g) || []).length, emptyCount > 1 ? count + 1 : capacity);
      assert.equal((list.match(/player-empty"/g) || []).length, emptyCount > 1 ? 1 : emptyCount);
      assert.doesNotMatch(list, /<details/);
      if (emptyCount > 1) {
        const foldedCount = emptyCount - 1;
        assert.match(list, /#icon-ellipsis/);
        assert.match(list, new RegExp(`还有 ${foldedCount} 个空位`));
      } else {
        assert.doesNotMatch(list, /player-empty-more/);
        assert.doesNotMatch(list, /还有 \d+ 个空位/);
      }
    }
  }
});

test('名字默认生成，改名保留 uid 并写入数据库', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const db = createMemoryDb();
  const manager = new RoomManager({ db });
  const a = client(manager);
  manager.handle(a, { type: 'createRoom' });
  const uid = a.uid;
  passRateLimit(t);
  manager.handle(a, { type: 'rename', name: '新的名字' });
  assert.equal(db.getPlayer(uid).name, '新的名字');
  assert.equal(manager.roomFor(a).players[0].uid, uid);
});

test('未进入房间也可以修改名字并收到用户资料状态', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const db = createMemoryDb();
  const manager = new RoomManager({ db });
  const states = [];
  const connection = manager.connect();
  connection.ws = { readyState: 1, send(payload) { states.push(JSON.parse(payload)); }, close() {} };

  manager.sendState(connection, null);
  assert.equal(states.at(-1).user.uid, connection.uid);
  assert.equal(states.at(-1).user.name, db.getPlayer(connection.uid).name);
  assert.equal(states.at(-1).room, null);

  passRateLimit(t);
  manager.handle(connection, { type: 'rename', name: '首页新名字' });
  assert.equal(db.getPlayer(connection.uid).name, '首页新名字');
  assert.equal(states.at(-1).user.name, '首页新名字');
});

test('房间状态下发空闲截止时间，有活动后重置为五分钟', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const states = [];
  const manager = new RoomManager({ db: createMemoryDb() });
  const attach = (connection) => {
    connection.ws = { readyState: 1, send(payload) { states.push(JSON.parse(payload)); }, close() {} };
    return connection;
  };
  const idleMs = 5 * 60 * 1000;
  const host = attach(manager.connect());
  manager.handle(host, { type: 'createRoom' });
  const room = manager.roomFor(host);
  assert.equal(states.at(-1).room.idleDeadline, room.lastActiveAt + idleMs);

  t.mock.timers.tick(2 * 60 * 1000);
  const guest = attach(manager.connect());
  manager.handle(guest, { type: 'joinRoom', code: room.code });
  assert.equal(states.at(-1).room.idleDeadline, Date.now() + idleMs);
  assert.ok(states.at(-1).room.idleDeadline > room.createdAt + idleMs);
  assert.match(lobbyMarkup({ room, uid: host.uid, user: { uid: host.uid, name: '甲' } }), /id="idle-countdown"/);
});

test('房主固定在第一位，其余按加入顺序，房主可点击转让', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db: createMemoryDb() });
  const host = client(manager);
  manager.handle(host, { type: 'createRoom' });
  const room = manager.roomFor(host);
  const late = client(manager);
  passRateLimit(t);
  manager.handle(late, { type: 'joinRoom', code: room.code });
  const mid = client(manager);
  passRateLimit(t);
  manager.handle(mid, { type: 'joinRoom', code: room.code });

  assert.deepEqual(room.players.map((player) => player.uid), [host.uid, late.uid, mid.uid]);

  passRateLimit(t);
  assert.throws(() => manager.handle(late, { type: 'transferHost', uid: host.uid }), /只有房主/);
  passRateLimit(t);
  assert.throws(() => manager.handle(host, { type: 'transferHost', uid: host.uid }), /已经是房主/);
  passRateLimit(t);
  assert.throws(() => manager.handle(host, { type: 'transferHost', uid: 'nobody' }), /没有找到/);

  passRateLimit(t);
  manager.handle(host, { type: 'transferHost', uid: mid.uid });
  assert.equal(room.hostUid, mid.uid);
  assert.deepEqual(room.players.map((player) => player.uid), [mid.uid, host.uid, late.uid]);
  assert.equal(room.players.find((player) => player.uid === mid.uid).ready, false);
  assert.equal(room.players.find((player) => player.uid === host.uid).ready, false);

  // 开局后不能再转让
  passRateLimit(t);
  manager.handle(host, { type: 'setReady', ready: true });
  passRateLimit(t);
  manager.handle(late, { type: 'setReady', ready: true });
  passRateLimit(t);
  manager.handle(mid, { type: 'start' });
  assert.equal(room.phase, 'countdown');
  manager.advanceDeadline(room);
  assert.equal(room.phase, 'writing');
  passRateLimit(t);
  assert.throws(() => manager.handle(mid, { type: 'transferHost', uid: host.uid }), /开局后/);
});

test('只有在线玩家能被选为新房主，断线玩家不可转让', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager({ db: createMemoryDb() });
  const host = client(manager);
  manager.handle(host, { type: 'createRoom' });
  const room = manager.roomFor(host);
  const guest = client(manager);
  passRateLimit(t);
  manager.handle(guest, { type: 'joinRoom', code: room.code });
  const guestPlayer = room.players.find((player) => player.uid === guest.uid);
  assert.match(playerItemMarkup(guestPlayer, room, host.uid), /data-action="transfer-host"/);

  manager.disconnect(guest);
  assert.equal(guestPlayer.connected, false);
  assert.doesNotMatch(playerItemMarkup(guestPlayer, room, host.uid), /transfer-host/);
  passRateLimit(t);
  assert.throws(() => manager.handle(host, { type: 'transferHost', uid: guest.uid }), /不在线/);
  assert.equal(room.hostUid, host.uid);
});

test('凭房号加入、改名、准备、取消、房主无需准备即可开始', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager();
  const host = client(manager);
  manager.handle(host, { type: 'createRoom' });
  const room = manager.roomFor(host);
  const guest = client(manager);
  passRateLimit(t);
  manager.handle(guest, { type: 'joinRoom', code: room.code.toLowerCase() });
  assert.equal(room.players.length, 2);
  passRateLimit(t);
  assert.throws(() => manager.handle(host, { type: 'start' }), /所有在线玩家准备/);
  passRateLimit(t);
  manager.handle(guest, { type: 'rename', name: '同席新名字' });
  passRateLimit(t);
  assert.throws(() => manager.handle(host, { type: 'setReady', ready: true }), /房主无需准备/);
  passRateLimit(t);
  manager.handle(guest, { type: 'setReady', ready: true });
  passRateLimit(t);
  manager.handle(guest, { type: 'setReady', ready: false });
  passRateLimit(t);
  manager.handle(guest, { type: 'setReady', ready: true });
  passRateLimit(t);
  manager.handle(host, { type: 'start' });
  assert.equal(room.phase, 'countdown');
  manager.advanceDeadline(room);
  assert.equal(room.phase, 'writing');
  assert.equal(room.round, 1);
  assert.equal(manager.playerFor(room, guest.uid).name, '同席新名字');
});

test('断线 90 秒内保留席位，超过后移除并移交房主', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager();
  const host = client(manager);
  manager.handle(host, { type: 'createRoom' });
  const room = manager.roomFor(host);
  const guest = client(manager);
  passRateLimit(t);
  manager.handle(guest, { type: 'joinRoom', code: room.code });
  const seat = manager.playerFor(room, guest.uid).seat;
  manager.disconnect(guest);
  assert.equal(room.players.length, 2);
  const restored = client(manager, guest.uid);
  restored.roomCode = room.code;
  assert.equal(manager.playerFor(room, guest.uid).seat, seat);
  manager.disconnect(restored);
  t.mock.timers.tick(90001);
  manager.cleanup();
  assert.equal(room.players.length, 1);
  manager.disconnect(host);
  assert.equal(room.hostUid, host.uid);
  t.mock.timers.tick(90001);
  manager.cleanup();
  assert.equal(manager.rooms.has(room.code), false);
});

test('非房主不能改设置，四人满房，五分钟无活动清理', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const manager = new RoomManager();
  const host = client(manager);
  manager.handle(host, { type: 'createRoom' });
  const room = manager.roomFor(host);
  const guests = [client(manager), client(manager), client(manager)];
  for (const guest of guests) {
    passRateLimit(t);
    manager.handle(guest, { type: 'joinRoom', code: room.code });
  }
  passRateLimit(t);
  assert.throws(() => manager.handle(guests[0], { type: 'updateSettings', maxRounds: 20 }), /只有房主/);
  passRateLimit(t);
  manager.handle(host, { type: 'updateSettings', maxRounds: 20, writeSeconds: 60 });
  assert.equal(room.maxRounds, 20);
  const fifth = client(manager);
  passRateLimit(t);
  assert.throws(() => manager.handle(fifth, { type: 'joinRoom', code: room.code }), /房间已满/);
  room.lastActiveAt = Date.now() - 300001;
  manager.cleanup();
  assert.equal(manager.rooms.has(room.code), false);
});

test('规则校验与繁简、空格归一', () => {
  assert.equal(normalizeWord(' iOS 手机 '), normalizeWord('ｉＯＳ手机'));
  assert.equal(normalizeWord('憂鬱'), normalizeWord('忧郁'));
  assert.equal(validateSettings({}).maxRounds, 12);
  assert.throws(() => validateSettings({ maxRounds: 3 }));
  assert.equal(validateName(' 名字 '), '名字');
  assert.throws(() => validateName('十三个字符的名字不能通过验证'));
});

test('设置校验兼容字符串数值，且所有控件按钮均显式声明 type 防止页面刷新', () => {
  const parsed = validateSettings({ maxRounds: '16', writeSeconds: '30', prepareSeconds: '15', banRepeat: false });
  assert.deepEqual(parsed, { mode: 'free', maxRounds: 16, writeSeconds: 30, prepareSeconds: 15, banRepeat: false, passwordEnabled: false, password: '' });

  const sampleRoom = {
    code: '12345',
    ...DEFAULT_SETTINGS,
    phase: 'lobby',
    round: 1,
    hostUid: 'u1',
    players: [
      { uid: 'u1', name: '甲', seat: 0, connected: true, ready: false },
      { uid: 'u2', name: '乙', seat: 1, connected: true, ready: true }
    ]
  };
  const markups = [
    shellMarkup(true, { uid: 'user-uid', name: '甲' }, true),
    homeMarkup(DEFAULT_SETTINGS, true),
    lobbyMarkup({ room: sampleRoom, uid: 'u1', user: { uid: 'u1', name: '甲' } }, true),
    writingMarkup({ room: { ...sampleRoom, phase: 'writing' }, uid: 'u1', user: { uid: 'u1', name: '甲' } })
  ];
  const allTags = markups.flatMap((html) => html.match(/<button\b[^>]*>/g) || []);
  assert.ok(allTags.length > 0);
  for (const tag of allTags) {
    assert.match(tag, /\btype="(button|submit)"/, `按钮缺少显式 type 属性: ${tag}`);
  }
});

test('header 展示用户与 UID，玩家改名按钮位于名字右侧', () => {
  const shell = shellMarkup(false, { uid: 'uid-123', name: '测试用户' }, true);
  assert.match(shell, /header-user-name[^>]*>测试用户</);
  assert.match(shell, /UID：uid-123/);
  assert.match(shell, /rename-modal is-open/);

  const room = {
    code: '12345', ...DEFAULT_SETTINGS, phase: 'lobby', round: 0, hostUid: 'u1',
    players: [{ uid: 'u1', name: '甲', seat: 0, connected: true, ready: false }]
  };
  const lobby = lobbyMarkup({ room, uid: 'u1', user: { uid: 'u1', name: '甲' } });
  assert.match(lobby, /player-name-row[\s\S]*player-name[^>]*>甲<[\s\S]*rename-trigger[\s\S]*<\/div>/);
  assert.match(shell, /id="transfer-modal" inert[\s\S]*id="transfer-target-name"[\s\S]*data-action="confirm-transfer"/);
  assert.match(shell, /data-action="cancel-transfer"[\s\S]*data-action="confirm-transfer"/);
});

test('文字头像按完整名字稳定映射四种配色', () => {
  const first = avatarDetails('随和的荔枝');
  assert.deepEqual(avatarDetails('随和的荔枝'), first);
  assert.equal(first.initial, '随');
  assert.equal(avatarDetails('Alice').initial, 'A');
  const tones = new Set(Array.from({ length: 64 }, (_, index) => `用户${index}`)
    .map((name) => avatarDetails(name).tone));
  assert.deepEqual([...tones].sort(), [0, 1, 2, 3]);

  const shell = shellMarkup(false, { uid: 'u1', name: '随和的荔枝' });
  assert.match(shell, new RegExp(`<img class="avatar header-avatar" data-avatar-name="随和的荔枝" data-avatar-tone="${first.tone}" alt=""`));
});

test('房号为 5 位纯数字，UID 为 8 位去掉易混字符的数字字母组合', () => {
  const manager = new RoomManager({ db: createMemoryDb() });
  for (let index = 0; index < 50; index += 1) {
    const code = manager.makeCode();
    assert.match(code, /^[1-9][0-9]{4}$/);
    assert.ok(!manager.rooms.has(code));
    manager.rooms.set(code, {});
  }
  assert.match(manager.makeCode(), /^[1-9][0-9]{4}$/);
  for (let index = 0; index < 50; index += 1) {
    const uid = manager.makeUid();
    assert.match(uid, /^[23456789A-HJ-KM-NP-Z]{8}$/);
    assert.doesNotMatch(uid, /[01OIL]/);
    manager.db.createPlayer(uid, '占位');
  }
  assert.equal(manager.makeUid().length, 8);
});

test('房号校验只接受 5 位数字，UID 校验只接受 8 位安全字符', () => {
  assert.equal(validateCode('12345'), '12345');
  assert.equal(validateCode('01234'), '01234');
  assert.equal(validateCode(' １２３４５ '), '12345');
  assert.throws(() => validateCode('ABCDE'), /5 位数字房号/);
  assert.throws(() => validateCode('1234'), /5 位数字房号/);
  assert.throws(() => validateCode('123456'), /5 位数字房号/);
  assert.throws(() => validateCode(12345), /5 位数字房号/);

  assert.equal(isValidUid('ABCD2345'), true);
  assert.equal(isValidUid('abcd2345'), false);
  assert.equal(isValidUid('ABCD234'), false);
  assert.equal(isValidUid('ABCD23O5'), false);
  assert.equal(isValidUid('ABCD23I5'), false);
  assert.equal(isValidUid(undefined), false);
});

test('新连接拿到 8 位 UID，旧的长 UID 会被换成新的短 UID', () => {
  const manager = new RoomManager({ db: createMemoryDb() });
  const first = manager.connect();
  assert.match(first.uid, /^[23456789A-HJ-KM-NP-Z]{8}$/);
  const restored = manager.connect(first.uid);
  assert.equal(restored.uid, first.uid);
  const legacy = manager.connect('9d1c5f2a-7b3e-4c8d-9f10-2a3b4c5d6e7f');
  assert.match(legacy.uid, /^[23456789A-HJ-KM-NP-Z]{8}$/);
  assert.notEqual(legacy.uid, '9d1c5f2a-7b3e-4c8d-9f10-2a3b4c5d6e7f');
});

test('加入房间输入框支持房号和邀请链接，并调起数字键盘', () => {
  const home = homeMarkup(DEFAULT_SETTINGS, false);
  assert.match(home, /id="room-code"[^>]*inputmode="numeric"/);
  assert.doesNotMatch(home, /id="room-code"[^>]*(?:pattern|maxlength)=/);
  assert.match(home, /placeholder="输入 5 位数房间号，或直接粘贴邀请链接"/);
  assert.match(home, /data-action="paste-invite"><svg[^>]*><use href="\/icons\.svg#icon-clipboard-paste"><\/use><\/svg><span>粘贴邀请链接<\/span>/);
  assert.doesNotMatch(home, /class="button secondary join-submit"/);
  assert.equal(parseRoomCode('63068'), '63068');
  assert.equal(parseRoomCode(' ６３０６８ '), '63068');
  assert.equal(parseRoomCode('http://example.com/?r=63068'), '63068');
  assert.equal(parseRoomCode('https://example.com/?x=1&r=01234#section'), '01234');
  for (const input of ['1234', '123456', 'http://example.com/?r=1234', 'http://12345.example/?x=63068', 'http://example.com/?r=12345&r=67890', 'javascript:?r=12345', 'invalid']) {
    assert.equal(parseRoomCode(input), '', input);
  }
});

test('各阶段玩家状态使用一致的语义颜色，投票选择保持隐藏', () => {
  const room = { code: '12345', hostUid: 'host', phase: 'lobby', round: 1, maxRounds: 4, players: [] };
  const player = (uid, extra = {}) => ({ uid, name: uid, seat: 0, connected: true, ...extra });
  for (const [p, key, label, glyph] of [
    [player('host'), 'host', '房主', 'user'],
    [player('a'), 'waiting', '未准备', 'clock'],
    [player('a', { ready: true }), 'done', '已准备', 'check'],
    [player('a', { connected: false, ready: true }), 'away', '连接中断', 'log-out']
  ]) {
    const html = playerItemMarkup(p, room, 'host');
    assert.match(html, new RegExp(`status-${key}`));
    assert.match(html, new RegExp(`icons.svg#icon-${glyph}[^]*?<span>${label}</span>`));
    assert.doesNotMatch(html, /等待重连/);
  }
  for (const [phase, extra, key, label] of [
    ['writing', {}, 'waiting', '未开始'],
    ['writing', { typing: true }, 'active', '正在输入'],
    ['writing', { submitted: true }, 'done', '已提交'],
    ['voting', {}, 'waiting', '未投票'],
    ['voting', { voted: true }, 'done', '已投票'],
    ['prepare', {}, 'waiting', '未准备'],
    ['prepare', { ready: true }, 'done', '已准备'],
    ['prepare', { connected: false }, 'away', '连接中断']
  ]) {
    const html = writingMarkup({ uid: 'other', room: { ...room, phase, players: [player('a', extra)] } });
    assert.match(html, new RegExp(`game-status status-${key}`));
    assert.match(html, new RegExp(label));
    assert.match(html, /game-status-avatar/);
    const expectedIcon = { waiting: 'clock', active: 'pen-line', done: 'check', away: 'log-out' }[key];
    assert.match(html, new RegExp(`game-status-icon[^>]*><use href="/icons.svg#icon-${expectedIcon}"`));
  }
  const result = writingMarkup({ uid: 'other', room: { ...room, phase: 'result', players: [player('a')] } });
  assert.doesNotMatch(result, /game-status status-/);
});

test('思考路径按轮次展示已揭晓词语，不泄露写词阶段当前轮', () => {
  const players = [{ uid: 'a', name: '<甲>', seat: 0 }, { uid: 'b', name: '乙', seat: 1 }];
  const history = [{ n: 1, words: { a: '苹果', b: '[未提交]' }, marks: { a: 'none', b: 'empty' } }];
  assert.match(thoughtPathMarkup({ players, history: [], phase: 'writing' }), /还没有揭晓/);
  const writing = thoughtPathMarkup({ players, history, phase: 'writing', round: 2, words: { a: '秘密' } });
  assert.match(writing, /&lt;甲&gt;/);
  assert.match(writing, /苹果/);
  assert.match(writing, /\[未提交\]/);
  assert.doesNotMatch(writing, /秘密/);
  const voting = thoughtPathMarkup({ players, history, phase: 'voting', round: 2, words: { a: '香蕉', b: '[非法答案]' }, marks: { b: 'invalid' } });
  assert.match(voting, /香蕉/);
  assert.match(voting, /\[非法答案\]/);
  assert.equal((voting.match(/第 2 轮/g) || []).length, 1);
  assert.equal((voting.match(/class="path-answer"/g) || []).length, 4);
  assert.equal((voting.match(/path-avatar/g) || []).length, 2);
  assert.match(voting, /--path-players:2/);
  assert.doesNotMatch(voting, /path-connector/);
  assert.match(voting, /path-table-header[^]*?path-avatar[^]*?&lt;甲&gt;[^]*?path-avatar[^]*?乙/);
  assert.match(shellMarkup(true, { uid: 'a', name: '甲' }), /id="path-title"[^]*?icons.svg#icon-route/);
  assert.ok(voting.indexOf('第 1 轮') < voting.indexOf('苹果'));
  assert.ok(voting.indexOf('苹果') < voting.indexOf('第 2 轮'));
  assert.ok(voting.indexOf('第 2 轮') < voting.indexOf('香蕉'));
  const finished = thoughtPathMarkup({ players, history: [...history, { n: 2, words: { a: '香蕉' }, marks: {} }], phase: 'result', round: 2, words: { a: '香蕉' } });
  assert.equal((finished.match(/第 2 轮/g) || []).length, 1);
  for (const phase of ['writing', 'voting', 'prepare', 'result']) {
    const html = writingMarkup({ uid: 'a', room: { phase, round: 2, players, code: '12345', history } });
    if (phase === 'writing') assert.doesNotMatch(html, /data-action="open-path"/);
    else assert.match(html, /data-action="open-path"/);
    if (phase !== 'writing') assert.equal((writingMarkup({ uid: 'a', room: { phase, players, code: '12345', history } }).match(/previous-word-avatar/g) || []).length, 2);
  }
});

test('写词输入上方仅展示上一轮已揭晓的所有玩家词语', () => {
  const players = [{ uid: 'a', name: '甲', seat: 0 }, { uid: 'b', name: '乙', seat: 1 }];
  const history = [{ n: 1, words: { a: '苹果', b: '[未提交]' }, marks: { a: 'none', b: 'empty' } }];
  const first = writingMarkup({ uid: 'a', room: { phase: 'writing', round: 1, players, history: [] } });
  assert.doesNotMatch(first, /上一轮的词/);
  const second = writingMarkup({ uid: 'a', room: { phase: 'writing', round: 2, players, history } });
  assert.ok(second.indexOf('上一轮的词') < second.indexOf('id="word-form"'));
  assert.match(second, /苹果/);
  assert.match(second, /\[未提交\]/);
  assert.match(second, /甲/);
  assert.match(second, /乙/);
  assert.equal((second.match(/class="word-card previous-word-card"/g) || []).length, 2);
  assert.equal((second.match(/previous-word-avatar/g) || []).length, 2);
  assert.match(second, /previous-word-player[^]*?previous-word-avatar[^]*?<span>甲<\/span>/);
  const missing = writingMarkup({ uid: 'a', room: { phase: 'writing', round: 3, players, history } });
  assert.doesNotMatch(missing, /上一轮的词/);
});

test('词卡按席位配色，仅标记部分玩家相同的有效词语', () => {
  const players = ['a', 'b', 'c', 'd'].map((uid, seat) => ({ uid, seat, name: uid, connected: true }));
  const room = { phase: 'voting', round: 1, players, words: { a: '臺灣', b: '台湾', c: '苹果', d: '[未提交]' }, marks: { a: 'none', b: 'none', c: 'none', d: 'empty' }, wordKeys: { a: '台湾', b: '台湾', c: '苹果' } };
  const html = writingMarkup({ uid: 'a', room });
  assert.equal((html.match(/class="word-duplicate"/g) || []).length, 2);
  assert.match(html, /class="word-duplicate">臺灣/);
  assert.match(html, /class="word-duplicate">台湾/);
  for (let seat = 0; seat < 4; seat++) assert.match(html, new RegExp(`--player:var\\(--player-${seat}\\)`));
  const all = writingMarkup({ uid: 'a', room: { ...room, words: { a: '雨', b: '雨', c: '雨', d: '雨' }, marks: {}, wordKeys: { a: '雨', b: '雨', c: '雨', d: '雨' } } });
  assert.doesNotMatch(all, /word-duplicate/);
  const empty = writingMarkup({ uid: 'a', room: { ...room, words: { a: '[未提交]', b: '[未提交]' }, marks: { a: 'empty', b: 'empty' }, wordKeys: {} } });
  assert.doesNotMatch(empty, /word-duplicate/);
});

test('阶段进度居中区标记当前环节，思考路径入口位于词汇标题', () => {
  const players = [{ uid: 'a', name: '甲', seat: 0 }];
  const history = [{ n: 1, words: { a: '苹果' }, marks: { a: 'none' } }];
  for (const [phase, label] of [['writing', '写词'], ['voting', '投票'], ['prepare', '准备']]) {
    const html = writingMarkup({ uid: 'a', room: { phase, round: 2, maxRounds: 12, code: '12345', players, history } });
    assert.match(html, new RegExp(`aria-current="step"[^]*?stage-step-label">${label}`));
    for (const glyph of ['pen-line', 'check', 'play']) assert.match(html, new RegExp(`icons.svg#icon-${glyph}`));
    assert.match(html, /class="stage-round"[^]*?class="stage-progress"[^]*?class="room-code-display stage-room"[^]*?icon-door-open/);
    if (phase === 'writing') assert.doesNotMatch(html, /data-action="open-path"/);
    else {
      assert.match(html, /class="section-heading"><h2>本轮的词<\/h2><button class="path-open"/);
      assert.equal((html.match(/data-action="open-path"/g) || []).length, 1);
    }
  }
  const first = writingMarkup({ uid: 'a', room: { phase: 'writing', round: 1, players, history: [] } });
  assert.doesNotMatch(first, /data-action="open-path"/);
  for (const phase of ['voting', 'prepare']) assert.doesNotMatch(writingMarkup({ uid: 'a', room: { phase, round: 1, players, history } }), /data-action="open-path"/);
  assert.match(writingMarkup({ uid: 'a', room: { phase: 'writing', round: 3, players, history: [{ ...history[0], n: 2 }] } }), /data-action="open-path"/);
});
