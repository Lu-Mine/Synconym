import { readFileSync } from 'node:fs';
import { matchDetailMarkup } from '../../public/render.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lobbyMarkup, writingMarkup } from '../../public/render.js';

const players = [
  { uid: 'a', name: '甲', seat: 0, connected: true },
  { uid: 'b', name: '乙', seat: 1, connected: true }
];
const room = { code: '12345', hostUid: 'a', players, round: 2, maxRounds: 12,
  mode: 'free', writeSeconds: 45, prepareSeconds: 30, banRepeat: true,
  history: [{ n: 1, words: { a: '海洋', b: '天空' }, marks: {} }], words: { a: '海洋', b: '天空' } };

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
    assert.ok(html.indexOf('game-status-block') < controls, phase);
    assert.ok(controls < html.indexOf('game-leave'), phase);
    assert.ok(controls < html.indexOf(phase === 'writing' ? 'id="word-form"' : 'word-grid'), phase);
  }
});

test('历史详情的词路径与曲线投票使用独立宽屏列，窄屏阅读顺序不变', () => {
  const html = matchDetailMarkup({ match: { players, rounds: room.history, chart: [], roomCode: '12345', outcome: 'none', totalRounds: 1, maxRounds: 12, startedAt: 1, endedAt: 2 } });
  const main = html.indexOf('class="match-detail-main"');
  const aside = html.indexOf('class="match-detail-aside"');
  assert.ok(main > html.indexOf('match-detail-heading'));
  assert.ok(main < html.indexOf('同局玩家'));
  assert.ok(html.indexOf('完整词路径') < aside);
  assert.ok(aside < html.indexOf('收敛曲线'));
  assert.ok(html.indexOf('收敛曲线') < html.indexOf('逐轮投票记录'));
  for (const detail of [null, { error: '对局不存在或无权查看' }]) {
    assert.doesNotMatch(matchDetailMarkup(detail), /class="match-detail-(main|aside)"/);
  }
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 1000px\)\s*\{\s*\.app:has\(\.match-detail-page\)\s*\{\s*width: min\(100% - 64px, 1120px\)/);
  assert.match(css, /\.match-detail-main, \.match-detail-aside\s*\{[^}]*flex-direction: column/);
  assert.match(css, /\.profile-history \.history-search\s*\{[^}]*grid-template-columns: 100px minmax\(0, 1fr\) auto/);
});
