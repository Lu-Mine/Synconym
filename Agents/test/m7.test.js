import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomManager } from '../../server/rooms.js';
import { createDatabase } from '../../server/db.js';

test('文件型数据库：关闭后重新打开，同一 uid 的档案与对局仍在', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const dir = mkdtempSync(join(tmpdir(), 'synconym-db-'));
  const file = join(dir, 'synconym.db');
  let db, manager;
  // 只注册一个清理钩子：先关库再删目录，否则 Windows 上文件仍被占用
  t.after(() => { manager?.close(); db?.close(); rmSync(dir, { recursive: true, force: true }); });

  db = createDatabase(file);
  manager = new RoomManager({ db });
  const connect = (uid) => {
    const c = manager.connect(uid); c.messages = [];
    c.ws = { readyState: 1, send: (s) => c.messages.push(JSON.parse(s)), close() {} };
    return c;
  };
  const send = (c, message) => { t.mock.timers.tick(501); manager.handle(c, message); };
  const a = connect(), b = connect();
  send(a, { type: 'createRoom' });
  const room = manager.roomFor(a);
  send(b, { type: 'joinRoom', code: room.code }); send(b, { type: 'setReady', ready: true });
  send(a, { type: 'start' });
  manager.advanceDeadline(room);
  send(a, { type: 'submitWord', word: '苹果' }); send(b, { type: 'submitWord', word: '苹果' });
  assert.equal(room.phase, 'result');
  const matchId = room.matchId;
  manager.close(); db.close();
  assert.ok(existsSync(file));

  db = createDatabase(file);
  manager = new RoomManager({ db });
  const again = connect(a.uid);
  assert.equal(again.uid, a.uid);
  const profile = manager.profileFor(a.uid);
  assert.equal(profile.total, 1);
  assert.equal(profile.matches[0].id, matchId);
  assert.equal(profile.matches[0].convergedRound, 1);
  assert.equal(db.getMatch(matchId).rounds[0].words[b.uid], '苹果');
});
