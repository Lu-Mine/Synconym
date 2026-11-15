import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shellMarkup } from '../../public/render.js';

test('危险操作使用站内确认弹窗，包含安全取消与明确确认按钮', () => {
  const html = shellMarkup();
  assert.match(html, /id="confirm-modal" inert/);
  assert.match(html, /role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description"/);
  assert.match(html, /type="button" data-action="cancel-confirm"/);
  assert.match(html, /class="button danger" type="button" data-action="accept-confirm"/);
  assert.match(html, /id="transfer-modal"/);
});

test('脱离身份在唯一入口时走三步确认，前两步各等 3 秒才允许继续', () => {
  const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const html = shellMarkup();
  assert.match(html, /id="confirm-step" hidden/);
  assert.match(source, /const LEAVE_FINAL_STEPS = Object\.freeze\(\[/);
  assert.equal((source.match(/wait: 3\b/g) || []).length, 2);
  assert.equal((source.match(/wait: 0\b/g) || []).length, 1);
  assert.match(source, /acceptButton\.disabled = left > 0/);
  // 还有别的入口时只确认一次，唯一入口时才走三步
  assert.match(source, /const confirmed = state\.profile\?\.user\?\.soleOwner/);
  assert.match(source, /\? await confirmLeaveIdentityFinal\(\)/);
  assert.match(source, /: await confirmAction\('leaveIdentity'\)/);
  assert.match(source, /if \(confirmed\) socket\.send\(\{ type: 'leaveIdentity' \}, true\)/);
  // 前两步只往下走，最后一步才算同意
  assert.match(source, /accept-confirm' && pendingConfirm\?\.next\) pendingConfirm\.next\(\)/);
});

test('所有退出入口异步等待站内确认，不再调用系统确认或离站提示', () => {
  const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /window\.(confirm|alert|prompt)\s*\(|beforeunload|allowNavigation/);
  assert.equal((source.match(/if \(await confirmLeave\(\)\) enqueueWrite\(\{ type: 'leave' \}\)/g) || []).length, 3);
  assert.match(source, /if \(phaseChanged\) \{\s*closeConfirm\(false\)/);
  assert.match(source, /event.key === 'Escape'.*closeConfirm\(false\)/);
  assert.match(source, /event.key === 'Tab'/);
});

test('初次连接不闪提示，退出房间后不能复用大厅设置区当作主页', () => {
  const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /: connectionStatus === 'connected' \|\| connectionStatus === 'connecting' \? ''/);
  assert.match(source, /banner\.hidden = !banner\.textContent/);
  assert.match(source, /nextScreen === 'home' && stage\.querySelector\('\.home-page'\) && patchSettingsDOM/);
});
