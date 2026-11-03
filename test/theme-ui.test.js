import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsMarkup, writingMarkup, resultMarkup } from '../public/render.js';
import { readFileSync } from 'node:fs';

const settings = { mode: 'theme', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true };
const room = { ...settings, code: '12345', phase: 'writing', round: 1, themeId: 'food', themeName: '<食物>', players: [], history: [] };

test('主题设置说明随机抽取，房主和成员均无主题选择器', () => {
  for (const editable of [true, false]) {
    const html = settingsMarkup(settings, editable);
    assert.match(html, /开始后随机抽取主题/);
    assert.doesNotMatch(html, /data-setting="themeId"|<select/);
    assert.match(settingsMarkup({ ...settings, mode: 'free' }, editable), /data-theme-setting-hint hidden/);
  }
});

test('各阶段与结算显示转义后的主题，自由模式不显示', () => {
  for (const phase of ['writing', 'voting', 'prepare', 'breakVote', 'result', 'rematch', 'interrupted']) {
    const render = ['result', 'rematch', 'interrupted'].includes(phase) ? resultMarkup : writingMarkup;
    const state = { uid: 'a', room: { ...room, phase } };
    const html = render(state);
    assert.match(html, ['result', 'rematch', 'interrupted'].includes(phase) ? /本局主题/ : /当前主题/);
    assert.match(html, /&lt;食物&gt;/);
    assert.doesNotMatch(html, /<食物>/);
    assert.doesNotMatch(render({ ...state, room: { ...state.room, mode: 'free' } }), /当前主题|本局主题|&lt;食物&gt;/);
  }
});
test('对局主题叠加在阶段卡片内，首轮仍可见', () => {
  for (const phase of ['writing', 'voting', 'prepare', 'breakVote']) {
    const html = writingMarkup({ uid: 'a', room: { ...room, phase } });
    assert.match(html, /<section class="writing-stage">[\s\S]*<div id="current-theme" class="stage-theme">[\s\S]*当前主题[\s\S]*<\/section>/);
    assert.equal((html.match(/id="current-theme"/g) || []).length, 1);
  }
});


test('同场景增量更新设置提示及主题，不重建写词表单', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /themeHint\.hidden = values\.mode !== 'theme'/);
  assert.equal((app.match(/patchMarkup\(theme, themeMarkup\(state\.room\)\)/g) || []).length, 2);
  assert.match(writingMarkup({ uid: 'a', room }, { draft: '草稿' }), /value="草稿"/);
});
