import { Socket } from './ws.js';
import {
  avatarDetails,
  homeMarkup,
  icon,
  lobbyMarkup,
  playerItemMarkup,
  settingsSummaryText,
  shellMarkup,
  writingMarkup
} from './render.js';

const NUMERIC_SETTINGS = new Set(['maxRounds', 'writeSeconds', 'prepareSeconds']);
const WRITE_COOLDOWN_MS = 520;

const app = document.querySelector('#app');
const toastElement = document.querySelector('#toast');

let state = { room: null };
let settings = {
  mode: 'free',
  maxRounds: 12,
  writeSeconds: 45,
  prepareSeconds: 30,
  banRepeat: true
};
let homeSettingsOpen = false;
let renameOpen = false;
let toastTimer;
let previousRoomCode = '';
let currentScreen = '';
let timeOffset = 0;
let countdownTimer;
let stepperAnimTimer;
let lastWriteAt = 0;
let writeDrainTimer;
const writeQueue = [];
let pendingLobbySettings = null;

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
    const seconds = Math.max(0, Math.ceil((state.room.phaseDeadline - (Date.now() + timeOffset)) / 1000));
    const element = document.querySelector('#countdown');
    if (element) {
      element.textContent = `${seconds} 秒`;
      element.parentElement?.classList.toggle('urgent', seconds <= 10);
    }
  };
  tick();
  countdownTimer = setInterval(tick, 250);
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
  if (!section) return false;
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

function syncRenameModalDOM(focusInput = false) {
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

function patchHeaderDOM(inRoom) {
  const user = state.user;
  const headerUser = app.querySelector('#header-user');
  if (headerUser) {
    headerUser.classList.toggle('is-visible', Boolean(user));
    const avatar = headerUser.querySelector('.header-avatar');
    const name = headerUser.querySelector('#header-user-name');
    if (avatar) {
      const details = avatarDetails(user?.name);
      const glyph = avatar.querySelector('.avatar-glyph text');
      if (glyph) {
        glyph.textContent = details.initial;
        glyph.setAttribute('dy', details.glyphDy);
      }
      avatar.dataset.avatarTone = String(details.tone);
    }
    if (name) name.textContent = user?.name || '';
  }
  const leaveBtn = app.querySelector('#header-leave');
  if (leaveBtn) {
    leaveBtn.classList.toggle('is-visible', inRoom);
    leaveBtn.toggleAttribute('inert', !inRoom);
    if (inRoom) leaveBtn.removeAttribute('tabindex');
    else leaveBtn.setAttribute('tabindex', '-1');
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
  const canStart = host && room.players.length >= 2 && room.players.every((player) => player.ready && player.connected);

  const codeEl = page.querySelector('#lobby-room-code');
  if (codeEl) codeEl.textContent = room.code;

  const countEl = page.querySelector('#player-count');
  if (countEl) countEl.textContent = `${room.players.length} / 4`;

  const list = page.querySelector('#player-list');
  if (list) {
    const firstRects = new Map();
    for (const item of list.querySelectorAll('.player[data-uid]')) {
      firstRects.set(item.dataset.uid, item.getBoundingClientRect());
    }

    const activeElementId = document.activeElement?.id;
    list.innerHTML = room.players.map((player) => playerItemMarkup(player, room, uid)).join('');

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

  const settingsHeading = page.querySelector('.settings-block .section-heading');
  if (settingsHeading) {
    const existingTag = settingsHeading.querySelector('.readonly-tag');
    if (!host && !existingTag) {
      settingsHeading.insertAdjacentHTML('beforeend', '<span class="readonly-tag">房主可改</span>');
    } else if (host && existingTag) {
      existingTag.remove();
    }
  }

  const effectiveSettings = pendingLobbySettings && host ? pendingLobbySettings : room;
  patchSettingsDOM(effectiveSettings, host);

  const actions = page.querySelector('#lobby-actions');
  if (actions) {
    const readyBtn = actions.querySelector('[data-action="ready"]');
    if (readyBtn && me) {
      readyBtn.className = `button ${me.ready ? 'secondary' : 'primary'} ready-button`;
      readyBtn.innerHTML = me.ready ? `${icon('x')}<span>取消准备</span>` : `${icon('check')}<span>准备</span>`;
    }
    let startBtn = actions.querySelector('[data-action="start"]');
    if (host) {
      if (!startBtn) {
        actions.insertAdjacentHTML(
          'beforeend',
          `<button class="button primary start-button" type="button" data-action="start" ${canStart ? '' : 'disabled'}>${icon('play')}<span>开始</span></button>`
        );
      } else {
        startBtn.disabled = !canStart;
      }
    } else if (startBtn) {
      startBtn.remove();
    }
  }

  return true;
}

function screenKeyFor(nextState) {
  if (!nextState.room) return 'home';
  return nextState.room.phase === 'lobby' ? 'lobby' : 'writing';
}

function buildScreenMarkup(screen) {
  if (screen === 'home') return homeMarkup(settings, homeSettingsOpen);
  if (screen === 'lobby') return lobbyMarkup(state, renameOpen);
  return writingMarkup(state);
}

function ensureShell(inRoom) {
  let stage = app.querySelector('#stage');
  if (!stage) {
    app.innerHTML = shellMarkup(inRoom, state.user, renameOpen);
    stage = app.querySelector('#stage');
  }
  patchHeaderDOM(inRoom);
  return stage;
}

function render({ forceFull = false } = {}) {
  const nextScreen = screenKeyFor(state);
  const inRoom = Boolean(state.room);
  const stage = ensureShell(inRoom);

  if (!forceFull && nextScreen === currentScreen) {
    if (nextScreen === 'home' && patchSettingsDOM(settings, true)) {
      syncHomeDrawerDOM();
      return;
    }
    if (nextScreen === 'lobby' && patchLobbyDOM(state)) {
      syncRenameModalDOM(false);
      return;
    }
  }

  const html = buildScreenMarkup(nextScreen);
  const shouldTransition = Boolean(
    currentScreen &&
    currentScreen !== nextScreen &&
    document.startViewTransition &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const applyDOM = () => {
    stage.innerHTML = html;
    if (shouldTransition) {
      stage.firstElementChild?.classList.add('vt-managed');
    }
  };

  if (shouldTransition) {
    document.startViewTransition(applyDOM);
  } else {
    applyDOM();
  }

  currentScreen = nextScreen;
  updateCountdown();
}

function flushWriteQueue() {
  clearTimeout(writeDrainTimer);
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
  onHello(message) {
    const code = socket.roomCode;
    if (code && !message.restored) enqueueWrite({ type: 'joinRoom', code });
  },
  onState(next) {
    state = next;
    timeOffset = next.serverNow - Date.now();
    if (next.room) {
      socket.roomCode = next.room.code;
      if (previousRoomCode !== next.room.code) {
        renameOpen = false;
        pendingLobbySettings = null;
        history.replaceState(null, '', `/?r=${next.room.code}`);
        previousRoomCode = next.room.code;
      }
    } else {
      socket.roomCode = '';
      previousRoomCode = '';
      renameOpen = false;
      pendingLobbySettings = null;
      if (location.search) history.replaceState(null, '', '/');
    }
    render();
  },
  onError(message) {
    pendingLobbySettings = null;
    if (state.room) render();
    toast(message);
  },
  onToast: toast
});

render({ forceFull: true });

app.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'create-form') {
    enqueueWrite({ type: 'createRoom', ...settings });
  } else if (event.target.id === 'join-form') {
    const code = String(new FormData(event.target).get('code') || '').trim().toUpperCase();
    if (code) enqueueWrite({ type: 'joinRoom', code });
  } else if (event.target.id === 'rename-form') {
    const input = app.querySelector('#player-name');
    const name = input?.value.trim() || '';
    if (!name) return;
    renameOpen = false;
    syncRenameModalDOM(false);
    enqueueWrite({ type: 'rename', name });
  }
});

app.addEventListener('input', (event) => {
  if (event.target.id === 'room-code') {
    event.target.value = event.target.value.toUpperCase().replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, '').slice(0, 4);
  }
});

app.addEventListener('click', async (event) => {
  const homeLink = event.target.closest('[data-action="home"]');
  if (homeLink && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    if (state.room) {
      enqueueWrite({ type: 'leave' });
    } else {
      socket.roomCode = '';
      previousRoomCode = '';
      if (location.search) history.replaceState(null, '', '/');
      render();
    }
    return;
  }

  const button = event.target.closest('button');
  if (!button || button.disabled) return;

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

  if (button.dataset.action === 'ready') {
    event.preventDefault();
    const me = state.room?.players.find((player) => player.uid === state.uid);
    if (me) enqueueWrite({ type: 'setReady', ready: !me.ready });
  } else if (button.dataset.action === 'start') {
    event.preventDefault();
    enqueueWrite({ type: 'start' });
  } else if (button.dataset.action === 'leave') {
    event.preventDefault();
    enqueueWrite({ type: 'leave' });
  } else if (button.dataset.action === 'rename') {
    event.preventDefault();
    renameOpen = !renameOpen;
    syncRenameModalDOM(renameOpen);
  } else if (button.dataset.action === 'cancel-rename') {
    event.preventDefault();
    renameOpen = false;
    syncRenameModalDOM(false);
  } else if (button.dataset.action === 'copy') {
    event.preventDefault();
    if (!state.room) return;
    const url = `${state.publicUrl || location.origin}/?r=${state.room.code}&inviter=${state.uid}`;
    button.classList.add('copied');
    setTimeout(() => button.classList.remove('copied'), 600);
    try {
      await navigator.clipboard.writeText(url);
      toast('邀请链接已复制');
    } catch {
      toast('请复制浏览器地址栏中的邀请链接');
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && renameOpen) {
    renameOpen = false;
    syncRenameModalDOM(false);
  }
});
