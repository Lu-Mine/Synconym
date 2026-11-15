const $ = (selector) => document.querySelector(selector);
const frame = $('#game');
const select = $('#player');
let room = null;
let pausedAt = null;
// 全站页面编号。01–50 放入口、静态与各玩法共用的页面；51–100 留给系统与异常页；
// 之后每个玩法各占 20 个号，新增页面只在所属段内往后取号，不重排别处。
const STAGE_SEGMENTS = [
  ['01-50', '入口、静态与通用页', 1, 50],
  ['51-100', '系统与异常页', 51, 100],
  ['101-120', '经典对局（自由 / 主题）', 101, 120],
  ['121-140', '即时竞猜', 121, 140],
  ['141-160', '接龙', 141, 160],
  ['161-180', '思维卧底', 161, 180],
  ['181-200', '极速闪电', 181, 200],
  ['201-220', '语义搭桥', 201, 220]
];
const STAGES = [
  ['home', '01', '首页'],
  ['insane', '02', '狂意大厅'],
  ['profile', '03', '档案'],
  ['match-detail', '04', '对局详情'],
  ['qa', '05', '问答'],
  ['privacy', '06', '隐私说明'],
  ['lobby', '07', '等待大厅'],
  ['countdown', '08', '开局倒计时'],
  ['result', '09', '结算'],
  ['rematch', '10', '重赛选择'],
  ['interrupted', '51', '对局中断'],
  ['writing', '101', '写词'],
  ['voting', '102', '投票'],
  ['breakVote', '103', '崩局投票'],
  ['prepare', '104', '准备'],
  ['lvIntro', '121', '竞猜出题'],
  ['lvPlay', '122', '竞猜描述'],
  ['lvScore', '123', '本轮结算']
];
// 段位自检：编号要么唯一落在某个段内，要么干脆没错，避免以后加页面时悄悄撞号或越界。
function stageNumberIssues() {
  const issues = [];
  const seen = new Map();
  for (const [key, no] of STAGES) {
    const value = Number(no);
    const owners = STAGE_SEGMENTS.filter(([, , low, high]) => value >= low && value <= high);
    if (owners.length !== 1) issues.push(`${key} 的编号 ${no} 没有落在唯一段位内`);
    if (seen.has(no)) issues.push(`${key} 与 ${seen.get(no)} 编号重复：${no}`);
    else seen.set(no, key);
  }
  return issues;
}
const STAGE_NUMBER_ISSUES = stageNumberIssues();
if (STAGE_NUMBER_ISSUES.length && typeof console !== 'undefined') console.error('[mock] 阶段编号异常：', STAGE_NUMBER_ISSUES.join('；'));
const STAGE_BY_KEY = new Map(STAGES.map(([key, no, label]) => [key, { no, label }]));
const phaseNames = Object.fromEntries(STAGES.map(([key, , label]) => [key, label]));
let currentScene = '';
// 人数限制与 server/rules.js、public/render.js 保持一致，面板只负责禁用提示。
const ROOM_LIMITS = { free: [2, 4], theme: [2, 4], livonym: [3, 8], shiritori: [2, 4], impostor: [3, 6], blitz: [2, 2], bridge: [2, 4] };
const roomLimits = (mode) => ROOM_LIMITS[mode] || ROOM_LIMITS.free;
const TIMED_PHASES = ['countdown', 'writing', 'voting', 'prepare', 'breakVote', 'result', 'rematch'];

function render() {
  const bots = room?.players?.filter(player => player.mockBot) || [];
  const selected = select.value;
  select.replaceChildren(...bots.map(player => new Option(player.name, player.uid)));
  if (bots.some(player => player.uid === selected)) select.value = selected;
  const bot = bots.find(player => player.uid === select.value);
  const phase = room?.phase;
  const [minPlayers, maxPlayers] = roomLimits(room?.mode);
  $('#status').textContent = stageText(room);
  $('#stage-no').textContent = currentStage(room)?.no || '--';
  select.disabled = !bot;
  $('#add').disabled = phase !== 'lobby' || room.players.length >= maxPlayers;
  $('#remove').disabled = !bot;
  $('#ready').disabled = !bot || !['lobby', 'prepare'].includes(phase) || (phase === 'lobby' && room.hostUid === bot.uid);
  $('#ready').checked = Boolean(bot?.ready);
  $('#start').disabled = phase !== 'lobby' || room.players.length < minPlayers || room.players.length > maxPlayers || !room.players.some(p => p.uid === room.hostUid && p.connected) || room.players.some(p => p.uid !== room.hostUid && (!p.ready || !p.connected));
  $('#word').disabled = !bot || phase !== 'writing' || bot.submitted;
  $('#submitWord').disabled = $('#word').disabled;
  const canVote = bot && ((phase === 'voting' && !bot.voted) || (phase === 'breakVote' && !bot.breakVoted));
  $('#yes').disabled = $('#no').disabled = !canVote;
  $('#yes').textContent = phase === 'breakVote' ? '玩崩了' : '同意';
  $('#no').textContent = phase === 'breakVote' ? '继续' : '否决';
  const canRematch = bot && ['result', 'rematch'].includes(phase) && room.rematchEligibleUids?.includes(bot.uid) && !room.rematchVotes?.[bot.uid];
  $('#rematch').disabled = !canRematch || Object.values(room?.rematchVotes || {}).includes('room');
  $('#room').disabled = !canRematch;
  $('#pause').checked = pausedAt != null;
  $('#back').disabled = !room?.mockCanBack;
  $('#advance').disabled = !room || (!room.mockCanForward && (!TIMED_PHASES.includes(phase) || room.phaseDeadline == null));
}

function send(action, extra = {}) {
  frame.contentWindow.postMessage({ type: 'mock-action', action, uid: select.value, ...extra }, location.origin);
}
function syncRoute(search) {
  if (typeof history?.replaceState !== 'function' || typeof search !== 'string') return;
  if ((location.search || '') !== search) history.replaceState(null, '', `${location.pathname || '/__mock'}${search}`);
}
frame.addEventListener?.('load', () => {
  try {
    if (frame.contentWindow?.location?.origin === location.origin) syncRoute(frame.contentWindow.location.search || '');
  } catch { /* 忽略非同源或测试环境 */ }
});
// 当前阶段：优先用游戏页同步过来的页面，兜底用房间阶段。
function currentStage(currentRoom) {
  return STAGE_BY_KEY.get(currentScene) || STAGE_BY_KEY.get(currentRoom?.phase) || null;
}
function stageText(currentRoom) {
  const label = currentStage(currentRoom)?.label;
  if (currentRoom) return `房间 ${currentRoom.code} · ${label || currentRoom.phase || ''}`;
  return label || '等待进入房间';
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'mock-route') { syncRoute(event.data.search || ''); return; }
  if (event.data?.type === 'mock-scene') {
    const scene = String(event.data.scene || '');
    if (scene !== currentScene) { currentScene = scene; render(); }
    return;
  }
  if (event.data?.type !== 'mock-state') return;
  room = event.data.room;
  pausedAt = event.data.mockPausedAt ?? room?.mockPausedAt ?? null;
  render();
});
select.addEventListener('change', render);
$('#add').addEventListener('click', () => send('add'));
$('#remove').addEventListener('click', () => send('remove'));
$('#ready').addEventListener('change', event => { send('ready', { ready: event.target.checked }); render(); });
$('#start').addEventListener('click', () => send('start'));
$('#submitWord').addEventListener('click', () => send('submitWord', { word: $('#word').value }));
for (const [id, yes] of [['yes', true], ['no', false]]) $( `#${id}`).addEventListener('click', () => send(room.phase === 'breakVote' ? 'breakVote' : 'vote', { yes }));
$('#rematch').addEventListener('click', () => send('rematch', { choice: 'rematch' }));
$('#room').addEventListener('click', () => send('rematch', { choice: 'room' }));
$('#pause').addEventListener('change', event => { send(event.target.checked ? 'pause' : 'resume'); render(); });
$('#back').addEventListener('click', () => send('back'));
const viewport = $('#viewport');
let previewWidth = null;
function updateViewport() {
  const maximum = Math.floor(window.innerWidth);
  viewport.min = String(Math.min(320, maximum));
  viewport.max = String(maximum);
  const width = previewWidth == null ? maximum : Math.min(previewWidth, maximum);
  viewport.value = String(width);
  frame.style.width = `${width}px`;
  $('#viewport-value').textContent = `${width} px`;
  viewport.setAttribute('aria-valuetext', `${width} 像素`);
}
viewport.addEventListener('input', () => {
  previewWidth = Number(viewport.value) === Number(viewport.max) ? null : Number(viewport.value);
  updateViewport();
});
updateViewport();
$('#advance').addEventListener('click', () => send('advance'));
render();

const panel = $('#mock-panel');
const handle = $('#drag-handle');
let drag = null;
function movePanel(x, y) {
  const rect = panel.getBoundingClientRect();
  panel.style.right = 'auto';
  panel.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
}
handle.addEventListener('pointerdown', event => {
  if (event.button !== 0 || drag) return;
  const rect = panel.getBoundingClientRect();
  drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
  handle.setPointerCapture(event.pointerId);
  panel.classList.add('dragging');
  event.preventDefault();
  handle.focus({ preventScroll: true });
});
handle.addEventListener('pointermove', event => {
  if (drag?.id === event.pointerId) movePanel(event.clientX - drag.x, event.clientY - drag.y);
});
function endDrag(event) {
  if (drag?.id !== event.pointerId) return;
  drag = null;
  panel.classList.remove('dragging');
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, endDrag);
handle.addEventListener('keydown', event => {
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!direction) return;
  event.preventDefault();
  const rect = panel.getBoundingClientRect();
  const step = event.shiftKey ? 32 : 8;
  movePanel(rect.left + direction[0] * step, rect.top + direction[1] * step);
});
$('#collapse').addEventListener('click', () => {
  const content = $('#panel-controls');
  content.hidden = !content.hidden;
  $('#collapse').textContent = content.hidden ? '展开' : '收起';
  $('#collapse').setAttribute('aria-expanded', String(!content.hidden));
  const rect = panel.getBoundingClientRect();
  movePanel(rect.left, rect.top);
});
window.addEventListener('resize', () => {
  updateViewport();
  const rect = panel.getBoundingClientRect();
  movePanel(rect.left, rect.top);
});
