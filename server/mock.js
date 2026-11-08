import { seedMockHistory } from './mock-history.js';

// 模拟控制只包装隔离的 RoomManager，不修改正式房间。
export function createMockControls(manager) {
  const bots = new Map();
  const histories = new WeakMap();
  let pausedAt = null;
  let restoring = false;
  const originalHandle = manager.handle.bind(manager);
  const originalBroadcast = manager.broadcast.bind(manager);
  const originalCleanup = manager.cleanup.bind(manager);
  const originalSetPhase = manager.setPhase.bind(manager);
  let joinTestBot = null;
  function ensureJoinTestRoom() {
    if (manager.rooms.has('99999')) return;
    if (!joinTestBot) {
      joinTestBot = manager.connect();
      joinTestBot.ws = { readyState: 1, send() {}, close() {} };
      manager.db.rename(joinTestBot.uid, '加入测试机器人');
      bots.set(joinTestBot.uid, joinTestBot);
    }
    const makeCode = manager.makeCode;
    try {
      manager.makeCode = () => '99999';
      joinTestBot.lastWrite = 0;
      manager.handle(joinTestBot, { type: 'createRoom' });
    } finally { manager.makeCode = makeCode; }
  }

  const fields = ['phaseDeadline', 'prepareGraceDeadline', 'rematchDeadline', 'lastActiveAt'];
  function stopTimers(room) {
    clearTimeout(room.timer); clearTimeout(room.prepareGraceTimer);
    room.timer = null; room.prepareGraceTimer = null;
  }
  function shift(room, delta) {
    for (const field of fields) if (Number.isFinite(room[field])) room[field] += delta;
    for (const player of room.players) if (Number.isFinite(player.disconnectedAt)) player.disconnectedAt += delta;
  }
  function syncPaused(room) {
    if (pausedAt == null || !room) return;
    const now = Date.now();
    if (room.mockClockStamp != null) shift(room, now - room.mockClockStamp);
    room.mockClockStamp = now;
    stopTimers(room);
  }
  function schedule(room) {
    stopTimers(room);
    if (room.phaseDeadline != null) {
      const deadline = room.phaseDeadline;
      room.timer = setTimeout(() => {
        if (manager.rooms.get(room.code) !== room || room.phaseDeadline !== deadline || pausedAt != null) return;
        save(room);
        manager.advanceDeadline(room);
        if (manager.rooms.get(room.code) === room) manager.broadcast(room);
      }, Math.max(0, deadline - Date.now()));
      room.timer.unref?.();
    }
    if (room.phase === 'prepare' && room.prepareGraceDeadline > Date.now()) {
      const deadline = room.phaseDeadline;
      room.prepareGraceTimer = setTimeout(() => {
        if (manager.rooms.get(room.code) !== room || room.phase !== 'prepare' || room.phaseDeadline !== deadline || pausedAt != null) return;
        save(room); manager.checkProgress(room); manager.broadcast(room);
      }, Math.max(0, room.prepareGraceDeadline - Date.now()));
      room.prepareGraceTimer.unref?.();
    }
  }
  function snapshot(room) {
    const data = {};
    for (const [key, value] of Object.entries(room)) {
      if (!['timer', 'prepareGraceTimer', 'mockClockStamp'].includes(key)) data[key] = value;
    }
    return { data: structuredClone(data), at: Date.now() };
  }
  function save(room) {
    if (!room || restoring || manager.rooms.get(room.code) !== room) return;
    syncPaused(room);
    let history = histories.get(room);
    const current = snapshot(room);
    if (!history) { histories.set(room, { entries: [current], index: 0 }); return; }
    const previous = history.entries[history.index]?.data;
    if (previous?.phase !== room.phase || previous?.round !== room.round) {
      history.entries.splice(history.index + 1);
      history.entries.push(current); history.index++;
    } else {
      history.entries[history.index] = current;
    }
  }
  function restore(room, index) {
    const history = histories.get(room);
    if (!history || index < 0 || index >= history.entries.length) throw new Error('没有可切换的阶段');
    stopTimers(room);
    const saved = history.entries[index];
    const data = structuredClone(saved.data);
    // 保留当前连接状态，避免历史快照重建或接管实际连接。
    const connected = new Map(room.players.map(player => [player.uid, player]));
    for (const player of data.players) {
      const live = connected.get(player.uid);
      if (live) { player.connected = live.connected; player.disconnectedAt = live.disconnectedAt; player.leftReason = live.leftReason; }
    }
    for (const key of Object.keys(room)) delete room[key];
    Object.assign(room, data);
    shift(room, Date.now() - saved.at);
    history.index = index;
    if (pausedAt != null) room.mockClockStamp = Date.now();
    else schedule(room);
    restoring = true;
    try { manager.broadcast(room); } finally { restoring = false; }
  }
  manager.broadcast = (room) => { save(room); originalBroadcast(room); };
  manager.setPhase = (room, ...args) => {
    syncPaused(room);
    const result = originalSetPhase(room, ...args);
    if (pausedAt != null) { room.mockClockStamp = Date.now(); stopTimers(room); }
    return result;
  };
  manager.handle = (connection, message) => {
    if (message.type === 'openProfile' || message.type === 'openMatch') seedMockHistory(manager, connection.uid);
    const before = manager.rooms.get(connection.roomCode);
    if (before) {
      syncPaused(before);
      const history = histories.get(before);
      if (history && history.index < history.entries.length - 1 && !['openProfile', 'openMatch', 'typing', 'draft'].includes(message.type)) history.entries.splice(history.index + 1);
      save(before);
    }
    try { return originalHandle(connection, message); }
    finally {
      const after = manager.rooms.get(connection.roomCode);
      if (after) { if (pausedAt != null && after.mockClockStamp == null) after.mockClockStamp = Date.now(); syncPaused(after); save(after); }
    }
  };
  manager.cleanup = (now = Date.now()) => {
    if (pausedAt == null) {
      const room = manager.rooms.get('99999');
      if (room?.phase === 'lobby' && room.players.length === 1 && room.players[0].uid === joinTestBot?.uid) room.lastActiveAt = now;
      originalCleanup(now);
      ensureJoinTestRoom();
    }
  };
  function broadcastAll() {
    for (const connection of manager.clients.values()) if (connection.ws?.readyState === 1) manager.sendState(connection);
  }
  function handle(connection, message) {
    if (message.action === 'pause' || message.action === 'resume') {
      if (message.action === 'pause' && pausedAt == null) {
        pausedAt = Date.now();
        for (const room of manager.rooms.values()) { room.mockClockStamp = pausedAt; stopTimers(room); }
      } else if (message.action === 'resume' && pausedAt != null) {
        for (const room of manager.rooms.values()) syncPaused(room);
        const duration = Date.now() - pausedAt;
        for (const recent of manager.recentRooms.values()) recent.expiresAt += duration;
        pausedAt = null;
        for (const room of manager.rooms.values()) { delete room.mockClockStamp; schedule(room); }
      }
      broadcastAll(); return;
    }
    const room = manager.roomFor(connection);
    syncPaused(room); save(room);
    const history = histories.get(room);
    if (message.action === 'back') { restore(room, history.index - 1); return; }
    if (message.action === 'advance') {
      if (history.index < history.entries.length - 1) { restore(room, history.index + 1); return; }
      if (room.phaseDeadline == null) throw new Error('当前阶段没有倒计时');
      manager.advanceDeadline(room);
      if (manager.rooms.get(room.code) === room) { syncPaused(room); manager.broadcast(room); }
      return;
    }
    if (message.action === 'add') {
      if (room.phase !== 'lobby' || room.players.length >= 4) throw new Error('只能在未满员的大厅添加玩家');
      const bot = manager.connect();
      bot.ws = { readyState: 1, send() {}, close() {} };
      bots.set(bot.uid, bot);
      try { manager.handle(bot, { type: 'joinRoom', code: room.code }); }
      catch (error) { bots.delete(bot.uid); manager.disconnect(bot); throw error; }
      return;
    }
    if (message.action === 'start') {
      const host = manager.clients.get(room.hostUid);
      if (!host || host.roomCode !== room.code || host.ws?.readyState !== 1) throw new Error('房主当前不在线');
      host.lastWrite = 0;
      manager.handle(host, { type: 'start' });
      return;
    }
    const bot = bots.get(message.uid);
    if (!bot || bot.roomCode !== room.code || !room.players.some(player => player.uid === bot.uid)) throw new Error('请选择当前房间的模拟玩家');
    const actions = {
      remove: { type: 'leave' }, ready: { type: 'setReady', ready: Boolean(message.ready) },
      submitWord: { type: 'submitWord', word: message.word }, vote: { type: 'vote', yes: message.yes },
      breakVote: { type: 'breakVote', yes: message.yes }, rematch: { type: 'rematch', choice: message.choice }
    };
    const action = actions[message.action];
    if (!action) throw new Error('未知的模拟操作');
    bot.lastWrite = 0;
    manager.handle(bot, action);
    if (message.action === 'remove') { bots.delete(bot.uid); manager.disconnect(bot); }
  }
  function annotate(message) {
    if (message.type === 'state') {
      message.mockPausedAt = pausedAt;
      if (message.room) {
        const room = manager.rooms.get(message.room.code);
        const history = histories.get(room);
        message.room.mockCanBack = Boolean(history && history.index > 0);
        message.room.mockCanForward = Boolean(history && history.index < history.entries.length - 1);
        if (pausedAt != null && room?.mockClockStamp != null) {
          const delta = room.mockClockStamp - pausedAt;
          for (const field of ['phaseDeadline', 'prepareGraceDeadline', 'rematchDeadline', 'idleDeadline']) if (Number.isFinite(message.room[field])) message.room[field] -= delta;
        }
        for (const player of message.room.players) player.mockBot = bots.has(player.uid);
      }
    }
    return message;
  }
  ensureJoinTestRoom();
  return { handle, annotate };
}
