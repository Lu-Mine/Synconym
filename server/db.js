import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const THEMES = JSON.parse(readFileSync(new URL('../data/themes.json', import.meta.url), 'utf8'));

const likeEscape = (value) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
// 主题名或 id 命中折算成 theme_id；空查询不参与主题匹配。
const themeIdsFor = (value) => (value
  ? THEMES.filter((theme) => theme.name.toLowerCase().includes(value.toLowerCase()) || theme.id.includes(value.toLowerCase())).map((theme) => theme.id)
  : []);

// Search inputs are normalized once for both count and list (including the memory DB).
// 只有一个类型：任意维度命中即算找到——房号前缀、参与者 UID 前缀、参与者名字、主题名，以及能解析出的时间范围。
export function normalizeMatchFilter(filter) {
  if (filter == null) return null;
  if (typeof filter !== 'object' || Array.isArray(filter)) throw new Error('历史筛选无效');
  if (Object.keys(filter).length === 0) return null;
  if (filter.type !== 'any' || typeof filter.value !== 'string') throw new Error('历史筛选无效');
  const value = filter.value.trim();
  if ([...value].length > 32) throw new Error('历史筛选无效');
  const result = { type: 'any', value, themeIds: themeIdsFor(value) };
  for (const key of ['from', 'to']) {
    if (filter[key] === undefined) continue;
    if (!Number.isSafeInteger(filter[key]) || filter[key] < 0 || filter[key] > 8640000000000000) throw new Error('时间范围无效');
    result[key] = filter[key];
  }
  if (result.from !== undefined && result.to !== undefined && result.from >= result.to) throw new Error('时间范围无效');
  return value || result.from !== undefined || result.to !== undefined ? result : null;
}

function matchWhere(uid, input) {
  const filter = normalizeMatchFilter(input);
  let sql = 'p.uid = ?';
  const params = [uid];
  if (filter?.type === 'any') {
    const matched = [];
    if (filter.value) {
      const prefix = `${likeEscape(filter.value)}%`;
      matched.push('m.room_code LIKE ? ESCAPE \'\\\'');
      params.push(prefix);
      matched.push('EXISTS (SELECT 1 FROM match_players other WHERE other.match_id = m.id AND (other.uid LIKE ? ESCAPE \'\\\' OR other.name_at_time LIKE ? ESCAPE \'\\\'))');
      params.push(prefix, `%${likeEscape(filter.value)}%`);
      if (filter.themeIds.length) {
        matched.push(`m.theme_id IN (${filter.themeIds.map(() => '?').join(', ')})`);
        params.push(...filter.themeIds);
      }
    }
    // 时间维度的两端是 AND，作为整体再与其它维度 OR
    const ranged = [];
    if (filter.from !== undefined) { ranged.push('m.started_at >= ?'); params.push(filter.from); }
    if (filter.to !== undefined) { ranged.push('m.started_at < ?'); params.push(filter.to); }
    if (ranged.length) matched.push(`(${ranged.join(' AND ')})`);
    sql += ` AND (${matched.join(' OR ')})`;
  }
  return { sql, params };
}

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
    CREATE TABLE IF NOT EXISTS player_credentials (
      uid TEXT PRIMARY KEY, credential_hash BLOB NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_name_history_uid ON name_history(uid);
    CREATE INDEX IF NOT EXISTS idx_match_time ON matches(started_at DESC);
  `);
  const roundColumns = db.pragma('table_info(match_rounds)').map((column) => column.name);
  if (!roundColumns.includes('vote_details_json')) db.exec('ALTER TABLE match_rounds ADD COLUMN vote_details_json TEXT');
  const getPlayer = db.prepare('SELECT uid, name FROM players WHERE uid = ?');
  const createPlayer = db.prepare('INSERT INTO players (uid, name, created_at, last_seen) VALUES (?, ?, ?, ?)');
  const touchPlayer = db.prepare('UPDATE players SET last_seen = ? WHERE uid = ?');
  const updateName = db.prepare('UPDATE players SET name = ?, last_seen = ? WHERE uid = ?');
  const recordName = db.prepare('INSERT INTO name_history (uid, name, changed_at) VALUES (?, ?, ?)');
  const profileRow = db.prepare('SELECT uid, name, created_at FROM players WHERE uid = ?');
  const nameHistoryRows = db.prepare('SELECT name, changed_at FROM name_history WHERE uid = ? ORDER BY changed_at DESC, rowid DESC LIMIT ?');
  const matchSource = 'FROM matches m JOIN match_players p ON p.match_id = m.id';
  const matchMembers = db.prepare('SELECT uid, seat, name_at_time AS name FROM match_players WHERE match_id = ? ORDER BY seat');

  const insertMatch = db.prepare(`INSERT INTO matches
    (id, room_code, mode, theme_id, max_rounds, total_rounds, converged_round, outcome, started_at, ended_at)
    VALUES (@id, @roomCode, @mode, @themeId, @maxRounds, @totalRounds, @convergedRound, @outcome, @startedAt, @endedAt)`);
  const insertParticipant = db.prepare('INSERT INTO match_players (match_id, uid, seat, name_at_time) VALUES (?, ?, ?, ?)');
  const insertRound = db.prepare('INSERT INTO match_rounds (match_id, n, words_json, marks_json, votes_json, outcome, vote_details_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const saveMatch = db.transaction((match) => {
    if (db.prepare('SELECT 1 FROM matches WHERE id = ?').get(match.id)) return;
    insertMatch.run(match);
    for (const player of match.players) insertParticipant.run(match.id, player.uid, player.seat, player.name);
    for (const round of match.rounds) insertRound.run(match.id, round.n, JSON.stringify(round.words),
      JSON.stringify(round.marks), round.votes == null ? null : JSON.stringify(round.votes), round.outcome,
      round.voteChoices || round.breakVote ? JSON.stringify({ voteChoices: round.voteChoices, breakVote: round.breakVote }) : null);
  });

  return {
    getPlayer: (uid) => getPlayer.get(uid),
    setCredentialHash(uid, hash) { db.prepare('INSERT INTO player_credentials (uid, credential_hash) VALUES (?, ?)').run(uid, hash); },
    getCredentialHash(uid) { return db.prepare('SELECT credential_hash FROM player_credentials WHERE uid = ?').get(uid)?.credential_hash; },
    getProfile(uid) {
      const row = profileRow.get(uid);
      return row ? { uid: row.uid, name: row.name, createdAt: row.created_at } : undefined;
    },
    getNameHistory: (uid, limit = 20) => nameHistoryRows.all(uid, limit)
      .map((row) => ({ name: row.name, changedAt: row.changed_at })),
    countMatchesFor(uid, filter) {
      const { sql, params } = matchWhere(uid, filter);
      return db.prepare(`SELECT COUNT(*) AS total ${matchSource} WHERE ${sql}`).get(...params).total;
    },
    listMatchesFor(uid, { limit = 10, offset = 0, filter } = {}) {
      const { sql, params } = matchWhere(uid, filter);
      return db.prepare(`SELECT m.* ${matchSource} WHERE ${sql} ORDER BY m.started_at DESC, m.id DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset).map((row) => ({
        id: row.id, roomCode: row.room_code, mode: row.mode, themeId: row.theme_id,
        totalRounds: row.total_rounds, convergedRound: row.converged_round, outcome: row.outcome,
        startedAt: row.started_at, endedAt: row.ended_at, players: matchMembers.all(row.id)
      }));
    },
    saveMatch,
    getMatch(id) {
      const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
      if (!row) return undefined;
      return {
        id: row.id, roomCode: row.room_code, mode: row.mode, themeId: row.theme_id,
        maxRounds: row.max_rounds, totalRounds: row.total_rounds, convergedRound: row.converged_round,
        outcome: row.outcome, startedAt: row.started_at, endedAt: row.ended_at,
        players: db.prepare('SELECT uid, seat, name_at_time AS name FROM match_players WHERE match_id = ? ORDER BY seat').all(id),
        rounds: db.prepare('SELECT * FROM match_rounds WHERE match_id = ? ORDER BY n').all(id).map((r) => ({
          n: r.n, words: JSON.parse(r.words_json), marks: JSON.parse(r.marks_json), outcome: r.outcome,
          ...(r.votes_json == null ? {} : { votes: JSON.parse(r.votes_json) }),
          ...(r.vote_details_json == null ? {} : JSON.parse(r.vote_details_json))
        }))
      };
    },
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
