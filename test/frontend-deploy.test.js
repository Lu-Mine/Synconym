import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const python = process.platform === 'win32' ? 'python' : 'python3';

test('前端快照使用版本化路径且保留模块相对引用', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'synconym-frontend-'));
  const revision = 'a'.repeat(40);
  try {
    const target = join(tmp, 'snapshot');
    const result = spawnSync(python, ['deploy/prepare-frontend.py', 'public', target, revision], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(join(target, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`/assets/${revision}/app\\.js`));
    assert.match(html, new RegExp(`/assets/${revision}/styles\\.css`));
    assert.match(readFileSync(join(target, 'render.js'), 'utf8'), new RegExp(`/assets/${revision}/icons\\.svg`));
    assert.equal(readFileSync(join(target, '.deployed-revision'), 'utf8').trim(), revision);
    assert.match(readFileSync('deploy/github-deploy.sh', 'utf8'), /prepare-frontend\.py" "\$release\/public" "\$candidate" "\$revision"/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
