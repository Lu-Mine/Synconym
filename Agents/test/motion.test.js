import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');

test('阶段变化通过视图过渡执行增量更新，常规状态更新不重播', () => {
  assert.match(app, /previousScreen && previousScreen !== nextScreen && document\.startViewTransition/);
  assert.match(app, /const patched = !forceFull && patchSameScene\(stage, nextScreen\)/);
  assert.match(app, /document\.startViewTransition\(applyDOM\)/);
  assert.match(app, /if \(generation !== renderGeneration\) return/);
  assert.match(app, /activeSceneTransition\?\.skipTransition\(\)/);
  assert.match(css, /::view-transition-old\(root\)/);
  assert.match(css, /::view-transition-new\(root\)/);
  assert.doesNotMatch(css, /view-transition-name:\s*stage/);
  assert.doesNotMatch(css, /::view-transition-(?:old|new)\(root\)\s*\{[^}]*width:/);
  assert.match(css, /\.page\s*\{\s*animation:\s*none/);
  assert.match(css, /\.home-page \.entry-deck\s*\{\s*width:\s*100%/);
});

test('连接同步快照直接呈现，房间恢复等待期间不渲染主页', () => {
  assert.match(app, /!initialSync && previousScreen && previousScreen !== nextScreen/);
  assert.match(app, /onState\(next, \{ initialSync = false \} = \{\}\)/);
  assert.match(app, /render\(\{ initialSync \}\)/);
  assert.match(app, /awaitingRoomRestore = Boolean\(socket\.roomCode && socket\.uid && !socket\.pendingLeave\)/);
  assert.match(app, /class="restore-status" role="status"/);
  assert.match(app, /if \(awaitingRoomRestore\) app\.innerHTML = '<p class="restore-status" role="status">正在恢复房间…<\/p>';\s*\}, 500\)/);
  assert.match(app, /function finishRoomRestore\(\)\s*\{\s*awaitingRoomRestore = false;\s*clearTimeout\(restoreStatusTimer\)/);
  assert.match(app, /if \(code && !message\.restored\)[\s\S]*?requestJoin\(code\)/);
});

test('玩家进出与步进器动画尊重减少动态效果并支持快速更新', () => {
  assert.match(app, /if \(!reducedMotion && !nextUids\.has\(item\.dataset\.uid\)\)/);
  assert.match(app, /setTimeout\(cleanup, 600\)/);
  assert.match(app, /stepperAnimation\?\.cancel\(\)/);
  assert.match(app, /output\.dataset\.value = String\(nextNumber\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
});

test('折叠记录与状态提示支持双向显隐', () => {
  assert.match(css, /\.result-votes::details-content/);
  assert.match(css, /\.result-votes\[open\]::details-content/);
  for (const name of ['connection-status', 'recent-room', 'prepare-grace-hint', 'theme-setting-hint']) {
    assert.match(css, new RegExp(`\\.${name}\\[hidden\\]`));
    assert.match(css, new RegExp(`\\.${name}:not\\(\\[hidden\\]\\)`));
  }
});
