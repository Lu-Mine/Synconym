import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createDatabase } from './db.js';
import { RoomManager } from './rooms.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

export function createSynconymServer({ db = createDatabase() } = {}) {
  const manager = new RoomManager({ db });
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
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
  const wss = new WebSocketServer({ noServer: true });
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
        const message = JSON.parse(data.toString());
        if (message.type === 'hello') {
          if (connection) { manager.sendState(connection); return; }
          connection = manager.connect(message.uid);
          connection.ws = ws;
          const roomCode = typeof message.roomCode === 'string' ? message.roomCode.toUpperCase() : '';
          const room = manager.rooms.get(roomCode);
          const restored = Boolean(room?.players.some((player) => player.uid === connection.uid));
          ws.send(JSON.stringify({ type: 'hello', uid: connection.uid, restored, serverNow: Date.now() }));
          if (restored) {
            connection.roomCode = roomCode;
            const player = manager.playerFor(room, connection.uid);
            player.connected = true;
            delete player.disconnectedAt;
            manager.touch(room);
          } else {
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
    for (const ws of wss.clients) ws.terminate();
    wss.close(); db.close();
  });
  return { server, manager, wss };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createSynconymServer();
  server.listen(port, () => console.log(`Synconym listening on http://localhost:${port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
