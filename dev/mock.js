const $ = (selector) => document.querySelector(selector);
const frame = $('#game');
const select = $('#player');
let room = null;
let pausedAt = null;
const phaseNames = { lobby: '等待大厅', countdown: '开局倒计时', writing: '写词', voting: '投票', prepare: '准备', breakVote: '崩局投票', result: '结算', rematch: '重赛选择', interrupted: '对局中断' };
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
  $('#status').textContent = room ? `房间 ${room.code} · ${phaseNames[phase] || phase}` : '等待进入房间';
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
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'mock-route') { syncRoute(event.data.search || ''); return; }
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
