import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { createDatabase } from '../../server/db.js';

const hashOf = (value) => createHash('sha256').update(value).digest();

function legacyDatabase() {
  const path = join(mkdtempSync(join(tmpdir(), 'synconym-cred-')), 'db.sqlite');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE players (
      uid TEXT PRIMARY KEY, name TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE TABLE player_credentials (
      uid TEXT PRIMARY KEY, credential_hash BLOB NOT NULL
    );
  `);
  const now = Date.now();
  db.prepare('INSERT INTO players (uid, name, created_at, last_seen) VALUES (?, ?, ?, ?)').run('ABCD2345', '旧的名字', now, now);
  db.prepare('INSERT INTO players (uid, name, created_at, last_seen) VALUES (?, ?, ?, ?)').run('EFGH6789', '另一个名字', now, now);
  db.prepare('INSERT INTO player_credentials (uid, credential_hash) VALUES (?, ?)').run('ABCD2345', hashOf('first'));
  db.prepare('INSERT INTO player_credentials (uid, credential_hash) VALUES (?, ?)').run('EFGH6789', hashOf('second'));
  db.close();
  return path;
}

test('单凭证表迁移到多凭证表，旧凭证仍可认领原身份', (t) => {
  const path = legacyDatabase();
  const db = createDatabase(path);
  t.after(() => db.close());
  assert.equal(db.getCredentialHash('ABCD2345').toString('hex'), hashOf('first').toString('hex'));
  assert.equal(db.credentialOwner(hashOf('second')), 'EFGH6789');
  assert.equal(db.countCredentials('ABCD2345'), 1);
  assert.equal(db.getPlayer('ABCD2345').name, '旧的名字');
});

test('迁移可重复执行，旧表只被搬一次', (t) => {
  const path = legacyDatabase();
  createDatabase(path).close();
  const db = createDatabase(path);
  t.after(() => db.close());
  assert.equal(db.countCredentials('ABCD2345'), 1);
  assert.equal(db.countCredentials('EFGH6789'), 1);
  const raw = new Database(path);
  t.after(() => raw.close());
  const legacy = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'player_credentials'").get();
  assert.equal(legacy, undefined);
});

test('一个身份可以并存多个浏览器凭证', (t) => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  db.createPlayer('ABCD2345', '同一人');
  db.addCredential('ABCD2345', hashOf('chrome'));
  db.addCredential('ABCD2345', hashOf('wechat'));
  assert.equal(db.countCredentials('ABCD2345'), 2);
  assert.equal(db.credentialOwner(hashOf('chrome')), 'ABCD2345');
  assert.equal(db.credentialOwner(hashOf('wechat')), 'ABCD2345');
  db.dropCredential(hashOf('chrome'));
  assert.equal(db.credentialOwner(hashOf('chrome')), undefined);
  assert.equal(db.credentialOwner(hashOf('wechat')), 'ABCD2345');
});
