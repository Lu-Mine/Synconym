import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  livonymMarkup, livonymResultMarkup, livonymRoundReason, livonymRoundMax, stageProgressMarkup, matchDetailMarkup, lobbyMarkup,
  profileMatchMarkup, canStartRoom, roomPlayerLimits, resultTitle
} from '../../public/render.js';
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
  // 金银铜变量与前三名规则，122 与 123 共用
  for (const medal of ['gold', 'silver', 'bronze']) assert.match(styles, new RegExp(`--medal-${medal}: #`));
  assert.match(styles, /:is\(\.livonym-guessed-item, \.livonym-score-row\)\.is-first \{ --medal: var\(--medal-gold\); \}/);
  assert.match(styles, /:is\(\.livonym-guessed-item, \.livonym-score-row\)\.is-third \{ --medal: var\(--medal-bronze\); \}/);
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
  assert.match(html, /竞猜王 · <span class="player-identity livonym-badge-name">[\s\S]*?player-identity-name">乙/);
  assert.match(html, /最佳描述 · <span class="player-identity livonym-badge-name">[\s\S]*?player-identity-name">甲/);
  assert.match(html, /神猜 · <span class="player-identity livonym-badge-name">[\s\S]*?player-identity-name">乙/);
  assert.match(html, /逐棒回顾/);
  // 总分榜与回顾页的每一行都先给头像；秘密词改由共用卡片显示
  assert.match(html, /livonym-result-row[\s\S]*?player-identity-avatar/);
  assert.match(html, /本轮秘密词[\s\S]*?class="livonym-secret">高压锅/);
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
  for (const page of pages) assert.doesNotMatch(page, /readonly-tag|livonym-score-block|本轮结算|人猜中/);
  assert.match(pages[0], /本轮秘密词[\s\S]*?class="livonym-secret">高压锅/);
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
