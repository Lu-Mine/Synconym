import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSynconymServer } from '../server/index.js';
import { createDatabase } from '../server/db.js';

for (const mock of [false, true]) {
  test(`状态预览仅在显式启用时开放（mock=${mock}）`, async (t) => {
    const { server } = createSynconymServer({ db: createDatabase(':memory:'), mock });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/__mock', '/__mock/', '/__mock/mock.js']) {
      const response = await fetch(base + path);
      assert.equal(response.status, mock ? 200 : 404, path);
      if (mock) assert.match(response.headers.get('content-type'), path.endsWith('.js') ? /javascript/ : /html/);
    }
    assert.equal((await fetch(base + '/__mock/unknown')).status, 404);
    assert.equal((await fetch(base + '/')).status, 200);
  });
}
