import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export function createDatabase(filename = process.env.DB_PATH || resolve('data/synconym.db')) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      uid TEXT PRIMARY KEY, name TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS name_history (
      uid TEXT NOT NULL, name TEXT NOT NULL, changed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY, room_code TEXT NOT NULL,
      mode TEXT NOT NULL, theme_id TEXT,
      max_rounds INTEGER NOT NULL, total_rounds INTEGER NOT NULL,
      converged_round INTEGER, outcome TEXT NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS match_players (
      match_id TEXT NOT NULL, uid TEXT NOT NULL, seat INTEGER NOT NULL,
      name_at_time TEXT NOT NULL, PRIMARY KEY (match_id, uid)
    );
    CREATE TABLE IF NOT EXISTS match_rounds (
      match_id TEXT NOT NULL, n INTEGER NOT NULL,
      words_json TEXT NOT NULL, marks_json TEXT NOT NULL,
      votes_json TEXT, outcome TEXT NOT NULL, PRIMARY KEY (match_id, n)
    );
    CREATE INDEX IF NOT EXISTS idx_mp_uid ON match_players(uid);
    CREATE INDEX IF NOT EXISTS idx_match_time ON matches(started_at DESC);
  `);
  const getPlayer = db.prepare('SELECT uid, name FROM players WHERE uid = ?');
  const createPlayer = db.prepare('INSERT INTO players (uid, name, created_at, last_seen) VALUES (?, ?, ?, ?)');
  const touchPlayer = db.prepare('UPDATE players SET last_seen = ? WHERE uid = ?');
  const updateName = db.prepare('UPDATE players SET name = ?, last_seen = ? WHERE uid = ?');
  const recordName = db.prepare('INSERT INTO name_history (uid, name, changed_at) VALUES (?, ?, ?)');

  return {
    getPlayer: (uid) => getPlayer.get(uid),
    createPlayer(uid, name, now = Date.now()) {
      createPlayer.run(uid, name, now, now);
      recordName.run(uid, name, now);
      return { uid, name };
    },
    touch(uid, now = Date.now()) { touchPlayer.run(now, uid); },
    rename: db.transaction((uid, name, now = Date.now()) => {
      updateName.run(name, now, uid);
      recordName.run(uid, name, now);
    }),
    close() { db.close(); }
  };
}
