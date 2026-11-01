import { randomUUID } from 'node:crypto';
import { createName } from './names.js';
import { validateCode, validateName, validateSettings } from './rules.js';

const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export class RoomManager {
  constructor({ db = createMemoryDb(), random = Math.random } = {}) {
    this.db = db;
    this.random = random;
    this.rooms = new Map();
    this.clients = new Map();
  }

  makeCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = Array.from({ length: 4 },
        () => CODE_CHARS[Math.floor(this.random() * CODE_CHARS.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('暂时无法分配房号，请重试');
  }

  connect(uid) {
    const now = Date.now();
    let player = /^[0-9a-f-]{36}$/i.test(uid || '') && this.db.getPlayer(uid);
    if (!player) {
      uid = randomUUID();
      player = this.db.createPlayer(uid, createName());
    }
    const old = this.clients.get(uid);
    if (old?.ws) old.ws.close(4001, '身份已在其他页面连接');
    const connection = { ws: null, uid, roomCode: null, lastWrite: 0 };
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
        hostUid: room.hostUid,
        players: room.players.map(({ uid, name, seat, connected, ready }) =>
          ({ uid, name, seat, connected, ready }))
      } : null,
      serverNow: Date.now()
    }));
  }

  touch(room) {
    room.lastActiveAt = Date.now();
    this.broadcast(room);
  }

  detach(connection, remove = false) {
    const room = this.rooms.get(connection.roomCode);
    if (room) {
      if (remove) {
        room.players = room.players.filter((item) => item.uid !== connection.uid);
      } else {
        const player = room.players.find((item) => item.uid === connection.uid);
        if (player) {
          player.connected = false;
          player.ready = false;
          player.disconnectedAt = Date.now();
        }
      }
      if (room.hostUid === connection.uid) this.transferHost(room);
      if (room.players.length === 0 && remove) this.rooms.delete(room.code);
      else this.touch(room);
    }
    connection.roomCode = null;
  }
  disconnect(connection) {
    if (this.clients.get(connection.uid) !== connection) return;
    this.detach(connection);
    this.clients.delete(connection.uid);
  }

  transferHost(room) {
    const next = room.players.find((player) => player.connected && player.uid !== room.hostUid);
    if (next) room.hostUid = next.uid;
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
  }

  handle(connection, message) {
    if (!message || typeof message !== 'object') throw new Error('消息格式无效');
    const { type } = message;
    if (type !== 'draft' && Date.now() - connection.lastWrite < 500) {
      throw new Error('操作太频繁，请稍后再试');
    }
    connection.lastWrite = Date.now();
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
        if (target.phase !== 'lobby') throw new Error('这局已经开始');
        if (target.players.filter((player) => player.connected).length >= 4) throw new Error('房间已满');
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
      this.touch(target);
      return;
    }
    const current = this.roomFor(connection);
    const player = this.playerFor(current, connection.uid);
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
      case 'setReady': {
        if (current.phase !== 'lobby') throw new Error('当前不能准备');
        if (typeof message.ready !== 'boolean') throw new Error('准备状态无效');
        player.ready = message.ready;
        break;
      }
      case 'start': {
        if (current.hostUid !== connection.uid) throw new Error('只有房主可以开始');
        if (current.phase !== 'lobby') throw new Error('这局已经开始');
        if (current.players.length < 2 || current.players.length > 4) {
          throw new Error('需要 2 到 4 人才能开始');
        }
        if (current.players.some((item) => !item.ready || !item.connected)) {
          throw new Error('等所有在线玩家准备后才能开始');
        }
        current.phase = 'writing';
        current.round = 1;
        current.phaseDeadline = Date.now() + current.writeSeconds * 1000;
        break;
      }
      case 'leave': {
        current.players = current.players.filter((item) => item.uid !== connection.uid);
        connection.roomCode = null;
        if (current.players.length === 0) {
          this.rooms.delete(current.code);
        } else {
          if (current.hostUid === connection.uid) this.transferHost(current);
          this.touch(current);
        }
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
        if (room.players.length) this.broadcast(room);
      }
      if (!room.players.length || now - room.lastActiveAt >= 5 * 60 * 1000) {
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
