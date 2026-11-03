import { avatarDetails, homeMarkup, lobbyMarkup, resultMarkup, shellMarkup, writingMarkup } from '/render.js';

const settings = { mode: 'free', maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true };
const players = [
  { uid: 'a', name: '迷人的橙子', seat: 0, connected: true, ready: true, submitted: true, voted: true },
  { uid: 'b', name: '狡猾的蘑菇', seat: 1, connected: true, typing: true },
  { uid: 'c', name: '快乐的苹果', seat: 2, connected: false },
  { uid: 'd', name: '温柔的柠檬', seat: 3, connected: true, ready: true }
];
const history = [
  { n: 1, words: { a: '海洋', b: '天空', c: '森林', d: '云朵' }, marks: {}, outcome: 'miss', votes: { a: true, b: false, c: false, d: true } },
  { n: 2, words: { a: '蓝色', b: '大海', c: '天空', d: '海浪' }, marks: {}, outcome: 'miss', votes: { a: true, b: true, d: false } }
];
const scenes = [
  ['home', '首页'], ['home-settings', '首页 · 展开设置'],
  ['lobby-host', '等待大厅 · 房主'], ['lobby-player', '等待大厅 · 玩家'],
  ['writing', '写词'], ['writing-submitted', '写词 · 已提交'],
  ['voting', '投票'], ['voting-voted', '投票 · 已投票'],
  ['prepare', '准备下一轮'], ['prepare-ready', '准备下一轮 · 已准备'],
  ['breakVote', '崩局投票'], ['breakVote-voted', '崩局投票 · 已投票'],
  ['result-exact', '结算 · 精确相遇'], ['result-voted', '结算 · 投票相遇'],
  ['result-none', '结算 · 未相遇'], ['result-break', '结算 · 崩局'],
  ['rematch', '结算 · 重赛选择'], ['interrupted', '对局中断']
];
const select = document.querySelector('#mock-scene');
const app = document.querySelector('#app');
for (const [value, label] of scenes) select.add(new Option(label, value));

function roomFor(scene) {
  const phase = scene.startsWith('writing') ? 'writing' : scene.startsWith('voting') ? 'voting'
    : scene.startsWith('prepare') ? 'prepare' : scene.startsWith('breakVote') ? 'breakVote'
    : scene.startsWith('lobby') ? 'lobby' : scene === 'interrupted' ? 'interrupted'
    : scene === 'rematch' ? 'rematch' : 'result';
  const outcome = scene === 'result-exact' ? 'exact' : scene === 'result-voted' || scene === 'rematch' ? 'voted' : scene === 'result-break' ? 'break' : 'none';
  const resultHistory = [...history, { n: 3, words: { a: '海边', b: '海边', c: '海风', d: '海边' }, marks: {}, outcome: outcome === 'exact' ? 'exact' : outcome === 'voted' ? 'voted' : 'miss', votes: { a: true, b: true, d: true } }];
  const roomPlayers = players.map((p) => ({ ...p }));
  if (phase === 'writing') roomPlayers[0].submitted = scene === 'writing-submitted';
  if (phase === 'voting') roomPlayers[0].voted = scene === 'voting-voted';
  if (phase === 'prepare') roomPlayers[0].ready = scene === 'prepare-ready';
  if (phase === 'breakVote') roomPlayers[0].breakVoted = scene === 'breakVote-voted';
  return { ...settings, code: '12345', phase, round: 3, hostUid: scene === 'lobby-player' ? 'b' : 'a',
    players: roomPlayers, resultPlayers: players.map((p) => ({ ...p })), outcome,
    history: ['result', 'rematch'].includes(phase) ? resultHistory : history,
    words: resultHistory[2].words, marks: {}, chart: [{ n: 1, similarity: .2 }, { n: 2, similarity: .5 }, { n: 3, similarity: outcome === 'exact' || outcome === 'voted' ? 1 : .65 }],
    rematchDeadline: Date.now() + 30000, rematchEligibleUids: ['a', 'b', 'c', 'd'],
    rematchVotes: scene === 'rematch' ? { a: 'rematch', b: 'room', c: 'rematch' } : {},
    idleDeadline: Date.now() + 300000 };
}

function hydrateAvatars() {
  const colors = [['#3154C7', '#E8EEFF'], ['#B94735', '#FFF0EC'], ['#187A61', '#E8F8F1'], ['#7447B8', '#F3ECFF']];
  for (const image of app.querySelectorAll('img.avatar[data-avatar-name]')) {
    const { initial, tone } = avatarDetails(image.dataset.avatarName);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 152;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = colors[tone][1]; ctx.fillRect(0, 0, 152, 152);
    ctx.fillStyle = colors[tone][0]; ctx.font = 'bold 64px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initial.toUpperCase(), 76, 80);
    image.src = canvas.toDataURL();
  }
}

function render(scene) {
  const room = roomFor(scene);
  const isHome = scene.startsWith('home');
  const state = { uid: 'a', user: { uid: 'a', name: players[0].name }, room };
  document.body.dataset.scene = isHome ? 'home' : ['result', 'rematch', 'interrupted'].includes(room.phase) ? 'result' : room.phase;
  app.innerHTML = shellMarkup(!isHome, state.user);
  const stage = app.querySelector('#stage');
  stage.innerHTML = isHome ? homeMarkup(settings, scene === 'home-settings') : room.phase === 'lobby' ? lobbyMarkup(state)
    : ['result', 'rematch', 'interrupted'].includes(room.phase) ? resultMarkup(state) : writingMarkup(state);
  const countdown = app.querySelector('#countdown');
  if (countdown) countdown.textContent = '23 秒';
  const idle = app.querySelector('#idle-countdown');
  if (idle) idle.textContent = '4:32';
  hydrateAvatars();
}
const requested = new URL(location.href).searchParams.get('scene');
select.value = scenes.some(([value]) => value === requested) ? requested : 'home';
select.addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('scene', select.value);
  window.history.replaceState(null, '', url);
  render(select.value);
});
// Preview controls are deliberately inert; they must not act on a real room.
app.addEventListener('click', (event) => event.preventDefault());
app.addEventListener('submit', (event) => event.preventDefault());
render(select.value);
