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

  manager.handle(a, { type: 'eraseIdentity' });

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

  manager.handle(a, { type: 'eraseIdentity' });

  const round = db.getMatch('m1').rounds[0];
  assert.equal(round.words[uid], undefined);
  assert.equal(round.words.PARTNER, '天');
  assert.equal(round.marks[uid], undefined);
  assert.equal(round.marks.PARTNER, 'none');
  assert.equal(round.votes[uid], undefined);
  assert.equal(round.votes.PARTNER, false);
  assert.equal(round.voteChoices[uid], undefined);
});

test('注销移除凭证、设备绑定与已移除记录，旧凭证不再能认领', (t) => {
  const { manager, db, client } = setup(t);
  const a = client();
  const uid = a.uid;
  const hash = db.getCredentialHash(uid);
  db.insertDevice({ deviceKey: 'device-x', weakKey: 'weak-x', profileJson: '{}' });
  db.linkDevice('device-x', uid, 'created');
  saveMatch(db, 'm1', uid, 'PARTNER');
  manager.handle(a, { type: 'deleteMatch', id: 'm1' });
  assert.equal(db.countHiddenMatches(uid), 1);

  manager.handle(a, { type: 'eraseIdentity' });

  assert.equal(db.getCredentialHash(uid), undefined);
  assert.equal(db.credentialOwner(hash), undefined);
  assert.equal(db.getDeviceLinks('device-x').length, 0);
  assert.equal(db.getDevice('device-x'), undefined);
  assert.equal(db.countHiddenMatches(uid), 0);
  // 连接拿到的是全新身份
  assert.notEqual(a.uid, uid);
  assert.ok(db.getPlayer(a.uid));
  const identity = a.messages.filter((m) => m.type === 'identity').at(-1);
  assert.equal(identity.uid, a.uid);
  assert.equal(identity.erased, true);
  assert.match(identity.credential, /^[A-Za-z0-9_-]{43}$/);
});

test('注销后同一个 uid 无法再被复用', (t) => {
  const { manager, db, client } = setup(t);
  const a = client();
  const uid = a.uid;
  manager.handle(a, { type: 'eraseIdentity' });
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

  manager.handle(a, { type: 'eraseIdentity' });

  const room = manager.rooms.get(code);
  assert.ok(room.players.every((player) => player.uid !== a.uid));
  assert.match(b.messages.filter((m) => m.type === 'toast').at(-1).message, /已主动退出房间/);
  assert.ok(db.getPlayer(b.uid));
});
