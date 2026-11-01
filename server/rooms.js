import { createName } from './names.js';
import { UID_CHARS, UID_LENGTH, isValidUid, validateCode, validateName, validateSettings, validateWord, normalizeWord } from './rules.js';

const ROOM_IDLE_MS = 5 * 60 * 1000;

function wordKeys(record) {
  return Object.fromEntries(Object.entries(record?.words || {})
    .filter(([uid, word]) => record.marks?.[uid] === 'none' && typeof word === 'string')
    .map(([uid, word]) => [uid, normalizeWord(word)]));
}

function randomString(chars, length, random) {
  return Array.from({ length }, () => chars[Math.floor(random() * chars.length)]).join('');
}

export class RoomManager {
  constructor({ db = createMemoryDb(), random = Math.random } = {}) {
    this.db = db;
    this.random = random;
    this.rooms = new Map();
    this.clients = new Map();
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
    const old = this.clients.get(uid);
    if (old?.ws) old.ws.close(4001, '身份已在其他页面连接');
    const connection = { ws: null, uid, roomCode: old?.roomCode ?? null, lastWrite: 0, lastTyping: 0 };
    this.clients.set(uid, connection);
    this.db.touch(uid, now);
    return connection;
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
      publicUrl: process.env.PUBLIC_URL?.replace(/\/$/, ''),
      room: room ? {
        code: room.code, mode: room.mode, themeId: room.themeId,
        maxRounds: room.maxRounds, writeSeconds: room.writeSeconds,
        prepareSeconds: room.prepareSeconds, banRepeat: room.banRepeat,
        phase: room.phase, round: room.round, phaseDeadline: room.phaseDeadline,
        hostUid: room.hostUid, idleDeadline: room.lastActiveAt + ROOM_IDLE_MS,
        players: room.players.map(({ uid, name, seat, connected, ready, draft, submittedWord, vote }) =>
          ({ uid, name, seat, connected, ready, typing: room.phase === 'writing' && !!draft && submittedWord === undefined,
            submitted: room.phase === 'writing' && submittedWord !== undefined,
            voted: room.phase === 'voting' && vote !== undefined })),
        words: room.phase === 'writing' || room.phase === 'lobby' ? null : room.currentRecord?.words ?? null,
        marks: room.phase === 'writing' || room.phase === 'lobby' ? null : room.currentRecord?.marks ?? null,
        votes: room.phase === 'voting' ? null : room.currentRecord?.votes ?? null,
        wordKeys: room.phase === 'writing' || room.phase === 'lobby' ? null : wordKeys(room.currentRecord),
        outcome: room.outcome ?? null, history: room.history.map((record) => ({ ...record, wordKeys: wordKeys(record) }))
      } : null,
      serverNow: Date.now()
    }));
  }

  touch(room) {
    room.lastActiveAt = Date.now();
    this.broadcast(room);
  }

  toast(room, event, player, excludeUid) {
    const message = event === 'join' ? `${player.name} 加入了房间` :
      event === 'leave' ? `${player.name} 已退出房间` : `${player.name} 回来了`;
    for (const connection of this.clients.values()) {
      if (connection.roomCode === room.code && connection.uid !== excludeUid && connection.ws?.readyState === 1) {
        connection.ws.send(JSON.stringify({ type: 'toast', event, uid: player.uid, name: player.name, message }));
      }
    }
  }

  restore(connection, code) {
    const room = this.rooms.get(code);
    const player = room?.players.find((item) => item.uid === connection.uid);
    if (!player) return false;
    if (!player.connected && player.disconnectedAt != null && Date.now() - player.disconnectedAt >= 90000) {
      this.cleanup();
      return false;
    }
    const returning = !player.connected;
    const reason = player.leftReason;
    connection.roomCode = code;
    player.connected = true;
    delete player.disconnectedAt;
    delete player.leftReason;
    if (!room.players.some((p) => p.uid === room.hostUid && p.connected)) room.hostUid = player.uid;
    this.sortPlayers(room);
    if (returning && reason === 'disconnect' && room.phase !== 'lobby') this.toast(room, 'return', player, player.uid);
    this.touch(room);
    return true;
  }

  setPhase(room, phase, seconds) {
    clearTimeout(room.timer);
    room.phase = phase;
    room.phaseDeadline = seconds == null ? null : Date.now() + seconds * 1000;
    if (seconds != null) {
      const deadline = room.phaseDeadline;
      room.timer = setTimeout(() => {
        if (this.rooms.get(room.code) !== room || room.phaseDeadline !== deadline) return;
        this.advanceDeadline(room);
        this.broadcast(room);
      }, seconds * 1000);
      room.timer.unref?.();
    }
  }

  active(room) { return room.players.filter((p) => p.connected); }
  startWriting(room) {
    room.round += 1;
    room.currentRecord = null;
    for (const p of room.players) { p.draft = ''; p.submittedWord = undefined; p.vote = undefined; p.ready = false; }
    this.setPhase(room, 'writing', room.writeSeconds);
  }

  reveal(room) {
    const words = {}, marks = {};
    const previous = room.history.flatMap((r) => Object.entries(r.words).filter(([uid]) => r.marks[uid] === 'none').map(([, word]) => word));
    for (const p of room.players) {
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
    record.outcome = outcome;
    room.history.push(record);
    if (outcome !== 'miss' || room.round >= room.maxRounds) {
      room.outcome = outcome === 'miss' ? 'none' : outcome;
      this.setPhase(room, 'result', null);
    } else {
      for (const p of room.players) p.ready = false;
      this.setPhase(room, 'prepare', room.prepareSeconds);
    }
  }

  finishVote(room) {
    const active = this.active(room);
    room.currentRecord.votes = Object.fromEntries(active.map((p) => [p.uid, p.vote === true]));
    const passed = active.length >= 2 && active.every((p) => p.vote === true);
    for (const connection of this.clients.values()) {
      if (connection.roomCode === room.code && connection.ws?.readyState === 1) {
        connection.ws.send(JSON.stringify({ type: 'toast', event: 'voteResult', message: passed ? '全票通过' : '未通过' }));
      }
    }
    this.finishRound(room, passed ? 'voted' : 'miss');
  }

  checkProgress(room) {
    const active = this.active(room);
    if (!active.length) return;
    if (room.phase === 'writing' && active.every((p) => p.submittedWord !== undefined)) this.reveal(room);
    else if (room.phase === 'prepare' && active.every((p) => p.ready)) this.startWriting(room);
  }

  advanceDeadline(room) {
    if (room.phase === 'writing') this.reveal(room);
    else if (room.phase === 'voting') this.finishVote(room);
    else if (room.phase === 'prepare') this.startWriting(room);
  }
  close() { for (const room of this.rooms.values()) clearTimeout(room.timer); }

  detach(connection, remove = false) {
    const room = this.rooms.get(connection.roomCode);
    if (room) {
      const player = room.players.find((item) => item.uid === connection.uid);
      const permanent = remove && room.phase === 'lobby';
      if (player && permanent) room.players = room.players.filter((item) => item.uid !== connection.uid);
      else if (player && player.connected) {
        player.connected = false;
        player.ready = false;
        player.disconnectedAt = Date.now();
        player.leftReason = remove ? 'leave' : 'disconnect';
        if (room.phase === 'writing') { player.draft = ''; player.submittedWord = undefined; }
        if (room.phase === 'voting') player.vote = undefined;
      }
      connection.roomCode = null;
      if (remove && player) this.toast(room, 'leave', player);
      if (room.hostUid === connection.uid) this.transferHost(room);
      if (room.players.length === 0) { clearTimeout(room.timer); this.rooms.delete(room.code); }
      else { this.checkProgress(room); this.touch(room); }
    } else connection.roomCode = null;
  }
  disconnect(connection) {
    if (this.clients.get(connection.uid) !== connection) return;
    this.detach(connection);
    this.clients.delete(connection.uid);
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
    const { type } = message;
    const typing = type === 'typing' || type === 'draft';
    const now = Date.now();
    if (typing ? now - connection.lastTyping < 300 : now - connection.lastWrite < 500) {
      throw new Error('操作太频繁，请稍后再试');
    }
    if (typing) connection.lastTyping = now; else connection.lastWrite = now;
    const room = connection.roomCode ? this.rooms.get(connection.roomCode) : null;
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
    if (type === 'createRoom' || type === 'joinRoom') {
      const player = this.db.getPlayer(connection.uid);
      let target;
      if (type === 'joinRoom') {
        const code = validateCode(message.code?.toUpperCase());
        target = this.rooms.get(code);
        if (!target) throw new Error('没有找到这个房间');
        if (connection.roomCode === code) { this.sendState(connection, target); return; }
        const existing = target.players.find((item) => item.uid === connection.uid);
        if (existing && !existing.connected && existing.disconnectedAt != null && Date.now() - existing.disconnectedAt < 90000) {
          this.detach(connection, true);
          this.restore(connection, code);
          return;
        }
        if (existing && !existing.connected) this.cleanup();
        target = this.rooms.get(code);
        if (!target) throw new Error('没有找到这个房间');
        if (target.phase !== 'lobby') throw new Error('这局已经开始');
        if (target.players.length >= 4) throw new Error('房间已满');
      }
      this.detach(connection, true);
      if (type === 'createRoom') {
        const settings = validateSettings(message);
        const code = this.makeCode();
        target = {
          code, ...settings, phase: 'lobby', round: 0, hostUid: connection.uid,
          players: [], history: [], dropped: false, createdAt: Date.now(), lastActiveAt: Date.now()
        };
        this.rooms.set(code, target);
      }
      this.addPlayer(connection, target, player.name);
      if (type === 'joinRoom') this.toast(target, 'join', this.playerFor(target, connection.uid));
      this.touch(target);
      return;
    }
    const current = this.roomFor(connection);
    const player = this.playerFor(current, connection.uid);
    if (current.phaseDeadline != null && Date.now() >= current.phaseDeadline) {
      this.advanceDeadline(current);
      this.touch(current);
    }
    switch (type) {
      case 'updateSettings': {
        if (current.hostUid !== connection.uid) throw new Error('只有房主可以修改设置');
        if (current.phase !== 'lobby') throw new Error('开局后不能修改设置');
        Object.assign(current, validateSettings(message));
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
        this.startWriting(current);
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
      const expired = room.players.filter((player) => !player.connected && player.disconnectedAt && now - player.disconnectedAt >= 90000);
      if (expired.length) {
        room.players = room.players.filter((player) => !expired.includes(player));
        if (expired.some((player) => player.uid === room.hostUid)) this.transferHost(room);
        this.checkProgress(room);
        if (room.players.length) this.broadcast(room);
      }
      if (!room.players.length || now - room.lastActiveAt >= ROOM_IDLE_MS) {
        for (const player of room.players) {
          const connection = this.clients.get(player.uid);
          if (connection) {
            connection.roomCode = null;
            if (connection.ws?.readyState === 1) {
              connection.ws.send(JSON.stringify({ type: 'state', uid: connection.uid, room: null, serverNow: now }));
              connection.ws.send(JSON.stringify({ type: 'toast', message: '房间因长时间无活动已关闭' }));
            }
          }
        }
        clearTimeout(room.timer);
        this.rooms.delete(code);
      }
    }
  }
}

export function createMemoryDb() {
  const players = new Map();
  return {
    getPlayer: (uid) => players.get(uid),
    createPlayer(uid, name) { const player = { uid, name }; players.set(uid, player); return player; },
    touch() {},
    rename(uid, name) { players.get(uid).name = name; },
    close() {}
  };
}
