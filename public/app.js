import { Socket } from './ws.js';
import { homeMarkup, lobbyMarkup, writingMarkup } from './render.js';

const app = document.querySelector('#app');
const toastElement = document.querySelector('#toast');
let state = { room: null };
let settings = { mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true };
let toastTimer;
let previousRoomCode = '';
let phase;
let timeOffset = 0;
let countdownTimer;

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
    if (element) element.textContent = `${seconds} 秒`;
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

function render() {
  const nextPhase = state.room?.phase;
  const html = state.room ? (nextPhase === 'lobby' ? lobbyMarkup(state) : writingMarkup(state)) : homeMarkup(settings);
  const update = () => { app.innerHTML = html; };
  if (phase !== nextPhase && document.startViewTransition) document.startViewTransition(update);
  else update();
  phase = nextPhase;
  updateCountdown();
}

const socket = new Socket({
  onHello(message) {
    const code = socket.roomCode;
    if (code && !message.restored) socket.send({ type: 'joinRoom', code });
  },
  onState(next) {
    state = next;
    timeOffset = next.serverNow - Date.now();
    if (next.room) {
      socket.roomCode = next.room.code;
      if (previousRoomCode !== next.room.code) {
        history.replaceState(null, '', `/?r=${next.room.code}`);
        previousRoomCode = next.room.code;
      }
    } else {
      socket.roomCode = '';
      previousRoomCode = '';
      history.replaceState(null, '', '/');
    }
    render();
  },
  onError: toast,
  onToast: toast
});

app.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'create-form') socket.send({ type: 'createRoom', ...settings });
  if (event.target.id === 'join-form') socket.send({ type: 'joinRoom', code: new FormData(event.target).get('code').toUpperCase() });
  if (event.target.id === 'rename-form') socket.send({ type: 'rename', name: document.querySelector('#player-name').value });
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
      socket.send({ type: 'leave' });
    } else {
      socket.roomCode = '';
      previousRoomCode = '';
      history.replaceState(null, '', '/');
      render();
    }
    return;
  }
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.setting) {
    const key = button.dataset.setting;
    const target = state.room || settings;
    const value = key === 'banRepeat' ? !target.banRepeat : button.dataset.value;
    if (state.room) socket.send({ type: 'updateSettings', ...state.room, [key]: value });
    else { settings[key] = value; render(); }
  } else if (button.dataset.step) {
    const target = state.room || settings;
    const maxRounds = target.maxRounds + Number(button.dataset.step);
    if (state.room) socket.send({ type: 'updateSettings', ...state.room, maxRounds });
    else {
      const value = document.querySelector('#rounds');
      value?.classList.add('changing');
      setTimeout(() => {
        settings.maxRounds = maxRounds;
        render();
        const next = document.querySelector('#rounds');
        next?.classList.add('entering');
        requestAnimationFrame(() => requestAnimationFrame(() => next?.classList.remove('entering')));
      }, 180);
    }
  } else if (button.dataset.action === 'ready') {
    const me = state.room.players.find((player) => player.uid === state.uid);
    socket.send({ type: 'setReady', ready: !me.ready });
  } else if (button.dataset.action === 'start') {
    socket.send({ type: 'start' });
  } else if (button.dataset.action === 'leave') {
    socket.send({ type: 'leave' });
  } else if (button.dataset.action === 'rename') {
    const form = document.querySelector('#rename-form');
    form.hidden = !form.hidden;
    if (!form.hidden) { form.querySelector('input').focus(); form.querySelector('input').select(); }
  } else if (button.dataset.action === 'copy') {
    const url = `${state.publicUrl || location.origin}/?r=${state.room.code}&inviter=${state.uid}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('邀请链接已复制');
    } catch {
      toast('请复制浏览器地址栏中的邀请链接');
    }
  }
});
