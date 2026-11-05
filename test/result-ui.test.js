import test from 'node:test';
import assert from 'node:assert/strict';
import { resultMarkup, writingMarkup, resultTitle } from '../public/render.js';
import { chartMarkup } from '../public/chart.js';

function fixture() {
  const players = [{ uid: 'a', name: '<甲>', seat: 0, connected: true }, { uid: 'b', name: '乙', seat: 1, connected: false }];
  return { uid: 'a', room: { code: '12345', phase: 'result', round: 2, maxRounds: 4, outcome: 'voted', players: [players[0]], resultPlayers: players,
    history: [{ n: 1, words: { a: '[非法答案]', b: '[未提交]' }, marks: { a: 'invalid', b: 'empty' }, outcome: 'miss', votes: { a: false } }, { n: 2, words: { a: '苹果', b: '香蕉' }, marks: { a: 'none', b: 'none' }, outcome: 'voted', votes: { a: true, b: true } }],
    chart: [{ n: 1, similarity: null }, { n: 2, similarity: 1 }]
  } };
}

test('结算展示完整历史成员、标记、投票与相遇轮次并转义内容', () => {
  const html = resultMarkup(fixture());
  for (const text of ['完整词路径', '投票记录', '[非法答案]', '[未提交]', '乙', '否 / 超时', '未参与', '第 2 轮投票达成一致', '导出 SVG', '重赛', '回房间', '回主页', '&lt;甲&gt;']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('<甲>'));
  assert.match(html, /<details class="surface-block result-votes">/);
  assert.ok(!writingMarkup({ ...fixture(), room: { ...fixture().room, phase: 'writing' } }).includes('convergence-chart'));
});

test('结算和中断页在标题同行显示房间号', () => {
  const state = fixture();
  for (const phase of ['result', 'rematch', 'interrupted']) {
    state.room.phase = phase;
    const html = resultMarkup(state);
    assert.match(html, /class="result-title-row"><h1>[^<]+<\/h1><span class="result-room-code">房间号 <strong>12345<\/strong><\/span>/);
    assert.doesNotMatch(html, /本局回顾|result-eyebrow/);
  }
});

test('重赛展示历史玩家、已选重赛可改回房间，按钮显式声明不提交表单', () => {
  const state = fixture();
  Object.assign(state.room, { phase: 'rematch', rematchEligibleUids: ['a'], rematchVotes: { a: 'rematch' }, rematchDeadline: 123 });
  const html = resultMarkup(state);
  assert.match(html, /id="countdown"/);
  assert.match(html, /data-action="rematch-yes" disabled/);
  assert.match(html, /data-action="rematch-room" ><svg/);
  assert.ok(html.includes('已选重赛'));
  assert.ok(html.includes('30 秒'));
  state.room.rematchVotes = { a: 'room' };
  assert.match(resultMarkup(state), /data-action="rematch-room" disabled/);
  for (const button of html.matchAll(/<button\b[^>]*>/g)) assert.ok(button[0].includes('type="button"'));
});

test('有效玩家选择回房间后禁用重赛，离开后可再次选择', () => {
  const state = fixture();
  Object.assign(state.room, { phase: 'rematch', rematchEligibleUids: ['a', 'b'], rematchVotes: {}, rematchDeadline: 123 });
  assert.match(resultMarkup(state), /data-action="rematch-yes" >/);
  state.room.rematchVotes.b = 'room';
  assert.match(resultMarkup(state), /data-action="rematch-yes" disabled/);
  assert.match(resultMarkup(state), /data-action="rematch-room" >/);
  state.room.rematchEligibleUids = ['a'];
  assert.match(resultMarkup(state), /data-action="rematch-yes" >/);
});

test('曲线含未知虚线、玩家颜色、轮次和可独立导出的SVG', () => {
  const html = chartMarkup(fixture().room);
  assert.ok(html.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(html.includes('stroke-dasharray="5 5"'));
  for (const text of ['#3D5AFE', '#FF5A46', '无法计算', '第 1 轮', '第 2 轮', '投票相遇', '&lt;甲&gt;']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('NaN'));
});

test('未相遇与单轮曲线不会出现错误胜利标题或非法坐标', () => {
  const state = fixture(); state.room.outcome = 'none'; state.room.history = [state.room.history[0]]; state.room.chart = [state.room.chart[0]];
  const html = resultMarkup(state);
  assert.ok(html.includes(resultTitle(state.room)));
  assert.ok(!html.includes('我们相遇了'));
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('Infinity'));
});

test('结算文案按结果匹配多句，同局状态更新文案不跳变', () => {
  const state = fixture();
  const title = resultTitle(state.room);
  assert.equal(resultTitle({ ...state.room, phase: 'rematch', rematchVotes: { a: 'rematch' } }), title);
  for (const outcome of ['exact', 'voted', 'none']) {
    const variants = new Set(Array.from({ length: 100 }, (_, i) => resultTitle({ ...state.room, outcome, code: String(i) })));
    assert.ok(variants.size >= 4, outcome);
    assert.ok(!variants.has('我们相遇了'));
  }
});

test('未点击的结算阶段就显示倒计时，断线者显示重连等待和原选择', () => {
  const state = fixture();
  Object.assign(state.room, { phase: 'result', rematchDeadline: 30000, rematchEligibleUids: ['a', 'b'], rematchVotes: { b: 'rematch' } });
  state.room.players = state.room.resultPlayers;
  const html = resultMarkup(state);
  assert.match(html, /id="countdown"/);
  assert.doesNotMatch(html, /\d+\s*\/\s*\d+ 已选择/);
  assert.ok(html.includes('连接中断 · 已选重赛'));
  assert.ok(!html.includes('等待重连'));
  assert.ok(!html.includes('结算即开始 30 秒倒计时'));
  assert.ok(!html.includes('选择后最多等'));
});

test('结算玩家状态使用对局样式并区分选择、掉线和离开', () => {
  const state = fixture();
  state.room.resultPlayers = [...state.room.resultPlayers, { uid: 'c', name: '丙', seat: 2 }, { uid: 'd', name: '丁', seat: 3 }];
  state.room.players = [{ ...state.room.resultPlayers[0] }, { ...state.room.resultPlayers[1], connected: true }, { ...state.room.resultPlayers[2], connected: false }];
  Object.assign(state.room, { rematchDeadline: 30000, rematchEligibleUids: ['a', 'b', 'c'], rematchVotes: { a: 'rematch', b: 'room' } });
  let html = resultMarkup(state);
  assert.match(html, /class="game-status-list"/);
  assert.match(html, /<div class="result-player-status"[^>]*><div class="section-heading"><h3>玩家状态<\/h3>/);
  assert.match(html, /class="ready-state"/);
  assert.doesNotMatch(html, /\d+\s*\/\s*\d+ 已选择/);
  for (const text of ['已选重赛', '已选回房间', '连接中断', '已离开', '（你）']) assert.ok(html.includes(text), text);
  assert.match(html, /class="game-status status-done"/);
  assert.match(html, /class="game-status status-away"/);
  state.room.rematchVotes = {};
  html = resultMarkup(state);
  assert.match(html, /class="game-status status-waiting"/);
  assert.ok(html.includes('选择中'));
});

test('中断结算仅提供回房间和回主页，不展示对局记录', () => {
  const state = fixture();
  state.room.phase = 'interrupted';
  const html = resultMarkup(state);
  assert.match(html, /本局已中断/);
  assert.match(html, /本局不会记录/);
  assert.match(html, /data-action="rematch-room"/);
  assert.match(html, /data-action="leave"/);
  assert.doesNotMatch(html, /收敛曲线|完整词路径|投票记录|data-action="rematch-yes"/);
});
