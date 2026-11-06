import test from 'node:test';
import assert from 'node:assert/strict';
import { lobbyMarkup, writingMarkup } from '../public/render.js';

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
