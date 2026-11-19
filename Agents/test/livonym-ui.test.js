import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  livonymMarkup, livonymResultMarkup, livonymRoundReason, livonymRoundMax, stageProgressMarkup, matchDetailMarkup, lobbyMarkup,
  profileMatchMarkup, canStartRoom, roomPlayerLimits, resultTitle, qaMarkup, shellMarkup, startCountdownMarkup
} from '../../public/render.js';
import { insaneMarkup, insanePreviewMarkup } from '../../public/insane.js';
import { cleanDescribe, describeContainsSecret, DESCRIBE_LIMIT } from '../../public/livonym.js';

const players = [
  { uid: 'U1', name: '甲', seat: 0 },
  { uid: 'U2', name: '乙', seat: 1 },
  { uid: 'U3', name: '丙', seat: 2 }
];

const modeDetails = {
  secret: '高压锅', describerUid: 'U1', guesserCount: 2, aborted: false,
  guesses: { U2: { order: 1, atMs: 4200 } },
  points: { U2: 3, U1: 1 }
};

function roomState(phase, overrides = {}) {
  return {
    uid: 'U1',
    room: {
      code: '12345', mode: 'livonym', phase, round: 1, maxRounds: 12,
      describeSeconds: 45, roundsPerPlayer: 1,
      players, history: [], outcome: 'played',
      livonym: {
        order: ['U1', 'U2', 'U3'], index: 0, totalRounds: 3,
        describerUid: 'U1', describerName: '甲',
        secret: '高压锅', streamText: '', streamRev: 0,
        guessed: [], guesserCount: 2,
        scores: { U1: 1, U2: 3, U3: 0 }, roundPoints: { U2: 3, U1: 1 }
      },
      ...overrides
    }
  };
}

test('出题人视图给出秘密词与多行描述框，且不带 maxlength', () => {
  const html = livonymMarkup(roomState('lvPlay'));
  assert.match(html, /data-screen="lvPlay"/);
  assert.match(html, /id="livonym-secret"[^>]*>高压锅</);
  assert.match(html, /<textarea id="describe-input" class="input livonym-describe-input"[^>]*rows="1"/);
  assert.doesNotMatch(html, /id="describe-input"[^>]*maxlength/);
  assert.match(html, /写出谜底会被拦下；可以分行/);
  assert.match(html, /id="livonym-guessed"/);
  assert.match(html, /已猜中/);
  // 出题人没有抢答框
  assert.doesNotMatch(html, /id="guess-form"/);
});

test('竞猜者视图只看得到流式文本与抢答框', () => {
  const state = roomState('lvPlay');
  state.uid = 'U2';
  const html = livonymMarkup(state);
  assert.match(html, /id="livonym-stream"/);
  assert.match(html, /id="livonym-stream-text"/);
  assert.match(html, /id="guess-form"/);
  assert.match(html, /id="guess-input"/);
  assert.doesNotMatch(html, /id="livonym-secret"/);
  assert.doesNotMatch(html, /id="describe-input"/);
});

test('猜中列表为每位竞猜者留一行空态：头像在名字前，名次用短横，用时对齐在名字后，右端是本轮加分', () => {
  const state = roomState('lvPlay');
  state.room.livonym.guessed = [
    { uid: 'U2', name: '乙', order: 1, atMs: 4200, points: 3 },
    { uid: 'U4', name: '丁', order: 2, atMs: 6100, points: 2 },
    { uid: 'U5', name: '戊', order: 3, atMs: 9000, points: 1 }
  ];
  state.room.livonym.guessers = [
    { uid: 'U3', name: '丙' }, { uid: 'U2', name: '乙' }, { uid: 'U4', name: '丁' }, { uid: 'U5', name: '戊' }
  ];
  const html = livonymMarkup(state);
  const list = html.match(/<ol id="livonym-guessed"[^>]*>([\s\S]*?)<\/ol>/)[1];
  const rows = list.split('<li class="livonym-guessed-item').slice(1).map((chunk) => {
    const identity = chunk.match(/(<span class="player-identity livonym-guessed-name">[\s\S]*?)<span class="livonym-guessed-time">/)[1];
    return {
      className: `livonym-guessed-item${chunk.match(/^([^"]*)"/)[1]}`,
      uid: chunk.match(/data-uid="([^"]*)"/)[1],
      rank: chunk.match(/livonym-guessed-rank">([^<]*)</)[1],
      name: identity.match(/player-identity-name">([^<]*)</)[1],
      tags: [...identity.matchAll(/badge me-label">([^<]*)</g)].map(([, tag]) => tag),
      avatar: /class="avatar player-identity-avatar"/.test(identity),
      time: chunk.match(/livonym-guessed-time">([^<]*)</)[1],
      dataPoints: chunk.match(/data-points="([^"]*)"/)[1],
      gain: chunk.match(/--gain:([\d.]+)/)[1],
      label: chunk.match(/--gain-glow:[^"]*">([^<]*)</)[1]
    };
  });
  // 猜中的人按名次排在最上面，其余按名单顺序留空态；前三名带金银铜类名
  // 3 人局本轮天花板取 3 分（竞猜者第一名），所以 3/2/1 分的占比是 1.00/0.67/0.33
  assert.deepEqual(rows, [
    { className: 'livonym-guessed-item is-guessed is-first', uid: 'U2', rank: '1', name: '乙', tags: [], avatar: true, time: '4.2s', dataPoints: '3', gain: '1.00', label: '+3' },
    { className: 'livonym-guessed-item is-guessed is-second', uid: 'U4', rank: '2', name: '丁', tags: [], avatar: true, time: '6.1s', dataPoints: '2', gain: '0.67', label: '+2' },
    { className: 'livonym-guessed-item is-guessed is-third', uid: 'U5', rank: '3', name: '戊', tags: [], avatar: true, time: '9.0s', dataPoints: '1', gain: '0.33', label: '+1' },
    { className: 'livonym-guessed-item is-pending', uid: 'U3', rank: '–', name: '丙', tags: [], avatar: true, time: '–', dataPoints: '0', gain: '0.00', label: '+0' }
  ]);
  // 计数只算已猜中的人
  assert.match(html, /id="livonym-guessed-count">3</);

  // 自己的空态行也挂上大厅同款「你」标签，而不是拼在名字后面
  state.uid = 'U3';
  assert.match(livonymMarkup(state), /<span class="player-identity livonym-guessed-name">[\s\S]*?<span class="player-identity-name">丙<\/span><span class="badge me-label">你<\/span><\/span><span class="livonym-guessed-time">–<\/span><span class="livonym-gain" data-points="0"/);
});

test('加分强度按本轮天花板取比例：8 人局出题人 +6 才是满格', () => {
  // 8 人局：7 位竞猜者全中时出题人归零，最高 6 分，因此天花板是 6
  assert.equal(livonymRoundMax(2), 3);
  assert.equal(livonymRoundMax(7), 6);
  assert.equal(livonymRoundMax(8), 7);

  const state = roomState('lvPlay');
  state.room.livonym.guesserCount = 7;
  state.room.livonym.guessed = [
    { uid: 'U2', name: '乙', order: 1, atMs: 4200, points: 3 },
    { uid: 'U4', name: '丁', order: 2, atMs: 6100, points: 2 }
  ];
  state.room.livonym.guessers = [{ uid: 'U2', name: '乙' }, { uid: 'U4', name: '丁' }];
  const play = livonymMarkup(state);
  // 同样 +3：3 人局是满格 1.00，8 人局只有一半
  assert.match(play, /data-points="3" style="--gain:0\.50;--gain-pct:68%;--gain-glow:25%">\+3</);
  assert.doesNotMatch(play, /--gain:1\.00;--gain-pct:100%/);

  const scoreState = roomState('lvScore');
  scoreState.room.livonym.scores = { U1: 6, U2: 3 };
  scoreState.room.history = [{
    n: 1, outcome: 'played',
    modeDetails: { ...modeDetails, guesserCount: 7, points: { U1: 6, U2: 3 } }
  }];
  const score = livonymMarkup(scoreState);
  // 出题人 +6 拿满，竞猜者 +3 只有一半
  assert.match(score, /data-points="6" style="--gain:1\.00;--gain-pct:100%;--gain-glow:50%">\+6</);
  assert.match(score, /data-points="3" style="--gain:0\.50;--gain-pct:68%;--gain-glow:25%">\+3</);
  assert.match(score, /本轮满分 6 分/);
});

test('加分字样的强弱由占比驱动，前三名共金银铜', () => {
  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const item = styles.match(/\.livonym-guessed-item \{[\s\S]*?\n\}/)[0];
  assert.match(item, /grid-template-columns: 24px minmax\(0, 1fr\) 4.6ch auto;/);
  // 头像尺寸跟着名字的字号走，换到更小的行也不突出一截
  assert.match(styles, /\.player-identity \.player-identity-avatar \{ width: 1\.3em; height: 1\.3em;/);
  assert.match(styles, /\.livonym-guessed-time \{ white-space: nowrap; \}/);
  // 字号与浓度都跟着 --gain 走，不再按 1/2/3 分写死档位
  assert.match(styles, /\.livonym-gain \{[\s\S]*?--gain: 0;[\s\S]*?font-size: calc\(14px \+ 6px \* var\(--gain\)\);[\s\S]*?color: color-mix\(in srgb, var\(--gain-ink\) var\(--gain-pct\), var\(--muted\)\);/);
  assert.doesNotMatch(styles, /\.livonym-gain\[data-points="[123]"\]/);
  assert.match(styles, /\.livonym-gain\[data-points="0"\] \{ font-size: 14px; font-weight: 500; color: var\(--muted\);/);
  // 金银铜变量与前三名规则，122、123 与终局总分榜共用
  for (const medal of ['gold', 'silver', 'bronze']) assert.match(styles, new RegExp(`--medal-${medal}: #`));
  assert.match(styles, /:is\(\.livonym-guessed-item, \.livonym-score-row, \.livonym-result-row\)\.is-first \{ --medal: var\(--medal-gold\); \}/);
  assert.match(styles, /:is\(\.livonym-guessed-item, \.livonym-score-row, \.livonym-result-row\)\.is-third \{ --medal: var\(--medal-bronze\); \}/);
  // 空态短横上抬 1px：24px 高的圈底部让出 2px
  assert.match(styles, /\.livonym-guessed-item\.is-pending \.livonym-guessed-rank \{[\s\S]*?padding-bottom: 2px;/);
});

test('123 结算：名字前有排名，前三名上金银铜，本轮加分挂在总分右上角', () => {
  const state = roomState('lvScore');
  state.room.livonym.scores = { U1: 2, U2: 7, U3: 4 };
  state.room.history = [{
    n: 1, outcome: 'played',
    modeDetails: { ...modeDetails, points: { U1: 2, U2: 3, U3: 1 } }
  }];
  const html = livonymMarkup(state);
  const rows = html.split('<li class="livonym-score-row').slice(1).map((chunk) => {
    const head = chunk.match(/^([^"]*)" data-uid="([^"]*)" data-prev-rank="(\d+)">/);
    const identity = chunk.match(/<span class="player-identity livonym-score-name">([\s\S]*?)<span class="livonym-score-total">/)[1];
    return {
      className: `livonym-score-row${head[1]}`,
      uid: head[2],
      prevRank: head[3],
      rank: chunk.match(/livonym-score-rank">(\d+)</)[1],
      name: identity.match(/player-identity-name">([^<]*)</)[1],
      tags: [...identity.matchAll(/badge me-label">([^<]*)</g)].map(([, tag]) => tag),
      avatar: /player-identity-avatar/.test(identity),
      total: chunk.match(/livonym-score-total"><strong>(\d+)</)[1],
      dataPoints: chunk.match(/data-points="([^"]*)"/)[1],
      gain: chunk.match(/--gain:([\d.]+)/)[1],
      label: chunk.match(/--gain-glow:[^"]*">([^<]*)</)[1]
    };
  });
  // 按总分排名：乙 7 分第一（金）、丙 4 分第二（银）、甲 2 分第三（铜）；3 人局天花板 3 分
  // 上一轮名次由「总分 - 本轮得分」倒推：乙 4、丙 3、甲 0 → 乙/丙/甲
  assert.deepEqual(rows.map(({ prevRank, rank, total, dataPoints, gain, label }) => ({ prevRank, rank, total, dataPoints, gain, label })), [
    { prevRank: '1', rank: '1', total: '7', dataPoints: '3', gain: '1.00', label: '+3' },
    { prevRank: '2', rank: '2', total: '4', dataPoints: '1', gain: '0.33', label: '+1' },
    { prevRank: '3', rank: '3', total: '2', dataPoints: '2', gain: '0.67', label: '+2' }
  ]);
  // 每行都先给头像；「你」与「出题」是两枚大厅同款标签，不再拼成名字里的括注或单独的胶囊
  assert.ok(rows.every((row) => row.avatar));
  assert.deepEqual(rows.map(({ tags }) => tags), [[], [], ['你', '出题']]);
  assert.match(rows[0].className, /is-first/);
  assert.match(rows[1].className, /is-second/);
  assert.match(rows[2].className, /is-third/);
  // 「本轮 +x」那列已经删掉，加分只在总分右上角出现一次
  assert.doesNotMatch(html, /livonym-score-round|本轮 \+/);
});

test('准备阶段只让出题人看词，结算阶段全员看词', () => {
  const describer = livonymMarkup(roomState('lvIntro'));
  assert.match(describer, /id="livonym-secret"/);
  // 准备阶段只看秘密词，描述卡片等正式出题才出现
  assert.doesNotMatch(describer, /id="describe-input"|describe-form|describe-count/);

  // 121 对竞猜者是同一套骨架：词块还在，但只有遮起来的占位，没有真词
  const guesserState = roomState('lvIntro');
  guesserState.uid = 'U2';
  const guesser = livonymMarkup(guesserState);
  assert.match(guesser, /本轮秘密词/);
  assert.match(guesser, /只有出题人看得到/);
  assert.match(guesser, /class="livonym-secret is-locked"/);
  assert.doesNotMatch(guesser, /id="livonym-secret"|高压锅/);
  assert.match(guesser, /data-action="leave"/);

  const scoreState = roomState('lvScore');
  scoreState.room.history = [{ n: 1, outcome: 'played', modeDetails }];
  const score = livonymMarkup(scoreState);
  assert.match(score, /本轮结算/);
  assert.match(score, /1 人猜中/);
  assert.match(score, /本轮满分 3 分/);
  assert.match(score, /id="livonym-scores"/);
});

test('阶段条对即时竞猜换成描述与抢猜', () => {
  const html = stageProgressMarkup('lvPlay');
  assert.match(html, /描述 \/ 抢猜/);
  assert.doesNotMatch(html, /写词/);
  assert.doesNotMatch(html, /投票/);
});

test('模式行只有英文艺术字，没有胶囊外壳', () => {
  const state = roomState('lobby');
  state.room.hostUid = 'U1';
  const html = lobbyMarkup(state);
  assert.match(html, /class="livonym-mode" role="img" aria-label="即时竞猜"/);
  assert.match(html, /class="mode-wordmark"[^>]*><span class="wm-livonym"/);
  assert.match(html, /class="live-char/);
  // 不再有中文名：语义只由容器的 aria-label 承担
  assert.doesNotMatch(html, /livonym-mode-name/, '模式行不该再有中文名');
  assert.match(html, /aria-hidden="true"><span class="wm-livonym"/);

  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const block = css.match(/\.livonym-mode \{[^}]*\}/)[0];
  assert.doesNotMatch(block, /background:/, '不要胶囊底色');
  assert.doesNotMatch(block, /border-radius/, '不要胶囊圆角');
  // 字形与狂意页一致：同样的字号、字重与字距
  const wordmark = css.match(/\.livonym-mode \.mode-wordmark \{[\s\S]*?\n\}/)[0];
  for (const rule of ['font-size: 20px', 'font-weight: 700', 'letter-spacing: -.015em', 'white-space: nowrap']) {
    assert.ok(wordmark.includes(rule), `艺术字缺少 ${rule}`);
  }
  // 配色与动效都沿用狂意页那一套，不在房间另起一套
  assert.doesNotMatch(css, /\.livonym-mode \.wm-livonym \{/, '不该覆盖字标配色');
  assert.doesNotMatch(css, /\.livonym-mode \.live-i::before \{ background/, '不该覆盖绿点');
  assert.match(css, /\.livonym-mode \.live-char \{ animation: live-type/);
  assert.match(css, /\.livonym-mode \.live-i::before \{ animation: live-dot/);
  assert.doesNotMatch(css, /\.livonym-mode:is\(:hover/, '不该再挂 hover 条件');
});

test('得分原因与计分规则一致', () => {
  assert.equal(livonymRoundReason(modeDetails), '1 人猜中');
  assert.equal(livonymRoundReason({ ...modeDetails, guesses: {} }), '没人猜中');
  assert.equal(livonymRoundReason({ ...modeDetails, guesses: { U2: { order: 1 }, U3: { order: 2 } } }), '全都猜中了');
  assert.equal(livonymRoundReason(null), '');
});

test('结算给出总分、称号与逐棒回顾', () => {
  const state = roomState('result');
  state.uid = 'U2';
  state.room.resultPlayers = players;
  state.room.history = [{ n: 1, outcome: 'played', modeDetails }];
  const html = livonymResultMarkup(state);
  assert.match(html, /总分/);
  // 总分前三名保留可见名次数字与极简奖牌圆形类，不用 icon 替代数字
  assert.match(html, /class="livonym-result-row is-first"><span class="livonym-result-rank is-medal">1<\/span>/);
  assert.doesNotMatch(html, /livonym-result-rank[^>]*>[\s\S]*?icon-medal/);
  assert.match(html, /class="livonym-badge-row is-award-guess"><span class="livonym-badge-title">[\s\S]*?#icon-crown[\s\S]*?<span>竞猜王<\/span><\/span><span class="player-identity livonym-badge-name">[\s\S]*?player-identity-name">乙/);
  assert.match(html, /class="livonym-badge-row is-award-describe"><span class="livonym-badge-title">[\s\S]*?#icon-message-square-text[\s\S]*?<span>最佳描述<\/span><\/span><span class="player-identity livonym-badge-name">[\s\S]*?player-identity-name">甲/);
  assert.match(html, /class="livonym-badge-row is-award-fastest"><span class="livonym-badge-title">[\s\S]*?#icon-zap[\s\S]*?<span>神猜<\/span><\/span><span class="player-identity livonym-badge-name">[\s\S]*?player-identity-name">乙/);
  const resultStyles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(resultStyles, /\.livonym-result-row:is\(\.is-first, \.is-second, \.is-third\) \.livonym-result-rank \{[\s\S]*?radial-gradient/);
  assert.match(resultStyles, /\.livonym-badge-row\.is-award-guess[\s\S]*?\.livonym-badge-row\.is-award-describe[\s\S]*?\.livonym-badge-row\.is-award-fastest/);
  assert.match(html, /逐棒回顾/);
  // 总分榜与回顾页的每一行都先给头像；回顾秘密词直接展示词本身，不显示「本轮秘密词」和「x 个字」
  assert.match(html, /livonym-result-row[\s\S]*?player-identity-avatar/);
  assert.match(html, /livonym-review-secret[\s\S]*?class="livonym-secret">高压锅/);
  assert.doesNotMatch(html, /本轮秘密词|个字/);
  assert.match(html, /本轮满分 3 分（在线竞猜者 2 人）/);
  assert.doesNotMatch(html, /本轮结算|1 人猜中/);
  // 结算页沿用重赛区；下一步单独一张卡，总分与回顾同在主列，总分在前
  assert.match(html, /<div class="result-aside">\s*<div id="result-rematch" class="result-rematch-group">[^]*?<\/div>\s*<\/div>\s*<div class="result-main">\s*<section class="surface-block livonym-result-board">/);
  const main = html.slice(html.indexOf('<div class="result-main">'));
  assert.ok(main.indexOf('livonym-result-board') < main.indexOf('livonym-review-carousel'), '总分在前，回顾在后');
  assert.doesNotMatch(html.slice(0, html.indexOf('<div class="result-main">')), /livonym-result-board/);
});

test('逐棒回顾一棒一页，翻页器与主页介绍同一套，页内总分按棒累加', () => {
  const state = roomState('result');
  state.uid = 'U2';
  state.room.resultPlayers = players;
  const second = {
    ...modeDetails, secret: '运河', describerUid: 'U3', guesses: { U2: { order: 1, atMs: 2100 }, U1: { order: 2, atMs: 3400 } },
    points: { U2: 3, U1: 2, U3: 0 }
  };
  state.room.history = [{ n: 1, outcome: 'played', modeDetails }, { n: 2, outcome: 'played', modeDetails: second }];
  const html = livonymResultMarkup(state);
  // 翻页器在页上方：圆形箭头夹着「1 / n」，与主页介绍一致
  assert.match(html, /<div class="livonym-review-carousel">\s*<nav class="livonym-review-pagination" aria-label="逐棒回顾翻页">\s*<button type="button" data-review-step="-1" aria-label="上一棒" disabled>[^]*?<span class="livonym-review-page-count"[^>]*>1 \/ 2<\/span>\s*<button type="button" data-review-step="1" aria-label="下一棒">[^]*?<\/nav>\s*<div class="livonym-review-pages scrollbars-hidden"[^>]*>/);
  const pages = html.split('class="livonym-review-page"').slice(1);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /高压锅/);
  assert.match(pages[1], /运河/);
  // 页里只有卡片的内容：不套外面的框，也不带「图标 + 本轮结算 + 没人猜中」那行
  assert.doesNotMatch(html, /class="surface-block livonym-score-block"/);
  for (const page of pages) assert.doesNotMatch(page, /readonly-tag|livonym-score-block|本轮结算|人猜中|本轮秘密词|个字/);
  assert.match(pages[0], /livonym-review-secret[\s\S]*?class="livonym-secret">高压锅/);
  // 第 1 棒结束时乙 3 分、甲 1 分；第 2 棒再加 3 与 2
  assert.match(pages[0], /<strong>3<\/strong><span class="livonym-gain" data-points="3"/);
  assert.match(pages[1], /<strong>6<\/strong><span class="livonym-gain" data-points="3"/);
  assert.match(pages[1], /<strong>3<\/strong><span class="livonym-gain" data-points="2"/);
  // 出题人与「你」的标记跟着每棒各自的结算走
  assert.match(pages[0], /player-identity-name">甲<\/span><span class="badge me-label">出题<\/span>/);
  assert.match(pages[1], /player-identity-name">丙<\/span><span class="badge me-label">出题<\/span>/);
  assert.match(pages[1], /player-identity-name">乙<\/span><span class="badge me-label">你<\/span>/);
});

test('只有一棒时不渲染翻页器', () => {
  const state = roomState('result');
  state.room.resultPlayers = players;
  state.room.history = [{ n: 1, outcome: 'played', modeDetails }];
  const html = livonymResultMarkup(state);
  assert.doesNotMatch(html, /livonym-review-pagination/);
  assert.equal(html.split('class="livonym-review-page"').length - 1, 1);
});

test('历史详情对即时竞猜换成逐棒回顾，不再显示词路径', () => {
  const detail = {
    match: {
      id: 'm1', roomCode: '12345', mode: 'livonym', outcome: 'played',
      totalRounds: 1, convergedRound: 1, startedAt: 1700000000000, endedAt: 1700000600000,
      maxRounds: 12, players,
      rounds: [{ n: 1, words: {}, marks: {}, outcome: 'played', modeDetails }]
    }
  };
  const html = matchDetailMarkup(detail);
  assert.match(html, /共 1 棒结束/);
  assert.match(html, /逐棒回顾/);
  assert.doesNotMatch(html, /完整词路径/);
  assert.doesNotMatch(html, /逐轮投票记录/);
});

test('描述框清洗保留标点、emoji 与换行，剔除不可见字符', () => {
  assert.equal(cleanDescribe('你好，世界！'), '你好，世界！');
  assert.equal(cleanDescribe('第一行\n第二行'), '第一行\n第二行');
  assert.equal(cleanDescribe('a\n\n\nb'), 'a\nb');
  assert.equal(cleanDescribe('a   b'), 'a b');
  assert.equal(cleanDescribe('a\u0007b'), 'ab');
  assert.equal(cleanDescribe('a\u200bb'), 'ab');
  assert.equal(cleanDescribe('a\ufeffb'), 'ab');
  // 零宽连接符要保留，否则组合 emoji 会被拆开
  assert.equal(cleanDescribe('👨\u200d👩'), '👨\u200d👩');
  assert.equal(cleanDescribe('🎉 好耶'), '🎉 好耶');
  assert.equal([...cleanDescribe('字'.repeat(500))].length, DESCRIBE_LIMIT);
  assert.equal(DESCRIBE_LIMIT, 50);
  // 标点与换行同样占一个字的额度
  assert.equal([...cleanDescribe('，'.repeat(60))].length, 50);
  assert.equal([...cleanDescribe('一二三四五，六七八九十！'.repeat(5))].length, 50);
  assert.equal(cleanDescribe('短句', 2), '短句');
});

test('出题阶段的描述框继承站点字体、文字居中，提示行右端显示字数', () => {
  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const describer = livonymMarkup(roomState('lvPlay'));
  assert.match(describer, /class="page writing-page livonym-page" data-role="describer"/);
  assert.match(describer, new RegExp(`写出谜底会被拦下；可以分行。</span><output id="describe-count" class="describe-count">0/${DESCRIBE_LIMIT}</output>`));
  const guesserState = roomState('lvPlay');
  guesserState.uid = 'U2';
  assert.match(livonymMarkup(guesserState), /data-role="guesser"/);

  // 描述框沿用站点字体，文字在框内水平垂直居中；秘密词居中
  assert.match(styles, /button, input, textarea \{[^}]*font: inherit;/);
  assert.match(styles, /\.livonym-describe-input \{[^}]*text-align: center;[^}]*align-content: center;/);
  assert.match(styles, /\.livonym-secret \{[^}]*text-align: center;/);
  // 提示行左右分栏，顶到上限后继续打字整行转红
  assert.match(styles, /\.describe-hint \{ display: flex;[^}]*justify-content: space-between;/);
  assert.match(styles, /\.livonym-describe-form\.is-over \.describe-hint-text,\s*\.livonym-describe-form\.is-over \.describe-count \{ color: var\(--vermilion\); \}/);
});

test('121 只有一个界面：舞台、秘密词与退出按钮，任何宽度都单列并限宽', () => {
  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const describer = livonymMarkup(roomState('lvIntro'));
  assert.match(describer, /id="livonym-secret"/);
  assert.match(describer, /data-action="leave"/);
  assert.doesNotMatch(describer, /describe-form|describe-input|livonym-guessed-block/);

  // 竞猜者是同一套骨架：词块、舞台、退出按钮都在，只是词被遮起来
  const guesserState = roomState('lvIntro');
  guesserState.uid = 'U2';
  const guesser = livonymMarkup(guesserState);
  assert.match(guesser, /class="surface-block livonym-secret-block"/);
  assert.match(guesser, /data-action="leave"/);
  assert.doesNotMatch(guesser, /describe-form|describe-input|livonym-guessed-block/);

  // 遮起来的占位加了字距，末尾那半个字距要用等量左内边距补回来，否则整串偏左
  assert.match(styles, /\.livonym-secret\.is-locked \{[^}]*letter-spacing: \.3em;[^}]*padding-left: \.3em;/);
  // 121 保持单列：舞台、秘密词、退出按钮
  assert.match(styles, /\.livonym-page\[data-screen="lvIntro"\] \.writing-stage \{ order: 0; \}/);
  assert.match(styles, /\.livonym-page\[data-screen="lvIntro"\] \.livonym-secret-block \{ order: 1; \}/);
  assert.match(styles, /\.livonym-page\[data-screen="lvIntro"\] \.game-leave \{ order: 2; \}/);
  assert.doesNotMatch(styles, /data-role="describer"\]\[data-screen="lvIntro"/);
  // 宽屏也不分栏，宽度沿用普通单列的上限
  assert.match(styles, /\.app:has\(\.livonym-page\[data-screen="lvIntro"\]\) \{ --app-w: min\(100% - 64px, 600px\); \}/);
  assert.match(styles, /\.livonym-page\[data-screen="lvIntro"\] \{\s*display: flex;\s*flex-direction: column;/);
  // 中间的包裹层要拉平，退出按钮才能靠 order 排到最后
  assert.match(styles, /\.livonym-page\[data-screen="lvIntro"\] \.game-info,\s*\.livonym-page\[data-screen="lvIntro"\] \.game-controls \{ display: contents; \}/);
});


test('122 出题人与竞猜者同一套双列：猜中列表在左列舞台下面，退出按钮贴着右列末尾', () => {
  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const scope = '\\.livonym-page:is\\(\\[data-screen="lvPlay"\\], \\[data-screen="lvScore"\\]\\)';
  assert.match(styles, /\.livonym-page:is\(\[data-screen="lvPlay"\], \[data-screen="lvScore"\]\) \{\s*display: grid;/);
  assert.match(styles, new RegExp(`${scope} \\.game-info,\\s*${scope} \\.game-controls \\{\\s*display: flex;`));
  assert.match(styles, new RegExp(`${scope} \\.game-leave \\{\\s*width: 100%;\\s*margin-top: 0;\\s*align-self: stretch;`));
  assert.doesNotMatch(styles, /\[data-screen="lvPlay"\] \.writing-stage \{ grid-area/);
  // 左列只有舞台与猜中列表；右列是描述流、抢答框，退出按钮紧跟在抢答框后面
  const guesserState = roomState('lvPlay');
  guesserState.uid = 'U2';
  const html = livonymMarkup(guesserState);
  const info = html.match(/<div class="game-info">([\s\S]*?)<\/div>\s*<div class="game-controls">/)[1];
  assert.match(info, /writing-stage/);
  assert.match(info, /livonym-guessed-block/);
  assert.doesNotMatch(info, /livonym-stream-block|guess-form/);
  const controls = html.slice(html.indexOf('<div class="game-controls">'));
  assert.ok(controls.indexOf('livonym-stream-block') < controls.indexOf('guess-form'));
  assert.ok(controls.indexOf('guess-form') < controls.indexOf('game-leave'));
  // 121 的单列限宽不影响 122
  assert.doesNotMatch(styles, /\.app:has\(\.livonym-page\[data-screen="lvPlay"\]\) \{[^}]*--app-w/);
});

test('122 流式卡片居中；猜错把输入卡缩成冷却进度，猜对整卡呼吸绿光并换成正确按钮', () => {
  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.livonym-stream \{[\s\S]*?display: grid;[\s\S]*?place-items: center;[\s\S]*?text-align: center;/);
  assert.match(styles, /\.guess-form\.is-cooling::before \{[\s\S]*?transform-origin: left center;[\s\S]*?animation: guess-cooldown-shrink var\(--guess-cooldown, 1500ms\) linear forwards;/);
  assert.match(styles, /@keyframes guess-cooldown-shrink \{[\s\S]*?scaleX\(1\)[\s\S]*?scaleX\(0\)/);
  assert.match(styles, /\.guess-form\.is-correct \{[\s\S]*?animation: guess-correct-breathe/);
  assert.match(styles, /\.button\.primary\.is-correct,[\s\S]*?background: color-mix\(in srgb, var\(--jade\) 70%, #003b26\)/);

  const guesserState = roomState('lvPlay');
  guesserState.uid = 'U2';
  const cooling = livonymMarkup(guesserState, { streamText: '一种会响的锅', guessCooldownUntil: Date.now() + 1500 });
  assert.match(cooling, /class="livonym-stream-body"/);
  assert.match(cooling, /livonym-stream-author[\s\S]*?player-identity-avatar/);
  assert.match(cooling, /<form id="guess-form" class="surface-block game-form guess-form is-cooling" style="--guess-cooldown:\d+ms">/);

  const correct = livonymMarkup(guesserState, { streamText: '一种会响的锅', guessedOrder: 1, guessPoints: 3 });
  assert.match(correct, /<form id="guess-form" class="surface-block game-form guess-form is-correct">/);
  assert.match(correct, /<button class="button primary is-correct" type="submit" disabled>[\s\S]*?icon-check[\s\S]*?<span>正确！<\/span><\/button>/);
  assert.doesNotMatch(correct, /<span>已猜中<\/span>/);
  assert.match(correct, /第 1 个猜中，本轮 \+3 分/);

  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const GUESS_COOLDOWN_MS = 1500;/);
  assert.match(app, /form\.classList\.add\('is-cooling'\)/);
  assert.match(app, /label\.textContent = '正确！'/);
});

test('123 秘密词卡在舞台下方，最后一棒不再说交给下一位出题人', () => {
  const state = roomState('lvScore');
  state.room.livonym.index = 2;
  state.room.history = [{ n: 3, outcome: 'played', modeDetails: { ...modeDetails, secret: '运河' } }];
  const html = livonymMarkup(state);
  const info = html.match(/<div class="game-info">([\s\S]*?)<\/div>\s*<div class="game-controls">/)[1];
  assert.ok(info.indexOf('writing-stage') < info.indexOf('livonym-secret-block'));
  assert.match(info, /data-revealed="true"/);
  assert.match(info, /本轮秘密词/);
  assert.match(info, /class="livonym-secret">运河/);
  assert.doesNotMatch(info, /只有出题人看得到|readonly-tag/);
  const score = html.slice(html.indexOf('<section class="surface-block livonym-score-block">'));
  assert.doesNotMatch(score, /运河|livonym-score-secret/);
  assert.match(html, /最后一棒结算，之后进入本局总结。/);
  assert.doesNotMatch(html, /交给下一位出题人/);

  state.room.livonym.index = 0;
  assert.match(livonymMarkup(state), /交给下一位出题人/);
});
test('本地谜底拦截与服务端同规则', () => {
  assert.equal(describeContainsSecret('这是高压锅', '高压锅'), true);
  assert.equal(describeContainsSecret('高压 锅 会响', '高压锅'), true);
  assert.equal(describeContainsSecret('锅里煮着汤', '锅'), false);
  assert.equal(describeContainsSecret('ＨＩＧＨ', 'high'), true);
  assert.equal(describeContainsSecret('随便写', ''), false);
});

test('房间设置的同步消息带齐字段', () => {
  const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const block = source.match(/function scheduleLobbySettingsSync[\s\S]*?\n}/)[0];
  for (const field of ['describeSeconds', 'roundsPerPlayer']) {
    assert.match(block, new RegExp(`${field}: nextSettings\\.${field}`), `同步消息缺少 ${field}`);
  }
});

test('八个席位色都已定义', () => {
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  for (let index = 0; index < 8; index += 1) {
    assert.match(css, new RegExp(`--player-${index}:`), `缺少 --player-${index}`);
    assert.match(css, new RegExp(`--card-player-${index}:`), `缺少 --card-player-${index}`);
  }
  assert.match(css, /\.livonym-stream-body\s*\{[^}]*white-space: pre-wrap/);
});

test('房主开始按钮按各模式房间人数上下限与准备状态判定可用性', () => {
  const makePlayers = (count, allReady = true) => Array.from({ length: count }, (_, i) => ({
    uid: `U${i + 1}`, name: `玩家${i + 1}`, seat: i,
    connected: true, ready: i === 0 ? false : allReady
  }));
  for (const [mode, [min, max]] of Object.entries({
    free: [2, 4], theme: [2, 4], livonym: [3, 8], shiritori: [2, 4], impostor: [3, 6], blitz: [2, 2], bridge: [2, 4]
  })) {
    assert.deepEqual(roomPlayerLimits(mode), [min, max]);
    const buildRoom = (count, allReady = true) => ({
      code: '12345', mode, phase: 'lobby', hostUid: 'U1',
      maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true,
      describeSeconds: 45, roundsPerPlayer: 1,
      players: makePlayers(count, allReady)
    });
    assert.equal(canStartRoom(buildRoom(min - 1), 'U1'), false, `${mode} 少于下限应不可开始`);
    assert.equal(canStartRoom(buildRoom(min), 'U1'), true, `${mode} 达到下限且全员准备应可开始`);
    assert.equal(canStartRoom(buildRoom(max), 'U1'), true, `${mode} 达到上限且全员准备应可开始`);
    assert.equal(canStartRoom(buildRoom(max + 1), 'U1'), false, `${mode} 超出上限应不可开始`);
    assert.equal(canStartRoom(buildRoom(min, false), 'U1'), false, `${mode} 有人未准备应不可开始`);
    assert.equal(canStartRoom(buildRoom(min), 'U2'), false, `${mode} 非房主应不可开始`);
  }

  // livonym 两人已准备时，lobbyMarkup 渲染的开始按钮仍为 disabled
  const twoPlayersReady = {
    uid: 'U1',
    room: {
      code: '12345', mode: 'livonym', phase: 'lobby', hostUid: 'U1',
      maxRounds: 12, writeSeconds: 45, prepareSeconds: 30, banRepeat: true,
      describeSeconds: 45, roundsPerPlayer: 1,
      players: makePlayers(2, true)
    }
  };
  assert.match(lobbyMarkup(twoPlayersReady), /data-action="start" disabled/);

  // patchLobbyDOM 同样复用 canStartRoom，不再硬编码 >= 2
  const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const patchBlock = source.match(/function patchLobbyDOM[\s\S]*?\n}/)[0];
  assert.match(patchBlock, /canStartRoom\(room,\s*uid\)/);
  assert.doesNotMatch(patchBlock, /room\.players\.length\s*>=\s*2/);
});

test('档案条目按玩法写文案', () => {
  const base = {
    id: 'm1', roomCode: '12345', startedAt: 1700000000000, players: ['乙'],
    totalRounds: 3, convergedRound: 3
  };
  const livonym = profileMatchMarkup({ ...base, mode: 'livonym', outcome: 'played' }, {});
  assert.match(livonym, /共 3 棒/);
  assert.doesNotMatch(livonym, /相遇/, '即时竞猜不该说「相遇」');
  assert.match(profileMatchMarkup({ ...base, mode: 'free', outcome: 'none' }, {}), /打满 3 轮未相遇/);
  assert.match(profileMatchMarkup({ ...base, mode: 'theme', outcome: 'voted' }, {}), /第 3 轮投票相遇/);
});

test('结算标题点名祝贺第一名，句子里带他的名字', () => {
  const state = roomState('result');
  state.room.resultPlayers = players;
  state.room.history = [{ n: 1, outcome: 'played', modeDetails }];
  const title = resultTitle(state.room);
  assert.match(title, /乙/);
  assert.doesNotMatch(title, /甲|丙|这一局结束了/);
  // 同一局文案固定：结算期间状态再更新也不跳变
  assert.equal(resultTitle({ ...state.room, phase: 'rematch', rematchVotes: { U2: 'rematch' } }), title);
  // 多种说法：换房号就换一句，且每句都写着他的名字
  const variants = new Set(Array.from({ length: 40 }, (_, i) => resultTitle({ ...state.room, code: String(i) })));
  assert.ok(variants.size >= 4, `只出现了 ${variants.size} 种说法`);
  for (const line of variants) assert.match(line, /乙/);
  // 结算页标题用的就是这一句：去掉标签后的文字与 resultTitle 一致，名字前挂着头像
  const heading = livonymResultMarkup({ ...state, uid: 'U2' });
  const headingText = heading.match(/<h1>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(headingText, title);
  assert.match(heading, /<h1>[\s\S]*class="player-identity result-title-name"><img[^>]+>[\s\S]*乙[\s\S]*<\/h1>/);
});

test('并列第一时两个人的名字一起进祝贺句', () => {
  const state = roomState('result');
  state.room.resultPlayers = players;
  state.room.livonym.scores = { U1: 4, U2: 4, U3: 0 };
  const title = resultTitle(state.room);
  assert.match(title, /甲/);
  assert.match(title, /乙/);
  assert.match(title, /并列|并排/);
  assert.doesNotMatch(title, /丙/);
});

test('全员 0 分不点名祝贺，也不再是「这一局结束了」', () => {
  const state = roomState('result');
  state.room.resultPlayers = players;
  state.room.livonym.scores = { U1: 0, U2: 0, U3: 0 };
  const title = resultTitle(state.room);
  assert.doesNotMatch(title, /甲|乙|丙/);
  assert.notEqual(title, '这一局结束了');
});

test('逐棒回顾展示出题描述、猜中用时与可展开猜错词浮窗，缺失或空态用 ---- 占位', () => {
  const detail = {
    match: {
      id: 'm-review', roomCode: '12345', mode: 'livonym', outcome: 'played',
      totalRounds: 3, convergedRound: 3, startedAt: 1700000000000, endedAt: 1700000600000,
      maxRounds: 12, players,
      rounds: [
        {
          n: 1, words: {}, marks: {}, outcome: 'played',
          modeDetails: {
            secret: '高压锅', describerUid: 'U1', description: '厨房里会嘶嘶响的锅',
            guesserCount: 2, aborted: false,
            guesses: { U2: { order: 1, atMs: 4200 } },
            wrongGuesses: { U2: ['电饭煲', '高压'] },
            points: { U2: 3, U1: 1 }
          }
        },
        {
          n: 2, words: {}, marks: {}, outcome: 'played',
          modeDetails: {
            secret: '运河', describerUid: 'U2', description: '',
            guesserCount: 2, aborted: false,
            guesses: {},
            wrongGuesses: {},
            points: {}
          }
        },
        {
          // 模拟未收集过 description 与 wrongGuesses 的旧对局
          n: 3, words: {}, marks: {}, outcome: 'played',
          modeDetails: {
            secret: '灯塔', describerUid: 'U3',
            guesserCount: 2, aborted: false,
            guesses: { U1: { order: 1, atMs: 1800 } },
            points: { U1: 3, U3: 1 }
          }
        }
      ]
    }
  };

  const html = matchDetailMarkup(detail, {}, 'U2');
  const pages = html.split('class="livonym-review-page"').slice(1);
  assert.equal(pages.length, 3);

  // 不再出现「未留下」「未记录」「无错词」「错词未记录」
  assert.doesNotMatch(html, /未留下|未记录|无错词/);

  // 第 1 棒：描述内容、猜中时间（在分数左侧，格式与对局流程内一致）直接展示；仅对有猜错词的 U2 开放点击并换色提示，U3 无错词不可点击
  assert.match(pages[0], /描述内容[\s\S]*?厨房里会嘶嘶响的锅/);
  assert.match(pages[0], /class="livonym-score-time">4\.2s<\/span>\s*<span class="livonym-score-total">/);
  assert.match(pages[0], /点变色名字看错词/);
  assert.match(pages[0], /data-action="toggle-wrong-popover" aria-expanded="false" aria-controls="lv-wrong-1-U2"[^>]*><span class="player-identity livonym-score-name has-wrong"/);
  assert.match(pages[0], /id="lv-wrong-1-U2" class="livonym-wrong-popover"[^>]* hidden>[\s\S]*?<li>电饭煲<\/li><li>高压<\/li>/);
  assert.doesNotMatch(pages[0], /lv-wrong-1-U3/);

  // 第 2 棒：空描述用 ---- 占位，无人有错词时不出现错词提示
  assert.match(pages[1], /livonym-review-describe-text is-empty">----<\/p>/);
  assert.doesNotMatch(pages[1], /点变色名字看错词|data-action="toggle-wrong-popover"|has-wrong/);

  // 第 3 棒：旧对局未收集字段同样用 ---- 占位，无错词不可点
  assert.match(pages[2], /livonym-review-describe-text is-empty">----<\/p>/);
  assert.match(pages[2], /class="livonym-score-time">1\.8s<\/span>\s*<span class="livonym-score-total">/);
  assert.doesNotMatch(pages[2], /lv-wrong-3-|data-action="toggle-wrong-popover"|has-wrong/);
});


test('出题人在 N-1 或 N 人猜中后输入框锁定并仅在提示行显示说明', () => {
  const state = roomState('lvPlay');
  state.room.livonym.locked = true;
  const html = livonymMarkup(state);
  assert.match(html, /<textarea id="describe-input"[^>]*disabled[^>]*readonly/);
  assert.doesNotMatch(html, /banner-warning|livonym-lock-banner/);
  assert.match(html, /只剩一个没猜中了，等等 TA/);

  state.room.livonym.guessed = [
    { uid: 'U2', name: '乙', order: 1, atMs: 1200, points: 3 },
    { uid: 'U3', name: '丙', order: 2, atMs: 2400, points: 2 }
  ];
  const fullHtml = livonymMarkup(state);
  assert.match(fullHtml, /<textarea id="describe-input"[^>]*disabled[^>]*readonly/);
  assert.doesNotMatch(fullHtml, /banner-warning|livonym-lock-banner/);
  assert.match(fullHtml, /全员已猜中，描述已锁定/);
});

test('出题人在本地拦截谜底时提示行展示警告说明而非静默停止', () => {
  const state = roomState('lvPlay');
  const html = livonymMarkup(state, { describeBlocked: true });
  assert.match(html, /class="game-hint describe-hint is-blocked"/);
  assert.match(html, /描述中不能包含秘密词或其变体/);
});

test('猜中者在 lvPlay 阶段可点击其他玩家切换至观战视角，展示被观战玩家状态与错词', () => {
  const state = roomState('lvPlay');
  state.uid = 'U2';
  state.room.livonym.guessed = [{ uid: 'U2', order: 1, atMs: 3000, points: 3 }];
  state.room.livonym.wrongGuesses = { U3: ['炒锅', '高压电'] };
  
  // 未猜中时观战提示隐藏；猜中后人数列表卡片右上角显示观战提示
  const beforeGuessHtml = livonymMarkup(state, {});
  assert.match(beforeGuessHtml, /id="livonym-spectate-hint"[^>]* hidden>点其他玩家可观战<\/span>/);

  // 猜中但未切换观战视角
  const normalHtml = livonymMarkup(state, { guessedOrder: 1, guessPoints: 3 });
  assert.match(normalHtml, /class="button primary is-correct"[^>]*disabled/);
  assert.match(normalHtml, /可点击左侧玩家列表观战/);
  assert.match(normalHtml, /id="livonym-spectate-hint" class="readonly-tag livonym-card-hint">点其他玩家可观战<\/span>/);
  assert.match(normalHtml, /class="livonym-guessed-list is-spectatable"/);

  // 切换到观战 U3：不再在答题卡内渲染蓝色横幅或修改顺位提示，改由壳层第二层滑出框与氛围光承担
  const spectatingHtml = livonymMarkup(state, { guessedOrder: 1, guessPoints: 3, spectatingUid: 'U3' });
  assert.doesNotMatch(spectatingHtml, /livonym-spectator-banner/);
  assert.match(spectatingHtml, /id="guess-hint"[^>]*>第 1 个猜中，本轮 \+3 分（可点击左侧玩家列表观战）<\/p>/);
  assert.match(spectatingHtml, /placeholder="该玩家正在思考 \/ 答题中…"/);
  assert.match(spectatingHtml, /<span class="badge tag">炒锅<\/span>/);
  assert.match(spectatingHtml, /<span class="badge tag">高压电<\/span>/);
  assert.match(spectatingHtml, /<li[^>]*class="[^"]*is-spectated[^"]*"[^>]*data-uid="U3"/);

  const shellHtml = shellMarkup(true, { uid: 'U2', name: '乙' });
  assert.match(shellHtml, /<div class="header-spectate-bar" id="header-spectate-bar" aria-hidden="true"><span class="header-spectate-label">正在观战<\/span><span class="header-spectate-target" id="header-spectate-target"><\/span><\/div>/);
  assert.match(shellHtml, /<div class="spectate-ambient" id="spectate-ambient" aria-hidden="true"><\/div>/);
});

test('lvScore 揭晓秘密词不显示字数，答题用时紧贴总分左侧且加分不再绝对定位偏移出外框', () => {
  const scoreState = roomState('lvScore');
  scoreState.room.livonym.scores = { U1: 1, U2: 3, U3: 0 };
  scoreState.room.history = [{
    n: 1, outcome: 'played',
    modeDetails: {
      ...modeDetails,
      guesses: { U2: { order: 1, atMs: 4200 } },
      points: { U1: 1, U2: 3, U3: 0 }
    }
  }];
  const html = livonymMarkup(scoreState);
  const secretCard = html.match(/<section class="surface-block livonym-secret-block" data-revealed="true">[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(secretCard, /个字|livonym-secret-length/);

  // 答题用时作为独立第 3 列紧贴 .livonym-score-total 左侧；出题人用空占位保持对齐
  assert.match(html, /<span class="livonym-score-time">4\.2s<\/span>\s*<span class="livonym-score-total"><strong>3<\/strong>/);
  assert.match(html, /<span class="livonym-score-time">–<\/span>\s*<span class="livonym-score-total"><strong>0<\/strong>/);
  assert.match(html, /<span class="livonym-score-time" aria-hidden="true"><\/span>\s*<span class="livonym-score-total"><strong>1<\/strong>/);

  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const gainRule = styles.match(/\.livonym-score-total > \.livonym-gain \{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(gainRule, /position:\s*absolute|right:\s*-/);
});

test('错词浮窗限制最大宽高、固定视口定位并支持点击空白关闭（不再渲染关闭按钮）', () => {
  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.livonym-wrong-popover \{[\s\S]*?position:\s*fixed;[\s\S]*?max-width:\s*min\(calc\(100vw - 24px\),\s*380px\);/);
  assert.match(styles, /\.livonym-wrong-popover \{[\s\S]*?max-height:\s*min\(calc\(100vh - 24px\),\s*300px\);[\s\S]*?overflow-y:\s*auto;/);
  assert.match(styles, /@media \(max-width: 600px\) \{[\s\S]*?\.livonym-wrong-popover \{[\s\S]*?max-width:\s*calc\(100vw - 24px\);/);

  const scoreState = roomState('lvScore');
  scoreState.room.history = [{
    n: 1, outcome: 'played',
    modeDetails: { ...modeDetails, wrongGuesses: { U2: ['电饭煲'] } }
  }];
  const scoreHtml = livonymMarkup(scoreState);
  assert.match(scoreHtml, /<div class="section-heading"><h2>[\s\S]*?本轮结算<\/span><\/h2><span class="readonly-tag livonym-card-hint">点变色名字看错词<\/span><\/div>/);
  assert.match(scoreHtml, /data-uid="U2"[\s\S]*?livonym-score-name has-wrong[\s\S]*?<\/li>/);
  assert.doesNotMatch(scoreHtml, /data-uid="U3"[\s\S]*?(has-wrong|toggle-wrong-popover)[\s\S]*?<\/li>/);
  assert.match(scoreHtml, /<div class="livonym-wrong-popover-head"><span>猜错的词<\/span><\/div>/);
  assert.doesNotMatch(scoreHtml, /data-wrong-close|livonym-wrong-popover-close/);
  assert.match(styles, /\.livonym-score-name\.has-wrong \.player-identity-name \{/);

  const noWrongState = roomState('lvScore');
  noWrongState.room.history = [{
    n: 1, outcome: 'played',
    modeDetails: { ...modeDetails, wrongGuesses: {} }
  }];
  const noWrongHtml = livonymMarkup(noWrongState);
  assert.doesNotMatch(noWrongHtml, /点变色名字看错词|toggle-wrong-popover|has-wrong|livonym-wrong-popover/);
});

test('弹幕容器挂在壳层顶部并配置跨阶段平滑滚动动画', () => {
  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.livonym-danmu-container \{[\s\S]*?position:\s*fixed;[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.livonym-danmu-item \{[\s\S]*?animation:\s*livonym-danmu-scroll 10s linear forwards;/);
  assert.match(styles, /@keyframes livonym-danmu-scroll \{[\s\S]*?from \{ transform: translateX\(0\); \}[\s\S]*?to \{ transform: translateX\(calc\(-100vw - 100%\)\); \}/);
});

test('lvIntro 猜词方标题在出题人名字前渲染头像，出题人标题保持纯文本', () => {
  const describerHtml = livonymMarkup(roomState('lvIntro'));
  assert.match(describerHtml, /<h1>轮到你出题<\/h1>/);
  assert.doesNotMatch(describerHtml, /livonym-preparing-author/);

  const guesserState = roomState('lvIntro');
  guesserState.uid = 'U2';
  const guesserHtml = livonymMarkup(guesserState);
  assert.match(guesserHtml, /<h1 class="livonym-preparing-title"><span class="player-identity livonym-preparing-author"><img class="avatar player-identity-avatar" data-avatar-name="甲"[^>]*><span class="player-identity-name">甲<\/span><\/span><span>正在准备<\/span><\/h1>/);
});

test('倒计时保持透明无胶囊框的简洁样式', () => {
  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const clockBlock = styles.match(/\.writing-clock, \.rematch-clock \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(clockBlock, /padding:\s*2px 0;/);
  assert.match(clockBlock, /background:\s*transparent;/);
  assert.doesNotMatch(clockBlock, /border-radius|border:|var\(--bg-subtle\)/);
});

test('页面与说明文案已移除「抢猜顺位：」与「悬崖机制」字样', () => {
  const describerHtml = livonymMarkup(roomState('lvPlay'));
  const guesserState = roomState('lvPlay');
  guesserState.uid = 'U2';
  const guesserHtml = livonymMarkup(guesserState);
  const qaHtml = qaMarkup();
  const insaneHtml = insaneMarkup('livonym');
  const previewHtml = insanePreviewMarkup('livonym');

  for (const html of [describerHtml, guesserHtml, qaHtml, insaneHtml, previewHtml]) {
    assert.doesNotMatch(html, /抢猜顺位：|悬崖机制/);
  }
  assert.match(guesserHtml, /第 1 名 \+3 分，第 2 名 \+2 分；猜错冷却 1\.5 秒/);
  assert.match(describerHtml, /每有一人猜中 \+1 分，若全员猜中则得 0 分/);
});

test('开局倒计时顺序包裹在圆角框内，显示头像与名字、序号不加「第x棒」且项末尾带箭头', () => {
  const html = startCountdownMarkup({
    code: '12345',
    mode: 'livonym',
    players,
    livonym: { order: ['U1', 'U2', 'U3'], totalRounds: 3 }
  });
  assert.match(html, /class="countdown-clue-order"[\s\S]*?共 3 棒[\s\S]*?class="countdown-order-list"/);
  assert.doesNotMatch(html, /第\s*\d+\s*棒/);
  const items = html.split('class="countdown-order-item').slice(1);
  assert.equal(items.length, 3);
  assert.match(items[0], /class="order-step">1<\/span>[\s\S]*?player-identity-avatar[\s\S]*?player-identity-name">甲<\/span>[\s\S]*?countdown-order-arrow/);
  assert.match(items[1], /class="order-step">2<\/span>[\s\S]*?player-identity-avatar[\s\S]*?player-identity-name">乙<\/span>[\s\S]*?countdown-order-arrow/);
  assert.match(items[2], /class="order-step">3<\/span>[\s\S]*?player-identity-avatar[\s\S]*?player-identity-name">丙<\/span>/);
  assert.doesNotMatch(items[2], /countdown-order-arrow/);
});

test('Livonym 历史详情页具备专属深色 UI 与突出 Livonym 标识', () => {
  const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const cardMotion = readFileSync(new URL('../../public/insane-card-motion.js', import.meta.url), 'utf8');
  assert.match(styles, /body:has\(\.match-detail-page\[data-mode="livonym"\]\)\s*\{[^}]*color-scheme:\s*dark;/);
  assert.match(styles, /body:has\(\.match-detail-page\[data-mode="livonym"\]\)\s*\{[^}]*--mode-a:\s*#8ee4d7;/);
  assert.match(styles, /body\.has-insane-gl:has\(\.match-detail-page\[data-mode="livonym"\]\)::before\s*\{\s*display:\s*none;\s*\}/);
  assert.match(styles, /body:is\(\[data-insane\], :has\(\.match-detail-page\[data-mode="livonym"\]\)\) \.livonym-badge-row\.is-award-guess/);
  assert.match(styles, /body:is\(\[data-insane\], :has\(\.match-detail-page\[data-mode="livonym"\]\)\) \.livonym-score-name\.has-wrong \.player-identity-name/);
  assert.match(styles, /\.livonym-history-hero\s*\{/);
  assert.match(styles, /\.livonym-history-hero-canvas\s*\{/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.livonym-history-hero-canvas\s*\{\s*display:\s*none;\s*\}/);
  assert.match(app, /stage\.querySelector\?\.\('\.match-detail-page\[data-mode="livonym"\]'\)[\s\S]*?insaneBackground\.setActive\(true\)[\s\S]*?insaneBackground\.setMode\?\.\('livonym'/);
  assert.match(app, /stage\.querySelector\('\.livonym-history-hero'\)\)[\s\S]*?observeInsaneCardMotion\(stage\)/);
  assert.match(cardMotion, /\.livonym-history-hero > \.livonym-history-hero-canvas/);

  const detail = {
    match: {
      id: 'm-lv-hero', roomCode: '12345', mode: 'livonym', outcome: 'played',
      totalRounds: 1, convergedRound: 1, startedAt: 1700000000000, endedAt: 1700000600000,
      maxRounds: 12, players,
      rounds: [{ n: 1, words: {}, marks: {}, outcome: 'played', modeDetails }]
    }
  };
  const html = matchDetailMarkup(detail, {}, 'U2');
  assert.match(html, /class="page match-detail-page match-detail-page--livonym" data-screen="match-detail" data-mode="livonym"/);
  assert.match(html, /class="livonym-history-hero" data-mode="livonym">\s*<canvas class="livonym-history-hero-canvas" aria-hidden="true"><\/canvas>/);
  assert.doesNotMatch(html, /livonym-history-mode/);
  assert.match(html, /<h1>[\s\S]*class="player-identity result-title-name"[\s\S]*乙[\s\S]*<\/h1>\s*<p class="livonym-history-subtitle">共 1 棒结束<\/p>/);
  assert.match(html, /class="match-fact-mode match-fact-mode--livonym"[\s\S]*?match-fact-mode-badge[\s\S]*?insane-mark--livonym[\s\S]*?class="wm-livonym"[\s\S]*?<strong>即时竞猜<\/strong>/);
  assert.match(html, /class="match-detail-players"[\s\S]*?<strong>乙<\/strong><span>UID：U2<\/span>/);
  assert.doesNotMatch(html, /match-detail-players--livonym/);

  const listHtml = profileMatchMarkup({
    id: 'm-lv-list', roomCode: '12345', mode: 'livonym', outcome: 'played',
    totalRounds: 3, startedAt: 1700000000000, players: ['甲', '乙']
  }, {});
  assert.match(listHtml, /class="profile-match profile-match--livonym" data-mode="livonym"/);
  // 首行只放头像、名字与日期；第二行只显示「共 3 棒」，并把无胶囊的 Livonym 标识放在第三列主题位
  const headingPart = listHtml.match(/class="profile-match-heading">[\s\S]*?<span class="profile-match-meta">/)?.[0] || '';
  const metaPart = listHtml.match(/class="profile-match-meta">[\s\S]*?<span class="profile-match-open">/)?.[0] || '';
  assert.doesNotMatch(headingPart, /profile-match-livonym-tag/);
  assert.match(metaPart, /class="profile-match-outcome"[^>]*>[\s\S]*?<span>共 3 棒<\/span>/);
  assert.doesNotMatch(metaPart, /即时竞猜 ·/);
  assert.match(metaPart, /profile-match-room[\s\S]*?class="profile-match-livonym-tag"[\s\S]*?insane-mark insane-mark--livonym[\s\S]*?class="wm-livonym"/);
  assert.match(styles, /\.profile-match--livonym \{[\s\S]*?margin:\s*8px 0;/);
  const normLinkRule = styles.match(/\.profile-match-link \{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(normLinkRule, /margin-inline:\s*-12px/);
  const livTagRule = styles.match(/\.profile-match-livonym-tag \{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(livTagRule, /border-radius:\s*999px/);
});
