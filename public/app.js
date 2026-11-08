import { historyQuery, historyFilter, historyHref, parseHistoryTime } from './match-history.js';
import { Socket } from './ws.js';
import { observeStoryMotion } from './story-motion.js';
import { countdownState } from './countdown.js';
import { patchMarkup } from './dom.js';
import { copyText, readClipboardText } from './clipboard.js';
import { parseRoomCode, sanitizeRoomInput } from './room-code.js';
import { observeJoinPlaceholder } from './join-placeholder.js';
import { refreshPlayingCount } from './playing.js';
import {
  avatarDetails,
  homeMarkup,
  icon,
  lobbyMarkup,
  matchDetailMarkup,
  playerItemMarkup,
  privacyMarkup,
  profileMarkup,
  rematchMarkup,
  resultMarkup,
  settingValueMarkup,
  settingsBlockMarkup,
  settingsSummaryText,
  shellMarkup,
  thoughtPathMarkup,
  themeMarkup,
  writingMarkup
} from './render.js';

const MOCK = Boolean(window.__SYNCONYM_MOCK__);
const APP_ROOT = MOCK ? '/__mock/play' : '/';
const NUMERIC_SETTINGS = new Set(['maxRounds', 'writeSeconds', 'prepareSeconds']);
const WRITE_COOLDOWN_MS = 520;
const AVATAR_PALETTE = [
  { ink: '#3154C7', bg: '#E8EEFF', line: '#CCD8FF' },
  { ink: '#B94735', bg: '#FFF0EC', line: '#FFD4CA' },
  { ink: '#187A61', bg: '#E8F8F1', line: '#C4ECDC' },
  { ink: '#7447B8', bg: '#F3ECFF', line: '#DFD0FA' }
];
const avatarImageCache = new Map();

function avatarImageUrl(name) {
  const normalizedName = String(name || '').trim();
  if (avatarImageCache.has(normalizedName)) return avatarImageCache.get(normalizedName);
  const { initial, tone } = avatarDetails(normalizedName);
  const palette = AVATAR_PALETTE[tone];
  const canvas = document.createElement('canvas');
  const size = 152;
  const radius = 44;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  context.beginPath();
  context.roundRect(2, 2, size - 4, size - 4, radius);
  context.fillStyle = palette.bg;
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = palette.line;
  context.stroke();

  context.fillStyle = palette.ink;
  context.font = '680 60px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  const glyph = initial.toUpperCase();
  const metrics = context.measureText(glyph);
  const inkLeft = metrics.actualBoundingBoxLeft;
  const inkRight = metrics.actualBoundingBoxRight;
  const inkTop = metrics.actualBoundingBoxAscent;
  const inkBottom = metrics.actualBoundingBoxDescent;
  const x = (size + inkLeft - inkRight) / 2;
  const y = (size + inkTop - inkBottom) / 2;
  context.fillText(glyph, x, y);

  const url = canvas.toDataURL('image/png');
  avatarImageCache.set(normalizedName, url);
  return url;
}

function hydrateAvatars(root = app) {
  for (const avatar of root.querySelectorAll('img.avatar[data-avatar-name]')) {
    const name = avatar.dataset.avatarName || '';
    if (avatar.dataset.renderedName === name) continue;
    avatar.src = avatarImageUrl(name);
    avatar.dataset.renderedName = name;
  }
}

const app = document.querySelector('#app');
const toastElement = document.querySelector('#toast');

let state = { room: null, profile: null };
let settings = {
  mode: 'free',
  maxRounds: 12,
  writeSeconds: 45,
  prepareSeconds: 30,
  banRepeat: true
};
let homeSettingsOpen = false;
let renameOpen = false;
let profileOpen = new URLSearchParams(location.search).has('me');
let privacyOpen = new URLSearchParams(location.search).has('privacy');
let pathOpen = false;
let pathTrigger = null;
let pendingTransfer = null;
let pendingConfirm = null;
let pendingJoin = null;
let joinCheckVersion = 0;
let inviteTrigger = null;
let toastTimer;
let previousRoomCode = '';
let currentScreen = '';
// 每次渲染自增：用于丢弃 view transition 里尚未执行的过期快照。
let renderGeneration = 0;
let timeOffset = 0;
const gameNow = () => MOCK && Number.isFinite(state.mockPausedAt ?? state.room?.mockPausedAt) ? (state.mockPausedAt ?? state.room.mockPausedAt) : Date.now() + timeOffset;
let countdownTimer;
let idleCountdownTimer;
let idleFlashTimer;
let lastIdleDeadline = 0;
let idleRollTimer;
let stepperAnimTimer;
let lastWriteAt = 0;
let writeDrainTimer;
const writeQueue = [];
let pendingLobbySettings = null;
let gameUi = { draft: '', submitted: false, voted: false, ready: false };
let typingTimer;
let lastTypingAt = 0;
let finalTypingSent = false;
let roomHistoryGuard = false;

let stopJoinPlaceholder = () => {};
let stopStoryMotion = () => {};
let connectionStatus = 'connecting';

function syncConnectionUI() {
  const banner = document.querySelector('#connection-status');
  if (banner) {
    banner.hidden = connectionStatus === 'connected' || connectionStatus === 'connecting';
    banner.textContent = connectionStatus === 'replaced' ? '此身份已在其他页面连接，本页已停止重连。'
      : connectionStatus === 'auth-failed' ? '身份验证失败，已停止重连。请检查本地身份数据。'
      : connectionStatus === 'uid-in-use' ? '此身份仍在其他页面连接，正在等待连接释放并重试。'
      : connectionStatus === 'connecting' ? '正在连接服务器…'
      : '连接中断，正在重连。席位按当前阶段保留；重连前暂停操作。';
  }
  app.querySelector('#stage')?.toggleAttribute('inert', connectionStatus !== 'connected');
}

function closeConfirm(accepted = false) {
  if (!pendingConfirm) return;
  const { resolve, trigger } = pendingConfirm;
  pendingConfirm = null;
  const modal = app.querySelector('#confirm-modal');
  modal?.classList.remove('is-open');
  modal?.setAttribute('inert', '');
  syncModalScrollLock();
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  resolve(accepted);
}

function openInvite(url, trigger) {
  const modal = app.querySelector('#invite-modal');
  const input = app.querySelector('#invite-link');
  if (!modal || !input) return;
  inviteTrigger = trigger;
  input.value = url;
  modal.removeAttribute('inert');
  modal.classList.add('is-open');
  syncModalScrollLock();
  input.focus();
  input.select();
}

function closeInvite() {
  if (!inviteTrigger) return;
  const trigger = inviteTrigger;
  inviteTrigger = null;
  const modal = app.querySelector('#invite-modal');
  modal?.classList.remove('is-open');
  modal?.setAttribute('inert', '');
  syncModalScrollLock();
  if (trigger.isConnected) trigger.focus({ preventScroll: true });
}

function closeJoin() {
  if (!pendingJoin) return;
  const trigger = pendingJoin.trigger;
  pendingJoin = null;
  const modal = app.querySelector('#join-modal');
  modal?.classList.remove('is-open');
  modal?.setAttribute('inert', '');
  syncModalScrollLock();
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function markInvalid(input) {
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  input.classList.remove('input-shake');
  void input.offsetWidth;
  input.classList.add('input-shake');
}

async function checkJoinInput(input, version) {
  if (!input.isConnected || state.room || profileOpen || pendingJoin || pendingConfirm || renameOpen || inviteTrigger) return;
  const value = input.value.trim();
  if (!value) return;
  const code = parseRoomCode(value);
  if (!code) { toast('请输入 5 位房号或有效的邀请链接'); markInvalid(input); return; }
  try {
    const response = await fetch(`${MOCK ? '/__mock' : ''}/api/rooms/${code}`, { cache: 'no-store' });
    const data = await response.json();
    if (version !== joinCheckVersion || !input.isConnected || input.value.trim() !== value || state.room || profileOpen || pendingJoin || pendingConfirm || renameOpen || inviteTrigger) return;
    if (!response.ok) { toast(data.error || '房间不存在或无法加入'); markInvalid(input); return; }
    const modal = app.querySelector('#join-modal');
    const host = app.querySelector('#join-host');
    if (!modal || !host || !data.host) return;
    app.querySelector('#join-room-number').textContent = `房号 ${code}`;
    host.innerHTML = playerItemMarkup(data.host, { hostUid: data.host.uid, phase: 'lobby' }, '');
    hydrateAvatars(host);
    pendingJoin = { code, trigger: input };
    modal.removeAttribute('inert');
    modal.classList.add('is-open');
    syncModalScrollLock();
    modal.querySelector('.button[data-action="cancel-join"]').focus({ preventScroll: true });
  } catch {
    if (version === joinCheckVersion && input.isConnected && !state.room && !profileOpen) toast('无法查询房间，请稍后重试');
  }
}

function checkJoinOnInput(input, pasted = false) {
  const version = ++joinCheckVersion;
  const value = input.value.trim();
  if (pasted || parseRoomCode(value) || (/^[0-9０-９]+$/.test(value) && value.length > 5)) checkJoinInput(input, version);
}

function confirmAction(kind) {
  if (pendingConfirm) return Promise.resolve(false);
  const resetting = kind === 'reset';
  if (!state.room && !resetting) return Promise.resolve(false);
  const modal = app.querySelector('#confirm-modal');
  if (!modal) return Promise.resolve(false);
  const result = state.room ? ['result', 'rematch'].includes(state.room.phase) : false;
  const lobby = state.room?.phase === 'lobby';
  const breaking = kind === 'break';
  modal.querySelector('#confirm-title').textContent = resetting ? '换一个新身份？'
    : breaking ? '确定选择玩崩了？' : result ? '回到主页？' : '退出房间？';
  modal.querySelector('#confirm-description').textContent = resetting
    ? '会生成新的 UID 和随机名字。当前的改名记录与对局记录不会跟着新身份，也不会删除已有数据。'
    : breaking
      ? '达到半数选择玩崩了，本局将立即结束，且对局记录不会保存。选择后不能更改。'
      : result ? '你将退出本房间，移除重赛资格和已有选择。其他玩家可以继续，不会关闭他们的房间。'
      : lobby ? '你将离开当前房间并回到主页。其他玩家仍可继续留在房间。'
      : '你将主动退出本局并回到主页，席位和参与资格立即移除，不能恢复到已开始的本局。';
  modal.querySelector('[data-action="accept-confirm"] span').textContent = resetting ? '换新身份'
    : breaking ? '确认玩崩了' : result ? '退出并回主页' : '退出房间';
  const trigger = document.activeElement;
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  pendingConfirm = { resolve, promise, trigger };
  modal.removeAttribute('inert');
  modal.classList.add('is-open');
  syncModalScrollLock();
  modal.querySelector('.button[data-action="cancel-confirm"]').focus({ preventScroll: true });
  return promise;
}

function confirmLeave() { return confirmAction('leave'); }
function confirmBreakVote() { return confirmAction('break'); }

window.addEventListener('popstate', async () => {
  if (!state.room) {
    profileOpen = new URLSearchParams(location.search).has('me');
    privacyOpen = new URLSearchParams(location.search).has('privacy');
    state.profile = null;
    if (profileOpen && socket.ready) requestProfile(historyQuery(location.search).page);
    render();
    return;
  }
  if (!roomHistoryGuard) return;
  // 先恢复当前历史保护项，再异步确认；取消不导航，确认通过服务端退出。
  history.pushState({ roomGuard: true }, '', location.href);
  if (await confirmLeave()) enqueueWrite({ type: 'leave' });
});

function cleanWord(value) {
  let count = 0;
  let result = '';
  for (const char of value.normalize('NFC')) {
    if (/\s/u.test(char)) { if (result.length < 256) result += ' '; continue; }
    if (!/[\p{Script=Han}\p{L}\p{N}]/u.test(char)) continue;
    const length = [...char.normalize('NFKC')].length;
    if (count + length > 12) continue;
    count += length;
    result += char;
  }
  return result;
}

function sendTyping(force = false) {
  clearTimeout(typingTimer);
  if (state.room?.phase !== 'writing' || gameUi.submitted) return;
  const wait = 320 - (Date.now() - lastTypingAt);
  if (wait > 0) { typingTimer = setTimeout(() => sendTyping(), wait); return; }
  lastTypingAt = Date.now();
  if (socket.ws.readyState === WebSocket.OPEN) socket.send({ type: 'typing', word: gameUi.draft });
}

function acceptWordInput(input) {
  const before = input.value;
  const cursor = input.selectionStart ?? before.length;
  const cleaned = cleanWord(before);
  if (before !== cleaned) {
    input.value = cleaned;
    const position = cleanWord(before.slice(0, cursor)).length;
    input.setSelectionRange(position, position);
  }
  gameUi.draft = cleaned;
  sendTyping();
}

function coerceSettingValue(key, rawValue, currentTarget) {
  if (key === 'banRepeat') return !currentTarget.banRepeat;
  if (NUMERIC_SETTINGS.has(key)) return Number(rawValue);
  return String(rawValue);
}

function toast(message) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add('visible');
  toastTimer = setTimeout(() => toastElement.classList.remove('visible'), 2500);
}

function updateCountdown() {
  clearInterval(countdownTimer);
  if (state.room?.phase === 'lobby' || !state.room) return;
  const tick = () => {
    const deadline = Number(state.room?.phaseDeadline);
    const { seconds, grace, urgent } = countdownState(state.room, gameNow());
    if (state.room?.phase === 'writing' && deadline > 0 && !finalTypingSent && deadline - gameNow() <= 500) {
      finalTypingSent = true;
      sendTyping(true);
    }
    const element = document.querySelector('#countdown');
    if (element) {
      element.textContent = seconds === null ? '–' : `${seconds} 秒`;
      element.parentElement?.classList.toggle('urgent', urgent);
      element.parentElement?.classList.toggle('reconnect-grace', grace);
      const hint = document.querySelector('#prepare-grace-hint');
      if (hint) hint.hidden = !grace;
    }
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

function formatClock(seconds) {
  const total = Math.max(0, seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function idleClockText(idleDeadline) {
  const seconds = Math.max(0, Math.ceil((idleDeadline - gameNow()) / 1000));
  return seconds > 0 ? formatClock(seconds) : '即将关闭';
}

// 房间有活动时服务端会顺延 idleDeadline，倒计时借此轻微发光提示"有人动过"
function flashIdleClock(clock) {
  if (!clock) return;
  clearTimeout(idleFlashTimer);
  clock.classList.remove('is-pulsing');
  void clock.offsetWidth; // 强制回流，连续活动时也能重播这次发光
  clock.classList.add('is-pulsing');
  idleFlashTimer = setTimeout(() => clock.classList.remove('is-pulsing'), 1000);
}

const IDLE_DIGIT_CELLS = 3; // 每位只有"上一格 / 当前 / 下一格"，因此永远只滚一格
const IDLE_DIGIT_REST = 1;

function idleDigitOffset(index) {
  return `translateY(${(-index * 100 / IDLE_DIGIT_CELLS).toFixed(4)}%)`;
}

function idleDigitMarkup() {
  const cells = Array.from({ length: IDLE_DIGIT_CELLS }, () => '<span></span>').join('');
  return `<span class="idle-digit" aria-hidden="true"><span class="idle-digit-strip">${cells}</span></span>`;
}

function placeIdleDigit(slot, digit) {
  const strip = slot.querySelector('.idle-digit-strip');
  strip.children[IDLE_DIGIT_REST].textContent = String(digit);
  strip.style.transform = idleDigitOffset(IDLE_DIGIT_REST);
  slot.dataset.digit = String(digit);
}

// 就近翻一位：数值变大就从下方翻上来，变小就从上方翻下来，不滚过中间的数字
function rollIdleDigit(slot, nextDigit, order, animate) {
  if (!slot) return 0;
  const strip = slot.querySelector('.idle-digit-strip');
  const current = Number(slot.dataset.digit || 0);
  if (current === nextDigit) return 0;
  const cells = strip.children;
  strip.getAnimations().forEach((animation) => animation.cancel());
  placeIdleDigit(slot, current); // 打断上一次滚动时先归位到已知数字
  slot.dataset.digit = String(nextDigit);
  if (!animate) {
    placeIdleDigit(slot, nextDigit);
    return 0;
  }
  const forward = (nextDigit - current + 10) % 10;
  const backward = (current - nextDigit + 10) % 10;
  const target = forward <= backward ? IDLE_DIGIT_REST + 1 : IDLE_DIGIT_REST - 1;
  cells[target].textContent = String(nextDigit);
  const delay = order * 70;
  const animation = strip.animate(
    [{ transform: idleDigitOffset(IDLE_DIGIT_REST) }, { transform: idleDigitOffset(target) }],
    { duration: 260, delay, easing: 'cubic-bezier(.3, .7, .25, 1)', fill: 'backwards' }
  );
  animation.onfinish = () => {
    placeIdleDigit(slot, nextDigit);
    animation.cancel();
  };
  return delay + 260;
}

// animate=true 时逐位回滚，返回最后一位滚完所需毫秒数；false 时直接落到新数值
function paintIdleCountdown(element, text, animate) {
  const chars = [...text];
  const digits = chars.filter((ch) => ch >= '0' && ch <= '9');
  // 轮盘上的数字对读屏隐藏；用 aria-label 给它一个正常读数
  element.closest('.idle-clock')
    ?.setAttribute('aria-label', digits.length ? `房间空闲倒计时 ${text}` : `房间空闲${text}`);
  if (!digits.length) {
    element.textContent = text;
    element.dataset.layout = 'text';
    return 0;
  }
  const layout = chars.map((ch) => (ch >= '0' && ch <= '9' ? 'd' : ':')).join('');
  const fresh = element.dataset.layout !== layout;
  if (fresh) {
    element.dataset.layout = layout;
    element.innerHTML = chars.map((ch) => (ch >= '0' && ch <= '9'
      ? idleDigitMarkup()
      : '<span class="idle-sep" aria-hidden="true">:</span>')).join('');
  }
  const slots = element.querySelectorAll('.idle-digit');
  const rolling = animate && !fresh && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let elapsed = 0;
  digits.forEach((ch, index) => {
    if (fresh) placeIdleDigit(slots[index], Number(ch));
    else elapsed = Math.max(elapsed, rollIdleDigit(slots[index], Number(ch), digits.length - 1 - index, rolling));
  });
  return rolling ? elapsed : 0;
}

function updateIdleCountdown() {
  clearInterval(idleCountdownTimer);
  const element = document.querySelector('#idle-countdown');
  const idleDeadline = state.room?.idleDeadline;
  if (!element || !idleDeadline) {
    lastIdleDeadline = 0;
    return;
  }
  const clock = element.closest('.idle-clock');
  if (lastIdleDeadline && idleDeadline - lastIdleDeadline > 200) {
    flashIdleClock(clock);
    const rollMs = paintIdleCountdown(element, idleClockText(idleDeadline), true);
    clearTimeout(idleRollTimer);
    if (rollMs) {
      element.dataset.rolling = 'true';
      idleRollTimer = setTimeout(() => delete element.dataset.rolling, rollMs + 60);
    }
  }
  lastIdleDeadline = idleDeadline;
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((idleDeadline - gameNow()) / 1000));
    // 逐位回滚进行中不刷新数字，避免打断滚动
    if (element.dataset.rolling !== 'true') {
      paintIdleCountdown(element, seconds > 0 ? formatClock(seconds) : '即将关闭', false);
    }
    clock?.classList.toggle('urgent', seconds <= 30);
  };
  tick();
  idleCountdownTimer = setInterval(tick, 500);
}

function refreshTimers() {
  updateCountdown();
  updateIdleCountdown();
}

function animateStepperValue(nextNumber, direction = 1) {
  const output = app.querySelector('#rounds');
  if (!output) return;
  const prevNumber = Number(output.dataset.value || output.textContent);
  if (prevNumber === nextNumber) return;

  clearTimeout(stepperAnimTimer);
  const outClass = direction >= 0 ? 'slide-out-up' : 'slide-out-down';
  const inClass = direction >= 0 ? 'slide-in-from-down' : 'slide-in-from-up';

  output.classList.remove('slide-out-up', 'slide-out-down', 'slide-in-from-down', 'slide-in-from-up');
  output.classList.add(outClass);

  stepperAnimTimer = setTimeout(() => {
    output.textContent = String(nextNumber);
    output.dataset.value = String(nextNumber);
    output.classList.remove(outClass);
    output.classList.add(inClass);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        output.classList.remove(inClass);
      });
    });
  }, 95);
}

function patchSettingsDOM(values, editable) {
  const section = app.querySelector('.settings');
  if (!section || section.dataset.editable !== String(editable)) return false;
  section.dataset.editable = String(editable);

  for (const group of section.querySelectorAll('[data-segmented]')) {
    const name = group.dataset.segmented;
    const buttons = [...group.querySelectorAll('.segment')];
    const selectedIndex = buttons.findIndex((btn) => String(btn.dataset.value) === String(values[name]));
    if (selectedIndex >= 0) group.style.setProperty('--selected', String(selectedIndex));
    buttons.forEach((btn, idx) => {
      const selected = idx === selectedIndex;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
      btn.disabled = !editable;
    });
  }

  const output = section.querySelector('#rounds');
  if (output) {
    const currentShown = Number(output.dataset.value || output.textContent);
    if (currentShown !== values.maxRounds) {
      animateStepperValue(values.maxRounds, values.maxRounds > currentShown ? 1 : -1);
    }
  }
  const minusBtn = section.querySelector('[data-step="-1"]');
  const plusBtn = section.querySelector('[data-step="1"]');
  if (minusBtn) minusBtn.disabled = !editable || values.maxRounds <= 4;
  if (plusBtn) plusBtn.disabled = !editable || values.maxRounds >= 20;

  const switchBtn = section.querySelector('#banRepeat');
  if (switchBtn) {
    switchBtn.setAttribute('aria-checked', String(Boolean(values.banRepeat)));
    switchBtn.disabled = !editable;
  }

  for (const node of section.querySelectorAll('[data-setting-value]')) {
    const markup = settingValueMarkup(node.dataset.settingValue, values, node.dataset.control);
    if (node.outerHTML !== markup) node.outerHTML = markup;
  }

  const themeHint = section.querySelector('[data-theme-setting-hint]');
  if (themeHint) themeHint.hidden = values.mode !== 'theme';

  const summary = app.querySelector('#settings-summary');
  if (summary) summary.textContent = settingsSummaryText(values);
  return true;
}

function syncHomeDrawerDOM() {
  const drawer = app.querySelector('#home-settings-drawer');
  const trigger = drawer?.querySelector('[data-action="toggle-settings"]');
  const panel = app.querySelector('#home-settings-panel');
  if (!drawer || !trigger || !panel) return;
  drawer.classList.toggle('is-open', homeSettingsOpen);
  panel.classList.toggle('is-open', homeSettingsOpen);
  trigger.setAttribute('aria-expanded', String(homeSettingsOpen));
  panel.toggleAttribute('inert', !homeSettingsOpen);
}

function syncModalScrollLock() {
  document.documentElement.classList.toggle('is-modal-open', renameOpen || Boolean(pendingTransfer) || Boolean(pendingConfirm) || Boolean(pendingJoin) || Boolean(inviteTrigger) || pathOpen);
}

function syncRenameModalDOM(focusInput = false) {
  syncModalScrollLock();
  const modal = app.querySelector('#rename-modal');
  if (!modal) return;
  modal.classList.toggle('is-open', renameOpen);
  modal.toggleAttribute('inert', !renameOpen);
  const input = modal.querySelector('#player-name');
  if (input && state.user && document.activeElement !== input) input.value = state.user.name;
  if (renameOpen && focusInput && input) {
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }
}

function syncTransferModalDOM() {
  syncModalScrollLock();
  const modal = app.querySelector('#transfer-modal');
  if (!modal) return;
  modal.classList.toggle('is-open', Boolean(pendingTransfer));
  modal.toggleAttribute('inert', !pendingTransfer);
  const nameEl = modal.querySelector('#transfer-target-name');
  if (nameEl) nameEl.textContent = pendingTransfer?.name || '';
  if (pendingTransfer) {
    requestAnimationFrame(() => modal.querySelector('[data-action="cancel-transfer"].button')?.focus());
  }
}

function syncPathModalDOM(focusClose = false) {
  syncModalScrollLock();
  const modal = app.querySelector('#path-modal');
  if (!modal) return;
  modal.classList.toggle('is-open', pathOpen);
  modal.toggleAttribute('inert', !pathOpen);
  const content = modal.querySelector('#path-content');
  if (pathOpen && content && state.room) { patchMarkup(content, thoughtPathMarkup(state.room)); hydrateAvatars(content); }
  if (pathOpen && focusClose) requestAnimationFrame(() => modal.querySelector('.rename-dialog [data-action="close-path"]')?.focus());
}

function closePath() {
  pathOpen = false;
  syncPathModalDOM();
  if (pathTrigger?.isConnected) pathTrigger.focus();
  else app.querySelector('[data-action="open-path"]')?.focus();
  pathTrigger = null;
}

// 输入框内右侧的“按 … 匹配”只在输入能解析成时间时出现。
function syncHistoryTimeBadge() {
  const input = document.getElementById('history-search-input');
  const box = input?.closest('.history-search-box');
  if (!input || !box) return;
  const time = parseHistoryTime(input.value);
  box.classList.toggle('has-time', Boolean(time));
  const current = document.getElementById('history-search-time');
  if (!time) { current?.remove(); input.style.removeProperty('padding-right'); return; }
  const badge = current || document.createElement('span');
  // 用外层容器宽度判断：输入框宽度会被自己上一次留下的内边距影响
  const boxWidth = box.clientWidth || input.clientWidth;
  // 窄屏收起年份，避免徽标把输入内容挤没
  badge.textContent = `按 ${boxWidth < 360 ? time.short : time.label} 匹配`;
  badge.title = `按 ${time.label} 匹配`;
  badge.id = 'history-search-time';
  badge.className = 'history-search-time';
  badge.style.maxWidth = `${Math.max(96, Math.round(boxWidth * 0.55))}px`;
  if (!current) box.append(badge);
  // 按徽标实际宽度留出内边距，避免长区间被输入内容盖住
  input.style.paddingRight = `${badge.offsetWidth + 24}px`;
}

// 宽度变化时重新选一次徽标文案与留白
window.addEventListener('resize', () => { if (app.querySelector('.profile-page')) syncHistoryTimeBadge(); });

// 输入即搜：不跳转页面，改完地址后直接向服务端要第一页结果。
let historySearchTimer;
function scheduleHistorySearch(value) {
  clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => {
    const raw = String(value ?? '').trim();
    const params = new URLSearchParams({ me: '' });
    if (raw) params.set('q', raw);
    history.replaceState(null, '', `${APP_ROOT}?${params}`);
    if (socket.ready) requestProfile(1);
    else render();
  }, 240);
}

function requestProfile(page = 1) {
  state.profileError = null;
  const query = historyQuery(location.search);
  if (query.id) { socket.send({ type: 'openMatch', id: query.id }, true); return; }
  query.page = page;
  state.historyQuery = query;
  history.replaceState(null, '', `${APP_ROOT}${historyHref(query)}`);
  socket.send({ type: 'openProfile', page: query.page, filter: historyFilter(query) }, true);
}

function openProfile() {
  if (state.room) return;
  privacyOpen = false;
  profileOpen = true;
  state.profile = null;
  history.pushState({ profile: true }, '', `${APP_ROOT}?me`);
  requestProfile(1);
  render();
}

function requestTransfer(player) {
  if (!player || !state.room || state.room.hostUid !== state.uid) return;
  pendingTransfer = { uid: player.uid, name: player.name };
  syncTransferModalDOM();
}

function patchHeaderDOM(inRoom) {
  const user = state.user;
  const headerUser = app.querySelector('#header-user');
  if (headerUser) {
    headerUser.classList.toggle('is-visible', Boolean(user));
    const avatar = headerUser.querySelector('.header-avatar');
    const name = headerUser.querySelector('#header-user-name');
    if (avatar) {
      const userName = user?.name || '';
      const details = avatarDetails(userName);
      if (avatar.dataset.avatarName !== userName) {
        avatar.dataset.avatarName = userName;
        avatar.removeAttribute('data-rendered-name');
      }
      avatar.dataset.avatarTone = String(details.tone);
      hydrateAvatars(headerUser);
    }
    if (name) name.textContent = user?.name || '';
  }
  const uid = app.querySelector('#rename-uid');
  if (uid) uid.textContent = `UID：${user?.uid || ''}`;
  syncRenameModalDOM(false);
}

function patchLobbyDOM(nextState) {
  const { room, uid } = nextState;
  const page = app.querySelector('.lobby-page');
  if (!page || page.dataset.room !== room.code) return false;

  const host = room.hostUid === uid;
  const me = room.players.find((player) => player.uid === uid);
  const canStart = host && room.players.length >= 2 && room.players
    .filter((player) => player.uid !== room.hostUid)
    .every((player) => player.ready && player.connected);

  const codeEl = page.querySelector('#lobby-room-code');
  if (codeEl) codeEl.textContent = room.code;

  const countEl = page.querySelector('#player-count');
  if (countEl) countEl.textContent = `${room.players.length} / 4`;

  // 先量旧位置，再动其它区块，换位动画才能把设置区高度变化也算进去
  const list = page.querySelector('#player-list');
  const firstRects = new Map();
  if (list) {
    for (const item of list.querySelectorAll('.player[data-uid]')) {
      firstRects.set(item.dataset.uid, item.getBoundingClientRect());
    }
  }
  const activeElementId = document.activeElement?.id;

  // 房主身份变化会改变设置板块结构（可编辑控件 / 只读取值）：就地重建这一块，
  // 不走整页重渲染，玩家列表才能继续用换位动画。
  const settingsBlock = page.querySelector('.settings-block');
  const settingsEditable = settingsBlock?.querySelector('.settings')?.dataset.editable === 'true';
  if (settingsBlock && settingsEditable !== host) {
    settingsBlock.outerHTML = settingsBlockMarkup(room, host);
  }

  const actions = page.querySelector('#lobby-actions');
  if (actions) {
    const primaryAction = actions.querySelector('[data-action="ready"], [data-action="start"]');
    if (host) {
      if (primaryAction?.dataset.action !== 'start') {
        primaryAction?.remove();
        actions.insertAdjacentHTML('afterbegin', `<button class="button primary start-button" type="button" data-action="start" ${canStart ? '' : 'disabled'}>${icon('play')}<span>开始</span></button>`);
      } else {
        primaryAction.disabled = !canStart;
      }
    } else if (primaryAction?.dataset.action !== 'ready') {
      primaryAction?.remove();
      actions.insertAdjacentHTML('afterbegin', `<button class="button ${me?.ready ? 'secondary' : 'primary'} ready-button" type="button" data-action="ready">${me?.ready ? `<span>取消准备</span>${icon('x')}` : `<span>准备</span>${icon('check')}`}</button>`);
    } else if (me) {
      primaryAction.className = `button ${me.ready ? 'secondary' : 'primary'} ready-button`;
      patchMarkup(primaryAction, me.ready ? `<span>取消准备</span>${icon('x')}` : `<span>准备</span>${icon('check')}`);
    }
  }

  if (list) {
    patchMarkup(list, room.players.map((player) => playerItemMarkup(player, room, uid)).join(''));
    hydrateAvatars(list);

    for (const item of list.querySelectorAll('.player[data-uid]')) {
      const prev = firstRects.get(item.dataset.uid);
      if (!prev) {
        item.classList.add('player-enter');
        requestAnimationFrame(() => requestAnimationFrame(() => item.classList.remove('player-enter')));
      } else {
        const next = item.getBoundingClientRect();
        const dy = prev.top - next.top;
        if (Math.abs(dy) > 1) {
          item.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
            { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
          );
        }
      }
    }
    if (activeElementId) document.getElementById(activeElementId)?.focus();
  }

  const nameInput = app.querySelector('#player-name');
  if (nameInput && me && document.activeElement !== nameInput) {
    nameInput.value = me.name;
  }

  const effectiveSettings = pendingLobbySettings && host ? pendingLobbySettings : room;
  if (!patchSettingsDOM(effectiveSettings, host)) return false;

  return true;
}

function screenKeyFor(nextState) {
  if (!nextState.room) return privacyOpen ? 'privacy' : profileOpen ? 'profile' : 'home';
  return nextState.room.phase || 'writing';
}

function buildScreenMarkup(screen) {
  if (screen === 'home') return homeMarkup(settings, homeSettingsOpen);
  if (screen === 'profile') return historyQuery(location.search).id ? matchDetailMarkup(state.matchDetail, historyQuery(location.search)) : profileMarkup({ ...state, historyQuery: historyQuery(location.search) });
  if (screen === 'privacy') return privacyMarkup();
  if (screen === 'lobby') return lobbyMarkup(state, renameOpen);
  if (screen === 'result' || screen === 'rematch' || screen === 'interrupted') return resultMarkup(state);
  return writingMarkup(state, gameUi);
}

function ensureShell(inRoom) {
  let stage = app.querySelector('#stage');
  // 顶栏的可点区域只在首页出现：进出房间时整块外壳跟着重建一次
  if (!stage || app.querySelector('#site-header')?.dataset.inRoom !== String(inRoom)) {
    app.innerHTML = shellMarkup(inRoom, state.user, renameOpen);
    stage = app.querySelector('#stage');
  }
  patchHeaderDOM(inRoom);
  return stage;
}

function patchSameScene(stage, nextScreen) {
  const resultPage = stage.querySelector('.result-page');
  if (['result', 'rematch'].includes(nextScreen) && resultPage?.dataset.room === state.room?.code) {
    const theme = resultPage.querySelector('#current-theme');
    if (theme) patchMarkup(theme, themeMarkup(state.room));
    const panel = resultPage.querySelector('#result-rematch');
    if (panel) {
      const focusedAction = panel.contains(document.activeElement) ? document.activeElement.dataset.action : null;
      patchMarkup(panel, rematchMarkup(state));
      if (focusedAction) panel.querySelector(`[data-action="${focusedAction}"]:not(:disabled)`)?.focus({ preventScroll: true });
      resultPage.dataset.screen = nextScreen;
      return true;
    }
  }
  if (nextScreen === 'profile' && stage.querySelector('.profile-page')) {
    patchMarkup(stage, buildScreenMarkup('profile'));
    hydrateAvatars(stage);
    syncHistoryTimeBadge();
    return true;
  }
  if (nextScreen === 'home' && stage.querySelector('.home-page') && patchSettingsDOM(settings, true)) {
    syncHomeDrawerDOM();
    return true;
  }
  if (nextScreen === 'lobby' && patchLobbyDOM(state)) {
    syncRenameModalDOM(false);
    syncTransferModalDOM();
    return true;
  }
  if (nextScreen === 'voting' || nextScreen === 'prepare') {
    const page = stage.querySelector('.writing-page');
    if (page?.dataset.room === state.room?.code && page.dataset.round === String(state.room.round)) {
      patchMarkup(stage, writingMarkup(state, gameUi));
      hydrateAvatars(stage);
      return true;
    }
  }
  if (nextScreen === 'writing' && stage.querySelector('.writing-page')?.dataset.round === String(state.room.round)) {
    const page = stage.querySelector('.writing-page');
    const template = document.createElement('template');
    template.innerHTML = writingMarkup(state, gameUi);
    const fresh = template.content;
    const theme = page?.querySelector('#current-theme');
    if (theme) patchMarkup(theme, themeMarkup(state.room));
    const oldStatus = page?.querySelector('#game-status');
    const newStatus = fresh.querySelector('#game-status');
    if (oldStatus && newStatus) { patchMarkup(oldStatus, newStatus.innerHTML); hydrateAvatars(oldStatus); }
    const oldPrevious = page?.querySelector('#previous-words');
    const newPrevious = fresh.querySelector('#previous-words');
    if (oldPrevious && newPrevious && oldPrevious.innerHTML !== newPrevious.innerHTML) {
      patchMarkup(oldPrevious, newPrevious.innerHTML);
      hydrateAvatars(oldPrevious);
    }
    const input = page?.querySelector('#word-input');
    const button = page?.querySelector('#word-form button');
    const submitted = Boolean(state.room.players?.find((player) => player.uid === state.uid)?.submitted || gameUi.submitted);
    if (input) input.disabled = submitted;
    if (button) { button.disabled = submitted; button.querySelector('span').textContent = submitted ? '已提交，等待其他玩家' : '提交'; }
    return true;
  }
  const currentPage = stage.querySelector('[data-screen]');
  if (nextScreen === currentScreen && currentPage
      && (!state.room || (currentPage.dataset.room === state.room.code
        && (!currentPage.dataset.round || currentPage.dataset.round === String(state.room.round))))) {
    patchMarkup(stage, buildScreenMarkup(nextScreen));
    hydrateAvatars(stage);
    return true;
  }
  return false;
}

function replaceScene(stage, nextScreen, generation) {
  const html = buildScreenMarkup(nextScreen);
  const shouldTransition = Boolean(
    currentScreen && currentScreen !== nextScreen && document.startViewTransition
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const applyDOM = () => {
    // 过渡回调是异步的：期间若已有更新的渲染，这份过期快照必须丢弃，
    // 否则会用旧内容覆盖新内容（例如点头像进档案页时被「正在读取档案…」盖掉）。
    if (generation !== renderGeneration) return;
    stopStoryMotion();
    stopJoinPlaceholder();
    stage.innerHTML = html;
    stopJoinPlaceholder = observeJoinPlaceholder(stage);
    if (nextScreen === 'home') refreshPlayingCount(stage.querySelector('#playing-count'));
    stopStoryMotion = observeStoryMotion(stage);
    hydrateAvatars(stage);
    syncTransferModalDOM();
    if (shouldTransition) stage.firstElementChild?.classList.add('vt-managed');
  };
  if (shouldTransition) document.startViewTransition(applyDOM).updateCallbackDone.then(refreshTimers, refreshTimers);
  else { applyDOM(); refreshTimers(); }
}

function render({ forceFull = false } = {}) {
  if (!state.room || state.room.phase === 'lobby') pathOpen = false;
  const nextScreen = screenKeyFor(state);
  if (nextScreen === 'home' && currentScreen !== 'home') homeSettingsOpen = false;
  syncModalScrollLock();
  const stage = ensureShell(Boolean(state.room));
  syncConnectionUI();
  syncPathModalDOM();
  document.body.dataset.scene = nextScreen;
  renderGeneration += 1;
  const generation = renderGeneration;
  const patched = !forceFull && patchSameScene(stage, nextScreen);
  if (patched) { currentScreen = nextScreen; refreshTimers(); return; }
  replaceScene(stage, nextScreen, generation);
  currentScreen = nextScreen;
}

function flushWriteQueue() {
  clearTimeout(writeDrainTimer);
  if (!socket.ready && writeQueue[0]?.type !== 'leave') { writeQueue.length = 0; return; }
  if (!writeQueue.length) return;
  const elapsed = Date.now() - lastWriteAt;
  if (elapsed < WRITE_COOLDOWN_MS) {
    writeDrainTimer = setTimeout(flushWriteQueue, WRITE_COOLDOWN_MS - elapsed);
    return;
  }
  const nextMessage = writeQueue.shift();
  if (nextMessage.type === 'updateSettings') {
    pendingLobbySettings = null;
  }
  lastWriteAt = Date.now();
  socket.send(nextMessage);
  if (writeQueue.length) {
    writeDrainTimer = setTimeout(flushWriteQueue, WRITE_COOLDOWN_MS);
  }
}

function enqueueWrite(message) {
  if (!socket.ready && message.type === 'joinRoom') { socket.send(message); return; }
  if (!socket.ready && !['leave', 'joinRoom'].includes(message.type)) { toast('连接尚未恢复，请稍后重试'); return; }
  if (message.type === 'leave') {
    writeQueue.length = 0;
    pendingLobbySettings = null;
  }
  const coalesceIndex = (message.type === 'updateSettings' || message.type === 'setReady')
    ? writeQueue.findIndex((item) => item.type === message.type)
    : -1;
  if (coalesceIndex >= 0) {
    writeQueue[coalesceIndex] = message;
  } else {
    writeQueue.push(message);
  }
  flushWriteQueue();
}

function scheduleLobbySettingsSync(nextSettings) {
  pendingLobbySettings = nextSettings;
  patchSettingsDOM(nextSettings, true);
  enqueueWrite({
    type: 'updateSettings',
    mode: nextSettings.mode,
    maxRounds: nextSettings.maxRounds,
    writeSeconds: nextSettings.writeSeconds,
    prepareSeconds: nextSettings.prepareSeconds,
    banRepeat: nextSettings.banRepeat
  });
}

const socket = new Socket({
  onConnection(status) {
    connectionStatus = status;
    if (status !== 'connected') {
      closeConfirm(false);
      clearTimeout(typingTimer);
      clearTimeout(writeDrainTimer);
      writeQueue.length = 0;
      pendingLobbySettings = null;
      gameUi.submitted = false; gameUi.voted = false; gameUi.ready = false;
    }
    syncConnectionUI();
  },
  onHello(message) {
    const code = socket.roomCode;
    if (code && !message.restored) enqueueWrite({ type: 'joinRoom', code });
  },
  onProfile(profile) {
    if (!profileOpen || historyQuery(location.search).id) return;
    state.profile = profile;
    const query = historyQuery(location.search);
    query.page = profile.page;
    history.replaceState(null, '', `${APP_ROOT}${historyHref(query)}`);
    render();
  },
  onMatchDetail(detail) {
    if (!profileOpen || historyQuery(location.search).id !== detail.id) return;
    state.matchDetail = detail;
    render({ forceFull: true });
  },
  onIdentity() {
    state.profile = null;
    if (profileOpen) requestProfile(1);
  },
  onState(next) {
    const previous = state.room;
    const nextRoom = next.room;
    const phaseChanged = previous?.code !== nextRoom?.code || previous?.phase !== nextRoom?.phase || previous?.round !== nextRoom?.round;
    if (phaseChanged) {
      closeConfirm(false);
      closeJoin();
      closeInvite();
      clearTimeout(typingTimer);
      writeQueue.splice(0, writeQueue.length, ...writeQueue.filter((item) => !['submitWord', 'vote', 'breakVote', 'ready', 'setReady'].includes(item.type)));
      gameUi = { draft: '', submitted: false, voted: false, ready: false };
      finalTypingSent = false;
      if (previous?.phase === 'voting' && nextRoom && nextRoom.phase !== 'voting') {
        const outcome = nextRoom.outcome || nextRoom.history?.at(-1)?.outcome;
        if (outcome === 'voted') toast('全票通过');
        else if (outcome === 'miss' || nextRoom.phase === 'prepare') toast('未通过');
      }
    }
    const profile = state.profile;
    state = { ...next, profile, matchDetail: state.matchDetail };
    if (nextRoom) { profileOpen = false; privacyOpen = false; state.profile = null; }
    timeOffset = Number.isFinite(next.serverNow) ? next.serverNow - Date.now() : 0;
    if (next.room) {
      socket.roomCode = next.room.code;
      if (previousRoomCode !== next.room.code) {
        renameOpen = false;
        pendingTransfer = null;
        pendingLobbySettings = null;
        lastIdleDeadline = 0;
        history.replaceState(null, '', `${APP_ROOT}?r=${next.room.code}`);
        history.pushState({ roomGuard: true }, '', location.href);
        roomHistoryGuard = true;
        previousRoomCode = next.room.code;
      }
    } else {
      socket.roomCode = '';
      roomHistoryGuard = false;
      previousRoomCode = '';
      renameOpen = false;
      pendingTransfer = null;
      pendingLobbySettings = null;
      if (!profileOpen && !privacyOpen && location.search) history.replaceState(null, '', APP_ROOT);
    }
    if (MOCK) window.dispatchEvent(new CustomEvent('synconym-mock-state', { detail: { room: next.room, uid: next.uid, mockPausedAt: next.mockPausedAt } }));
    render();
    // 名字或身份变了：档案页跟着刷新一次
    if (profileOpen) requestProfile(state.profile?.page || historyQuery(location.search).page);
  },
  onError(message) {
    if (profileOpen && !state.room && !historyQuery(location.search).id) {
      state.profileError = message;
      render();
    }
    gameUi.submitted = false;
    gameUi.voted = false;
    gameUi.ready = false;
    if (state.room) render();
    if (message.includes('密码')) markInvalid(app.querySelector(pendingJoin ? '#join-password' : '#room-password'));
    else if (/词|答案/.test(message)) markInvalid(app.querySelector('#word-input'));
    else if (/名字/.test(message)) markInvalid(app.querySelector('#player-name'));
    toast(message);
  },
  onToast: toast
});
if (MOCK) window.addEventListener('synconym-mock-action', (event) => {
  if (event.detail && typeof event.detail.action === 'string') socket.send({ ...event.detail, type: 'mockAction' });
});


render({ forceFull: true });

app.addEventListener('invalid', (event) => markInvalid(event.target), true);
app.addEventListener('input', (event) => {
  event.target.removeAttribute('aria-invalid');
  event.target.classList.remove('input-shake');
  if (event.target.id === 'history-search-input') {
    syncHistoryTimeBadge();
    if (!event.isComposing) scheduleHistorySearch(event.target.value);
  }
});

app.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!socket.ready) { toast('连接尚未恢复，请稍后重试'); return; }
  if (event.target.id === 'create-form') {
    enqueueWrite({ type: 'createRoom', ...settings });
  } else if (event.target.id === 'join-form') {
    const input = event.target.querySelector('#room-code');
    if (input) checkJoinOnInput(input, true);
  } else if (event.target.id === 'rename-form') {
    const input = app.querySelector('#player-name');
    const name = input?.value.trim() || '';
    if (!name || [...name].length > 12) { markInvalid(input); toast('请输入 1–12 个字符的名字'); return; }
    renameOpen = false;
    syncRenameModalDOM(false);
    enqueueWrite({ type: 'rename', name });
  } else if (event.target.id === 'word-form' && state.room?.phase === 'writing') {
    const input = app.querySelector('#word-input');
    if (input && !input.disabled) {
      acceptWordInput(input);
      if (!gameUi.draft.trim()) { markInvalid(input); toast('请输入 1–12 个汉字、字母或数字'); return; }
      clearTimeout(typingTimer);
      gameUi.submitted = true;
      enqueueWrite({ type: 'submitWord', word: gameUi.draft });
      render();
    }
  }
});

function applyRoomPaste(input, text) {
  const code = parseRoomCode(text);
  if (!code) {
    ++joinCheckVersion;
    toast('请输入 5 位房号或有效的邀请链接');
    markInvalid(input);
    return;
  }
  input.value = code;
  checkJoinOnInput(input, true);
}

app.addEventListener('paste', (event) => {
  if (event.target.id !== 'room-code') return;
  event.preventDefault();
  applyRoomPaste(event.target, event.clipboardData?.getData('text/plain') || '');
});

app.addEventListener('input', (event) => {
  if (event.target.id === 'room-code' && !event.isComposing) {
    const input = event.target;
    const cursor = input.selectionStart;
    const before = cursor == null ? null : sanitizeRoomInput(input.value.slice(0, cursor)).length;
    input.value = sanitizeRoomInput(input.value);
    if (before != null) input.setSelectionRange(before, before);
    checkJoinOnInput(input);
  }
  if (event.target.id === 'word-input' && !event.isComposing) acceptWordInput(event.target);
});

app.addEventListener('compositionend', (event) => {
  if (event.target.id === 'room-code') {
    event.target.value = sanitizeRoomInput(event.target.value);
    checkJoinOnInput(event.target);
  }
  if (event.target.id === 'word-input') acceptWordInput(event.target);
});

app.addEventListener('keydown', (event) => {
  if (pendingJoin) {
    if (event.key === 'Escape') { event.preventDefault(); closeJoin(); return; }
    if (event.key === 'Tab') {
      const controls = [...app.querySelectorAll('#join-modal .rename-dialog button:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (inviteTrigger) {
    if (event.key === 'Escape') { event.preventDefault(); closeInvite(); return; }
    if (event.key === 'Tab') {
      const controls = [...app.querySelectorAll('#invite-modal .rename-dialog button, #invite-link')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (pendingConfirm) {
    if (event.key === 'Escape') { event.preventDefault(); closeConfirm(false); return; }
    if (event.key === 'Tab') {
      const controls = [...app.querySelectorAll('#confirm-modal button:not(:disabled)')].filter((el) => !el.classList.contains('rename-modal-backdrop'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (event.key === 'Escape' && pathOpen) { event.preventDefault(); closePath(); return; }
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest?.('[data-action="transfer-host"]');
  if (!row || row !== event.target) return;
  event.preventDefault();
  requestTransfer(state.room?.players.find((player) => player.uid === row.dataset.uid));
});

app.addEventListener('click', async (event) => {
  const storyLink = event.target.closest('.home-story-link');
  if (storyLink && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    const target = document.querySelector('#home-story-title');
    if (target) {
      event.preventDefault();
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    }
    return;
  }
  const privacySection = event.target.closest('.privacy-nav a');
  if (privacySection && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(privacySection.hash.slice(1))?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    return;
  }

  const privacyLink = event.target.closest('[data-action="open-privacy"]');
  if (privacyLink && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    if (state.room || privacyOpen) return;
    profileOpen = false;
    privacyOpen = true;
    state.profile = null;
    history.pushState({ privacy: true }, '', `${APP_ROOT}?privacy`);
    render();
    window.scrollTo(0, 0);
    return;
  }


  const homeLink = event.target.closest('[data-action="home"]');
  if (homeLink && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    if (state.room) {
      if (await confirmLeave()) enqueueWrite({ type: 'leave' });
    } else {
      socket.roomCode = '';
      previousRoomCode = '';
      profileOpen = false;
      privacyOpen = false;
      state.profile = null;
      if (location.search) history.replaceState(null, '', APP_ROOT);
      render();
    }
    return;
  }

  const transferRow = event.target.closest('[data-action="transfer-host"]');
  if (transferRow && event.button === 0) {
    event.preventDefault();
    requestTransfer(state.room?.players.find((player) => player.uid === transferRow.dataset.uid));
    return;
  }
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.action === 'cancel-join') { closeJoin(); return; }
  if (button.dataset.action === 'confirm-join') {
    const code = pendingJoin?.code;
    closeJoin();
    if (code) enqueueWrite({ type: 'joinRoom', code });
    return;
  }
  if (button.dataset.action === 'paste-invite') {
    const input = button.closest('form')?.querySelector('#room-code');
    const text = await readClipboardText();
    if (!input?.isConnected) return;
    if (text === null) { input.focus(); toast('无法读取剪贴板，请手动粘贴邀请链接'); return; }
    applyRoomPaste(input, text);
    input.focus();
    return;
  }
  if (button.dataset.action === 'close-invite') {
    event.preventDefault();
    closeInvite();
    return;
  }

  if (button.dataset.action === 'cancel-confirm' || button.dataset.action === 'accept-confirm') {
    event.preventDefault();
    closeConfirm(button.dataset.action === 'accept-confirm');
    return;
  }

  if (button.dataset.action === 'export-chart') {
    const chart = app.querySelector('#convergence-chart');
    if (!chart) return;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(chart)], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `synconym-${state.room.code}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (button.dataset.action === 'rematch-yes' || button.dataset.action === 'rematch-room') {
    event.preventDefault();
    if (!['result', 'rematch', 'interrupted'].includes(state.room?.phase)) return;
    enqueueWrite({ type: 'rematch', choice: button.dataset.action === 'rematch-yes' ? 'rematch' : 'room' });
    button.disabled = true;
    return;
  }

  if (button.dataset.action === 'open-path') {
    event.preventDefault();
    pathTrigger = button;
    pathOpen = true;
    syncPathModalDOM(true);
    return;
  }
  if (button.dataset.action === 'close-path') {
    event.preventDefault();
    closePath();
    return;
  }

  if (button.dataset.action === 'open-profile') {
    event.preventDefault();
    openProfile();
    return;
  }
  if (button.dataset.action === 'profile-prev' || button.dataset.action === 'profile-next') {
    event.preventDefault();
    const step = button.dataset.action === 'profile-next' ? 1 : -1;
    requestProfile((state.profile?.page || 1) + step);
    return;
  }
  if (button.dataset.action === 'reset-identity') {
    event.preventDefault();
    if (await confirmAction('reset')) enqueueWrite({ type: 'resetIdentity' });
    return;
  }
  if (button.dataset.action === 'copy-uid') {
    event.preventDefault();
    if (!state.profile?.user) return;
    try { await navigator.clipboard.writeText(state.profile.user.uid); toast('UID 已复制'); }
    catch { toast('请手动复制 UID'); }
    return;
  }

  if (button.dataset.action === 'toggle-settings') {
    event.preventDefault();
    homeSettingsOpen = !homeSettingsOpen;
    syncHomeDrawerDOM();
    return;
  }

  if (button.dataset.setting) {
    event.preventDefault();
    const key = button.dataset.setting;
    const base = state.room ? (pendingLobbySettings || state.room) : settings;
    const value = coerceSettingValue(key, button.dataset.value, base);
    if (base[key] === value) return;

    if (state.room) {
      scheduleLobbySettingsSync({
        mode: base.mode,
        maxRounds: base.maxRounds,
        writeSeconds: base.writeSeconds,
        prepareSeconds: base.prepareSeconds,
        banRepeat: base.banRepeat,
        [key]: value
      });
    } else {
      settings = { ...settings, [key]: value };
      patchSettingsDOM(settings, true);
    }
    return;
  }

  if (button.dataset.step) {
    event.preventDefault();
    const step = Number(button.dataset.step);
    const base = state.room ? (pendingLobbySettings || state.room) : settings;
    const maxRounds = Math.min(20, Math.max(4, base.maxRounds + step));
    if (maxRounds === base.maxRounds) return;

    if (state.room) {
      scheduleLobbySettingsSync({
        mode: base.mode,
        maxRounds,
        writeSeconds: base.writeSeconds,
        prepareSeconds: base.prepareSeconds,
        banRepeat: base.banRepeat
      });
    } else {
      settings = { ...settings, maxRounds };
      patchSettingsDOM(settings, true);
    }
    return;
  }

  if (button.dataset.action === 'break-yes' || button.dataset.action === 'break-no') {
    event.preventDefault();
    if (state.room?.phase !== 'breakVote' || gameUi.voted) return;
    const yes = button.dataset.action === 'break-yes';
    const room = state.room;
    if (yes && !(await confirmBreakVote())) return;
    if (state.room?.phase !== 'breakVote' || state.room.code !== room.code || state.room.round !== room.round
      || state.room.phaseDeadline !== room.phaseDeadline || gameNow() >= room.phaseDeadline || !socket.ready || gameUi.voted) return;
    gameUi.voted = true;
    enqueueWrite({ type: 'breakVote', yes });
    render();
    return;
  }
  if (button.dataset.action === 'vote-yes' || button.dataset.action === 'vote-no') {
    event.preventDefault();
    if (state.room?.phase !== 'voting' || gameUi.voted) return;
    gameUi.voted = true;
    enqueueWrite({ type: 'vote', yes: button.dataset.action === 'vote-yes' });
    render();
  } else if (button.dataset.action === 'game-ready') {
    event.preventDefault();
    if (state.room?.phase !== 'prepare' || gameUi.ready) return;
    gameUi.ready = true;
    enqueueWrite({ type: 'ready' });
    render();
  } else if (button.dataset.action === 'ready') {
    event.preventDefault();
    const me = state.room?.players.find((player) => player.uid === state.uid);
    if (me) enqueueWrite({ type: 'setReady', ready: !me.ready });
  } else if (button.dataset.action === 'start') {
    event.preventDefault();
    enqueueWrite({ type: 'start' });
  } else if (button.dataset.action === 'leave') {
    event.preventDefault();
    if (await confirmLeave()) enqueueWrite({ type: 'leave' });
  } else if (button.dataset.action === 'rename') {
    event.preventDefault();
    renameOpen = !renameOpen;
    syncRenameModalDOM(renameOpen);
  } else if (button.dataset.action === 'cancel-rename') {
    event.preventDefault();
    renameOpen = false;
    syncRenameModalDOM(false);
  } else if (button.dataset.action === 'cancel-transfer') {
    event.preventDefault();
    pendingTransfer = null;
    syncTransferModalDOM();
  } else if (button.dataset.action === 'confirm-transfer') {
    event.preventDefault();
    const targetUid = pendingTransfer?.uid;
    pendingTransfer = null;
    syncTransferModalDOM();
    if (targetUid) enqueueWrite({ type: 'transferHost', uid: targetUid });
  } else if (button.dataset.action === 'copy') {
    event.preventDefault();
    if (!state.room) return;
    const url = `${MOCK ? location.origin + APP_ROOT : `${state.publicUrl || location.origin}/`}?r=${state.room.code}`;
    if (await copyText(url)) {
      button.classList.add('copied');
      setTimeout(() => button.classList.remove('copied'), 600);
      toast('邀请链接已复制');
    } else {
      openInvite(url, button);
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (pendingTransfer) {
    pendingTransfer = null;
    syncTransferModalDOM();
    return;
  }
  if (renameOpen) {
    renameOpen = false;
    syncRenameModalDOM(false);
  }
});

setInterval(() => {
  if (!document.hidden) refreshPlayingCount(app.querySelector('#playing-count'));
}, 30000);
