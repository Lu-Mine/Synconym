import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createDatabase } from '../../server/db.js';

test('旧版数据库迁移保留历史投票并支持保存新明细', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'synconym-vote-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'old.db');
  const old = new Database(path);
  old.exec(`CREATE TABLE match_rounds (match_id TEXT NOT NULL, n INTEGER NOT NULL, words_json TEXT NOT NULL, marks_json TEXT NOT NULL, votes_json TEXT, outcome TEXT NOT NULL, PRIMARY KEY (match_id, n));
    INSERT INTO match_rounds VALUES ('old', 1, '{}', '{}', '{"a":false}', 'miss');`);
  old.close();
  const db = createDatabase(path);
  db.saveMatch({ id: 'new', roomCode: '12345', mode: 'free', themeId: null, maxRounds: 4, totalRounds: 1, convergedRound: null, outcome: 'none', startedAt: 1, endedAt: 2, players: [], rounds: [{ n: 1, words: {}, marks: {}, votes: { a: false }, voteChoices: { a: 'timeout' }, breakVote: { passed: false, choices: { a: 'no' } }, outcome: 'miss' }] });
  assert.deepEqual(db.getMatch('new').rounds[0].voteChoices, { a: 'timeout' });
  assert.deepEqual(db.getMatch('new').rounds[0].breakVote, { passed: false, choices: { a: 'no' } });
  db.close();
  const check = new Database(path, { readonly: true });
  assert.equal(check.prepare("SELECT votes_json FROM match_rounds WHERE match_id = 'old'").get().votes_json, '{"a":false}');
  check.close();
});
