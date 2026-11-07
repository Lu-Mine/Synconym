import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, configPath } from '../../server/config.js';

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'synconym-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('首次启动生成默认配置，后续启动保留用户更改', (t) => {
  const path = join(temp(t), 'nested', 'synconym.config.json');
  const initial = loadConfig({ env: {}, path });
  assert.equal(initial.port, 3000);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).security.maxAccountsPerSource, 20);
  const userContent = '{"port":3210,"security":{"maxAccountsPerSource":4}}\n';
  writeFileSync(path, userContent);
  const config = loadConfig({ env: { PORT: '4321' }, path });
  assert.equal(config.port, 4321);
  assert.equal(config.security.maxAccountsPerSource, 4);
  assert.equal(config.security.handshakeTimeoutMs, 10000);
  assert.equal(readFileSync(path, 'utf8'), userContent);
});

test('默认位置随数据库持久化目录，显式路径优先', (t) => {
  const dir = temp(t);
  assert.equal(configPath({}, dir), join(dir, 'synconym.config.json'));
  const env = { DB_PATH: join(dir, 'data', 'game.db') };
  assert.equal(configPath(env, dir), join(dir, 'data', 'synconym.config.json'));
  assert.equal(loadConfig({ env }).port, 3000);
  assert.equal(JSON.parse(readFileSync(configPath(env), 'utf8')).port, 3000);
  assert.equal(configPath({ ...env, SYNCONYM_CONFIG: join(dir, 'custom.json') }, dir), join(dir, 'custom.json'));
});

test('无效配置、未知字段和非法环境变量不能静默启动', (t) => {
  const path = join(temp(t), 'config.json');
  for (const value of [{ security: { trustProxy: 'false' } }, { port: 0 }, { security: { typo: 1 } }, { publicUrl: 'javascript:alert(1)' }]) {
    writeFileSync(path, JSON.stringify(value));
    assert.throws(() => loadConfig({ env: {}, path }));
  }
  writeFileSync(path, '{}');
  assert.throws(() => loadConfig({ env: { PORT: 'bad' }, path }));
});
