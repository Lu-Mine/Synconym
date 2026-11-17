import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createDatabase } from './db.js';
import { RoomManager } from './rooms.js';
import { createSecurityPolicy } from './security.js';
import { normalizeDeviceProfile, decideAdoption, collectDeviceLinks, collectDeviceKeys } from './identity.js';
import { modeCapacity } from './rules.js';
import { loadConfig } from './config.js';
import { createMockControls } from './mock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

// 构建号：部署脚本写下的提交号优先，没有就按 public 的内容做指纹。
// 用内容而不是 mtime，内容没变就不会误判出新版本。
let buildId;
async function currentBuildId() {
  if (buildId) return buildId;
  try {
    const marker = (await readFile(resolve(root, '.deployed-revision'), 'utf8')).trim();
    if (/^[0-9a-f]{40}$/.test(marker)) return (buildId = marker);
  } catch { /* 没有部署标记，退回内容指纹 */ }
  const hash = createHash('sha256');
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.isFile()) continue;
      hash.update(full.slice(root.length).split(sep).join('/'));
      hash.update(await readFile(full));
    }
  };
  await walk(root);
  return (buildId = hash.digest('hex').slice(0, 40));
}
// 部署加固：单进程默认最多 500 间房、单条 WS 消息 64 KB。都可用环境变量覆盖。
const DEF_MAX_ROOMS = Number(process.env.MAX_ROOMS || 500);
const DEF_MAX_PAYLOAD = Number(process.env.WS_MAX_PAYLOAD || 64 * 1024);
// 会凭空造出新身份的请求，按 IP 限速，避免刷身份。
const ACCOUNT_MESSAGES = new Set(['resetIdentity', 'resetDeviceBinding', 'leaveIdentity']);

export function createSynconymServer({
  db = createDatabase(), mock = false, maxRooms = DEF_MAX_ROOMS, maxPayload = DEF_MAX_PAYLOAD,
  security: securityConfig = {}, publicUrl, identity = {}
} = {}) {
  const security = createSecurityPolicy(securityConfig);
  const manager = new RoomManager({ db, maxRooms, publicUrl, identity });
  const mockDb = mock ? createDatabase(':memory:') : null;
  const mockManager = mock ? new RoomManager({ db: mockDb, maxRooms, identity }) : null;
  const mockControls = mock ? createMockControls(mockManager) : null;
  const credentialIssuer = (database) => (uid) => {
    const credential = randomBytes(32).toString('base64url');
    database.setCredentialHash(uid, createHash('sha256').update(credential).digest());
    return credential;
  };
  manager.issueCredential = credentialIssuer(db);
  if (mockManager) mockManager.issueCredential = credentialIssuer(mockDb);
  // 启动兜底：老数据里可能有既没有凭证也没有设备绑定的身份，注销掉再开门。
  manager.sweepOwnerlessIdentities();
  if (mockManager) mockManager.sweepOwnerlessIdentities();
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/healthz') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({
          status: 'ok', rooms: manager.rooms.size, clients: manager.clients.size,
          uptime: Math.round(process.uptime())
        }));
        return;
      }
      if (pathname === '/api/playing' || (mock && pathname === '/__mock/api/playing')) {
        const selectedManager = pathname.startsWith('/__mock/') ? mockManager : manager;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(JSON.stringify({ error: '请求方法不支持' })); return; }
        const playing = new Set();
        for (const room of selectedManager.rooms.values()) {
          if (!['countdown', 'writing', 'voting', 'prepare', 'breakVote', 'lvIntro', 'lvPlay', 'lvScore'].includes(room.phase)) continue;
          for (const player of room.players) if (player.connected) playing.add(player.uid);
        }
        response.writeHead(200);
        response.end(JSON.stringify({ playing: playing.size }));
        return;
      }
      if (pathname.startsWith('/api/rooms/') || (mock && pathname.startsWith('/__mock/api/rooms/'))) {
        const simulated = pathname.startsWith('/__mock/');
        const selectedManager = simulated ? mockManager : manager;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        const code = pathname.slice((simulated ? '/__mock/api/rooms/' : '/api/rooms/').length);
        const room = /^[0-9]{5}$/.test(code) ? selectedManager.rooms.get(code) : null;
        const error = !room ? '没有找到这个房间' : room.phase !== 'lobby' ? '这局已经开始' : room.players.length >= modeCapacity(room.mode) ? '房间已满' : '';
        const host = room?.players.find((player) => player.uid === room.hostUid);
        if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(JSON.stringify({ error: '请求方法不支持' })); return; }
        if (error || !host) { response.writeHead(404); response.end(JSON.stringify({ error: error || '没有找到这个房间' })); return; }
        response.writeHead(200);
        response.end(JSON.stringify({ code, mode: room.mode, passwordEnabled: Boolean(room.passwordEnabled), host: { uid: host.uid, name: host.name, seat: host.seat, connected: host.connected } }));
        return;
      }
      if (pathname === '/__mock' || pathname.startsWith('/__mock/')) {
        if (!mock) { response.writeHead(404); response.end('Not found'); return; }
        const mockFiles = { '/__mock': 'mock.html', '/__mock/': 'mock.html', '/__mock/mock.js': 'mock.js', '/__mock/play': 'play.html', '/__mock/control.js': 'control.js' };
        const file = mockFiles[pathname];
        if (!file) { response.writeHead(404); response.end('Not found'); return; }
        const mockRoot = resolve(root, '../dev');
        const content = await readFile(resolve(mockRoot, file));
        response.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-cache' });
        response.end(content);
        return;
      }
      const filename = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!filename.startsWith(`${root}${sep}`) || !(await stat(filename)).isFile()) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const body = await readFile(filename);
      if (filename === resolve(root, 'index.html')) {
        // 构建号写进页面，客户端靠它判断手里的 HTML 是不是旧的。
        response.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' });
        response.end(body.toString('utf8')
          .replace('<html lang="zh-CN">', `<html lang="zh-CN" data-build="${await currentBuildId()}">`));
        return;
      }
      response.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream',
        'Cache-Control': 'no-cache' });
      response.end(body);
    } catch {
      response.writeHead(404); response.end('Not found');
    }
  });
  // maxPayload 兜住超大帧：正常消息都在 1 KB 内，64 KB 已很宽松。
  const managerForReal = manager, dbForReal = db;
  let shuttingDown = false;
  const wss = new WebSocketServer({ noServer: true, maxPayload });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname !== '/ws' && !(mock && pathname === '/__mock/ws')) { socket.destroy(); return; }
    if (!security.allowOrigin(request, manager.publicUrl)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const ip = security.ipOf(request, socket);
    if (!security.tryAcquireConnection(ip)) { socket.destroy(); return; }
    request._clientIp = ip;
    let established = false;
    socket.once('close', () => { if (!established) security.releaseConnection(ip); });
    wss.handleUpgrade(request, socket, head, (ws) => { established = true; wss.emit('connection', ws, request); });
  });
  wss.on('connection', (ws, request) => {
    const simulated = new URL(request.url, 'http://localhost').pathname === '/__mock/ws';
    const manager = simulated ? mockManager : managerForReal;
    const db = simulated ? mockDb : dbForReal;
    if (simulated) {
      const send = ws.send.bind(ws);
      ws.send = (data, ...args) => send(JSON.stringify(mockControls.annotate(JSON.parse(data))), ...args);
    }
    const ip = request._clientIp ?? security.ipOf(request, { remoteAddress: ws._socket?.remoteAddress });
    let connection, authenticationFailed = false, handshaken = false;
    const bucket = security.createMessageBucket();
    const handshakeTimer = setTimeout(() => ws.terminate(), security.options.handshakeTimeoutMs);
    handshakeTimer.unref();
    const release = () => { clearTimeout(handshakeTimer); security.releaseConnection(ip); };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      try {
        if (authenticationFailed || connection?.replaced) return;
        if (!bucket.take() || !security.tryAcquireGlobalMessage()) {
          ws.close(4002, 'Rate limit exceeded'); return;
        }
        if (!handshaken && data.length > 4096) { ws.close(4002, 'Message too large'); return; }
        const message = JSON.parse(data.toString());
        if (message.type === 'hello') {
          if (connection) { manager.sendState(connection); return; }
          let credential, reborn = false, adopted = false, deviceCandidates;
          // 库里没有这个 uid 的凭证记录，说明身份已被清理或来自别的环境。
          // 这种情况不报错，直接当新玩家重开：设备不该因为服务器清理数据而卡死。
          // 只有凭证哈希存在时才算"认领已有身份"，那时凭证对不上仍然拒绝，避免顶替他人。
          const stored = typeof message.uid === 'string' ? db.getCredentialHash(message.uid) : undefined;
          if (stored) {
            const valid = typeof message.credential === 'string' && /^[A-Za-z0-9_-]{43}$/.test(message.credential);
            const candidate = valid ? createHash('sha256').update(message.credential).digest() : null;
            const owner = candidate ? db.credentialOwner(candidate) : undefined;
            if (!owner || owner !== message.uid) {
              ws.send(JSON.stringify({ type: 'error', message: '身份验证失败' }));
              ws.close(4003, 'Authentication failed');
              authenticationFailed = true;
              return;
            }
            db.touchCredential?.(candidate);
          } else if (message.uid !== undefined) {
            reborn = true;
            message.uid = undefined;
            message.credential = undefined;
          } else if (message.credential !== undefined) {
            // 带了凭证却没有 uid：畸形请求，按原来的方式拒绝。
            ws.send(JSON.stringify({ type: 'error', message: '身份验证失败' }));
            ws.close(4003, 'Authentication failed');
            authenticationFailed = true;
            return;
          }
          // 设备线索：浏览器之间不共享存储，只能靠设备自身特征沿用同一身份。
          // 超过 1KB 的字段直接忽略，不影响登录。
          let device = null;
          if (message.device && typeof message.device === 'object' && !Array.isArray(message.device)
            && JSON.stringify(message.device).length <= 1024) {
            device = normalizeDeviceProfile(message.device);
          }
          if (message.uid === undefined && device) {
            const deviceKeys = collectDeviceKeys(db, device);
            const links = collectDeviceLinks(db, device).filter((link) => Boolean(db.getPlayer(link.uid)));
            const decision = decideAdoption({
              links,
              playing: (uid) => Boolean(manager.clients.get(uid)?.roomCode),
              rejected: (uid) => deviceKeys.some((key) => db.isDeviceRejected(key, uid)),
              adopt: manager.identity.adopt,
              adoptMaxIdleDays: manager.identity.adoptMaxIdleDays
            });
            if (decision.action === 'adopt' && db.getPlayer(decision.uid)) { message.uid = decision.uid; adopted = true; }
            else if (decision.action === 'choose') deviceCandidates = manager.deviceCandidates(decision);
          }
          if (message.uid === undefined && !security.allowAccount(ip)) {
            ws.send(JSON.stringify({ type: 'error', message: '创建身份过于频繁，请稍后再试' }));
            ws.close(4004, 'Account rate limit');
            authenticationFailed = true;
            return;
          }
          connection = manager.connect(message.uid);
          // 沿用的身份要发给本浏览器自己的凭证，之后这个浏览器就不再依赖设备线索。
          if (message.uid === undefined || adopted) credential = manager.issueCredential(connection.uid);
          // 记住本连接手里的凭证，换身份时才能精确废掉旧的那一条。
          connection.credentialHash = typeof credential === 'string'
            ? createHash('sha256').update(credential).digest()
            : (typeof message.credential === 'string' ? createHash('sha256').update(message.credential).digest() : null);
          connection.deviceKey = device?.deviceKey ?? null;
          connection.weakKey = device?.weakKey ?? null;
          if (device) {
            db.insertDevice(device);
            db.linkDevice(device.deviceKey, connection.uid, adopted ? 'adopted' : 'created');
          }
          handshaken = true;
          clearTimeout(handshakeTimer);
          connection.ws = ws;
          const helloMessage = (restored) => JSON.stringify({
            type: 'hello', uid: connection.uid, credential, restored, reborn,
            ...(deviceCandidates ? { deviceCandidates } : {}), serverNow: Date.now()
          });
          const roomCode = typeof message.roomCode === 'string' ? message.roomCode.toUpperCase() : null;
          if (message.leaveRoom === true) {
            if (connection.roomCode && connection.roomCode !== roomCode) manager.detach(connection, true);
            if (manager.rooms.get(roomCode)?.players.some((player) => player.uid === connection.uid)) {
              manager.claimRoom(connection, roomCode);
              connection.roomCode = roomCode;
            }
            manager.detach(connection, true);
            ws.send(helloMessage(false));
            manager.sendState(connection, null);
            return;
          }
          const restored = manager.restore(connection, roomCode, () => { ws.send(helloMessage(true)); });
          if (!restored) {
            if (roomCode && !manager.clients.get(connection.uid)?.roomCode) {
              const oldRoom = [...manager.rooms.values()].find((room) => room.players.some((player) => player.uid === connection.uid));
              if (oldRoom && oldRoom.code !== roomCode) manager.detach({ uid: connection.uid, roomCode: oldRoom.code }, true);
            }
            ws.send(helloMessage(false));
            manager.detach(connection, true);
            manager.sendState(connection, null);
          }
        } else if (connection) {
          if (ACCOUNT_MESSAGES.has(message.type) && !security.allowAccount(ip)) {
            ws.send(JSON.stringify({ type: 'error', message: '创建身份过于频繁，请稍后再试' }));
            return;
          }
          if (simulated && message.type === 'mockAction') mockControls.handle(connection, message);
          else manager.handle(connection, message);
        } else {
          throw new Error('连接尚未就绪');
        }
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: error.message || '操作失败' }));
      }
    });
    ws.on('close', () => { release(); if (connection && !shuttingDown) manager.disconnect(connection); });
    ws.on('error', () => {});
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
  }, 30000);
  const cleanup = setInterval(() => { manager.cleanup(); mockManager?.cleanup(); }, 30000);
  heartbeat.unref(); cleanup.unref();
  server.on('close', () => {
    shuttingDown = true;
    clearInterval(heartbeat); clearInterval(cleanup); security.close();
    manager.close();
    mockManager?.close(); mockDb?.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close(); db.close();
  });
  return { server, manager, wss };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const config = loadConfig();
  const { server } = createSynconymServer({ db: createDatabase(config.dbPath), mock: process.argv.includes('--mock'),
    maxRooms: config.maxRooms, maxPayload: config.wsMaxPayload, security: config.security, publicUrl: config.publicUrl,
    identity: config.identity });
  server.listen(config.port, config.host || undefined, () => {
    console.log(`Synconym listening on http://localhost:${config.port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
