import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { motionTarget, sceneMotion } from '../../public/motion.js';

const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');

test('阶段变化通过视图过渡执行增量更新，常规状态更新不重播', () => {
  assert.match(app, /!initialSync && motion && document\.startViewTransition/);
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
  assert.match(app, /!initialSync && motion/);
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

test('二级页面、详情、同级导航与翻页的正反方向对等', () => {
  const target = motionTarget;
  const pairs = [
    [target('home'), target('qa'), 'depth'],
    [target('home'), target('profile'), 'depth'],
    [target('profile'), target('profile', { detail: 'match-1' }), 'depth'],
    [target('qa'), target('privacy'), 'lateral'],
    [target('profile', { page: 1 }), target('profile', { page: 2 }), 'lateral'],
    [target('writing'), target('voting'), 'phase']
  ];
  for (const [from, to, kind] of pairs) {
    const forward = sceneMotion(from, to);
    const backward = sceneMotion(to, from);
    assert.equal(forward.kind, kind);
    assert.equal(backward.kind, kind);
    assert.equal(forward.direction, -backward.direction);
  }
});

test('首次显示、重复快照、搜索和再来一局操作区更新不重播', () => {
  assert.equal(sceneMotion(null, motionTarget('home')), null);
  for (const screen of ['home', 'profile', 'writing', 'countdown']) {
    assert.equal(sceneMotion(motionTarget(screen), motionTarget(screen)), null);
  }
  assert.equal(sceneMotion(motionTarget('profile', { page: 2 }), motionTarget('profile', { query: '小明' })), null);
  assert.equal(sceneMotion(motionTarget('result'), motionTarget('rematch')), null);
});

test('动效统一令牌、镜像轨迹、交互穿透与减少动态效果', () => {
  assert.match(css, /#stage\s*\{ view-transition-name: scene/);
  assert.match(css, /::view-transition\s*\{ pointer-events: none/);
  assert.match(css, /animation-duration: var\(--motion-duration\)/);
  assert.match(css, /animation-timing-function: var\(--motion-ease\)/);
  assert.match(css, /data-scene-direction="backward"[^}]*--motion-sign: -1/);
  assert.match(css, /@keyframes scene-slide-out/);
  assert.match(css, /@keyframes scene-slide-in/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*::view-transition-old\(scene-old\)/);
  assert.match(app, /if \(activeSceneTransition !== transition\) return/);
});

test('历史详情使用可打断的站内导航，并保留修饰键原生行为', () => {
  assert.match(app, /closest\('\.profile-match-link, \.match-detail-page > \.privacy-back'\)/);
  assert.match(app, /matchLink && !state\.room && event\.button === 0 && !event\.metaKey && !event\.ctrlKey && !event\.shiftKey && !event\.altKey/);
  assert.match(app, /history\.pushState\(\{ profile: true \}, '', `\$\{APP_ROOT\}\$\{new URL\(matchLink\.href\)\.search\}`\)/);
  assert.match(css, /--motion-ease: cubic-bezier\(\.4, 0, \.6, 1\)/);
});

test('新旧快照保持独立几何，导航与控件使用短时长', () => {
  assert.match(css, /data-scene-snapshot="old"[^}]*view-transition-name: scene-old/);
  assert.match(css, /data-scene-snapshot="new"[^}]*view-transition-name: scene-new/);
  assert.match(css, /--motion-duration: 180ms/);
  assert.match(css, /--motion-depth-duration: 220ms/);
  assert.match(css, /--motion-control-duration: 160ms/);
});
