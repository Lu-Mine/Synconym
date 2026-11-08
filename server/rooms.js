import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildChart } from './similarity.js';
import { normalizeMatchFilter } from './db.js';
import { preparePlan, prepareCanAdvance, DISCONNECT_WINDOW_MS, REMATCH_SECONDS } from './phase.js';
import { markDisconnected, disconnectExpired, removePlayer } from './presence.js';
import { createName } from './names.js';
import { UID_CHARS, UID_LENGTH, isValidUid, validateCode, validateName, validateSettings, validateWord, normalizeWord } from './rules.js';

const ROOM_IDLE_MS = 5 * 60 * 1000;
const THEMES = JSON.parse(readFileSync(new URL('../data/themes.json', import.meta.url), 'utf8'));
const PROFILE_PAGE_SIZE = 10;
const PROFILE_NAME_HISTORY = 20;

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
      else if (player.uid.toLowerCase().startsWith(needle)) names.push({ name, whole: true });
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
  constructor({ db = createMemoryDb(), random = Math.random, maxRooms = Infinity, publicUrl = process.env.PUBLIC_URL || '' } = {}) {
    this.db = db;
    this.publicUrl = publicUrl;
    this.random = random;
    this.maxRooms = maxRooms;
    this.rooms = new Map();
    this.clients = new Map();
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
    const connection = { ws: null, uid, roomCode: null, lastWrite: 0, lastTyping: 0 };
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

  sendState(connection, room = this.rooms.get(connection.roomCode)) {
    if (connection.ws?.readyState !== 1) return;
    const user = this.db.getPlayer(connection.uid);
    connection.ws.send(JSON.stringify({
      type: 'state', uid: connection.uid, user: { uid: user.uid, name: user.name },
      publicUrl: this.publicUrl?.replace(/\/$/, '') || undefined,
      room: room ? {
        code: room.code, mode: room.mode, themeId: room.themeId ?? null, themeName: room.themeName ?? null,
        maxRounds: room.maxRounds, writeSeconds: room.writeSeconds,
        prepareSeconds: room.prepareSeconds, banRepeat: room.banRepeat,
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
        resultPlayers: room.resultPlayers ?? null, chart: room.chart ?? null,
        rematchEligibleUids: room.rematchEligibleUids ?? [], rematchVotes: room.rematchVotes ?? {},
        rematchDeadline: room.rematchDeadline ?? null
      } : null,
      serverNow: Date.now()
    }));
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
          id: match.id, roomCode: match.roomCode, outcome: match.outcome,
          totalRounds: match.totalRounds, convergedRound: match.convergedRound,
          themeName, startedAt: match.startedAt,
          players: match.players.filter((player) => player.uid !== uid).map((player) => player.name),
          ...(hits ? { hits } : {})
        };
      });
    return { user, nameHistory: this.db.getNameHistory(uid, PROFILE_NAME_HISTORY),
      matches, page: current, pageSize: PROFILE_PAGE_SIZE, total, filter };
  }

  sendProfile(connection, page, filter) {
    if (connection.ws?.readyState !== 1) return;
    connection.ws.send(JSON.stringify({ type: 'profile', profile: this.profileFor(connection.uid, page, filter), serverNow: Date.now() }));
  }

  sendMatch(connection, id) {
    if (connection.ws?.readyState !== 1) return;
    const match = typeof id === 'string' && id.length > 0 && id.length <= 128 ? this.db.getMatch(id) : null;
    if (!match || !match.players.some((player) => player.uid === connection.uid)) {
      connection.ws.send(JSON.stringify({ type: 'matchDetail', id: id ?? null, match: null, error: '对局不存在或无权查看' }));
      return;
    }
    connection.ws.send(JSON.stringify({ type: 'matchDetail', id, match: {
      ...match,
      themeName: match.mode === 'theme' ? THEMES.find((theme) => theme.id === match.themeId)?.name ?? null : null,
      history: match.rounds.map((round) => ({ ...round, wordKeys: wordKeys(round) })),
      chart: buildChart(match.players, match.rounds)
    } }));
  }

  touch(room) {
    room.lastActiveAt = Date.now();
    this.broadcast(room);
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
      const p = room.players.find((player) => player.uid === participant.uid) ?? { uid: participant.uid, connected: false };
      const word = p.connected ? (p.submittedWord ?? p.draft ?? '') : '';
      if (!word.trim()) { words[p.uid] = '[未提交]'; marks[p.uid] = 'empty'; continue; }
      try { validateWord(word, previous, room.banRepeat); words[p.uid] = word; marks[p.uid] = 'none'; }
      catch { words[p.uid] = '[非法答案]'; marks[p.uid] = 'invalid'; }
    }
    room.currentRecord = { n: room.round, words, marks, outcome: 'miss' };
    const active = this.active(room);
    if (active.length >= 2 && active.every((p) => marks[p.uid] === 'none' && normalizeWord(words[p.uid]) === normalizeWord(words[active[0].uid]))) {
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
    const active = this.active(room);
    room.currentRecord.votes = Object.fromEntries(active.filter((p) => !early || p.vote !== undefined).map((p) => [p.uid, p.vote === true]));
    const passed = active.length >= 2 && active.every((p) => p.vote === true);
    for (const connection of this.clients.values()) {
      if (connection.roomCode === room.code && connection.ws?.readyState === 1) {
        connection.ws.send(JSON.stringify({ type: 'toast', event: 'voteResult', message: passed ? '全票通过' : '未通过' }));
      }
    }
    this.finishRound(room, passed ? 'voted' : 'miss');
  }

  finishBreakVote(room) {
    if (room.phase !== 'breakVote') return;
    const players = room.players;
    const yes = players.filter((p) => p.breakVote === true).length;
    if (yes * 2 >= players.length) {
      room.outcome = 'break';
      room.dropped = true;
      this.settle(room);
    } else this.startWriting(room);
  }

  checkProgress(room) {
    if (['writing', 'voting', 'prepare', 'breakVote'].includes(room.phase) && room.players.length === 1) {
      room.history = [];
      room.currentRecord = null;
      room.outcome = 'interrupted';
      this.setPhase(room, 'interrupted', null);
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
    else if (room.phase === 'voting' && active.some((p) => p.vote === false)) this.finishVote(room, true);
    else if (prepareCanAdvance(room)) this.startWriting(room);
  }

  settle(room) {
    if (room.persisted) return;
    room.resultPlayers = room.matchPlayers.map((player) => ({ ...player }));
    room.chart = buildChart(room.resultPlayers, room.history);
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
    room.rematchVotes = {};
    this.setPhase(room, 'result', REMATCH_SECONDS, room.endedAt);
    room.rematchDeadline = room.phaseDeadline;
  }

  destroyRoom(room, message) {
    if (this.rooms.get(room.code) !== room) return;
    clearTimeout(room.timer);
    this.rooms.delete(room.code);
    clearTimeout(room.prepareGraceTimer);
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
    const restart = retained.length >= 2 && retained.every((player) => room.rematchVotes[player.uid] === 'rematch');
    for (const player of room.players.filter((player) => !retained.includes(player))) {
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
    for (const key of ['matchId', 'startedAt', 'endedAt', 'matchPlayers', 'resultPlayers', 'chart', 'outcome',
      'currentRecord', 'persisted', 'rematchEligibleUids', 'rematchVotes', 'rematchDeadline']) delete room[key];
    room.history = []; room.round = 0; room.dropped = false;
    room.themeId = null; room.themeName = null;
    this.sortPlayers(room);
    if (restart) {
      room.matchId = randomUUID();
      room.startedAt = Date.now();
      room.matchPlayers = room.players.map(({ uid, name, seat }) => ({ uid, name, seat }));
      this.selectTheme(room);
      this.startWriting(room);
    } else this.setPhase(room, 'lobby', null);
    this.touch(room);
  }

  advanceDeadline(room) {
    if (room.phase === 'writing') this.reveal(room);
    else if (room.phase === 'voting') this.finishVote(room);
    else if (room.phase === 'prepare') this.startWriting(room);
    else if (room.phase === 'breakVote') this.finishBreakVote(room);
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
    const seat = [0, 1, 2, 3].find((value) => !usedSeats.has(value));
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
    const typing = type === 'typing' || type === 'draft';
    const now = Date.now();
    if (typing ? now - connection.lastTyping < 300 : now - connection.lastWrite < 500) {
      throw new Error('操作太频繁，请稍后再试');
    }
    if (typing) connection.lastTyping = now; else connection.lastWrite = now;
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
    // 我是新人：旧 uid 与它的对局记录留在库里，新身份从零开始。
    if (type === 'resetIdentity') {
      const previous = connection.uid;
      this.detach(connection, true);
      if (this.clients.get(previous) === connection) {
        const other = [...this.connections].find((client) => client !== connection && client.uid === previous && !client.replaced);
        if (other) this.clients.set(previous, other); else this.clients.delete(previous);
      }
      connection.uid = this.makeUid();
      const player = this.db.createPlayer(connection.uid, createName());
      this.clients.set(connection.uid, connection);
      const credential = this.issueCredential?.(connection.uid);
      connection.ws?.send(JSON.stringify({ type: 'identity', uid: connection.uid, credential, name: player.name, serverNow: Date.now() }));
      this.sendState(connection, null);
      return;
    }
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
        if (target.players.length >= 4) throw new Error('房间已满');
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
        if (current.players.length < 2 || current.players.length > 4) {
          throw new Error('需要 2 到 4 人才能开始');
        }
        if (current.players.some((item) => item.uid !== current.hostUid && (!item.ready || !item.connected))) {
          throw new Error('等所有在线玩家准备后才能开始');
        }
        current.matchId = randomUUID();
        current.startedAt = Date.now();
        current.matchPlayers = current.players.map(({ uid, name, seat }) => ({ uid, name, seat }));
        this.selectTheme(current);
        this.startWriting(current);
        break;
      }
      case 'rematch': {
        if (current.phase === 'interrupted' && message.choice === 'room') {
          current.rematchEligibleUids = [connection.uid];
          current.rematchVotes = { [connection.uid]: 'room' };
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
    for (const [code, room] of this.rooms) {
      if (['result', 'rematch'].includes(room.phase)) {
        if (now >= room.rematchDeadline) this.finishRematch(room, true);
        continue;
      }
      const expired = room.players.filter((player) => disconnectExpired(player, now));
      if (expired.length) {
        for (const player of expired) {
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
  // 与 SQL 同一语义：任一维度命中即算找到
  const matchesAny = (match, filter) => {
    const needle = filter.value.toLowerCase();
    if (needle) {
      if (match.roomCode.toLowerCase().startsWith(needle)) return true;
      if (match.players.some((player) => player.uid.toLowerCase().startsWith(needle))) return true;
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
      && (!filter || matchesAny(match, filter)));
  };
  return {
    getPlayer: (uid) => players.get(uid),
    getProfile: (uid) => players.get(uid),
    createPlayer(uid, name) {
      const player = { uid, name, createdAt: Date.now() };
      players.set(uid, player);
      nameHistory.set(uid, [{ name, changedAt: player.createdAt }]);
      return player;
    },
    touch() {},
    rename(uid, name) {
      players.get(uid).name = name;
      if (!nameHistory.has(uid)) nameHistory.set(uid, []);
      nameHistory.get(uid).unshift({ name, changedAt: Date.now() });
    },
    getNameHistory: (uid, limit = 20) => (nameHistory.get(uid) || []).slice(0, limit),
    saveMatch(match) { if (!matches.has(match.id)) matches.set(match.id, structuredClone(match)); },
    getMatch: (id) => structuredClone(matches.get(id)),
    listMatches: () => structuredClone([...matches.values()]),
    countMatchesFor: (uid, filter) => filteredMatches(uid, filter).length,
    listMatchesFor(uid, { limit = 10, offset = 0, filter } = {}) {
      return filteredMatches(uid, filter)
        .sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .slice(offset, offset + limit)
        .map(({ rounds, ...match }) => structuredClone(match));
    },
    close() {}
  };
}
