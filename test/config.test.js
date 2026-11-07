import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/config.js';

test('默认配置开箱即用，外部文件局部覆盖，环境变量优先', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'synconym-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify({ port: 3210, security: { maxAccountsPerSource: 4 } }));
  const config = loadConfig({ env: { SYNCONYM_CONFIG: path, PORT: '4321', PUBLIC_URL: 'https://example.com' } });
  assert.equal(config.port, 4321);
  assert.equal(config.publicUrl, 'https://example.com');
  assert.equal(config.security.maxAccountsPerSource, 4);
  assert.equal(config.security.handshakeTimeoutMs, 10000);
  assert.equal(loadConfig({ env: {} }).port, 3000);
});

test('无效配置、未知字段及缺失文件不能静默启动', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'synconym-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  for (const value of [{ security: { trustProxy: 'false' } }, { port: 0 }, { security: { typo: 1 } }, { publicUrl: 'javascript:alert(1)' }]) {
    writeFileSync(path, JSON.stringify(value));
    assert.throws(() => loadConfig({ env: {}, path }));
  }
  assert.throws(() => loadConfig({ env: { PORT: 'bad' } }));
  assert.throws(() => loadConfig({ env: {}, path: join(dir, 'missing') }));
});
