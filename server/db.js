import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { DELETED_NAME } from './rules.js';

const THEMES = JSON.parse(readFileSync(new URL('../data/themes.json', import.meta.url), 'utf8'));

// 注销身份的统一展示名由规则层定义，昵称校验里禁止普通人使用。
export { DELETED_NAME };

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

// 隐藏过的记录不再出现在档案与详情里；已注销身份也不再能被 UID 或旧名搜到。
function matchWhere(uid, input) {
  const filter = normalizeMatchFilter(input);
  let sql = 'p.uid = ?';
  const params = [uid];
  sql += ' AND NOT EXISTS (SELECT 1 FROM match_hidden h WHERE h.uid = ? AND h.match_id = m.id AND h.disabled_at IS NULL)';
  params.push(uid);
  if (filter?.type === 'any') {
    const matched = [];
    if (filter.value) {
      const prefix = `${likeEscape(filter.value)}%`;
      matched.push('m.room_code LIKE ? ESCAPE \'\\\'');
      params.push(prefix);
      matched.push(`EXISTS (SELECT 1 FROM match_players other LEFT JOIN players op ON op.uid = other.uid
        WHERE other.match_id = m.id AND ((op.deleted_at IS NULL AND other.uid LIKE ? ESCAPE '\\') OR other.name_at_time LIKE ? ESCAPE '\\'))`);
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

const matchView = (row) => ({
  id: row.id, roomCode: row.room_code, mode: row.mode, themeId: row.theme_id,
  totalRounds: row.total_rounds, convergedRound: row.converged_round, outcome: row.outcome,
  startedAt: row.started_at, endedAt: row.ended_at
});

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
      uid TEXT NOT NULL, name TEXT NOT NULL, changed_at INTEGER NOT NULL, disabled_at INTEGER
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
  if (!roundColumns.includes('mode_details_json')) db.exec('ALTER TABLE match_rounds ADD COLUMN mode_details_json TEXT');
  const playerColumns = db.pragma('table_info(players)').map((column) => column.name);
  if (!playerColumns.includes('deleted_at')) db.exec('ALTER TABLE players ADD COLUMN deleted_at INTEGER');
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      credential_hash BLOB PRIMARY KEY, uid TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, disabled_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_credentials_uid ON credentials(uid);
    CREATE TABLE IF NOT EXISTS devices (
      device_key TEXT PRIMARY KEY, weak_key TEXT NOT NULL, profile_json TEXT NOT NULL,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_devices_weak ON devices(weak_key);
    CREATE TABLE IF NOT EXISTS device_links (
      device_key TEXT NOT NULL, uid TEXT NOT NULL,
      bound_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, source TEXT NOT NULL,
      disabled_at INTEGER,
      PRIMARY KEY (device_key, uid)
    );
    CREATE INDEX IF NOT EXISTS idx_device_links_uid ON device_links(uid);
    CREATE TABLE IF NOT EXISTS device_rejections (
      device_key TEXT NOT NULL, uid TEXT NOT NULL, rejected_at INTEGER NOT NULL, disabled_at INTEGER,
      PRIMARY KEY (device_key, uid)
    );
    CREATE TABLE IF NOT EXISTS match_hidden (
      uid TEXT NOT NULL, match_id TEXT NOT NULL, hidden_at INTEGER NOT NULL, disabled_at INTEGER,
      PRIMARY KEY (uid, match_id)
    );
  `);
  // 注销只禁用数据，不物理删除行；旧库补上标记列。
  for (const table of ['name_history', 'credentials', 'device_links', 'device_rejections', 'match_hidden']) {
    const columns = db.pragma(`table_info(${table})`).map((column) => column.name);
    if (!columns.includes('disabled_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN disabled_at INTEGER`);
  }
  // 早期版本一个 uid 只存一条凭证。搬到多凭证表后旧数据仍然可以登录。
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'player_credentials'").get();
  if (legacy) {
    const now = Date.now();
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO credentials (credential_hash, uid, created_at, last_seen)
        SELECT credential_hash, uid, ?, ? FROM player_credentials`).run(now, now);
      db.exec('DROP TABLE player_credentials');
    })();
  }

  const getPlayer = db.prepare('SELECT uid, name FROM players WHERE uid = ? AND deleted_at IS NULL');
  const createPlayer = db.prepare('INSERT INTO players (uid, name, created_at, last_seen) VALUES (?, ?, ?, ?)');
  const touchPlayer = db.prepare('UPDATE players SET last_seen = ? WHERE uid = ?');
  const updateName = db.prepare('UPDATE players SET name = ?, last_seen = ? WHERE uid = ?');
  const recordName = db.prepare('INSERT INTO name_history (uid, name, changed_at) VALUES (?, ?, ?)');
  const profileRow = db.prepare('SELECT uid, name, created_at FROM players WHERE uid = ? AND deleted_at IS NULL');
  const nameHistoryRows = db.prepare('SELECT name, changed_at FROM name_history WHERE uid = ? AND disabled_at IS NULL ORDER BY changed_at DESC, rowid DESC LIMIT ?');
  // 已注销的身份留着行，但不再算「存在」，避免重复注销同一个人。
  const playerActive = db.prepare('SELECT 1 AS hit FROM players WHERE uid = ? AND deleted_at IS NULL');
  const matchSource = 'FROM matches m JOIN match_players p ON p.match_id = m.id';
  const hiddenSource = 'FROM matches m JOIN match_hidden h ON h.match_id = m.id JOIN match_players p ON p.match_id = m.id';
  const matchMembers = db.prepare(`SELECT p.uid, p.seat, p.name_at_time AS name, pl.deleted_at AS deleted_at
    FROM match_players p LEFT JOIN players pl ON pl.uid = p.uid
    WHERE p.match_id = ? ORDER BY p.seat`);
  const membersOf = (id) => matchMembers.all(id)
    .map((row) => ({ uid: row.uid, seat: row.seat, name: row.name, ...(row.deleted_at != null ? { deleted: true } : {}) }));

  const insertMatch = db.prepare(`INSERT INTO matches
    (id, room_code, mode, theme_id, max_rounds, total_rounds, converged_round, outcome, started_at, ended_at)
    VALUES (@id, @roomCode, @mode, @themeId, @maxRounds, @totalRounds, @convergedRound, @outcome, @startedAt, @endedAt)`);
  const insertParticipant = db.prepare('INSERT INTO match_players (match_id, uid, seat, name_at_time) VALUES (?, ?, ?, ?)');
  const insertRound = db.prepare('INSERT INTO match_rounds (match_id, n, words_json, marks_json, votes_json, outcome, vote_details_json, mode_details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const saveMatch = db.transaction((match) => {
    if (db.prepare('SELECT 1 FROM matches WHERE id = ?').get(match.id)) return;
    insertMatch.run(match);
    for (const player of match.players) insertParticipant.run(match.id, player.uid, player.seat, player.name);
    for (const round of match.rounds) insertRound.run(match.id, round.n, JSON.stringify(round.words),
      JSON.stringify(round.marks), round.votes == null ? null : JSON.stringify(round.votes), round.outcome,
      round.voteChoices || round.breakVote ? JSON.stringify({ voteChoices: round.voteChoices, breakVote: round.breakVote }) : null,
      round.modeDetails ? JSON.stringify(round.modeDetails) : null);
  });

  // 凭证：一个身份可以有多个，分别对应不同浏览器。
  const credentialOwner = db.prepare('SELECT uid FROM credentials WHERE credential_hash = ? AND disabled_at IS NULL');
  const credentialForUid = db.prepare('SELECT credential_hash FROM credentials WHERE uid = ? AND disabled_at IS NULL LIMIT 1');
  const insertCredential = db.prepare(`INSERT INTO credentials (credential_hash, uid, created_at, last_seen, disabled_at)
    VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(credential_hash) DO UPDATE SET uid = excluded.uid, last_seen = excluded.last_seen, disabled_at = NULL`);
  const touchCredentialHash = db.prepare('UPDATE credentials SET last_seen = ? WHERE credential_hash = ? AND disabled_at IS NULL');
  const deleteCredentialHash = db.prepare('DELETE FROM credentials WHERE credential_hash = ?');
  const disableCredentialsFor = db.prepare('UPDATE credentials SET disabled_at = ? WHERE uid = ? AND disabled_at IS NULL');
  const credentialCount = db.prepare('SELECT COUNT(*) AS total FROM credentials WHERE uid = ? AND disabled_at IS NULL');

  // 设备：指纹只用来提示与自动沿用，不参与凭证校验。
  const upsertDevice = db.prepare(`INSERT INTO devices (device_key, weak_key, profile_json, first_seen, last_seen)
    VALUES (@deviceKey, @weakKey, @profileJson, @now, @now)
    ON CONFLICT(device_key) DO UPDATE SET weak_key = excluded.weak_key,
      profile_json = excluded.profile_json, last_seen = excluded.last_seen`);
  const deviceRow = db.prepare('SELECT device_key, weak_key, profile_json, first_seen, last_seen FROM devices WHERE device_key = ?');
  const deviceByWeakKey = db.prepare('SELECT device_key, weak_key, profile_json, first_seen, last_seen FROM devices WHERE weak_key = ? ORDER BY last_seen DESC');
  const touchDevice = db.prepare('UPDATE devices SET last_seen = ? WHERE device_key = ?');
  const dropDevice = db.prepare('DELETE FROM devices WHERE device_key = ?');
  const linksForDevice = db.prepare('SELECT uid, bound_at, last_seen, source FROM device_links WHERE device_key = ? AND disabled_at IS NULL ORDER BY last_seen DESC');
  const linkCount = db.prepare('SELECT COUNT(*) AS total FROM device_links WHERE device_key = ? AND disabled_at IS NULL');
  const upsertLink = db.prepare(`INSERT INTO device_links (device_key, uid, bound_at, last_seen, source, disabled_at)
    VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(device_key, uid) DO UPDATE SET last_seen = excluded.last_seen, source = excluded.source, disabled_at = NULL`);
  const touchLink = db.prepare('UPDATE device_links SET last_seen = ? WHERE device_key = ? AND uid = ? AND disabled_at IS NULL');
  const deleteLink = db.prepare('DELETE FROM device_links WHERE device_key = ? AND uid = ?');
  const disableLinksFor = db.prepare('UPDATE device_links SET disabled_at = ? WHERE uid = ? AND disabled_at IS NULL');
  const linksOfUid = db.prepare('SELECT device_key FROM device_links WHERE uid = ? AND disabled_at IS NULL');
  const rejectLink = db.prepare(`INSERT INTO device_rejections (device_key, uid, rejected_at, disabled_at)
    VALUES (?, ?, ?, NULL) ON CONFLICT(device_key, uid) DO UPDATE SET rejected_at = excluded.rejected_at, disabled_at = NULL`);
  const rejectedLink = db.prepare('SELECT 1 AS hit FROM device_rejections WHERE device_key = ? AND uid = ? AND disabled_at IS NULL');
  const disableRejectionsFor = db.prepare('UPDATE device_rejections SET disabled_at = ? WHERE uid = ? AND disabled_at IS NULL');
  const pruneLinksBefore = db.prepare('DELETE FROM device_links WHERE last_seen < ?');

  // 记录隐藏：只影响提出隐藏的人，同局其他人照旧。
  const hideMatchRow = db.prepare(`INSERT INTO match_hidden (uid, match_id, hidden_at, disabled_at) VALUES (?, ?, ?, NULL)
    ON CONFLICT(uid, match_id) DO UPDATE SET hidden_at = excluded.hidden_at, disabled_at = NULL`);
  const unhideMatchRow = db.prepare('UPDATE match_hidden SET disabled_at = ? WHERE uid = ? AND match_id = ? AND disabled_at IS NULL');
  const hiddenRow = db.prepare('SELECT 1 AS hit FROM match_hidden WHERE uid = ? AND match_id = ? AND disabled_at IS NULL');
  const hideAllRows = db.prepare(`INSERT INTO match_hidden (uid, match_id, hidden_at, disabled_at)
    SELECT ?, p.match_id, ?, NULL FROM match_players p WHERE p.uid = ?
    ON CONFLICT(uid, match_id) DO UPDATE SET hidden_at = excluded.hidden_at, disabled_at = NULL`);
  const unhideAllRows = db.prepare('UPDATE match_hidden SET disabled_at = ? WHERE uid = ? AND disabled_at IS NULL');
  const countHidden = db.prepare('SELECT COUNT(*) AS total FROM match_hidden WHERE uid = ? AND disabled_at IS NULL');
  const disableHiddenFor = db.prepare('UPDATE match_hidden SET disabled_at = ? WHERE uid = ? AND disabled_at IS NULL');

  // 注销：行都留着，只是把内容清空、把相关数据标记为失效。
  const markDeleted = db.prepare('UPDATE players SET name = ?, deleted_at = ? WHERE uid = ?');
  const disableNameHistoryFor = db.prepare('UPDATE name_history SET disabled_at = ? WHERE uid = ? AND disabled_at IS NULL');
  const anonymizeParticipant = db.prepare('UPDATE match_players SET name_at_time = ? WHERE uid = ?');
  const roundsForUid = db.prepare(`SELECT r.match_id, r.n, r.words_json, r.marks_json, r.votes_json,
      r.vote_details_json, r.mode_details_json
    FROM match_rounds r JOIN match_players p ON p.match_id = r.match_id WHERE p.uid = ?`);
  const updateRound = db.prepare(`UPDATE match_rounds SET words_json = ?, marks_json = ?, votes_json = ?,
    vote_details_json = ?, mode_details_json = ? WHERE match_id = ? AND n = ?`);

  const stripKey = (json, strip) => {
    if (json == null) return null;
    let value;
    try { value = JSON.parse(json); } catch { return null; }
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    strip(value);
    return JSON.stringify(value);
  };

  // 注销只禁用：所有行留在原位，读的时候跳过 disabled_at 不为空的行。
  const eraseIdentity = db.transaction((uid, now = Date.now()) => {
    const player = playerActive.get(uid);
    if (!player) return false;
    markDeleted.run(DELETED_NAME, now, uid);
    disableNameHistoryFor.run(now, uid);
    disableCredentialsFor.run(now, uid);
    disableRejectionsFor.run(now, uid);
    disableHiddenFor.run(now, uid);
    disableLinksFor.run(now, uid);
    anonymizeParticipant.run(DELETED_NAME, uid);
    // 词、标记、投票的槽位留着，内容换成 null，渲染时显示为空。
    const erase = (value) => { if (uid in value) value[uid] = null; };
    for (const row of roundsForUid.all(uid)) {
      updateRound.run(
        stripKey(row.words_json, erase),
        stripKey(row.marks_json, erase),
        stripKey(row.votes_json, erase),
        stripKey(row.vote_details_json, (value) => {
          if (value.voteChoices && typeof value.voteChoices === 'object') erase(value.voteChoices);
          if (value.breakVote && typeof value.breakVote === 'object') erase(value.breakVote);
        }),
        stripKey(row.mode_details_json, (value) => {
          if (value.guesses && typeof value.guesses === 'object') erase(value.guesses);
        }),
        row.match_id, row.n
      );
    }
    return true;
  });

  return {
    getPlayer: (uid) => getPlayer.get(uid),
    // 兼容旧调用：一个 uid 的第一条凭证。
    setCredentialHash(uid, hash) { insertCredential.run(hash, uid, Date.now(), Date.now()); },
    getCredentialHash(uid) { return credentialForUid.get(uid)?.credential_hash; },
    addCredential(uid, hash, now = Date.now()) { insertCredential.run(hash, uid, now, now); },
    credentialOwner(hash) { return credentialOwner.get(hash)?.uid; },
    touchCredential(hash, now = Date.now()) { touchCredentialHash.run(now, hash); },
    dropCredential(hash) { deleteCredentialHash.run(hash); },
    countCredentials(uid) { return credentialCount.get(uid).total; },
    insertDevice({ deviceKey, weakKey, profileJson, profile }, now = Date.now()) {
      upsertDevice.run({ deviceKey, weakKey, profileJson: profileJson ?? profile ?? '{}', now });
    },
    getDevice(deviceKey) { return deviceRow.get(deviceKey); },
    devicesByWeakKey(weakKey) { return deviceByWeakKey.all(weakKey); },
    touchDevice(deviceKey, now = Date.now()) { touchDevice.run(now, deviceKey); },
    dropDevice(deviceKey) { dropDevice.run(deviceKey); },
    getDeviceLinks(deviceKey) { return linksForDevice.all(deviceKey); },
    countDeviceLinks(deviceKey) { return linkCount.get(deviceKey).total; },
    linkDevice(deviceKey, uid, source, now = Date.now()) { upsertLink.run(deviceKey, uid, now, now, source); },
    touchDeviceLink(deviceKey, uid, now = Date.now()) { touchLink.run(now, deviceKey, uid); },
    unlinkDevice(deviceKey, uid) { deleteLink.run(deviceKey, uid); },
    rejectDevice(deviceKey, uid, now = Date.now()) { rejectLink.run(deviceKey, uid, now); },
    isDeviceRejected(deviceKey, uid) { return Boolean(rejectedLink.get(deviceKey, uid)); },
    pruneDevices(before) {
      pruneLinksBefore.run(before);
      db.prepare(`DELETE FROM devices WHERE last_seen < ? AND NOT EXISTS
        (SELECT 1 FROM device_links l WHERE l.device_key = devices.device_key AND l.disabled_at IS NULL)`).run(before);
    },
    hideMatch(uid, matchId, now = Date.now()) { hideMatchRow.run(uid, matchId, now); },
    unhideMatch(uid, matchId, now = Date.now()) { unhideMatchRow.run(now, uid, matchId); },
    isHidden(uid, matchId) { return Boolean(hiddenRow.get(uid, matchId)); },
    hideAllMatches(uid, now = Date.now()) { hideAllRows.run(uid, now, uid); return countHidden.get(uid).total; },
    unhideAllMatches(uid, now = Date.now()) { unhideAllRows.run(now, uid); },
    countHiddenMatches(uid) { return countHidden.get(uid).total; },
    listHiddenMatches(uid, { limit = 10, offset = 0 } = {}) {
      return db.prepare(`SELECT m.* ${hiddenSource} WHERE p.uid = ? AND h.uid = ? AND h.disabled_at IS NULL
        ORDER BY m.started_at DESC, m.id DESC LIMIT ? OFFSET ?`)
        .all(uid, uid, limit, offset).map((row) => ({ ...matchView(row), players: membersOf(row.id) }));
    },
    eraseIdentity,
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
        .all(...params, limit, offset).map((row) => ({ ...matchView(row), players: membersOf(row.id) }));
    },
    saveMatch,
    getMatch(id) {
      const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
      if (!row) return undefined;
      return {
        id: row.id, roomCode: row.room_code, mode: row.mode, themeId: row.theme_id,
        maxRounds: row.max_rounds, totalRounds: row.total_rounds, convergedRound: row.converged_round,
        outcome: row.outcome, startedAt: row.started_at, endedAt: row.ended_at,
        players: membersOf(id),
        rounds: db.prepare('SELECT * FROM match_rounds WHERE match_id = ? ORDER BY n').all(id).map((r) => ({
          n: r.n, words: JSON.parse(r.words_json), marks: JSON.parse(r.marks_json), outcome: r.outcome,
          ...(r.votes_json == null ? {} : { votes: JSON.parse(r.votes_json) }),
          ...(r.vote_details_json == null ? {} : JSON.parse(r.vote_details_json)),
          ...(r.mode_details_json == null ? {} : { modeDetails: JSON.parse(r.mode_details_json) })
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
