import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createDatabase } from '../../server/db.js';

const modeDetails = {
  secret: '高压锅',
  describerUid: 'U1',
  guesserCount: 2,
  aborted: false,
  guesses: { U2: { order: 1, atMs: 4200 } },
  points: { U2: 3, U1: 1 }
};

function livonymMatch(rounds = 1) {
  return {
    id: 'lv1', roomCode: '12345', mode: 'livonym', themeId: null,
    maxRounds: 12, totalRounds: rounds, convergedRound: rounds, outcome: 'played',
    startedAt: 1, endedAt: 2,
    players: [{ uid: 'U1', name: '甲', seat: 0 }, { uid: 'U2', name: '乙', seat: 1 }, { uid: 'U3', name: '丙', seat: 2 }],
    rounds: Array.from({ length: rounds }, (_, index) => ({
      n: index + 1, words: {}, marks: {}, votes: null, outcome: 'played',
      modeDetails: { ...modeDetails, secret: `词${index + 1}` }
    }))
  };
}

test('旧库补上 mode_details_json 列并支持即时竞猜对局往返', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'synconym-livonym-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'old.db');

  // 旧版本结构：match_rounds 只有 vote_details_json，没有 mode_details_json
  const old = new Database(path);
  old.exec(`CREATE TABLE match_rounds (match_id TEXT NOT NULL, n INTEGER NOT NULL, words_json TEXT NOT NULL, marks_json TEXT NOT NULL, votes_json TEXT, outcome TEXT NOT NULL, vote_details_json TEXT, PRIMARY KEY (match_id, n));
    INSERT INTO match_rounds VALUES ('old', 1, '{}', '{}', '{"a":false}', 'miss', '{"voteChoices":{"a":"timeout"}}');`);
  old.close();

  const db = createDatabase(path);
  db.saveMatch(livonymMatch(2));

  const saved = db.getMatch('lv1');
  assert.equal(saved.mode, 'livonym');
  assert.equal(saved.outcome, 'played');
  assert.equal(saved.rounds.length, 2);
  assert.equal(saved.rounds[0].modeDetails.secret, '词1');
  assert.deepEqual(saved.rounds[0].modeDetails.points, { U2: 3, U1: 1 });
  assert.equal(saved.rounds[1].modeDetails.guesserCount, 2);
  // 未投票的记录不带 votes 键，经典模式的行为不受影响
  assert.equal('votes' in db.getMatch('lv1').rounds[0], false);
  db.close();

  const check = new Database(path, { readonly: true });
  const round = check.prepare("SELECT vote_details_json, mode_details_json FROM match_rounds WHERE match_id = 'old'").get();
  assert.equal(round.vote_details_json, '{"voteChoices":{"a":"timeout"}}');
  assert.equal(round.mode_details_json, null);
  check.close();
});

test('迁移可重复执行，经典对局不写入 modeDetails', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'synconym-livonym-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'again.db');

  const first = createDatabase(path);
  first.saveMatch(livonymMatch(1));
  first.close();

  // 第二次打开不应重复 ALTER，也不丢已有数据
  const second = createDatabase(path);
  assert.equal(second.getMatch('lv1').rounds[0].modeDetails.secret, '词1');
  second.saveMatch({
    id: 'classic', roomCode: '22222', mode: 'free', themeId: null,
    maxRounds: 4, totalRounds: 1, convergedRound: 1, outcome: 'exact',
    startedAt: 3, endedAt: 4,
    players: [{ uid: 'A', name: '甲', seat: 0 }],
    rounds: [{ n: 1, words: { A: '雨伞' }, marks: { A: 'none' }, outcome: 'exact' }]
  });
  const classic = second.getMatch('classic').rounds[0];
  assert.equal('modeDetails' in classic, false, '经典对局不该带 modeDetails');
  second.close();
});

test('recentLivonymSecrets 按时间窗口汇总在场玩家的近期秘密词', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'synconym-livonym-cd-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = createDatabase(join(dir, 'cd.db'));

  const makeMatch = (id, startedAt, uids, secrets, mode = 'livonym') => ({
    id, roomCode: '12345', mode, themeId: null,
    maxRounds: 12, totalRounds: secrets.length, convergedRound: secrets.length, outcome: 'played',
    startedAt, endedAt: startedAt + 1000,
    players: uids.map((uid, seat) => ({ uid, name: uid, seat })),
    rounds: secrets.map((secret, idx) => ({
      n: idx + 1, words: {}, marks: {}, votes: null, outcome: 'played',
      ...(mode === 'livonym' ? { modeDetails: { ...modeDetails, secret } } : {})
    }))
  });

  // 窗口外旧对局（startedAt=100）不应命中；另一批陌生人（U9）不应命中；classic 模式不应命中
  db.saveMatch(makeMatch('m-old', 100, ['U1', 'U2', 'U3'], ['太久前']));
  db.saveMatch(makeMatch('m-other', 5000, ['U9', 'U8', 'U7'], ['陌生词']));
  db.saveMatch(makeMatch('m-classic', 5000, ['U1', 'U2'], ['经典词'], 'free'));
  db.saveMatch(makeMatch('m-p1', 3000, ['U1', 'U2', 'U3'], ['重复词', '甲词']));
  db.saveMatch(makeMatch('m-p2', 6000, ['U2', 'U4', 'U5'], ['重复词', '乙词']));

  const seen = db.recentLivonymSecrets(['U1', 'U2', 'U6'], { since: 1000 });
  assert.equal(seen.size, 3);
  // 同一个词在多个最近场次出现时保留最新时间
  assert.equal(seen.get('重复词'), 6000);
  assert.equal(seen.get('甲词'), 3000);
  assert.equal(seen.get('乙词'), 6000);
  assert.equal(seen.has('太久前'), false);
  assert.equal(seen.has('陌生词'), false);
  assert.equal(seen.has('经典词'), false);
  db.close();
});

test('eraseIdentity 抹掉注销者在 modeDetails 中的出题描述与错词', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'synconym-livonym-erase-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = createDatabase(join(dir, 'erase.db'));
  db.createPlayer('U1', '甲', 1000);
  db.createPlayer('U2', '乙', 1000);
  db.createPlayer('U3', '丙', 1000);
  db.saveMatch({
    id: 'lv-erase', roomCode: '12345', mode: 'livonym', themeId: null,
    maxRounds: 12, totalRounds: 2, convergedRound: 2, outcome: 'played',
    startedAt: 1000, endedAt: 2000,
    players: [{ uid: 'U1', name: '甲', seat: 0 }, { uid: 'U2', name: '乙', seat: 1 }, { uid: 'U3', name: '丙', seat: 2 }],
    rounds: [
      {
        n: 1, words: {}, marks: {}, votes: null, outcome: 'played',
        modeDetails: {
          secret: '高压锅', describerUid: 'U1', description: '厨房里的锅',
          guesserCount: 2, aborted: false,
          guesses: { U2: { order: 1, atMs: 3000 } },
          wrongGuesses: { U2: ['电饭煲'], U3: ['平底锅'] },
          points: { U1: 1, U2: 3 }
        }
      },
      {
        n: 2, words: {}, marks: {}, votes: null, outcome: 'played',
        modeDetails: {
          secret: '运河', describerUid: 'U2', description: '人工水道',
          guesserCount: 2, aborted: false,
          guesses: { U1: { order: 1, atMs: 2500 } },
          wrongGuesses: { U1: ['江河'] },
          points: { U2: 1, U1: 3 }
        }
      }
    ]
  });

  db.eraseIdentity('U1', 3000);
  const saved = db.getMatch('lv-erase');
  // 第一棒 U1 是出题人：描述被置空，U2/U3 的错词保留
  assert.equal(saved.rounds[0].modeDetails.description, null);
  assert.deepEqual(saved.rounds[0].modeDetails.wrongGuesses, { U2: ['电饭煲'], U3: ['平底锅'] });
  // 第二棒 U2 是出题人：描述保留，U1 的猜中与错词被置空
  assert.equal(saved.rounds[1].modeDetails.description, '人工水道');
  assert.equal(saved.rounds[1].modeDetails.guesses.U1, null);
  assert.equal(saved.rounds[1].modeDetails.wrongGuesses.U1, null);
  db.close();
});
