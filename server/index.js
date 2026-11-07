import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createDatabase } from './db.js';
import { RoomManager } from './rooms.js';
import { vectorInfo } from './similarity.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

// 部署加固：单进程默认最多 500 间房、单条 WS 消息 64 KB。都可用环境变量覆盖。
const DEF_MAX_ROOMS = Number(process.env.MAX_ROOMS || 500);
const DEF_MAX_PAYLOAD = Number(process.env.WS_MAX_PAYLOAD || 64 * 1024);

export function createSynconymServer({
  db = createDatabase(), mock = false, maxRooms = DEF_MAX_ROOMS, maxPayload = DEF_MAX_PAYLOAD
} = {}) {
  const manager = new RoomManager({ db, maxRooms });
  const issueCredential = (uid) => {
    const credential = randomBytes(32).toString('base64url');
    db.setCredentialHash(uid, createHash('sha256').update(credential).digest());
    return credential;
  };
  manager.issueCredential = issueCredential;
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/healthz') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({
          status: 'ok', rooms: manager.rooms.size, clients: manager.clients.size,
          vectors: Boolean(vectorInfo), uptime: Math.round(process.uptime())
        }));
        return;
      }
      if (pathname === '/api/playing') {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(JSON.stringify({ error: '请求方法不支持' })); return; }
        const playing = new Set();
        for (const room of manager.rooms.values()) {
          if (!['writing', 'voting', 'prepare', 'breakVote'].includes(room.phase)) continue;
          for (const player of room.players) if (player.connected) playing.add(player.uid);
        }
        response.writeHead(200);
        response.end(JSON.stringify({ playing: playing.size }));
        return;
      }
      if (pathname.startsWith('/api/rooms/')) {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        const code = pathname.slice('/api/rooms/'.length);
        const room = /^[0-9]{5}$/.test(code) ? manager.rooms.get(code) : null;
        const error = !room ? '没有找到这个房间' : room.phase !== 'lobby' ? '这局已经开始' : room.players.length >= 4 ? '房间已满' : '';
        const host = room?.players.find((player) => player.uid === room.hostUid);
        if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(JSON.stringify({ error: '请求方法不支持' })); return; }
        if (error || !host) { response.writeHead(404); response.end(JSON.stringify({ error: error || '没有找到这个房间' })); return; }
        response.writeHead(200);
        response.end(JSON.stringify({ code, host: { uid: host.uid, name: host.name, seat: host.seat, connected: host.connected } }));
        return;
      }
      if (pathname === '/__mock' || pathname.startsWith('/__mock/')) {
        if (!mock) { response.writeHead(404); response.end('Not found'); return; }
        const mockFiles = { '/__mock': 'mock.html', '/__mock/': 'mock.html', '/__mock/mock.js': 'mock.js' };
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
      response.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream',
        'Cache-Control': 'no-cache' });
      response.end(await readFile(filename));
    } catch {
      response.writeHead(404); response.end('Not found');
    }
  });
  // maxPayload 兜住超大帧：正常消息都在 1 KB 内，64 KB 已很宽松。
  const wss = new WebSocketServer({ noServer: true, maxPayload });
  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });
  wss.on('connection', (ws) => {
    let connection, authenticationFailed = false;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      try {
        if (authenticationFailed || connection?.replaced) return;
        const message = JSON.parse(data.toString());
        if (message.type === 'hello') {
          if (connection) { manager.sendState(connection); return; }
          let credential;
          if (message.uid !== undefined || message.credential !== undefined) {
            const hash = typeof message.uid === 'string' && db.getCredentialHash(message.uid);
            const valid = typeof message.credential === 'string' && /^[A-Za-z0-9_-]{43}$/.test(message.credential);
            const candidate = valid ? createHash('sha256').update(message.credential).digest() : null;
            if (!hash || !candidate || hash.length !== candidate.length || !timingSafeEqual(hash, candidate)) {
              ws.send(JSON.stringify({ type: 'error', message: '身份验证失败' }));
              ws.close(4003, 'Authentication failed');
              authenticationFailed = true;
              return;
            }
          }
          connection = manager.connect(message.uid);
          if (message.uid === undefined) credential = issueCredential(connection.uid);
          connection.ws = ws;
          const roomCode = typeof message.roomCode === 'string' ? message.roomCode.toUpperCase() : null;
          if (message.leaveRoom === true) {
            if (connection.roomCode && connection.roomCode !== roomCode) manager.detach(connection, true);
            if (manager.rooms.get(roomCode)?.players.some((player) => player.uid === connection.uid)) {
              manager.claimRoom(connection, roomCode);
              connection.roomCode = roomCode;
            }
            manager.detach(connection, true);
            ws.send(JSON.stringify({ type: 'hello', uid: connection.uid, credential, restored: false, serverNow: Date.now() }));
            manager.sendState(connection, null);
            return;
          }
          const restored = manager.restore(connection, roomCode, () => {
            ws.send(JSON.stringify({ type: 'hello', uid: connection.uid, credential, restored: true, serverNow: Date.now() }));
          });
          if (!restored) {
            if (roomCode && !manager.clients.get(connection.uid)?.roomCode) {
              const oldRoom = [...manager.rooms.values()].find((room) => room.players.some((player) => player.uid === connection.uid));
              if (oldRoom && oldRoom.code !== roomCode) manager.detach({ uid: connection.uid, roomCode: oldRoom.code }, true);
            }
            ws.send(JSON.stringify({ type: 'hello', uid: connection.uid, credential, restored: false, serverNow: Date.now() }));
            manager.detach(connection, true);
            manager.sendState(connection, null);
          }
        } else if (connection) {
          manager.handle(connection, message);
        } else {
          throw new Error('连接尚未就绪');
        }
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: error.message || '操作失败' }));
      }
    });
    ws.on('close', () => { if (connection) manager.disconnect(connection); });
    ws.on('error', () => {});
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
  }, 30000);
  const cleanup = setInterval(() => manager.cleanup(), 30000);
  heartbeat.unref(); cleanup.unref();
  server.on('close', () => {
    clearInterval(heartbeat); clearInterval(cleanup);
    manager.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close(); db.close();
  });
  return { server, manager, wss };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createSynconymServer({ mock: process.argv.includes('--mock') });
  server.listen(port, process.env.HOST || undefined, () => {
    console.log(`Synconym listening on http://localhost:${port}`);
    if (vectorInfo) console.log(`词向量已加载：${vectorInfo.count} 个词，构建于 ${vectorInfo.builtAt}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
