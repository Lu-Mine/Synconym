import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeMatchFilter, DELETED_NAME } from './db.js';
import { preparePlan, prepareCanAdvance, DISCONNECT_WINDOW_MS, REMATCH_SECONDS } from './phase.js';
import { markDisconnected, disconnectExpired, removePlayer } from './presence.js';
import { createName } from './names.js';
import { collectDeviceKeys } from './identity.js';
import { UID_CHARS, UID_LENGTH, isValidUid, validateCode, validateName, validateSettings, validateWord, normalizeWord, modeCapacity } from './rules.js';
import {
  LIVONYM_LIMITS, LIVONYM_PHASES, LIVONYM_INTRO_SECONDS, LIVONYM_SCORE_SECONDS,
  LIVONYM_STREAM_INTERVAL_MS, LIVONYM_GUESS_COOLDOWN_MS, LIVONYM_COOLDOWN_DAYS,
  containsSecret, describerPoints, guessPoints, livonymDescriberUid, drawSecret
} from './livonym.js';

const ROOM_IDLE_MS = 5 * 60 * 1000;
const THEMES = JSON.parse(readFileSync(new URL('../data/themes.json', import.meta.url), 'utf8'));
const PROFILE_PAGE_SIZE = 10;
const PROFILE_NAME_HISTORY = 20;
// 凭证在库里只存哈希；连接记下自己的哈希，换身份时才能精确废掉那一条。
const credentialDigest = (token) => (typeof token === 'string' && token
  ? createHash('sha256').update(token).digest() : null);

function wordKeys(record) {
  return Object.fromEntries(Object.entries(record?.words || {})
    .filter(([uid, word]) => record.marks?.[uid] === 'none' && typeof word === 'string')
    .map(([uid, word]) => [uid, normalizeWord(word)]));
}

// 命中索引：告诉客户端这条记录在哪些维度上被搜到，用于高亮对应的信息。
// names 里 whole 表示整段高亮（命中 UID 前缀时高亮那个人的名字），否则按查询片段高亮。
function matchHits(filter, match) {
  if (!filter) return null;
  const needle = filter.value.toLowerCase();
  const names = [];
  if (needle) {
    for (const player of match.players) {
      const name = String(player.name);
      if (name.toLowerCase().includes(needle)) names.push({ name, whole: false });
      else if (!player.deleted && player.uid.toLowerCase().startsWith(needle)) names.push({ name, whole: true });
    }
  }
  const time = (filter.from !== undefined || filter.to !== undefined)
    && (filter.from === undefined || match.startedAt >= filter.from)
    && (filter.to === undefined || match.startedAt < filter.to);
  return {
    room: Boolean(needle) && match.roomCode.toLowerCase().startsWith(needle),
    theme: filter.themeIds.includes(match.themeId),
    time,
    names
  };
}

function randomString(chars, length, random) {
  return Array.from({ length }, () => chars[Math.floor(random() * chars.length)]).join('');
}

export class RoomManager {
  constructor({ db = createMemoryDb(), random = Math.random, maxRooms = Infinity,
    publicUrl = process.env.PUBLIC_URL || '', identity = {} } = {}) {
    this.db = db;
    this.publicUrl = publicUrl;
    this.random = random;
    this.maxRooms = maxRooms;
    // 设备采纳策略：auto 静默沿用，confirm 每次都要确认。
    this.identity = { adopt: 'auto', adoptMaxIdleDays: 30, deviceLinkTtlDays: 180, ...identity };
    this.rooms = new Map();
    this.clients = new Map();
    this.recentRooms = new Map();
    this.connections = new Set();
  }

  // 房号：5 位纯数字，首位非 0，输入时可以只调数字键盘
  makeCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = `${1 + Math.floor(this.random() * 9)}${randomString('0123456789', 4, this.random)}`;
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('暂时无法分配房号，请重试');
  }

  // 身份：8 位数字+大写字母，去掉容易看错的 0/O、1/I/L
  makeUid() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const uid = randomString(UID_CHARS, UID_LENGTH, this.random);
      if (!this.db.getPlayer(uid)) return uid;
    }
    throw new Error('暂时无法分配身份，请重试');
  }

  connect(uid) {
    const now = Date.now();
    let player = isValidUid(uid) && this.db.getPlayer(uid);
    if (!player) {
      uid = this.makeUid();
      player = this.db.createPlayer(uid, createName());
    }
    const connection = { ws: null, uid, roomCode: null, lastWrite: 0, lastTyping: 0, lastStream: 0, lastGuess: 0 };
    this.connections.add(connection);
    if (!this.clients.has(uid)) this.clients.set(uid, connection);
    this.db.touch(uid, now);
    return connection;
  }

  claimRoom(connection, code) {
    const old = this.clients.get(connection.uid);
    const previousRoom = [...this.rooms.values()].find((room) => room.players.some((player) => player.uid === connection.uid));
    const replacing = old !== connection && Boolean(old?.roomCode);
    if (previousRoom && previousRoom.code !== code) {
      const previous = old?.roomCode === previousRoom.code ? old : { uid: connection.uid, roomCode: previousRoom.code };
      this.detach(previous, true);
    }
    this.clients.set(connection.uid, connection);
    if (replacing) {
      old.roomCode = null;
      old.replaced = true;
      if (old.ws?.readyState === 1) old.ws.close(4001, 'Replaced by new connection');
    }
  }

  roomFor(connection) {
    const room = this.rooms.get(connection.roomCode);
    if (!room || !room.players.some((player) => player.uid === connection.uid)) {
      throw new Error('你还没有加入房间');
    }
    return room;
  }

  playerFor(room, uid) {
    const player = room.players.find((item) => item.uid === uid);
    if (!player) throw new Error('席位不存在');
    return player;
  }

  broadcast(room) {
    for (const connection of this.clients.values()) {
      if (connection.roomCode === room.code && connection.ws?.readyState === 1) {
        this.sendState(connection, room);
      }
    }
  }

  rememberDeparture(uid, room, at = Date.now()) {
    if (room && this.rooms.get(room.code) === room) {
      const previous = this.recentRooms.get(uid);
      const expiresAt = at + ROOM_IDLE_MS;
      if (!previous || previous.expiresAt <= expiresAt) this.recentRooms.set(uid, { room, expiresAt });
    }
  }

  recentRoomFor(uid) {
    const recent = this.recentRooms.get(uid);
    if (!recent) return null;
    if (recent.expiresAt <= Date.now() || this.rooms.get(recent.room.code) !== recent.room) {
      this.recentRooms.delete(uid);
      return null;
    }
    return { code: recent.room.code, expiresAt: recent.expiresAt };
  }

  effectiveLivonymGuesserCount(room) {
    const lv = room?.livonym;
    if (!lv) return 0;
    const describerUid = livonymDescriberUid(lv.order, lv.index);
    const effective = new Set(lv.guessed.map((item) => item.uid));
    for (const player of room.players) {
      if (player.uid !== describerUid && player.connected) effective.add(player.uid);
    }
    return effective.size;
  }

  // 即时竞猜的可见性只在服务端裁剪：秘密词只发给本轮出题人，本轮结束后全员可见。
  livonymView(room, uid) {
    const lv = room.livonym;
    if (!lv) return null;
    const describerUid = livonymDescriberUid(lv.order, lv.index);
    const describer = room.players.find((player) => player.uid === describerUid);
    const revealed = ['lvScore', 'result', 'rematch', 'interrupted'].includes(room.phase);
    const guessers = room.players.filter((player) => player.uid !== describerUid && player.connected);
    const guesserCount = ['lvIntro', 'lvPlay'].includes(room.phase)
      ? this.effectiveLivonymGuesserCount(room)
      : (lv.roundGuesserCount ?? this.effectiveLivonymGuesserCount(room));
    const locked = Boolean(guesserCount > 0 && lv.guessed.length >= Math.max(1, guesserCount - 1));
    const rematchSeconds = (room.mode === 'livonym' && (room.players.length >= 5 || room.matchPlayers?.length >= 5))
      ? 60
      : REMATCH_SECONDS;
    return {
      order: lv.order,
      index: Math.max(0, lv.index), totalRounds: lv.totalRounds,
      describerUid, describerName: describer?.name ?? null,
      streamText: lv.stream.text, streamRev: lv.stream.rev,
      secret: revealed || uid === describerUid ? lv.secret : null,
      secretLength: lv.secret ? [...lv.secret].length : 0,
      roundGuesserCount: guesserCount,
      locked,
      rematchSeconds,
      // 每条都带上本轮得分，列表直接显示各自加了几分，不必在客户端重算规则。
      guessed: lv.guessed.map((item) => ({ ...item, points: lv.roundPoints[item.uid] ?? 0 })),
      // 猜中列表为每位竞猜者留一行空态，未猜中的人排在已猜中的人之后。
      guessers: guessers.map((player) => ({ uid: player.uid, name: player.name })),
      guesserCount,
      scores: lv.scores,
      roundPoints: revealed ? lv.roundPoints : null,
      wrongGuesses: lv.wrongGuesses ?? {},
    };
  }

  sendState(connection, room = this.rooms.get(connection.roomCode)) {
    if (connection.ws?.readyState !== 1) return;
    const user = this.db.getPlayer(connection.uid);
    connection.ws.send(JSON.stringify({
      type: 'state', uid: connection.uid, user: { uid: user.uid, name: user.name },
      publicUrl: this.publicUrl?.replace(/\/$/, '') || undefined,
      recentRoom: this.recentRoomFor(connection.uid),
      room: room ? {
        code: room.code, mode: room.mode, themeId: room.themeId ?? null, themeName: room.themeName ?? null,
        maxRounds: room.maxRounds, writeSeconds: room.writeSeconds,
        prepareSeconds: room.prepareSeconds, banRepeat: room.banRepeat,
        describeSeconds: room.describeSeconds, roundsPerPlayer: room.roundsPerPlayer,
        passwordEnabled: Boolean(room.passwordEnabled),
        ...(room.hostUid === connection.uid ? { password: room.password || '' } : {}),
        phase: room.phase, round: room.round, phaseDeadline: room.phaseDeadline,
        prepareGraceDeadline: room.prepareGraceDeadline ?? null,
        hostUid: room.hostUid, idleDeadline: room.lastActiveAt + ROOM_IDLE_MS,
        players: room.players.map(({ uid, name, seat, connected, ready, draft, submittedWord, vote, breakVote, disconnectedAt }) =>
          ({ uid, name, seat, connected, ready, connectionState: connected ? 'connected' : 'disconnected',
            disconnectedAt: connected ? null : disconnectedAt ?? null,
            reconnectDeadline: connected ? null : ['result', 'rematch'].includes(room.phase)
              ? room.rematchDeadline : disconnectedAt == null ? null : disconnectedAt + 90000,
            typing: room.phase === 'writing' && !!draft && submittedWord === undefined,
            submitted: room.phase === 'writing' && submittedWord !== undefined,
            voted: room.phase === 'voting' && vote !== undefined,
            breakVoted: room.phase === 'breakVote' && breakVote !== undefined })),
        words: room.phase === 'writing' || room.phase === 'lobby' ? null : room.currentRecord?.words ?? null,
        marks: room.phase === 'writing' || room.phase === 'lobby' ? null : room.currentRecord?.marks ?? null,
        votes: room.phase === 'voting' ? null : room.currentRecord?.votes ?? null,
        wordKeys: room.phase === 'writing' || room.phase === 'lobby' ? null : wordKeys(room.currentRecord),
        outcome: room.outcome ?? null, history: room.history.map((record) => ({ ...record, wordKeys: wordKeys(record) })),
        resultPlayers: room.resultPlayers ?? null,
        rematchEligibleUids: room.rematchEligibleUids ?? [], rematchVotes: room.rematchVotes ?? {},
        rematchDeadline: room.rematchDeadline ?? null,
        livonym: this.livonymView(room, connection.uid)
      } : null,
      serverNow: Date.now()
    }));
  }

  // 卡片上下文：只有本人能认出的信息，用来替代不可靠的指纹。
  deviceContextFor(uid) {
    const user = this.db.getPlayer(uid);
    if (!user) return null;
    const recent = this.recentRoomFor(uid);
    const [latest] = this.db.listMatchesFor(uid, { limit: 1 });
    const opponent = latest?.players?.find((player) => player.uid !== uid);
    return {
      uid, name: user.name,
      lastSeen: this.db.getProfile(uid)?.createdAt ?? null,
      lastRoomCode: recent?.code ?? latest?.roomCode ?? null,
      lastOpponentName: opponent?.name ?? null
    };
  }

  deviceCandidates(decision) {
    const list = (decision?.candidates || []).map((uid) => this.deviceContextFor(uid)).filter(Boolean);
    return list.length ? { reason: decision.reason || 'multiple', candidates: list } : null;
  }

  deviceKeysFor(connection) {
    return collectDeviceKeys(this.db, { deviceKey: connection.deviceKey, weakKey: connection.weakKey });
  }

  // 沿用设备上已有的身份：只接受本设备（含弱指纹关联）已经绑定过的 uid。
  claimDevice(connection, uid) {
    const key = connection.deviceKey;
    if (!key || typeof uid !== 'string' || uid === connection.uid) { this.sendState(connection); return; }
    const keys = this.deviceKeysFor(connection);
    if (!keys.some((k) => this.db.getDeviceLinks(k).some((link) => link.uid === uid)) || !this.db.getPlayer(uid)) {
      throw new Error('这台设备没有记录过这个身份');
    }
    const previous = connection.uid;
    delete connection.removedPage;
    this.evictUidFromRooms(previous, connection);
    if (this.clients.get(previous) === connection) this.clients.delete(previous);
    // 放弃的那个新身份不该继续占着设备。
    for (const k of keys) this.db.unlinkDevice(k, previous);
    if (connection.credentialHash) this.db.disableCredential(connection.credentialHash);
    connection.uid = uid;
    this.clients.set(uid, connection);
    this.db.touch(uid);
    this.db.linkDevice(key, uid, 'claimed');
    const credential = this.issueCredential?.(uid);
    connection.credentialHash = credentialDigest(credential);
    // 换过去之后，刚才那个身份如果没人能认回，就地注销。
    this.dropIfOrphaned(previous);
    const user = this.db.getPlayer(uid);
    this.sendTo(connection, { type: 'identity', uid, credential, name: user?.name, serverNow: Date.now() });
    this.sendState(connection, null);
  }

  // 用户否认卡片上的身份：记下这台设备的不认领，之后不再提示。
  rejectDevice(connection, uid) {
    const key = connection.deviceKey;
    if (!key || typeof uid !== 'string') return;
    for (const k of this.deviceKeysFor(connection)) this.db.rejectDevice(k, uid);
    this.db.linkDevice(key, connection.uid, 'created');
    this.sendTo(connection, { type: 'toast', message: '这台设备不会再提示这个身份' });
  }

  // 脱离当前身份：这台设备换成新身份。旧身份如果还有别的凭证或设备能认回，
  // 就原样留着；一旦再没人认得回来，当场注销，免得留下没有主的数据。
  leaveIdentity(connection) {
    const key = connection.deviceKey;
    const previous = connection.uid;
    for (const k of this.deviceKeysFor(connection)) {
      this.db.unlinkDevice(k, previous);
      this.db.rejectDevice(k, previous);
    }
    delete connection.removedPage;
    // 本浏览器手里的旧凭证从此没人再用，直接失效。
    if (connection.credentialHash) this.db.disableCredential(connection.credentialHash);
    this.evictUidFromRooms(previous, connection);
    if (this.clients.get(previous) === connection) this.clients.delete(previous);
    this.recentRooms.delete(previous);
    connection.uid = this.makeUid();
    const player = this.db.createPlayer(connection.uid, createName());
    this.clients.set(connection.uid, connection);
    if (key) this.db.linkDevice(key, connection.uid, 'created');
    const credential = this.issueCredential?.(connection.uid);
    connection.credentialHash = credentialDigest(credential);
    const orphaned = this.dropIfOrphaned(previous);
    this.sendTo(connection, { type: 'identity', uid: connection.uid, credential, name: player.name, orphaned, serverNow: Date.now() });
    this.sendState(connection, null);
  }

  evictUidFromRooms(uid, excludeConnection = null) {
    if (!uid) return;
    if (excludeConnection?.roomCode) this.detach(excludeConnection, true);
    for (const room of [...this.rooms.values()]) {
      if (room.players.some((player) => player.uid === uid)) {
        this.detach({ uid, roomCode: room.code }, true);
      }
    }
    for (const conn of [...this.connections]) {
      if (conn.uid !== uid || conn === excludeConnection) continue;
      conn.roomCode = null;
      conn.replaced = true;
      this.connections.delete(conn);
      if (conn.ws?.readyState === 1) conn.ws.close(4001, 'Replaced by new connection');
    }
    if (this.clients.get(uid) && this.clients.get(uid) !== excludeConnection) {
      this.clients.delete(uid);
    }
  }

  anonymizeUidInRooms(uid) {
    if (!uid) return;
    const erase = (obj) => { if (obj && typeof obj === 'object' && uid in obj) obj[uid] = null; };
    const anonymizeRecord = (record) => {
      if (!record || typeof record !== 'object') return;
      erase(record.words);
      erase(record.marks);
      erase(record.votes);
      erase(record.voteChoices);
      if (record.breakVote && typeof record.breakVote === 'object') {
        erase(record.breakVote);
        erase(record.breakVote.choices);
      }
      if (record.modeDetails && typeof record.modeDetails === 'object') {
        erase(record.modeDetails.guesses);
        erase(record.modeDetails.wrongGuesses);
        if (record.modeDetails.describerUid === uid && 'description' in record.modeDetails) {
          record.modeDetails.description = null;
        }
      }
    };
    for (const room of this.rooms.values()) {
      let touched = false;
      for (const list of [room.matchPlayers, room.resultPlayers]) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          if (entry?.uid === uid) {
            entry.name = DELETED_NAME;
            entry.deleted = true;
            touched = true;
          }
        }
      }
      if (touched || room.history?.length || room.currentRecord) {
        for (const record of room.history || []) anonymizeRecord(record);
        anonymizeRecord(room.currentRecord);
      }
      if (touched) this.broadcast(room);
    }
  }

  // 兜底巡检：把已经没有任何凭证与设备绑定的身份注销掉，通常只在老数据里出现。
  sweepOwnerlessIdentities(graceMs = 60 * 60 * 1000, now = Date.now()) {
    const orphans = this.db.listOwnerlessPlayers(now - graceMs);
    for (const uid of orphans) {
      if (this.clients.has(uid)) continue;
      this.recentRooms.delete(uid);
      this.anonymizeUidInRooms(uid);
      this.db.eraseIdentity(uid, now);
    }
    return orphans.length;
  }

  // 换掉的身份如果已经没有任何有效凭证与设备绑定，就没人再认得回来：当场注销。
  dropIfOrphaned(uid) {
    if (!uid || this.clients.has(uid) || this.db.hasOwner(uid)) return false;
    this.recentRooms.delete(uid);
    this.anonymizeUidInRooms(uid);
    this.db.eraseIdentity(uid);
    return true;
  }

  // 档案：身份、改名历史与分页后的对局记录，只发给发起请求的人。
  profileFor(uid, page = 1, filter) {
    filter = normalizeMatchFilter(filter);
    const user = this.db.getProfile(uid);
    if (!user) throw new Error('身份不存在');
    const total = this.db.countMatchesFor(uid, filter);
    const pages = Math.max(1, Math.ceil(total / PROFILE_PAGE_SIZE));
    const current = Math.min(Math.max(Math.floor(Number(page)) || 1, 1), pages);
    const matches = this.db.listMatchesFor(uid, { limit: PROFILE_PAGE_SIZE, offset: (current - 1) * PROFILE_PAGE_SIZE, filter })
      .map((match) => {
        const themeName = match.mode === 'theme' ? THEMES.find((theme) => theme.id === match.themeId)?.name ?? null : null;
        const hits = matchHits(filter, match);
        return {
          id: match.id, roomCode: match.roomCode, mode: match.mode, outcome: match.outcome,
          totalRounds: match.totalRounds, convergedRound: match.convergedRound,
          themeName, startedAt: match.startedAt,
          players: match.players.filter((player) => player.uid !== uid)
            .map((player) => ({ name: player.name, ...(player.deleted ? { deleted: true } : {}) })),
          ...(hits ? { hits } : {})
        };
      });
    // soleOwner：脱离后这个身份就再没人能认回，前台据此改用会注销的文案。
    const soleOwner = this.db.countCredentials(uid) <= 1 && this.db.countLinkedDevices(uid) <= 1;
    return { user: { ...user, soleOwner }, nameHistory: this.db.getNameHistory(uid, PROFILE_NAME_HISTORY),
      matches, page: current, pageSize: PROFILE_PAGE_SIZE, total, filter,
      removed: this.db.countHiddenMatches(uid) };
  }

  sendProfile(connection, page, filter) {
    if (connection.ws?.readyState !== 1) return;
    connection.ws.send(JSON.stringify({ type: 'profile', profile: this.profileFor(connection.uid, page, filter), serverNow: Date.now() }));
  }

  sendMatch(connection, id) {
    if (connection.ws?.readyState !== 1) return;
    const match = typeof id === 'string' && id.length > 0 && id.length <= 128 ? this.db.getMatch(id) : null;
    // 自己移除过的记录连同详情一起隐藏。
    if (!match || !match.players.some((player) => player.uid === connection.uid) || this.db.isHidden(connection.uid, match.id)) {
      connection.ws.send(JSON.stringify({ type: 'matchDetail', id: id ?? null, match: null, error: '对局不存在或无权查看' }));
      return;
    }
    connection.ws.send(JSON.stringify({ type: 'matchDetail', id, match: {
      ...match,
      themeName: match.mode === 'theme' ? THEMES.find((theme) => theme.id === match.themeId)?.name ?? null : null,
      history: match.rounds.map((round) => ({ ...round, wordKeys: wordKeys(round) })),
    } }));
  }

  touch(room) {
    room.lastActiveAt = Date.now();
    this.broadcast(room);
  }

  // 从「我的记录」里移除一局：只影响自己，同局其他人照旧。
  removeMatch(connection, id) {
    const match = typeof id === 'string' && id.length > 0 && id.length <= 128 ? this.db.getMatch(id) : null;
    if (!match || !match.players.some((player) => player.uid === connection.uid)) throw new Error('对局不存在或无权操作');
    this.db.hideMatch(connection.uid, match.id);
    this.sendProfile(connection, 1);
    if (connection.removedPage) this.sendRemoved(connection, connection.removedPage);
  }

  restoreMatch(connection, id) {
    if (typeof id !== 'string' || !id) throw new Error('对局不存在');
    this.db.unhideMatch(connection.uid, id);
    this.sendProfile(connection, 1);
    if (connection.removedPage) this.sendRemoved(connection, connection.removedPage);
  }

  clearHistory(connection) {
    const removed = this.db.hideAllMatches(connection.uid);
    this.sendTo(connection, { type: 'toast', message: removed ? `已移除 ${removed} 局记录` : '没有可移除的记录' });
    this.sendProfile(connection, 1);
    if (connection.removedPage) this.sendRemoved(connection, connection.removedPage);
  }

  // 被移除的记录仍然留在库里，随时可以恢复。
  sendRemoved(connection, page = 1) {
    if (connection.ws?.readyState !== 1) return;
    const total = this.db.countHiddenMatches(connection.uid);
    const pages = Math.max(1, Math.ceil(total / PROFILE_PAGE_SIZE));
    const current = Math.min(Math.max(Math.floor(Number(page)) || 1, 1), pages);
    connection.removedPage = current;
    const matches = this.db.listHiddenMatches(connection.uid, {
      limit: PROFILE_PAGE_SIZE, offset: (current - 1) * PROFILE_PAGE_SIZE
    }).map((match) => ({
      id: match.id, roomCode: match.roomCode, mode: match.mode, outcome: match.outcome,
      totalRounds: match.totalRounds, convergedRound: match.convergedRound,
      themeName: match.mode === 'theme' ? THEMES.find((theme) => theme.id === match.themeId)?.name ?? null : null,
      startedAt: match.startedAt,
      players: match.players.filter((player) => player.uid !== connection.uid)
        .map((player) => ({ name: player.name, ...(player.deleted ? { deleted: true } : {}) }))
    }));
    this.sendTo(connection, {
      type: 'removedMatches',
      removed: { matches, page: current, pageSize: PROFILE_PAGE_SIZE, total },
      serverNow: Date.now()
    });
  }
  toast(room, event, player, excludeUid) {
    const message = event === 'join' ? `${player.name} 加入了房间` :
      event === 'leave' ? `${player.name} 已主动退出房间` :
      event === 'disconnect' ? `${player.name} 连接已断开，席位暂时保留，等待重连` :
      event === 'expired' ? `${player.name} 重连已超时，席位已移除` : `${player.name} 已重新连接，回来了`;
    for (const connection of this.clients.values()) {
      if (connection.roomCode === room.code && connection.uid !== excludeUid && connection.ws?.readyState === 1) {
        connection.ws.send(JSON.stringify({ type: 'toast', event, uid: player.uid, name: player.name, message }));
      }
    }
  }

  canRestore(connection, code) {
    let room = this.rooms.get(code);
    if (room && ['result', 'rematch'].includes(room.phase) && Date.now() >= room.rematchDeadline) this.finishRematch(room, true);
    room = this.rooms.get(code);
    const player = room?.players.find((item) => item.uid === connection.uid);
    if (!player) return false;
    if (['result', 'rematch'].includes(room.phase)) return room.rematchEligibleUids.includes(connection.uid);
    if (!player.connected && player.disconnectedAt != null && Date.now() - player.disconnectedAt >= 90000) {
      this.cleanup();
      return false;
    }
    return true;
  }

  restore(connection, code, onRestore = () => {}) {
    if (connection.roomCode && connection.roomCode !== code) this.detach(connection, true);
    if (!this.canRestore(connection, code)) return false;
    this.claimRoom(connection, code);
    const room = this.rooms.get(code);
    const player = this.playerFor(room, connection.uid);
    const returning = !player.connected;
    onRestore();
    connection.roomCode = code;
    player.connected = true;
    delete player.disconnectedAt;
    delete player.leftReason;
    if (!room.players.some((p) => p.uid === room.hostUid && p.connected)) room.hostUid = player.uid;
    this.sortPlayers(room);
    if (returning) this.toast(room, 'return', player, player.uid);
    this.touch(room);
    this.checkRematch(room);
    return true;
  }

  setPhase(room, phase, seconds, now = Date.now()) {
    clearTimeout(room.timer);
    clearTimeout(room.prepareGraceTimer);
    room.prepareGraceDeadline = null;
    room.phase = phase;
    room.phaseDeadline = seconds == null ? null : now + seconds * 1000;
    if (seconds != null) {
      const deadline = room.phaseDeadline;
      room.timer = setTimeout(() => {
        if (this.rooms.get(room.code) !== room || room.phaseDeadline !== deadline) return;
        this.advanceDeadline(room);
        this.broadcast(room);
      }, Math.max(0, deadline - Date.now()));
      room.timer.unref?.();
    }
  }

  active(room) { return room.players.filter((p) => p.connected); }
  selectTheme(room) {
    const theme = room.mode === 'theme' ? THEMES[Math.floor(this.random() * THEMES.length)] : null;
    room.themeId = theme?.id ?? null;
    room.themeName = theme?.name ?? null;
  }

  startWriting(room) {
    room.round += 1;
    room.currentRecord = null;
    for (const p of room.players) { p.draft = ''; p.submittedWord = undefined; p.vote = undefined; p.breakVote = undefined; p.ready = false; }
    this.setPhase(room, 'writing', room.writeSeconds);
  }

  reveal(room) {
    const words = {}, marks = {};
    const previous = room.history.flatMap((r) => Object.entries(r.words).filter(([uid]) => r.marks[uid] === 'none').map(([, word]) => word));
    for (const participant of [...room.matchPlayers, ...room.players.filter((p) => !room.matchPlayers.some((item) => item.uid === p.uid))]) {
      const p = room.players.find((player) => player.uid === participant.uid);
      const uid = participant.uid;
      const word = p ? (p.submittedWord ?? p.draft ?? '') : '';
      if (!word.trim()) { words[uid] = '[未提交]'; marks[uid] = 'empty'; continue; }
      try { validateWord(word, previous, room.banRepeat); words[uid] = word; marks[uid] = 'none'; }
      catch { words[uid] = '[非法答案]'; marks[uid] = 'invalid'; }
    }
    room.currentRecord = { n: room.round, words, marks, outcome: 'miss' };
    const contenders = room.players.filter((p) => p.connected || marks[p.uid] === 'none');
    if (contenders.length >= 2 && contenders.every((p) => marks[p.uid] === 'none' && normalizeWord(words[p.uid]) === normalizeWord(words[contenders[0].uid]))) {
      this.finishRound(room, 'exact');
    } else this.setPhase(room, 'voting', 5);
  }

  finishRound(room, outcome) {
    const record = room.currentRecord;
    if (!record || room.history.includes(record)) return;
    record.outcome = outcome;
    room.history.push(record);
    if (outcome !== 'miss' || room.round >= room.maxRounds) {
      room.outcome = outcome === 'miss' ? 'none' : outcome;
      this.setPhase(room, 'result', null);
      this.settle(room);
    } else if (room.maxRounds >= 8 && room.round % 5 === 0) {
      for (const p of room.players) p.breakVote = undefined;
      this.setPhase(room, 'breakVote', room.prepareSeconds);
    } else {
      for (const p of room.players) p.ready = false;
      const plan = preparePlan(room);
      this.setPhase(room, 'prepare', plan.durationMs / 1000);
      if (plan.graceMs) {
        room.prepareGraceDeadline = room.phaseDeadline - room.prepareSeconds * 1000;
        const deadline = room.phaseDeadline;
        room.prepareGraceTimer = setTimeout(() => {
          if (this.rooms.get(room.code) !== room || room.phase !== 'prepare' || room.phaseDeadline !== deadline) return;
          this.checkProgress(room);
          this.broadcast(room);
        }, Math.max(0, room.prepareGraceDeadline - Date.now()));
        room.prepareGraceTimer.unref?.();
      }
    }
  }

  finishVote(room, early = false) {
    const voters = room.players.filter((p) => p.connected || p.vote !== undefined);
    room.currentRecord.votes = Object.fromEntries(voters.filter((p) => !early || p.vote !== undefined).map((p) => [p.uid, p.vote === true]));
    room.currentRecord.voteChoices = Object.fromEntries(voters.filter((p) => !early || p.vote !== undefined).map((p) => [p.uid, p.vote === undefined ? 'timeout' : p.vote ? 'yes' : 'no']));
    const passed = voters.length >= 2 && voters.every((p) => p.vote === true);
    for (const connection of this.clients.values()) {
      if (connection.roomCode === room.code && connection.ws?.readyState === 1) {
        connection.ws.send(JSON.stringify({ type: 'toast', event: 'voteResult', message: passed ? '全票通过' : '未通过' }));
      }
    }
    this.finishRound(room, passed ? 'voted' : 'miss');
  }

  finishBreakVote(room, timedOut = false) {
    if (room.phase !== 'breakVote') return;
    const players = room.players;
    const yes = players.filter((p) => p.breakVote === true).length;
    const record = room.history.at(-1);
    if (record?.n === room.round) record.breakVote = {
      passed: yes * 2 >= players.length,
      choices: Object.fromEntries(players.filter((p) => p.breakVote !== undefined || timedOut)
        .map((p) => [p.uid, p.breakVote === undefined ? 'timeout' : p.breakVote ? 'yes' : 'no']))
    };
    if (yes * 2 >= players.length) {
      room.outcome = 'break';
      room.dropped = true;
      this.settle(room);
    } else this.startWriting(room);
  }

  checkProgress(room) {
    const minPlayers = room.mode === 'livonym' ? LIVONYM_LIMITS.minPlayers : 2;
    if (['countdown', 'writing', 'voting', 'prepare', 'breakVote', ...LIVONYM_PHASES].includes(room.phase)
      && room.players.length < minPlayers) {
      room.history = [];
      room.currentRecord = null;
      room.outcome = 'interrupted';
      this.setPhase(room, 'interrupted', null);
      return;
    }
    if (room.mode === 'livonym') {
      // 出题人掉线即中止本轮（不暂停等待）；无在线竞猜者或所有有效竞猜者均已猜中则提前结算。
      if (['lvIntro', 'lvPlay'].includes(room.phase)) {
        const lv = room.livonym;
        const describer = room.players.find((player) => player.uid === livonymDescriberUid(lv.order, lv.index));
        if (!describer || !describer.connected) return this.finishLivonymRound(room, true);
        const onlineGuessers = this.livonymGuessers(room);
        if (onlineGuessers.length === 0 && lv.guessed.length === 0) return this.finishLivonymRound(room, true);
        const guesserCount = this.effectiveLivonymGuesserCount(room);
        lv.roundGuesserCount = guesserCount;
        if (room.phase === 'lvPlay' && guesserCount > 0 && lv.guessed.length >= guesserCount) {
          this.finishLivonymRound(room);
        }
      }
      return;
    }
    if (room.phase === 'breakVote') {
      const yes = room.players.filter((p) => p.breakVote === true).length;
      const undecided = room.players.filter((p) => p.breakVote === undefined).length;
      if (yes * 2 >= room.players.length || (yes + undecided) * 2 < room.players.length) this.finishBreakVote(room);
      return;
    }
    const active = this.active(room);
    if (!active.length) return;
    if (room.phase === 'writing' && active.every((p) => p.submittedWord !== undefined)) this.reveal(room);
    else if (room.phase === 'voting' && room.players.some((p) => p.vote === false)) this.finishVote(room, true);
    else if (prepareCanAdvance(room)) this.startWriting(room);
  }

  settle(room) {
    if (room.persisted) return;
    room.resultPlayers = room.matchPlayers.map((player) => ({ ...player }));
    room.endedAt = Date.now();
    if (!room.dropped) this.db.saveMatch({
      id: room.matchId, roomCode: room.code, mode: room.mode, themeId: room.themeId ?? null,
      maxRounds: room.maxRounds, totalRounds: room.history.length,
      convergedRound: room.outcome === 'none' ? null : room.round, outcome: room.outcome,
      startedAt: room.startedAt, endedAt: room.endedAt,
      players: room.resultPlayers, rounds: room.history
    });
    room.persisted = true;
    // Settlement owns the only countdown; choices and reconnects never extend it.
    room.rematchEligibleUids = room.players.map((player) => player.uid);
    room.rematchRosterUids = [...room.rematchEligibleUids];
    room.rematchVotes = {};
    const rematchSeconds = (room.mode === 'livonym' && (room.players.length >= 5 || room.matchPlayers?.length >= 5))
      ? 60
      : REMATCH_SECONDS;
    this.setPhase(room, 'result', rematchSeconds, room.endedAt);
    room.rematchDeadline = room.phaseDeadline;
    room.rematchSeconds = rematchSeconds;
  }

  destroyRoom(room, message) {
    if (this.rooms.get(room.code) !== room) return;
    clearTimeout(room.timer);
    this.rooms.delete(room.code);
    clearTimeout(room.prepareGraceTimer);
    for (const [uid, recent] of this.recentRooms) {
      if (recent.room !== room) continue;
      this.recentRooms.delete(uid);
      for (const connection of this.connections) {
        if (connection.uid === uid && !connection.roomCode) this.sendState(connection, null);
      }
    }
    for (const connection of this.clients.values()) {
      if (connection.roomCode !== room.code) continue;
      connection.roomCode = null;
      this.sendState(connection, null);
      if (connection.ws?.readyState === 1) connection.ws.send(JSON.stringify({ type: 'toast', message }));
    }
  }

  checkRematch(room) {
    if (this.rooms.get(room.code) !== room || !['result', 'rematch'].includes(room.phase)) return;
    if (Date.now() >= room.rematchDeadline) { this.finishRematch(room, true); return; }
    const eligible = room.rematchEligibleUids;
    if (!eligible.length) { this.destroyRoom(room, '没有有效玩家，房间已关闭'); return; }
    if (eligible.every((uid) => room.players.some((player) => player.uid === uid && player.connected)
      && ['rematch', 'room'].includes(room.rematchVotes[uid]))) this.finishRematch(room);
  }

  finishRematch(room, timedOut = false) {
    if (this.rooms.get(room.code) !== room || !['result', 'rematch'].includes(room.phase)) return;
    if (!timedOut && !room.rematchEligibleUids.every((uid) => room.players.some((player) => player.uid === uid && player.connected)
      && ['rematch', 'room'].includes(room.rematchVotes[uid]))) return;
    const retained = room.players.filter((player) => player.connected && room.rematchEligibleUids.includes(player.uid)
      && ['rematch', 'room'].includes(room.rematchVotes[player.uid]));
    const roster = room.rematchRosterUids ?? room.rematchEligibleUids;
    const restart = retained.length >= 2 && retained.length === roster.length
      && roster.every((uid) => retained.some((player) => player.uid === uid) && room.rematchVotes[uid] === 'rematch');
    for (const player of room.players.filter((player) => !retained.includes(player))) {
      this.rememberDeparture(player.uid, room, player.disconnectedAt ?? Date.now());
      const connection = this.clients.get(player.uid);
      if (connection?.roomCode !== room.code) continue;
      connection.roomCode = null;
      this.sendState(connection, null);
      if (connection.ws?.readyState === 1) connection.ws.send(JSON.stringify({ type: 'toast', message: '超时未选择已退出' }));
    }
    room.players = retained;
    if (!retained.length) { this.destroyRoom(room, '没有玩家留下，房间已关闭'); return; }
    if (!room.players.some((player) => player.uid === room.hostUid)) room.hostUid = room.players[0].uid;
    for (const player of room.players) {
      player.ready = false; player.draft = '';
      delete player.submittedWord; delete player.vote; delete player.breakVote; delete player.disconnectedAt; delete player.leftReason;
    }
    for (const key of ['matchId', 'startedAt', 'endedAt', 'matchPlayers', 'resultPlayers', 'outcome',
      'currentRecord', 'persisted', 'rematchEligibleUids', 'rematchRosterUids', 'rematchVotes', 'rematchDeadline',
      'livonym']) delete room[key];
    room.history = []; room.round = 0; room.dropped = false;
    room.themeId = null; room.themeName = null;
    this.sortPlayers(room);
    if (restart) {
      room.matchId = randomUUID();
      room.startedAt = Date.now();
      room.matchPlayers = room.players.map(({ uid, name, seat }) => ({ uid, name, seat }));
      this.selectTheme(room);
      if (room.mode === 'livonym') this.startLivonym(room);
      this.setPhase(room, 'countdown', 5);
    } else this.setPhase(room, 'lobby', null);
    this.touch(room);
  }

  // ── 即时竞猜 ──

  sendTo(connection, payload) {
    if (connection?.ws?.readyState === 1) connection.ws.send(JSON.stringify(payload));
  }

  startLivonym(room) {
    const order = room.players.map((player) => player.uid);
    const rounds = Math.max(1, Number(room.roundsPerPlayer) || 1);
    if (!(room.livonymUsed instanceof Set)) room.livonymUsed = new Set();
    const since = Date.now() - LIVONYM_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const recent = this.db.recentLivonymSecrets?.(order, { since });
    room.livonymCooldown = recent instanceof Map ? recent : new Map(Object.entries(recent || {}));
    room.livonym = {
      order, index: -1, totalRounds: order.length * rounds,
      secret: null, stream: { text: '', rev: 0 }, guessed: [], wrongGuesses: {},
      roundPoints: {}, roundStartAt: 0, used: [],
      scores: Object.fromEntries(order.map((uid) => [uid, 0]))
    };
  }

  startLivonymRound(room) {
    const lv = room.livonym;
    if (!lv) return;
    for (;;) {
      lv.index += 1;
      if (lv.index >= lv.totalRounds) { this.finishLivonym(room); return; }
      // 已离开房间或处于离线断线保席期的玩家跳过其棒次，不补位也不等待
      const describerUid = livonymDescriberUid(lv.order, lv.index);
      const describer = room.players.find((player) => player.uid === describerUid);
      if (describer && describer.connected) break;
    }
    const { secret, category } = drawSecret({
      roomUsed: room.livonymUsed,
      cooldown: room.livonymCooldown,
      lastSecret: room.livonymLastSecret ?? null,
      lastCategory: room.livonymLastCategory ?? null,
      random: this.random
    });
    lv.secret = secret;
    lv.used.push(secret);
    room.livonymLastSecret = secret;
    room.livonymLastCategory = category;
    lv.stream = { text: '', rev: 0 };
    lv.guessed = [];
    lv.wrongGuesses = {};
    lv.roundPoints = {};
    lv.roundStartAt = Date.now();
    lv.roundGuesserCount = this.effectiveLivonymGuesserCount(room);
    room.livonymCooldown?.set(secret, lv.roundStartAt);
    room.round = lv.index + 1;
    room.currentRecord = null;
    for (const player of room.players) {
      player.draft = ''; player.ready = false;
      delete player.submittedWord; delete player.vote; delete player.breakVote;
    }
    this.setPhase(room, 'lvIntro', LIVONYM_INTRO_SECONDS);
  }

  beginLivonymPlay(room) {
    const lv = room.livonym;
    if (!lv || room.phase !== 'lvIntro') return;
    lv.roundStartAt = Date.now();
    lv.roundGuesserCount = this.effectiveLivonymGuesserCount(room);
    this.setPhase(room, 'lvPlay', room.describeSeconds || 45);
    this.checkProgress(room);
  }

  livonymGuessers(room) {
    const lv = room.livonym;
    const describerUid = livonymDescriberUid(lv.order, lv.index);
    return room.players.filter((player) => player.uid !== describerUid && player.connected);
  }

  // 本轮结算：出题人按猜中人数得分，竞猜者按名次得分；双方共用 roundPoints 与 scores。
  finishLivonymRound(room, aborted = false) {
    const lv = room.livonym;
    if (!lv || !['lvIntro', 'lvPlay'].includes(room.phase)) return;
    const describerUid = livonymDescriberUid(lv.order, lv.index);
    const guesserCount = this.effectiveLivonymGuesserCount(room);
    lv.roundGuesserCount = guesserCount;
    const guessedCount = lv.guessed.length;
    const points = { ...lv.roundPoints };
    points[describerUid] = (points[describerUid] || 0)
      + describerPoints({ guessedCount, guesserCount });
    for (const [uid, value] of Object.entries(points)) lv.scores[uid] = (lv.scores[uid] || 0) + value;
    lv.roundPoints = points;
    const wrongGuesses = Object.fromEntries(
      Object.entries(lv.wrongGuesses || {}).map(([uid, list]) => [uid, [...list]])
    );
    const record = {
      n: room.round, outcome: 'played', words: {}, marks: {}, votes: null,
      modeDetails: {
        secret: lv.secret, describerUid, description: lv.stream?.text ?? '',
        guesserCount, aborted,
        guesses: Object.fromEntries(lv.guessed.map((item) => [item.uid, { order: item.order, atMs: item.atMs }])),
        wrongGuesses,
        points
      }
    };
    room.currentRecord = record;
    room.history.push(record);
    this.setPhase(room, 'lvScore', LIVONYM_SCORE_SECONDS);
  }

  finishLivonym(room) {
    room.outcome = 'played';
    this.settle(room);
  }

  nextLivonymRound(room) {
    const lv = room.livonym;
    if (!lv) return;
    if (lv.index + 1 >= lv.totalRounds) this.finishLivonym(room);
    else this.startLivonymRound(room);
  }

  advanceLivonym(room) {
    if (room.phase === 'lvIntro') this.beginLivonymPlay(room);
    else if (room.phase === 'lvPlay') this.finishLivonymRound(room);
    else if (room.phase === 'lvScore') this.nextLivonymRound(room);
  }

  // 描述流走独立消息，不进 state 全量广播，也不回显给出题人本人。
  broadcastLivonymStream(room, describerUid) {
    const lv = room.livonym;
    const payload = JSON.stringify({
      type: 'livonymStream', describerUid,
      text: lv.stream.text, rev: lv.stream.rev, serverNow: Date.now()
    });
    for (const connection of this.clients.values()) {
      if (connection.roomCode !== room.code || connection.uid === describerUid || connection.ws?.readyState !== 1) continue;
      connection.ws.send(payload);
    }
  }

  applyLivonymStream(room, connection, player, text) {
    const lv = room.livonym;
    if (!lv) throw new Error('当前不在即时竞猜');
    const describerUid = livonymDescriberUid(lv.order, lv.index);
    if (room.phase !== 'lvPlay' || player.uid !== describerUid) throw new Error('这一轮不是你出题');
    const guesserCount = this.effectiveLivonymGuesserCount(room);
    lv.roundGuesserCount = guesserCount;
    if (guesserCount > 0 && lv.guessed.length >= Math.max(1, guesserCount - 1)) {
      return this.sendTo(connection, { type: 'livonymBlocked', reason: 'locked', text: lv.stream.text });
    }
    if (typeof text !== 'string') return this.sendTo(connection, { type: 'livonymBlocked', reason: 'invalid', text: '' });
    if ([...text].length > LIVONYM_LIMITS.describeLimit) {
      return this.sendTo(connection, { type: 'livonymBlocked', reason: 'tooLong', text });
    }
    if (containsSecret(text, lv.secret)) {
      return this.sendTo(connection, { type: 'livonymBlocked', reason: 'secret', text });
    }
    if (text === lv.stream.text) return;
    lv.stream = { text, rev: lv.stream.rev + 1 };
    this.broadcastLivonymStream(room, describerUid);
  }

  isLivonymDanmu(room, text) {
    if (room?.mode !== 'livonym') return false;
    if (typeof text !== 'string' || !text.trim()) return false;
    const lv = room?.livonym;
    if (!lv?.secret) return false;
    let normalized;
    try {
      normalized = validateWord(text, [], false);
    } catch {
      return true; // 包含标点、特殊符号、空白或超长
    }
    const targetLength = [...(lv.secret || '')].length;
    if ([...normalized].length !== targetLength) {
      return true; // 字数与秘密词不符
    }
    return false;
  }

  broadcastLivonymDanmu(room, payload) {
    const message = JSON.stringify({
      type: 'livonymDanmu',
      ...payload
    });
    for (const connection of this.clients.values()) {
      if (connection.roomCode === room.code && connection.ws?.readyState === 1) {
        connection.ws.send(message);
      }
    }
  }

  applyLivonymDanmu(room, connection, player, rawText) {
    if (typeof rawText !== 'string') return;
    const text = rawText.trim().slice(0, 100);
    if (!text) return;
    const now = Date.now();
    if (now - (connection.lastDanmu ?? 0) < 1000) {
      return this.sendTo(connection, { type: 'livonymDanmuResult', ok: false, reason: 'cooldown', cooldownMs: 1000 });
    }
    connection.lastDanmu = now;
    this.broadcastLivonymDanmu(room, {
      uid: player.uid,
      name: player.name,
      text,
      timestamp: now
    });
  }

  applyLivonymGuess(room, connection, player, text) {
    const lv = room.livonym;
    if (!lv) throw new Error('当前不在即时竞猜');
    const reply = (payload) => this.sendTo(connection, {
      type: 'livonymGuessResult', text: typeof text === 'string' ? text : '', ...payload
    });
    if (room.phase !== 'lvPlay') return reply({ ok: false, reason: 'closed' });
    if (player.uid === livonymDescriberUid(lv.order, lv.index)) throw new Error('这一轮由你出题');
    if (this.isLivonymDanmu(room, text)) {
      const danmuText = typeof text === 'string' ? text.trim().slice(0, 100) : '';
      if (danmuText) {
        this.broadcastLivonymDanmu(room, {
          uid: player.uid,
          name: player.name,
          text: danmuText,
          timestamp: Date.now()
        });
      }
      return reply({ ok: false, reason: 'danmu', cooldownMs: 1000 });
    }
    if (lv.guessed.some((item) => item.uid === player.uid)) return reply({ ok: false, reason: 'closed' });
    let normalized;
    try { normalized = validateWord(text, [], false); } catch { return reply({ ok: false, reason: 'invalid' }); }
    if (normalized !== normalizeWord(lv.secret)) {
      (lv.wrongGuesses[player.uid] ||= []).push(normalized);
      return reply({ ok: false, reason: 'wrong' });
    }
    const order = lv.guessed.length + 1;
    const atMs = Math.max(0, Date.now() - lv.roundStartAt);
    lv.guessed.push({ uid: player.uid, name: player.name, order, atMs });
    const guesserCount = this.effectiveLivonymGuesserCount(room);
    lv.roundGuesserCount = guesserCount;
    const totalPlayers = guesserCount + 1;
    const points = guessPoints(order, totalPlayers);
    lv.roundPoints[player.uid] = points;
    reply({ ok: true, order, points });
    for (const client of this.clients.values()) {
      if (client.roomCode !== room.code || client.ws?.readyState !== 1) continue;
      client.ws.send(JSON.stringify({ type: 'livonymGuessed', uid: player.uid, name: player.name, order, inMs: atMs }));
    }
    this.checkProgress(room);
    this.broadcast(room);
  }

  advanceDeadline(room) {
    if (room.phase === 'countdown') {
      if (room.mode === 'livonym') this.startLivonymRound(room);
      else this.startWriting(room);
    } else if (LIVONYM_PHASES.includes(room.phase)) this.advanceLivonym(room);
    else if (room.phase === 'writing') this.reveal(room);
    else if (room.phase === 'voting') this.finishVote(room);
    else if (room.phase === 'prepare') this.startWriting(room);
    else if (room.phase === 'breakVote') this.finishBreakVote(room, true);
    else if (['result', 'rematch'].includes(room.phase)) this.finishRematch(room, true);
  }
  close() { for (const room of this.rooms.values()) { clearTimeout(room.timer); clearTimeout(room.prepareGraceTimer); } }

  detach(connection, remove = false) {
    let room = this.rooms.get(connection.roomCode);
    // Explicit departure wins at a deadline boundary; late game messages do not.
    if (!remove && room && ['result', 'rematch'].includes(room.phase) && Date.now() >= room.rematchDeadline) {
      this.finishRematch(room, true);
      room = this.rooms.get(connection.roomCode);
    }
    if (!room) { connection.roomCode = null; return; }
    const player = room.players.find((item) => item.uid === connection.uid);
    if (player) this.rememberDeparture(connection.uid, room);
    connection.roomCode = null;
    if (remove) {
      const removed = removePlayer(room, connection.uid);
      if (removed) this.toast(room, 'leave', removed);
    } else if (markDisconnected(player)) {
      this.toast(room, 'disconnect', player);
    } else return;
    if (room.hostUid === connection.uid) this.transferHost(room);
    if (!room.players.length) { this.destroyRoom(room, '没有玩家留下，房间已关闭'); return; }
    if (remove) this.checkRematch(room);
    if (this.rooms.get(room.code) !== room) return;
    this.checkProgress(room);
    this.touch(room);
  }
  disconnect(connection) {
    this.connections.delete(connection);
    if (this.clients.get(connection.uid) !== connection) return;
    this.detach(connection);
    const other = [...this.connections].find((client) => client.uid === connection.uid && !client.replaced);
    if (other) this.clients.set(connection.uid, other); else this.clients.delete(connection.uid);
  }

  transferHost(room) {
    const next = room.players.find((player) => player.connected && player.uid !== room.hostUid);
    if (next) room.hostUid = next.uid;
    this.sortPlayers(room);
  }

  sortPlayers(room) {
    room.players.sort((a, b) => {
      if (a.uid === room.hostUid) return -1;
      if (b.uid === room.hostUid) return 1;
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
  }

  addPlayer(connection, room, name) {
    const usedSeats = new Set(room.players.map((player) => player.seat));
    // 座位数按最大容量（即时竞猜 8 人）铺设，其他模式由容量校验挡住
    const seat = Array.from({ length: modeCapacity('livonym') }, (_, index) => index)
      .find((value) => !usedSeats.has(value));
    const uniqueName = room.players.some((player) => player.name === name)
      ? createName(room.players.map((player) => player.name)) : name;
    room.players.push({
      uid: connection.uid, name: uniqueName, seat, connected: true, ready: false,
      draft: '', joinedAt: Date.now()
    });
    connection.roomCode = room.code;
    this.sortPlayers(room);
  }

  handle(connection, message) {
    if (!message || typeof message !== 'object') throw new Error('消息格式无效');
    let { type } = message;
    // 档案只读，不占用写操作限流：改名后立刻刷新档案不该被 500ms 冷却拦下。
    if (type === 'openProfile') { this.sendProfile(connection, message.page, message.filter); return; }
    if (type === 'openMatch') { this.sendMatch(connection, message.id); return; }
    // 设备认领与记录删除同样不占写操作限流：都是本人对自己的档案动手。
    if (type === 'claimDevice') { this.claimDevice(connection, message.uid); return; }
    if (type === 'rejectDevice') { this.rejectDevice(connection, message.uid); return; }
    if (type === 'leaveIdentity' || type === 'resetDeviceBinding' || type === 'resetIdentity') { this.leaveIdentity(connection); return; }
    if (type === 'deleteMatch') { this.removeMatch(connection, message.id); return; }
    if (type === 'restoreMatch') { this.restoreMatch(connection, message.id); return; }
    if (type === 'clearHistory') { this.clearHistory(connection); return; }
    if (type === 'openRemoved') { this.sendRemoved(connection, message.page); return; }
    const typing = type === 'typing' || type === 'draft';
    const streaming = type === 'livonymStream';
    const guessing = type === 'livonymGuess';
    const danmu = type === 'livonymDanmu';
    const now = Date.now();
    if (streaming) {
      // 流式抖动是常态：超限静默丢弃，不回错误提示
      if (now - connection.lastStream < LIVONYM_STREAM_INTERVAL_MS) return;
      connection.lastStream = now;
    } else if (danmu) {
      // 弹幕独立限流 1000ms，在 applyLivonymDanmu 处理
    } else if (guessing) {
      const room = connection.roomCode ? this.rooms.get(connection.roomCode) : null;
      const isDanmu = room?.mode === 'livonym' && room?.livonym && this.isLivonymDanmu(room, message.text);
      if (isDanmu) {
        if (now - (connection.lastDanmu ?? 0) < 1000) {
          this.sendTo(connection, {
            type: 'livonymGuessResult', ok: false, reason: 'danmu', cooldownMs: 1000,
            text: typeof message.text === 'string' ? message.text : ''
          });
          return;
        }
        connection.lastDanmu = now;
      } else {
        if (now - connection.lastGuess < LIVONYM_GUESS_COOLDOWN_MS) {
          this.sendTo(connection, {
            type: 'livonymGuessResult', ok: false, reason: 'cooldown',
            text: typeof message.text === 'string' ? message.text : ''
          });
          return;
        }
        connection.lastGuess = now;
      }
    } else {
      if (typing ? now - connection.lastTyping < 300 : now - connection.lastWrite < 500) {
        throw new Error('操作太频繁，请稍后再试');
      }
      if (typing) connection.lastTyping = now; else connection.lastWrite = now;
    }
    if (type === 'joinRecentRoom') {
      const recent = this.recentRoomFor(connection.uid);
      if (!recent || recent.code !== message.code || connection.roomCode) throw new Error('最近退出的房间已失效');
      type = 'joinRoom';
    }
    const room = connection.roomCode ? this.rooms.get(connection.roomCode) : null;
    if (type === 'leave') {
      this.detach(connection, true);
      this.sendState(connection, null);
      return;
    }
    if (room && !['createRoom', 'joinRoom'].includes(type) && ['result', 'rematch'].includes(room.phase) && now >= room.rematchDeadline) {
      this.finishRematch(room, true);
      throw new Error('选择已超时，请根据当前阶段重新操作');
    }
    if (type === 'hello') {
      if (room) this.sendState(connection);
      return;
    }
    if (type === 'rename' && !room) {
      const name = validateName(message.name);
      this.db.rename(connection.uid, name);
      this.sendState(connection, null);
      return;
    }
    // 创建房间/加入房间由后面的分支处理。
    if (type === 'createRoom' || type === 'joinRoom') {
      // 房间数上限：防止有人反复建房把内存吃满；已在房内的人建房会先退出旧房，所以这里按上限拒绝。
      if (type === 'createRoom' && this.rooms.size >= this.maxRooms) throw new Error('服务器房间已满，请稍后再试');
      const player = this.db.getPlayer(connection.uid);
      let target;
      if (type === 'joinRoom') {
        const code = validateCode(message.code?.toUpperCase());
        target = this.rooms.get(code);
        if (!target) throw new Error('没有找到这个房间');
        if (connection.roomCode === code) { this.sendState(connection, target); return; }
        const existing = target.players.find((item) => item.uid === connection.uid);
        if (existing && this.canRestore(connection, code)) {
          this.restore(connection, code);
          return;
        }
        target = this.rooms.get(code);
        if (!target) throw new Error('没有找到这个房间');
        if (target.phase !== 'lobby') throw new Error('这局已经开始');
        if (target.players.length >= modeCapacity(target.mode)) throw new Error('房间已满');
        if (target.passwordEnabled && message.password !== target.password) throw new Error('房间密码错误，请输入房主提供的 6 位数字密码');
      }
      const settings = type === 'createRoom' ? validateSettings(message) : null;
      this.detach(connection, true);
      if (type === 'createRoom') {
        const code = this.makeCode();
        target = {
          code, ...settings, phase: 'lobby', round: 0, hostUid: connection.uid,
          players: [], history: [], dropped: false, createdAt: Date.now(), lastActiveAt: Date.now()
        };
        this.rooms.set(code, target);
      }
      this.claimRoom(connection, target.code);
      this.addPlayer(connection, target, player.name);
      if (type === 'joinRoom') this.toast(target, 'join', this.playerFor(target, connection.uid));
      this.touch(target);
      return;
    }
    const current = this.roomFor(connection);
    let player = this.playerFor(current, connection.uid);
    if (current.phaseDeadline != null && Date.now() >= current.phaseDeadline) {
      this.advanceDeadline(current);
      if (this.rooms.get(current.code) !== current) throw new Error('房间已关闭');
      if (connection.roomCode !== current.code) throw new Error('你还没有加入房间');
      player = this.playerFor(current, connection.uid);
      this.touch(current);
    }
    switch (type) {
      case 'updateSettings': {
        if (current.hostUid !== connection.uid) throw new Error('只有房主可以修改设置');
        if (current.phase !== 'lobby') throw new Error('开局后不能修改设置');
        Object.assign(current, validateSettings({ ...current, ...message }));
        current.themeId = null; current.themeName = null;
        break;
      }
      case 'rename': {
        player.name = validateName(message.name);
        this.db.rename(connection.uid, player.name);
        break;
      }
      case 'typing':
      case 'draft': {
        if (current.phase !== 'writing' || player.submittedWord !== undefined) throw new Error('当前不能输入');
        const word = type === 'draft' ? message.text : message.word;
        if (typeof word !== 'string' || word.length > 1024) throw new Error('输入内容无效');
        player.draft = word;
        break;
      }
      case 'submitWord': {
        if (current.phase !== 'writing' || player.submittedWord !== undefined) throw new Error('当前不能提交');
        if (typeof message.word !== 'string' || message.word.length > 1024) throw new Error('输入内容无效');
        player.draft = message.word;
        const previous = current.history.flatMap((r) => Object.entries(r.words).filter(([uid]) => r.marks[uid] === 'none').map(([, word]) => word));
        validateWord(message.word, previous, current.banRepeat);
        player.submittedWord = message.word;
        this.checkProgress(current);
        break;
      }
      case 'vote':
      case 'submitVote': {
        if (current.phase !== 'voting' || player.vote !== undefined) throw new Error('当前不能投票');
        const yes = type === 'vote' ? message.yes : message.agree;
        if (typeof yes !== 'boolean') throw new Error('投票无效');
        player.vote = yes;
        this.checkProgress(current);
        break;
      }
      case 'breakVote': {
        if (current.phase !== 'breakVote' || player.breakVote !== undefined) throw new Error('当前不能投票');
        if (typeof message.yes !== 'boolean') throw new Error('投票无效');
        player.breakVote = message.yes;
        this.checkProgress(current);
        break;
      }
      case 'ready': {
        if (current.phase !== 'prepare') throw new Error('当前不能准备');
        if (message.ready !== undefined && typeof message.ready !== 'boolean') throw new Error('准备状态无效');
        player.ready = message.ready ?? true;
        this.checkProgress(current);
        break;
      }
      case 'setReady': {
        if (current.phase === 'prepare') {
          if (typeof message.ready !== 'boolean') throw new Error('准备状态无效');
          player.ready = message.ready;
          this.checkProgress(current);
          break;
        }
        if (current.phase !== 'lobby') throw new Error('当前不能准备');
        if (current.hostUid === connection.uid) throw new Error('房主无需准备');
        if (typeof message.ready !== 'boolean') throw new Error('准备状态无效');
        player.ready = message.ready;
        break;
      }
      case 'transferHost': {
        if (current.hostUid !== connection.uid) throw new Error('只有房主可以转让房主');
        if (current.phase !== 'lobby') throw new Error('开局后不能转让房主');
        const nextHost = current.players.find((item) => item.uid === message.uid);
        if (!nextHost) throw new Error('没有找到这位玩家');
        if (nextHost.uid === connection.uid) throw new Error('你已经是房主');
        if (!nextHost.connected) throw new Error('对方暂时不在线');
        current.hostUid = nextHost.uid;
        player.ready = false;
        nextHost.ready = false;
        this.sortPlayers(current);
        break;
      }
      case 'start': {
        if (current.hostUid !== connection.uid) throw new Error('只有房主可以开始');
        if (current.phase !== 'lobby') throw new Error('这局已经开始');
        const capacity = modeCapacity(current.mode);
        const minPlayers = current.mode === 'livonym' ? LIVONYM_LIMITS.minPlayers : 2;
        if (current.players.length < minPlayers || current.players.length > capacity) {
          throw new Error(`需要 ${minPlayers} 到 ${capacity} 人才能开始`);
        }
        if (current.players.some((item) => item.uid !== current.hostUid && (!item.ready || !item.connected))) {
          throw new Error('等所有在线玩家准备后才能开始');
        }
        current.matchId = randomUUID();
        current.startedAt = Date.now();
        current.matchPlayers = current.players.map(({ uid, name, seat }) => ({ uid, name, seat }));
        this.selectTheme(current);
        if (current.mode === 'livonym') this.startLivonym(current);
        this.setPhase(current, 'countdown', 5);
        break;
      }
      case 'rematch': {
        if (current.phase === 'interrupted' && message.choice === 'room') {
          if (!player.connected) throw new Error('当前不能重赛');
          const onlineUids = current.players.filter((item) => item.connected).map((item) => item.uid);
          current.rematchEligibleUids = onlineUids;
          current.rematchVotes = Object.fromEntries(onlineUids.map((uid) => [uid, 'room']));
          current.phase = 'result';
          this.finishRematch(current);
          this.touch(current);
          return;
        }
        const choice = message.choice ?? (message.accept === true ? 'rematch' : message.accept === false ? 'room' : undefined);
        if (!['rematch', 'room'].includes(choice)) throw new Error('重赛投票无效');
        if (!['result', 'rematch'].includes(current.phase) || !player.connected) throw new Error('当前不能重赛');
        if (!current.rematchEligibleUids.includes(connection.uid)) throw new Error('没有重赛资格');
        if (choice === 'rematch' && current.rematchEligibleUids.some((uid) => current.rematchVotes[uid] === 'room')) {
          throw new Error('已有玩家选择回房间，不能重赛');
        }
        if (current.phase === 'result') current.phase = 'rematch';
        current.rematchVotes[connection.uid] = choice;
        this.checkRematch(current);
        if (this.rooms.get(current.code) !== current) return;
        break;
      }
      case 'livonymStream': {
        this.applyLivonymStream(current, connection, player, message.text);
        this.touch(current);
        return;
      }
      case 'livonymDanmu': {
        if (current.mode === 'livonym') {
          this.applyLivonymDanmu(current, connection, player, message.text);
        }
        return;
      }
      case 'livonymGuess': {
        this.applyLivonymGuess(current, connection, player, message.text);
        return;
      }
      case 'leave': {
        this.detach(connection, true);
        this.sendState(connection, null);
        return;
      }
      default:
        throw new Error('当前阶段不支持此操作');
    }
    this.touch(current);
  }

  cleanup(now = Date.now()) {
    for (const [uid, recent] of this.recentRooms) if (recent.expiresAt <= now) this.recentRooms.delete(uid);
    for (const [code, room] of this.rooms) {
      if (['result', 'rematch'].includes(room.phase)) {
        if (now >= room.rematchDeadline) this.finishRematch(room, true);
        continue;
      }
      const expired = room.players.filter((player) => disconnectExpired(player, now));
      if (expired.length) {
        for (const player of expired) {
          this.rememberDeparture(player.uid, room, player.disconnectedAt ?? now);
          removePlayer(room, player.uid);
          this.toast(room, 'expired', player);
          const connection = this.clients.get(player.uid);
          if (connection?.roomCode === code) { connection.roomCode = null; this.sendState(connection, null); }
        }
        if (expired.some((player) => player.uid === room.hostUid)) this.transferHost(room);
        this.checkProgress(room);
        if (room.players.length) this.broadcast(room);
      }
      if (!room.players.length || now - room.lastActiveAt >= ROOM_IDLE_MS) {
        this.destroyRoom(room, '房间因长时间无活动已关闭');
      }
    }
    for (const connection of this.clients.values()) {
      const code = connection.roomCode;
      if (code && (!this.rooms.has(code) || !this.rooms.get(code).players.some((p) => p.uid === connection.uid))) {
        connection.roomCode = null;
        this.sendState(connection, null);
      }
    }
  }
}

export function createMemoryDb() {
  const players = new Map();
  const nameHistory = new Map();
  const matches = new Map();
  const credentials = new Map();   // 凭证哈希 -> uid
  const devices = new Map();
  const links = new Map();
  const rejections = new Map();
  const hidden = new Map();
  // 与 SQLite 同一语义：注销只把行标记成失效，不物理删除。
  const disabled = { nameHistory: new Set(), credentials: new Set(), links: new Set(), rejections: new Set(), hidden: new Set() };
  const hiddenFor = (uid, matchId) => hidden.has(hiddenKey(uid, matchId)) && !disabled.hidden.has(hiddenKey(uid, matchId));
  const linkKey = (deviceKey, uid) => `${deviceKey}|${uid}`;
  const hiddenKey = (uid, matchId) => `${uid}|${matchId}`;
  const credentialKey = (hash) => (Buffer.isBuffer(hash) ? hash.toString('hex') : String(hash));
  const alive = (uid) => {
    const player = players.get(uid);
    return player && !player.deletedAt ? player : undefined;
  };
  const membersOf = (match) => (match.players || []).map((player) => ({
    uid: player.uid, seat: player.seat, name: player.name,
    ...(players.get(player.uid)?.deletedAt ? { deleted: true } : {})
  }));
  // 与 SQL 同一语义：任一维度命中即算找到
  const matchesAny = (match, filter) => {
    const needle = filter.value.toLowerCase();
    if (needle) {
      if (match.roomCode.toLowerCase().startsWith(needle)) return true;
      // 已注销身份不再按 UID 前缀命中
      if (match.players.some((player) => !players.get(player.uid)?.deletedAt && player.uid.toLowerCase().startsWith(needle))) return true;
      if (match.players.some((player) => String(player.name).toLowerCase().includes(needle))) return true;
      if (filter.themeIds.includes(match.themeId)) return true;
    }
    if (filter.from !== undefined && match.startedAt < filter.from) return false;
    if (filter.to !== undefined && match.startedAt >= filter.to) return false;
    return filter.from !== undefined || filter.to !== undefined;
  };
  const filteredMatches = (uid, input) => {
    const filter = normalizeMatchFilter(input);
    return [...matches.values()].filter((match) => match.players.some((player) => player.uid === uid)
      && !hiddenFor(uid, match.id)
      && (!filter || matchesAny(match, filter)));
  };
  return {
    getPlayer: (uid) => alive(uid),
    getProfile: (uid) => {
      const player = alive(uid);
      return player ? { uid: player.uid, name: player.name, createdAt: player.createdAt } : undefined;
    },
    createPlayer(uid, name) {
      const player = { uid, name, createdAt: Date.now() };
      players.set(uid, player);
      nameHistory.set(uid, [{ name, changedAt: player.createdAt }]);
      return { uid, name };
    },
    touch() {},
    rename(uid, name) {
      players.get(uid).name = name;
      if (!nameHistory.has(uid)) nameHistory.set(uid, []);
      nameHistory.get(uid).unshift({ name, changedAt: Date.now() });
    },
    getNameHistory: (uid, limit = 20) => (disabled.nameHistory.has(uid) ? [] : (nameHistory.get(uid) || []).slice(0, limit)),
    setCredentialHash(uid, hash) { disabled.credentials.delete(credentialKey(hash)); credentials.set(credentialKey(hash), uid); },
    getCredentialHash(uid) {
      for (const [key, owner] of credentials) if (owner === uid && !disabled.credentials.has(key)) return Buffer.from(key, 'hex');
      return undefined;
    },
    addCredential(uid, hash) { disabled.credentials.delete(credentialKey(hash)); credentials.set(credentialKey(hash), uid); },
    credentialOwner: (hash) => (disabled.credentials.has(credentialKey(hash)) ? undefined : credentials.get(credentialKey(hash))),
    touchCredential() {},
    dropCredential: (hash) => credentials.delete(credentialKey(hash)),
    countCredentials(uid) {
      let total = 0;
      for (const [key, owner] of credentials) if (owner === uid && !disabled.credentials.has(key)) total += 1;
      return total;
    },
    disableCredential(hash) { disabled.credentials.add(credentialKey(hash)); },
    countLinkedDevices: (uid) => new Set(
      [...links.entries()]
        .filter(([key, link]) => link.uid === uid && !disabled.links.has(key))
        .map(([, link]) => devices.get(link.deviceKey)?.weakKey || link.deviceKey)
    ).size,
    hasOwner(uid) {
      for (const [key, owner] of credentials) if (owner === uid && !disabled.credentials.has(key)) return true;
      return this.countLinkedDevices(uid) > 0;
    },
    listOwnerlessPlayers(before) {
      return [...players.values()]
        .filter((player) => !player.deletedAt && player.createdAt < before && !this.hasOwner(player.uid))
        .map((player) => player.uid);
    },
    insertDevice({ deviceKey, weakKey, profileJson, profile }, now = Date.now()) {
      const previous = devices.get(deviceKey);
      devices.set(deviceKey, {
        deviceKey, weakKey, device_key: deviceKey, weak_key: weakKey,
        profileJson: profileJson ?? profile ?? '{}', firstSeen: previous?.firstSeen ?? now, lastSeen: now
      });
    },
    getDevice: (deviceKey) => devices.get(deviceKey),
    devicesByWeakKey: (weakKey) => [...devices.values()].filter((device) => device.weakKey === weakKey),
    touchDevice(deviceKey, now = Date.now()) { const device = devices.get(deviceKey); if (device) device.lastSeen = now; },
    dropDevice: (deviceKey) => { devices.delete(deviceKey); },
    getDeviceLinks(deviceKey) {
      return [...links.entries()].filter(([key, link]) => link.deviceKey === deviceKey && !disabled.links.has(key))
        .map(([, link]) => link)
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .map(({ uid, boundAt, lastSeen, source }) => ({ uid, bound_at: boundAt, last_seen: lastSeen, source }));
    },
    countDeviceLinks: (deviceKey) => [...links.entries()]
      .filter(([key, link]) => link.deviceKey === deviceKey && !disabled.links.has(key)).length,
    linkDevice(deviceKey, uid, source, now = Date.now()) {
      const previous = links.get(linkKey(deviceKey, uid));
      disabled.links.delete(linkKey(deviceKey, uid));
      links.set(linkKey(deviceKey, uid), { deviceKey, uid, boundAt: previous?.boundAt ?? now, lastSeen: now, source });
    },
    touchDeviceLink(deviceKey, uid, now = Date.now()) {
      const key = linkKey(deviceKey, uid);
      const link = links.get(key);
      if (link && !disabled.links.has(key)) link.lastSeen = now;
    },
    unlinkDevice(deviceKey, uid) { disabled.links.delete(linkKey(deviceKey, uid)); links.delete(linkKey(deviceKey, uid)); },
    rejectDevice(deviceKey, uid, now = Date.now()) {
      disabled.rejections.delete(linkKey(deviceKey, uid));
      rejections.set(linkKey(deviceKey, uid), now);
    },
    isDeviceRejected: (deviceKey, uid) => rejections.has(linkKey(deviceKey, uid)) && !disabled.rejections.has(linkKey(deviceKey, uid)),
    pruneDevices() {},
    hideMatch: (uid, matchId, now = Date.now()) => {
      disabled.hidden.delete(hiddenKey(uid, matchId));
      hidden.set(hiddenKey(uid, matchId), now);
    },
    unhideMatch: (uid, matchId) => {
      disabled.hidden.delete(hiddenKey(uid, matchId));
      hidden.delete(hiddenKey(uid, matchId));
    },
    isHidden: (uid, matchId) => hiddenFor(uid, matchId),
    hideAllMatches(uid, now = Date.now()) {
      for (const match of matches.values()) {
        if (!match.players.some((player) => player.uid === uid)) continue;
        disabled.hidden.delete(hiddenKey(uid, match.id));
        hidden.set(hiddenKey(uid, match.id), now);
      }
      return this.countHiddenMatches(uid);
    },
    unhideAllMatches(uid) {
      for (const key of [...hidden.keys()]) {
        if (!key.startsWith(`${uid}|`)) continue;
        hidden.delete(key);
        disabled.hidden.delete(key);
      }
    },
    countHiddenMatches: (uid) => [...hidden.keys()]
      .filter((key) => key.startsWith(`${uid}|`) && !disabled.hidden.has(key)).length,
    listHiddenMatches(uid, { limit = 10, offset = 0 } = {}) {
      return [...matches.values()]
        .filter((match) => hiddenFor(uid, match.id) && match.players.some((player) => player.uid === uid))
        .sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .slice(offset, offset + limit)
        .map((match) => ({ ...structuredClone(match), players: membersOf(match) }));
    },
    // 注销只禁用：行都还在，只是不再可读。
    eraseIdentity(uid, now = Date.now()) {
      const player = alive(uid);
      if (!player) return false;
      player.deletedAt = now;
      player.name = DELETED_NAME;
      disabled.nameHistory.add(uid);
      for (const [key, owner] of credentials) if (owner === uid) disabled.credentials.add(key);
      for (const [key, link] of links) if (link.uid === uid) disabled.links.add(key);
      for (const key of rejections.keys()) if (key.endsWith(`|${uid}`)) disabled.rejections.add(key);
      for (const key of hidden.keys()) if (key.startsWith(`${uid}|`)) disabled.hidden.add(key);
      const erase = (value) => { if (value && typeof value === 'object' && uid in value) value[uid] = null; };
      for (const match of matches.values()) {
        const seat = match.players.find((entry) => entry.uid === uid);
        if (!seat) continue;
        seat.name = DELETED_NAME;
        for (const round of match.rounds || []) {
          erase(round.words);
          erase(round.marks);
          erase(round.votes);
          erase(round.voteChoices);
          erase(round.breakVote);
          erase(round.breakVote?.choices);
          erase(round.modeDetails?.guesses);
          erase(round.modeDetails?.wrongGuesses);
          if (round.modeDetails?.describerUid === uid && 'description' in round.modeDetails) {
            round.modeDetails.description = null;
          }
        }
      }
      return true;
    },
    saveMatch(match) { if (!matches.has(match.id)) matches.set(match.id, structuredClone(match)); },
    recentLivonymSecrets(uids, { since = 0 } = {}) {
      const uidSet = new Set((uids || []).filter((uid) => typeof uid === 'string' && uid));
      const seen = new Map();
      if (!uidSet.size) return seen;
      for (const match of matches.values()) {
        if (match.mode !== 'livonym' || match.startedAt < since) continue;
        if (!match.players?.some((player) => uidSet.has(player.uid))) continue;
        for (const round of match.rounds || []) {
          const secret = round.modeDetails?.secret;
          if (typeof secret !== 'string' || !secret) continue;
          const prev = seen.get(secret);
          if (prev === undefined || match.startedAt > prev) seen.set(secret, match.startedAt);
        }
      }
      return seen;
    },
    getMatch(id) {
      const match = matches.get(id);
      return match ? { ...structuredClone(match), players: membersOf(match) } : undefined;
    },
    listMatches: () => structuredClone([...matches.values()]),
    countMatchesFor: (uid, filter) => filteredMatches(uid, filter).length,
    listMatchesFor(uid, { limit = 10, offset = 0, filter } = {}) {
      return filteredMatches(uid, filter)
        .sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .slice(offset, offset + limit)
        .map((match) => ({ ...structuredClone(match), players: membersOf(match) }));
    },
    close() {}
  };
}
