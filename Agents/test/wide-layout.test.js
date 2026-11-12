import { readFileSync } from 'node:fs';
import { matchDetailMarkup } from '../../public/render.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { homeMarkup, lobbyMarkup, privacyMarkup, shellMarkup, writingMarkup } from '../../public/render.js';

const players = [
  { uid: 'a', name: '甲', seat: 0, connected: true },
  { uid: 'b', name: '乙', seat: 1, connected: true }
];
const room = { code: '12345', hostUid: 'a', players, round: 2, maxRounds: 12,
  mode: 'free', writeSeconds: 45, prepareSeconds: 30, banRepeat: true,
  history: [{ n: 1, words: { a: '海洋', b: '天空' }, marks: {} }], words: { a: '海洋', b: '天空' } };

test('页脚和宽屏顶栏提供站点链接、开始游戏与 Q&A 入口', () => {
  for (const inRoom of [false, true]) {
    const html = shellMarkup(inRoom);
    const header = html.match(/<nav class="header-nav"[\s\S]*?<\/nav>/)[0];
    const footer = html.match(/<nav class="footer-links"[\s\S]*?<\/nav>/)[0];
    assert.match(header, /href="https:\/\/github\.com\/Lu-Mine\/Synconym"/);
    assert.match(footer, /href="https:\/\/github\.com\/Lu-Mine\/Synconym"/);
    assert.match(footer, /href="\/\?privacy"/);
    assert.match(footer, inRoom ? /target="_blank"/ : /data-action="open-privacy"/);
    assert.match(header, /<a class="site-nav-link[^"]*" href="\/\?qa"/);
    assert.match(header, inRoom ? /target="_blank"/ : /data-action="open-qa"/);
    assert.match(footer, /<a class="footer-privacy" href="\/\?qa"/);
    assert.match(footer, inRoom ? /target="_blank"/ : /data-action="open-qa"/);
    // 顶栏主入口是开始游戏，对局中不打断当前这局
    assert.equal(/data-action="open-start"/.test(header), !inRoom);
  }
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.header-nav\s*\{\s*display: none/);
  assert.match(css, /@container site-header \(min-width: 680px\)\s*\{\s*\.header-nav\s*\{[^}]*display: flex/);
  // 顶栏够宽先只显示开始按钮，再宽裕才补 GitHub 与 Q&A
  assert.match(css, /\.header-nav-secondary\s*\{\s*display: none/);
  assert.match(css, /@container site-header \(min-width: 820px\)\s*\{\s*\.header-nav-secondary\s*\{\s*display: inline-flex/);
});

test('首页入口与玩法介绍分区，宽屏固定入口并隐藏跳转链接', () => {
  const html = homeMarkup(room);
  assert.match(html, /class="home-entry"[\s\S]*class="intro"[\s\S]*class="entry-deck"[\s\S]*class="home-story-link"[\s\S]*class="home-story"/);
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 1200px\)\s*\{\s*\.app\s*\{[^}]*\}\s*\.app:has\(\.home-page\)[^}]*\}[\s\S]*?\.home-entry\s*\{[^}]*position: fixed/);
  assert.match(css, /\.home-story-link\s*\{\s*display: none/);
  assert.match(css, /\.home-entry\s*\{[^}]*top: 25dvh;[^}]*height: 75dvh;[^}]*\}/);
  assert.match(css, /\.home-entry:has\(\.drawer-grid\.is-open\)\s*\{[^}]*top: max\(120px, 20dvh\);[^}]*height: max\(0px, calc\(90dvh - max\(120px, 20dvh\)\)\)/);
  assert.match(css, /\.home-entry\s*\{[^}]*transition: top var\(--dur-3\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.home-entry\s*\{\s*transition: none/);
  assert.match(css, /\.home-entry \.drawer-grid\.is-open \.drawer-inner\s*\{[^}]*overflow-y: auto/);
  // 入口区与玩法说明在单列一律 600px 限宽，不随 760px 断点变宽变窄
  assert.match(css, /\.home-page \.intro, \.home-page \.entry-deck \{ max-width: 600px; margin-inline: auto; \}/);
  assert.match(css, /\.home-story-heading, \.home-story-how \{ max-width: 600px; margin-inline: auto; \}/);
  assert.match(css, /\.home-story\s*\{[^}]*grid-column: 1;[^}]*grid-row: 1/);
});
test('顶栏固定悬浮，全站内容在顶栏下方的滚动层内滚动', () => {
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.site-header\s*\{[^}]*position: fixed;[^}]*top: var\(--header-gap\);[^}]*background: var\(--card\)/);
  assert.match(css, /\.app\s*\{[^}]*position: fixed;[^}]*top: calc\(var\(--header-gap\) \+ var\(--header-h\)\);[^}]*overflow-y: auto/);
  assert.match(css, /\.app\s*\{[^}]*--app-w: min\(100% - 40px, 600px\);/);
  assert.match(css, /\.app \.stage,\s*\.app \.site-footer \{ width: var\(--app-w\); \}/);
  assert.match(css, /\.app:has\(\.home-page\)\s*\{\s*--app-w: min\(100% - 64px, 960px\); \}/);
  // 640–760 之间内容宽连续增长，760 档的 696px 正好接住，不再卡在 600px
  assert.match(css, /@media \(min-width: 640px\)\s*\{\s*\.app\s*\{[^}]*\}\s*\.app:has\(\.home-page\)\s*\{\s*--app-w: clamp\(600px, calc\(80% \+ 88px\), 696px\)/);
  // 所有页面共用首页顶栏宽度曲线，页面内容宽度变化不影响顶栏
  assert.match(css, /\.app\s*\{[^}]*--header-content-w: min\(100vw - 40px, 600px\);[^}]*--header-w: calc\(var\(--header-content-w\) \+ 32px\)/);
  assert.match(css, /\.site-header\s*\{[^}]*width: var\(--header-w\);[^}]*max-width: calc\(100vw - 16px\)/);
  assert.match(css, /@media \(min-width: 640px\)\s*\{\s*\.app\s*\{\s*--header-content-w: clamp\(600px, calc\(80vw \+ 88px\), 696px\)/);
  assert.match(css, /@media \(min-width: 760px\)\s*\{\s*\.app\s*\{\s*--header-content-w: min\(100vw - 64px, 960px\)/);
  assert.match(css, /@media \(min-width: 1200px\)\s*\{\s*\.app\s*\{\s*--header-content-w: min\(100vw - 64px, 1120px\)/);
  assert.equal(css.match(/--header-w:/g).length, 1);
  // 顶栏内部自适应只按自身宽度分档，不混用视口断点
  assert.match(css, /\.header-user-name\s*\{[^}]*max-width: clamp\(80px, 12cqw, 132px\)/);
  assert.doesNotMatch(css, /@media[^{]*\{[^}]*\.header-(?:nav|user|rename)/);
  assert.match(css, /html\.is-modal-open \.app,[\s\S]*?overflow: hidden/);
  assert.match(css, /\.stage\s*\{[^}]*flex: 1 0 auto;[^}]*width: 100%;[^}]*margin-inline: auto/);
  assert.match(css, /\.site-footer\s*\{[^}]*width: 100%;[^}]*margin: 32px auto 0/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.app\s*\{\s*--app-w: min\(100vw - 32px, 600px\)/);
  assert.doesNotMatch(css, /--stage-top-clip|\.app:not\(:has\(\.home-page\)\) \.stage/);
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /updateStageClip|--stage-top-clip/);
  assert.match(css, /\.scrollbar-overlay\.is-vertical\.is-left \.scrollbar-overlay-thumb\s*\{[^}]*left: 2px/);
  assert.doesNotMatch(css, /--story-top-clip/);
  assert.doesNotMatch(css, /\.site-header::before/);
});
test('外壳渲染后同步顶栏账户信息与改名入口', () => {
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /function ensureShell\(inRoom\)\s*\{[\s\S]*patchHeaderDOM\(inRoom\);[\s\S]*return stage;/);
  const html = shellMarkup(false, { uid: 'U1', name: '活泼的柠檬' });
  assert.match(html, /id="header-user"/);
  assert.match(html, /header-avatar[^>]*data-avatar-name="活泼的柠檬"/);
  assert.match(html, /data-action="rename"/);
});

test('大厅信息和操作分别放在独立列容器中', () => {
  const html = lobbyMarkup({ uid: 'a', room: { ...room, phase: 'lobby' } });
  const info = html.indexOf('class="lobby-info"');
  const controls = html.indexOf('class="lobby-controls"');
  assert.ok(info < html.indexOf('class="room-banner"'));
  assert.ok(html.indexOf('players-block') < controls);
  assert.ok(controls < html.indexOf('settings-block'));
  assert.ok(html.indexOf('settings-block') < html.indexOf('id="lobby-actions"'));
});

test('各游戏阶段的状态和操作分别放在独立列容器中', () => {
  for (const phase of ['writing', 'voting', 'prepare', 'breakVote']) {
    const html = writingMarkup({ uid: 'a', room: { ...room, phase } });
    const controls = html.indexOf('class="game-controls"');
    assert.ok(html.indexOf('class="game-info"') < html.indexOf('writing-stage'), phase);
    assert.ok(html.indexOf('game-status-block') < html.indexOf('game-leave'), phase);
    assert.ok(html.indexOf('game-leave') < controls, phase);
    assert.ok(controls < html.indexOf(phase === 'writing' ? 'id="word-form"' : 'word-grid'), phase);
  }
});

test('所有游戏阶段退出房间按钮单列留空探底、双列左侧居中半宽', () => {
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.writing-page \.game-leave\s*\{[^}]*order:\s*99;\s*margin-top:\s*28px;\s*width:\s*100%/);
  assert.match(css, /\.writing-page \.game-leave\s*\{[^}]*order:\s*unset;\s*align-self:\s*center;\s*width:\s*50%;\s*margin-top:\s*12px/);
});

test('历史详情的词路径与同局玩家投票使用独立宽屏列，窄屏阅读顺序不变', () => {
  const html = matchDetailMarkup({ match: { players, rounds: room.history, roomCode: '12345', outcome: 'none', totalRounds: 1, maxRounds: 12, startedAt: 1, endedAt: 2 } });
  const main = html.indexOf('class="match-detail-main"');
  const aside = html.indexOf('class="match-detail-aside"');
  assert.ok(main > html.indexOf('match-detail-heading'));
  assert.ok(main < html.indexOf('完整词路径'));
  assert.ok(html.indexOf('完整词路径') < aside);
  assert.ok(aside < html.indexOf('同局玩家'));
  assert.ok(html.indexOf('同局玩家') < html.indexOf('逐轮投票记录'));
  for (const detail of [null, { error: '对局不存在或无权查看' }]) {
    assert.doesNotMatch(matchDetailMarkup(detail), /class="match-detail-(main|aside)"/);
  }
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 1000px\)\s*\{\s*\.app:has\(\.match-detail-page\)\s*\{\s*--app-w: min\(100% - 64px, 1120px\)/);
  assert.match(css, /\.match-detail-main, \.match-detail-aside\s*\{[^}]*flex-direction: column/);
  assert.match(css, /\.history-search-box\.has-time \.input\s*\{[^}]*padding-right/);
});

test('隐私说明宽屏分两列独立堆叠，窄屏阅读顺序不变', () => {
  const html = privacyMarkup();
  const main = html.indexOf('class="privacy-main"');
  const aside = html.indexOf('class="privacy-aside"');
  assert.ok(html.indexOf('class="privacy-columns"') > html.indexOf('class="privacy-nav"'));
  assert.ok(html.indexOf('class="privacy-columns"') < main);
  assert.ok(main < html.indexOf('id="identity"'));
  assert.ok(html.indexOf('id="identity"') < html.indexOf('id="records"'));
  assert.ok(html.indexOf('id="records"') < aside);
  assert.ok(aside < html.indexOf('id="deletion"'));
  assert.ok(html.indexOf('id="deletion"') < html.indexOf('id="hosting"'));
  assert.ok(html.indexOf('id="hosting"') < html.indexOf('privacy-back-bottom'));
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.privacy-main, \.privacy-aside\s*\{\s*display: contents/);
  assert.match(css, /@media \(min-width: 1000px\)\s*\{\s*\.app:has\(\.privacy-content\)\s*\{\s*--app-w: min\(100% - 64px, 1120px\)/);
  assert.match(css, /\.privacy-columns\s*\{[^}]*grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, 1fr\)[^}]*align-items: start/);
  assert.match(css, /\.privacy-main, \.privacy-aside\s*\{\s*display: flex; flex-direction: column; min-width: 0/);
});
