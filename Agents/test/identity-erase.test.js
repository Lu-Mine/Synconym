import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase, DELETED_NAME } from '../../server/db.js';
import { isValidUid } from '../../server/rules.js';

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
  // 真实部署里由 index.js 注入签发器；这里给一个可断言的替身。
  manager.issueCredential = (uid) => { const token = 'c'.repeat(43); db.addCredential(uid, Buffer.from(uid)); return token; };
  return { manager, db, client };
}

function saveMatch(db, id, uid, partner) {
  db.saveMatch({
    id, roomCode: '12345', mode: 'free', themeId: null,
    maxRounds: 12, totalRounds: 3, convergedRound: 2, outcome: 'exact',
    startedAt: 1000, endedAt: 1500,
    players: [{ uid, seat: 0, name: '甲' }, { uid: partner, seat: 1, name: '乙' }],
    rounds: [{
      n: 1, words: { [uid]: '海', [partner]: '天' },
      marks: { [uid]: 'none', [partner]: 'none' },
      votes: { [uid]: true, [partner]: false },
      voteChoices: { [uid]: true, [partner]: false }, outcome: 'miss'
    }]
  });
}

test('注销把名字与同局快照替换成注销用户，身份查询视为不存在', (t) => {
  const { manager, db, client } = setup(t);
  const a = client();
  const uid = a.uid;
  saveMatch(db, 'm1', uid, 'PARTNER');

  manager.handle(a, { type: 'leaveIdentity' });

  assert.equal(db.getPlayer(uid), undefined);
  assert.equal(db.getProfile(uid), undefined);
  assert.equal(db.getNameHistory(uid).length, 0);
  const match = db.getMatch('m1');
  assert.equal(match.players[0].name, DELETED_NAME);
  assert.equal(match.players[0].deleted, true);
  assert.equal(match.players[1].name, '乙');
  assert.equal(match.players[1].deleted, undefined);
});

test('注销清掉自己写下的词、标记与投票，同局其他人的内容保持完整', (t) => {
  const { manager, db, client } = setup(t);
  const a = client();
  const uid = a.uid;
  saveMatch(db, 'm1', uid, 'PARTNER');

  manager.handle(a, { type: 'leaveIdentity' });

  const round = db.getMatch('m1').rounds[0];
  // 槽位留着，内容被抹成 null，所以渲染出来是空的。
  assert.equal(round.words[uid], null);
  assert.equal(round.words.PARTNER, '天');
  assert.equal(round.marks[uid], null);
  assert.equal(round.marks.PARTNER, 'none');
  assert.equal(round.votes[uid], null);
  assert.equal(round.votes.PARTNER, false);
  assert.equal(round.voteChoices[uid], null);
});

test('注销移除凭证、设备绑定与已移除记录，旧凭证不再能认领', (t) => {
  const { manager, db, client } = setup(t);
  const a = client();
  const uid = a.uid;
  const hash = db.getCredentialHash(uid);
  db.insertDevice({ deviceKey: 'device-x', weakKey: 'weak-x', profileJson: '{}' });
  db.linkDevice('device-x', uid, 'created');
  // 这台设备就是当前连接，脱离时会被解绑。
  a.deviceKey = 'device-x';
  saveMatch(db, 'm1', uid, 'PARTNER');
  manager.handle(a, { type: 'deleteMatch', id: 'm1' });
  assert.equal(db.countHiddenMatches(uid), 1);

  manager.handle(a, { type: 'leaveIdentity' });

  assert.equal(db.getCredentialHash(uid), undefined);
  assert.equal(db.credentialOwner(hash), undefined);
  // 本设备重新绑到新身份，旧身份在上面不留绑定。
  assert.equal(db.getDeviceLinks('device-x').some((link) => link.uid === uid), false);
  assert.equal(db.getDeviceLinks('device-x').some((link) => link.uid === a.uid), true);
  // 设备行与绑定行都还在，只是绑定被标记失效。
  assert.ok(db.getDevice('device-x'));
  assert.equal(db.countHiddenMatches(uid), 0);
  // 连接拿到的是全新身份
  assert.notEqual(a.uid, uid);
  assert.ok(db.getPlayer(a.uid));
  const identity = a.messages.filter((m) => m.type === 'identity').at(-1);
  assert.equal(identity.uid, a.uid);
  assert.equal(identity.orphaned, true);
  assert.match(identity.credential, /^[A-Za-z0-9_-]{43}$/);
});

test('脱离后同一个 uid 无法再被复用', (t) => {
  const { manager, db, client } = setup(t);
  const a = client();
  const uid = a.uid;
  manager.handle(a, { type: 'leaveIdentity' });
  const revived = manager.connect(uid);
  assert.notEqual(revived.uid, uid);
  assert.ok(isValidUid(revived.uid));
  assert.equal(db.getPlayer(uid), undefined);
});

test('在房间里注销按主动退出处理，其他人收到提示', (t) => {
  const { manager, db, client } = setup(t);
  const a = client();
  const b = client();
  manager.handle(a, { type: 'createRoom' });
  const code = manager.clients.get(a.uid).roomCode;
  manager.handle(b, { type: 'joinRoom', code });
  b.messages.length = 0;

  manager.handle(a, { type: 'leaveIdentity' });

  const room = manager.rooms.get(code);
  assert.ok(room.players.every((player) => player.uid !== a.uid));
  assert.match(b.messages.filter((m) => m.type === 'toast').at(-1).message, /已主动退出房间/);
  assert.ok(db.getPlayer(b.uid));
});

test('注销只把数据标记成失效，行本身留在库里', async (t) => {
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  const { rmSync } = await import('node:fs');
  const { default: Database } = await import('better-sqlite3');
  const file = join(tmpdir(), `synconym-erase-${randomUUID()}.db`);
  const cleanup = () => { for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true }); };
  const db = createDatabase(file);
  const uid = 'UIDERASE';
  db.createPlayer(uid, '甲', 1000);
  db.addCredential(uid, Buffer.from(uid), 1000);
  db.insertDevice({ deviceKey: 'device-x', weakKey: 'weak-x', profileJson: '{}' }, 1000);
  db.linkDevice('device-x', uid, 'created', 1000);
  db.hideMatch(uid, 'm1', 1000);

  assert.equal(db.eraseIdentity(uid, 2000), true);
  db.close();

  const raw = new Database(file, { readonly: true });
  t.after(() => { raw.close(); cleanup(); });
  const player = raw.prepare('SELECT uid, name, deleted_at FROM players WHERE uid = ?').get(uid);
  assert.equal(player.name, DELETED_NAME);
  assert.equal(player.deleted_at, 2000);
  const names = raw.prepare('SELECT name, disabled_at FROM name_history WHERE uid = ?').all(uid);
  assert.equal(names.length, 1);
  assert.equal(names[0].disabled_at, 2000);
  const credential = raw.prepare('SELECT uid, disabled_at FROM credentials WHERE uid = ?').get(uid);
  assert.equal(credential.disabled_at, 2000);
  const link = raw.prepare('SELECT uid, disabled_at FROM device_links WHERE device_key = ?').get('device-x');
  assert.equal(link.disabled_at, 2000);
  const hidden = raw.prepare('SELECT uid, disabled_at FROM match_hidden WHERE uid = ?').get(uid);
  assert.equal(hidden.disabled_at, 2000);
  assert.ok(raw.prepare('SELECT 1 FROM devices WHERE device_key = ?').get('device-x'));
});

test('注销身份同时擦除 breakVote.choices 与内存房间的在途快照', (t) => {
  const { manager, db, client } = setup(t);
  const a = client();
  const b = client();
  const uid = a.uid;
  const keep = b.uid;
  db.saveMatch({
    id: 'm-break',
    roomCode: '12345',
    mode: 'free',
    themeId: null,
    maxRounds: 12,
    totalRounds: 1,
    convergedRound: null,
    outcome: 'none',
    startedAt: 1000,
    endedAt: 1500,
    players: [{ uid, seat: 0, name: '破局者' }, { uid: keep, seat: 1, name: '留守者' }],
    rounds: [{
      n: 1,
      words: { [uid]: '秘密词', [keep]: '公开词' },
      marks: { [uid]: 'none', [keep]: 'none' },
      votes: { [uid]: false, [keep]: false },
      voteChoices: { [uid]: false, [keep]: false },
      outcome: 'miss',
      breakVote: { triggeredBy: uid, choices: { [uid]: true, [keep]: false }, passed: false },
    }],
  });

  db.eraseIdentity(uid, 3000);
  const detail = db.getMatch('m-break');
  assert.equal(detail.rounds[0].breakVote.choices[uid], null);
  assert.equal(detail.rounds[0].breakVote.choices[keep], false);

  // 验证多标签页下，一个标签页退出/注销身份时，另一个处于房间内的标签页被立刻移出且房间内存历史被匿名化
  const tab1 = client();
  const tab2 = manager.connect(tab1.uid);
  tab2.messages = [];
  tab2.ws = { readyState: 1, send: (data) => tab2.messages.push(JSON.parse(data)) };
  let tab1ClosedCode = null;
  tab1.ws.close = (code) => { tab1ClosedCode = code; };

  manager.handle(tab1, { type: 'createRoom' });
  const code = tab1.messages.find((m) => m.type === 'state').room.code;
  manager.handle(b, { type: 'joinRoom', code });

  const room = manager.rooms.get(code);
  room.history.push({
    n: 1,
    words: { [tab1.uid]: '敏感词', [b.uid]: '敏感词' },
    marks: { [tab1.uid]: 'none', [b.uid]: 'none' },
    votes: {},
    voteChoices: {},
    outcome: 'exact',
    breakVote: { choices: { [tab1.uid]: true, [b.uid]: false }, passed: false },
  });
  room.matchPlayers = [{ uid: tab1.uid, seat: 0, name: tab1.name }, { uid: b.uid, seat: 1, name: b.name }];

  const abandonedUid = tab1.uid;
  manager.handle(tab2, { type: 'leaveIdentity' });
  assert.equal(tab1ClosedCode, 4001);
  assert.equal(room.players.some((p) => p.uid === abandonedUid), false);
  assert.equal(room.matchPlayers.find((p) => p.uid === abandonedUid).name, DELETED_NAME);
  assert.equal(room.history[0].words[abandonedUid], null);
  assert.equal(room.history[0].breakVote.choices[abandonedUid], null);
});

