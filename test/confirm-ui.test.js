import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shellMarkup } from '../public/render.js';

test('危险操作使用站内确认弹窗，包含安全取消与明确确认按钮', () => {
  const html = shellMarkup();
  assert.match(html, /id="confirm-modal" inert/);
  assert.match(html, /role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description"/);
  assert.match(html, /type="button" data-action="cancel-confirm"/);
  assert.match(html, /class="button danger" type="button" data-action="accept-confirm"/);
  assert.match(html, /id="transfer-modal"/);
});

test('所有退出入口异步等待站内确认，不再调用系统确认或离站提示', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /window\.(confirm|alert|prompt)\s*\(|beforeunload|allowNavigation/);
  assert.equal((source.match(/if \(await confirmLeave\(\)\) enqueueWrite\(\{ type: 'leave' \}\)/g) || []).length, 3);
  assert.match(source, /if \(phaseChanged\) \{\s*closeConfirm\(false\)/);
  assert.match(source, /event.key === 'Escape'.*closeConfirm\(false\)/);
  assert.match(source, /event.key === 'Tab'/);
});

test('初次连接不闪提示，退出房间后不能复用大厅设置区当作主页', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /banner\.hidden = connectionStatus === 'connected' \|\| connectionStatus === 'connecting'/);
  assert.match(source, /nextScreen === 'home' && stage\.querySelector\('\.home-page'\) && patchSettingsDOM/);
});
