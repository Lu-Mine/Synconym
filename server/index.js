import { createServer } from 'node:http';
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
    let connection;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      try {
        if (connection && manager.clients.get(connection.uid) !== connection) return;
        const message = JSON.parse(data.toString());
        if (message.type === 'hello') {
          if (connection) { manager.sendState(connection); return; }
          connection = manager.connect(message.uid);
          connection.ws = ws;
          const roomCode = typeof message.roomCode === 'string' ? message.roomCode.toUpperCase() : connection.roomCode;
          if (message.leaveRoom === true) {
            if (connection.roomCode && connection.roomCode !== roomCode) manager.detach(connection, true);
            if (manager.rooms.get(roomCode)?.players.some((player) => player.uid === connection.uid)) connection.roomCode = roomCode;
            manager.detach(connection, true);
            ws.send(JSON.stringify({ type: 'hello', uid: connection.uid, restored: false, serverNow: Date.now() }));
            manager.sendState(connection, null);
            return;
          }
          const restored = manager.restore(connection, roomCode, () => {
            ws.send(JSON.stringify({ type: 'hello', uid: connection.uid, restored: true, serverNow: Date.now() }));
          });
          if (!restored) {
            ws.send(JSON.stringify({ type: 'hello', uid: connection.uid, restored: false, serverNow: Date.now() }));
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
  server.listen(port, () => {
    console.log(`Synconym listening on http://localhost:${port}`);
    if (vectorInfo) console.log(`词向量已加载：${vectorInfo.count} 个词，构建于 ${vectorInfo.builtAt}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
