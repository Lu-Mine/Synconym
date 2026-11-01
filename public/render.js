export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function avatarDetails(name) {
  const normalizedName = String(name || '').trim();
  const initial = [...normalizedName][0] || '?';
  let hash = 2166136261;
  for (const char of normalizedName) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  return { initial, tone: hash >>> 0 & 3 };
}

export function avatarMarkup(name, className = '') {
  const { tone } = avatarDetails(name);
  return `<img class="avatar ${className}" data-avatar-name="${escapeHtml(name)}" data-avatar-tone="${tone}" alt="" aria-hidden="true">`;
}

export function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="/icons.svg#icon-${name}"></use></svg>`;
}

export function brandMarkup() {
  return `<a class="brand" href="/" data-action="home" aria-label="返回近意词 Synconym 主页"><span class="brand-mark" aria-hidden="true"><span class="orb orb-a"></span><span class="orb orb-b"></span></span><span class="brand-cn"><span class="brand-wing-l">近</span><span class="brand-accent brand-yi">意</span><span class="brand-wing-r">词</span></span><span class="brand-en">Syn<span class="brand-accent brand-c">c</span>onym</span></a>`;
}

export function segmented(name, value, options, disabled = false) {
  const index = Math.max(0, options.findIndex((option) => String(option.value) === String(value)));
  return `<div class="segmented" role="group" data-segmented="${name}" style="--selected:${index};--count:${options.length}">${options.map((option) => {
    const isSelected = String(option.value) === String(value);
    return `<button class="segment ${isSelected ? 'selected' : ''}" type="button" data-setting="${name}" data-value="${option.value}" aria-pressed="${isSelected}" ${disabled ? 'disabled' : ''}>${option.label}</button>`;
  }).join('')}</div>`;
}

const SETTING_VALUE_TEXT = {
  mode: (settings) => (settings.mode === 'theme' ? '主题' : '自由'),
  maxRounds: (settings) => `${settings.maxRounds} 轮`,
  writeSeconds: (settings) => `${settings.writeSeconds} 秒`,
  prepareSeconds: (settings) => `${settings.prepareSeconds} 秒`,
  banRepeat: (settings) => (settings.banRepeat ? '开启' : '关闭')
};

const DURATIONS = [15, 30, 45, 60];
const SETTING_LEVEL = {
  maxRounds: (settings) => Math.min(3, Math.floor((settings.maxRounds - 4) / 4)),
  writeSeconds: (settings) => Math.max(0, DURATIONS.indexOf(settings.writeSeconds)),
  prepareSeconds: (settings) => Math.max(0, DURATIONS.indexOf(settings.prepareSeconds))
};

export function settingValueText(name, settings) {
  return SETTING_VALUE_TEXT[name](settings);
}

// 四档强度条：点亮到当前档位，与分段选择器的四档一一对应
function levelMeterMarkup(level) {
  return `<span class="level-meter" aria-hidden="true">${Array.from({ length: DURATIONS.length }, (_, index) => (index <= level ? '<i class="is-on"></i>' : '<i></i>')).join('')}</span>`;
}

export function settingValueMarkup(name, settings, control) {
  const level = SETTING_LEVEL[name] ? Math.max(0, SETTING_LEVEL[name](settings)) : -1;
  const state = name === 'banRepeat' ? (settings.banRepeat ? ' is-on' : ' is-off') : '';
  return `<span class="setting-value${state}" data-setting-value="${name}" data-control="${control}">`
    + (name === 'banRepeat' ? icon(settings.banRepeat ? 'check' : 'x', 'setting-value-icon') : '')
    + (level >= 0 ? levelMeterMarkup(level) : '')
    + `<span class="setting-value-text">${escapeHtml(settingValueText(name, settings))}</span>`
    + '</span>';
}

export function settingsMarkup(settings, editable) {
  // 只读时用纯文本取值替换控件，data-control 记录被替换控件的类型以对齐行高
  const control = (name, type, markup) => (editable ? markup : settingValueMarkup(name, settings, type));
  return `<section class="settings" data-editable="${editable}" aria-label="房间设置">
    <div class="setting-row">
      <span class="setting-label">模式</span>
      ${control('mode', 'segmented', segmented('mode', settings.mode, [{ value: 'free', label: '自由' }, { value: 'theme', label: '主题' }]))}
    </div>
    <div class="setting-row">
      ${editable ? '<label class="setting-label" for="rounds">轮次上限</label>' : '<span class="setting-label">轮次上限</span>'}
      ${control('maxRounds', 'stepper', `<div class="stepper" role="group" aria-label="轮次上限">
        <button class="stepper-btn" type="button" data-step="-1" aria-label="减少轮次" ${settings.maxRounds <= 4 ? 'disabled' : ''}>${icon('minus')}</button>
        <output id="rounds" class="stepper-value" data-value="${settings.maxRounds}">${settings.maxRounds}</output>
        <button class="stepper-btn" type="button" data-step="1" aria-label="增加轮次" ${settings.maxRounds >= 20 ? 'disabled' : ''}>${icon('plus')}</button>
      </div>`)}
    </div>
    <div class="setting-row">
      <span class="setting-label">写词时限</span>
      ${control('writeSeconds', 'segmented', segmented('writeSeconds', settings.writeSeconds, [15, 30, 45, 60].map((value) => ({ value, label: `${value} 秒` }))))}
    </div>
    <div class="setting-row">
      <span class="setting-label">准备时限</span>
      ${control('prepareSeconds', 'segmented', segmented('prepareSeconds', settings.prepareSeconds, [15, 30, 45, 60].map((value) => ({ value, label: `${value} 秒` }))))}
    </div>
    <div class="setting-row">
      ${editable ? '<label class="setting-label" for="banRepeat">禁止重复词</label>' : '<span class="setting-label">禁止重复词</span>'}
      ${control('banRepeat', 'switch', `<button id="banRepeat" class="switch" type="button" role="switch" aria-checked="${Boolean(settings.banRepeat)}" data-setting="banRepeat" aria-label="禁止重复词"><span class="switch-thumb"></span></button>`)}
    </div>
  </section>`;
}

export function settingsSummaryText(settings) {
  const modeText = settings.mode === 'theme' ? '主题' : '自由';
  const repeatText = settings.banRepeat ? '禁重复' : '可重复';
  return `${modeText} · ${settings.maxRounds} 轮 · 写 ${settings.writeSeconds}s`;
}

export function shellMarkup(inRoom = false, user = null, renameOpen = false) {
  const name = user?.name || '';
  const uid = user?.uid || '';
  return `<header class="site-header" id="site-header">
    ${brandMarkup()}
    <div class="header-actions">
      <div class="header-user ${user ? 'is-visible' : ''}" id="header-user">
        ${avatarMarkup(name, 'header-avatar')}
        <span class="header-user-name" id="header-user-name">${escapeHtml(name)}</span>
        <button class="icon-button header-rename-trigger" type="button" data-action="rename" aria-label="修改名字" title="修改名字">${icon('pen-line')}<span class="header-rename-label">改名</span></button>
      </div>
    </div>
  </header>
  <div class="rename-modal ${renameOpen ? 'is-open' : ''}" id="rename-modal" ${renameOpen ? '' : 'inert'}>
    <button class="rename-modal-backdrop" type="button" data-action="cancel-rename" aria-label="关闭修改名字窗口"></button>
    <section class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
      <div class="rename-dialog-heading">
        <h2 id="rename-title">修改名字</h2>
        <button class="icon-button" type="button" data-action="cancel-rename" aria-label="关闭">${icon('x')}</button>
      </div>
      <form id="rename-form" class="rename-form">
        <label for="player-name">名字</label>
        <input id="player-name" class="input" maxlength="12" placeholder="输入新名字（最多 12 字）" required value="${escapeHtml(name)}">
        <p class="rename-uid" id="rename-uid">UID：${escapeHtml(uid)}</p>
        <div class="rename-dialog-actions">
          <button class="button secondary" type="button" data-action="cancel-rename">取消</button>
          <button class="button primary" type="submit">保存</button>
        </div>
      </form>
    </section>
  </div>
  <div class="rename-modal transfer-modal" id="transfer-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="cancel-transfer" aria-label="取消转让房主"></button>
    <section class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
      <div class="rename-dialog-heading">
        <h2 id="transfer-title">转让房主</h2>
        <button class="icon-button" type="button" data-action="cancel-transfer" aria-label="取消">${icon('x')}</button>
      </div>
      <p class="transfer-hint">把房主转给 <strong id="transfer-target-name"></strong> 后，你会变成普通玩家，需要准备后才能开始。</p>
      <div class="rename-dialog-actions">
        <button class="button secondary" type="button" data-action="cancel-transfer">取消</button>
        <button class="button primary" type="button" data-action="confirm-transfer">转让房主</button>
      </div>
    </section>
  </div>
  <div class="rename-modal path-modal" id="path-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="close-path" aria-label="关闭思考路径"></button>
    <section class="rename-dialog path-dialog" role="dialog" aria-modal="true" aria-labelledby="path-title">
      <div class="rename-dialog-heading"><h2 id="path-title">${icon('route')}<span>思考路径</span></h2><button class="icon-button" type="button" data-action="close-path" aria-label="关闭思考路径">${icon('x')}</button></div>
      <div id="path-content"></div>
    </section>
  </div>
  <div id="stage" class="stage"></div>`;
}

export function homeMarkup(settings, settingsOpen = false) {
  return `<div class="page home-page" data-screen="home">
    <section class="intro">
      <div class="intro-main">
        <span class="intro-orbits" aria-hidden="true"><span class="intro-orb intro-orb-a"></span><span class="intro-orb intro-orb-b"></span></span>
        <h1>各自想一个，<br>直到想到一起。</h1>
      </div>
      <p>两个词之间，藏着我们想到的同一个东西。</p>
    </section>

    <div class="entry-deck">
      <form id="create-form" class="create-card">
        <button class="button primary create-submit" type="submit">
          <span class="create-submit-label"><span>创建房间</span>${icon('arrow-right', 'create-submit-arrow')}</span>
        </button>
        <div class="drawer-shell ${settingsOpen ? 'is-open' : ''}" id="home-settings-drawer">
          <button class="drawer-trigger" type="button" data-action="toggle-settings" aria-expanded="${settingsOpen}" aria-controls="home-settings-panel">
            <span class="drawer-trigger-title">${icon('sliders-horizontal')}<span>房间设置</span></span>
            <span class="drawer-summary" id="settings-summary">${escapeHtml(settingsSummaryText(settings))}</span>
          </button>
        </div>
        <div class="drawer-grid ${settingsOpen ? 'is-open' : ''}" id="home-settings-panel" ${settingsOpen ? '' : 'inert'}>
          <div class="drawer-inner">
            ${settingsMarkup(settings, true)}
          </div>
        </div>
      </form>

      <div class="entry-divider" role="separator"><span>或者加入朋友的房间</span></div>

      <form id="join-form" class="join-form">
        <label class="sr-only" for="room-code">5 位数字房号</label>
        <input id="room-code" name="code" class="input code-input" type="text" inputmode="numeric" pattern="[0-9]{5}" placeholder="输入 5 位房号" maxlength="5" autocomplete="off" spellcheck="false" required>
        <button class="button secondary join-submit" type="submit">加入房间</button>
      </form>
    </div>
  </div>`;
}

export function playerItemMarkup(player, room, uid) {
  const isMe = player.uid === uid;
  const isHost = player.uid === room.hostUid;
  const isReady = !isHost && player.ready;
  const statusKey = !player.connected ? 'away' : isHost ? 'host' : isReady ? 'done' : 'waiting';
  const canTransfer = room.phase === 'lobby' && room.hostUid === uid && !isHost && player.connected;
  return `<li class="player status-${statusKey} ${isHost ? 'is-host' : ''} ${isReady ? 'is-ready' : ''} ${isMe ? 'is-me' : ''} ${canTransfer ? 'is-transferable' : ''}" data-uid="${escapeHtml(player.uid)}"${canTransfer
    ? ` data-action="transfer-host" tabindex="0" role="button" title="点击把房主转给 ${escapeHtml(player.name)}"`
    : ''} style="--player:var(--player-${player.seat})">
    ${avatarMarkup(player.name)}
    <div class="player-meta">
      <div class="player-name-row">
        <span class="player-name">${escapeHtml(player.name)}</span>
        ${isMe ? `<button class="icon-button rename-trigger" type="button" data-action="rename" aria-label="修改名字" title="修改名字">${icon('pen-line')}</button>` : ''}
        ${isMe ? '<span class="badge me-label">你</span>' : ''}
      </div>
    </div>
    ${!player.connected
      ? '<span class="ready-state">暂时离开</span>'
      : isHost ? '<span class="ready-state"><span>房主</span></span>'
      : `<span class="ready-state">${isReady ? `${icon('check')}<span>已准备</span>` : '<span>未准备</span>'}</span>`}
  </li>`;
}

export function settingsBlockMarkup(room, host) {
  return `<section class="surface-block settings-block">
    <div class="section-heading">
      <h2>${icon('sliders-horizontal')}<span>房间设置</span></h2>
      ${!host ? '<span class="readonly-tag">房主可改</span>' : ''}
    </div>
    ${settingsMarkup(room, host)}
  </section>`;
}

export function lobbyMarkup(state) {
  const { room, uid } = state;
  const me = room.players.find((player) => player.uid === uid);
  const host = room.hostUid === uid;
  const canStart = host && room.players.length >= 2 && room.players
    .filter((player) => player.uid !== room.hostUid)
    .every((player) => player.ready && player.connected);
  return `<div class="page lobby-page" data-screen="lobby" data-room="${escapeHtml(room.code)}">
    <section class="room-banner">
      <div class="room-heading-copy">
        <div class="room-heading-row">
          <h1>等待大家准备</h1>
          <div class="idle-clock" role="timer" aria-live="off" title="房间空闲 5 分钟后自动关闭">
            ${icon('clock')}
            <span id="idle-countdown"></span>
          </div>
        </div>
        <p>邀请朋友，准备好后由房主开始。</p>
      </div>
      <button class="room-code-ticket" type="button" data-action="copy" aria-label="复制邀请链接" title="复制邀请链接">
        <span class="ticket-caption">房间号</span>
        <span class="ticket-code-row">
          <span class="ticket-code" id="lobby-room-code">${escapeHtml(room.code)}</span>
          ${icon('copy', 'ticket-copy-icon')}
        </span>
      </button>
    </section>

    <section class="surface-block players-block" aria-label="房间玩家">
      <div class="section-heading">
        <h2>${icon('users')}<span>玩家</span></h2>
        <span class="player-count" id="player-count">${room.players.length} / 4</span>
      </div>
      <ul class="player-list" id="player-list">
        ${room.players.map((player) => playerItemMarkup(player, room, uid)).join('')}
      </ul>
    </section>

    ${settingsBlockMarkup(room, host)}

    <div class="lobby-actions" id="lobby-actions">
      ${host
        ? `<button class="button primary start-button" type="button" data-action="start" ${canStart ? '' : 'disabled'}>${icon('play')}<span>开始</span></button>`
        : `<button class="button ${me?.ready ? 'secondary' : 'primary'} ready-button" type="button" data-action="ready">${me?.ready ? `${icon('x')}<span>取消准备</span>` : `${icon('check')}<span>准备</span>`}</button>`}
      <button class="button secondary lobby-leave-button" type="button" data-action="leave">${icon('log-out')}<span>退出</span></button>
    </div>
  </div>`;
}

export function thoughtPathMarkup(room) {
  const players = Array.isArray(room?.players) ? room.players : [];
  const rounds = Array.isArray(room?.history) ? [...room.history] : [];
  if (room?.phase === 'voting' && room.words && !rounds.some((round) => round.n === room.round)) {
    rounds.push({ n: room.round, words: room.words, marks: room.marks || {} });
  }
  if (!rounds.length) return '<p class="path-empty">还没有揭晓的词，完成第一轮后就能看到思考路径。</p>';
  return `<p class="path-hint">按轮次查看每位玩家已揭晓的词</p><ol class="path-rounds">${rounds.map((round, index) => {
    const cards = players.map((player) => {
      const mark = round.marks?.[player.uid];
      const word = mark === 'empty' ? '[未提交]' : mark === 'invalid' ? '[非法答案]' : round.words?.[player.uid] || '[未参与]';
      const seat = Number.isInteger(player.seat) && player.seat >= 0 && player.seat < 4 ? player.seat : 0;
      return `<li class="path-answer" style="--player:var(--player-${seat})"><div class="path-player-heading">${avatarMarkup(player.name || '玩家', 'path-avatar')}<span class="path-name">${escapeHtml(player.name || '玩家')}</span></div><strong class="path-word">${escapeHtml(word)}</strong></li>`;
    }).join('');
    return `<li class="path-round-item">${index ? `<div class="path-connector" aria-hidden="true">${icon('arrow-down')}</div>` : ''}<section class="path-round-group"><h3>第 ${escapeHtml(round.n)} 轮</h3><ul class="path-answers" data-player-count="${Math.min(players.length, 4)}">${cards}</ul></section></li>`;
  }).join('')}</ol>`;
}

export function writingMarkup(state, ui = {}) {
  const { room, uid } = state;
  const players = Array.isArray(room.players) ? room.players : [];
  const me = players.find((player) => player.uid === uid);
  const phase = room.phase;
  const submitted = Boolean(me?.submitted || ui.submitted);
  const voted = Boolean(me?.voted || ui.voted);
  const ready = Boolean(me?.ready || ui.ready);
  const outcome = room.outcome || room.history?.at(-1)?.outcome;
  const pathButton = `<button class="path-open" type="button" data-action="open-path">${icon('route')}<span>思考路径</span></button>`;
  const stageProgress = [['writing', '写词', 'pen-line'], ['voting', '投票', 'check'], ['prepare', '准备', 'play']].map(([step, label, glyph]) => `<span class="stage-step${phase === step ? ' is-current' : ''}"${phase === step ? ' aria-current="step"' : ''}>${icon(glyph)}<span class="stage-step-label">${label}</span></span>`).join('<span class="stage-step-divider" aria-hidden="true">·</span>');
  const title = phase === 'writing' ? '各自写下此刻想到的词' : phase === 'voting' ? '这些词想到一起了吗？' : phase === 'prepare' ? '准备好，再靠近一点' : phase === 'result' ? (outcome === 'exact' || outcome === 'voted' ? '我们相遇了' : outcome === 'miss' || outcome === 'failed' ? '这一局结束了' : '对局结束') : '等待下一阶段';
  const previousRound = phase === 'writing' && Array.isArray(room.history) ? room.history.find((record) => record.n === room.round - 1) : null;
  const words = phase === 'writing' ? previousRound?.words || {} : room.words || room.history?.at(-1)?.words || {};
  const marks = phase === 'writing' ? previousRound?.marks || {} : room.marks || room.history?.at(-1)?.marks || {};
  const keys = phase === 'writing' ? previousRound?.wordKeys : room.wordKeys || room.history?.at(-1)?.wordKeys;
  const validKeys = players.map((player) => {
    const word = words[player.uid];
    if (marks[player.uid] === 'empty' || marks[player.uid] === 'invalid' || typeof word !== 'string' || !word) return null;
    return keys?.[player.uid] ?? word.normalize('NFC').replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0)).replace(/\s/gu, '').toLowerCase();
  });
  const counts = new Map();
  for (const key of validKeys) if (key) counts.set(key, (counts.get(key) || 0) + 1);
  const allMatch = players.length > 1 && validKeys.every((key) => key && key === validKeys[0]);
  const wordCards = players.map((player, index) => {
    const mark = marks[player.uid];
    const value = mark === 'invalid' ? '[非法答案]' : mark === 'empty' ? '[未提交]' : (typeof words[player.uid] === 'string' && words[player.uid] ? words[player.uid] : '[未提交]');
    const duplicate = !allMatch && validKeys[index] && counts.get(validKeys[index]) > 1;
    return `<li class="word-card previous-word-card" style="--player:var(--player-${Number.isInteger(player.seat) && player.seat >= 0 && player.seat < 4 ? player.seat : 0})"><div class="previous-word-player">${avatarMarkup(player.name || '玩家', 'previous-word-avatar')}<span>${escapeHtml(player.name || '玩家')}</span></div><strong${duplicate ? ' class="word-duplicate"' : ''}>${escapeHtml(value)}</strong></li>`;
  }).join('');
  const statuses = players.map((player) => {
    const mine = player.uid === uid;
    const complete = phase === 'writing' ? (player.submitted || (mine && ui.submitted)) : phase === 'voting' ? (player.voted || (mine && ui.voted)) : (player.ready || (mine && ui.ready));
    const statusKey = player.connected === false ? 'away' : complete ? 'done' : phase === 'writing' && (player.typing || (mine && ui.draft)) ? 'active' : 'waiting';
    const status = statusKey === 'away' ? '暂时离开' : phase === 'writing' ? ({ done: '已提交', active: '正在输入', waiting: '未开始' }[statusKey]) : phase === 'voting' ? (complete ? '已投票' : '未投票') : (complete ? '已准备' : '未准备');
    return `<li class="game-status status-${statusKey}"><span class="game-status-name">${avatarMarkup(player.name || '玩家', 'game-status-avatar')}<span>${escapeHtml(player.name || '玩家')}${player.uid === uid ? '（你）' : ''}</span></span><span class="ready-state">${icon({ waiting: 'clock', active: 'pen-line', done: 'check', away: 'log-out' }[statusKey], 'game-status-icon')}<span>${status}</span></span></li>`;
  }).join('');
  return `<div class="page writing-page" data-screen="${escapeHtml(phase)}" data-room="${escapeHtml(room.code || '')}">
    <section class="writing-stage">
      <div class="stage-meta"><span class="stage-round">第 ${escapeHtml(room.round ?? '–')} / ${escapeHtml(room.maxRounds ?? '–')} 轮</span><nav class="stage-progress" aria-label="对局阶段">${stageProgress}</nav><span class="stage-room">房间 ${escapeHtml(room.code || '–')}</span></div>
      <div class="stage-content">
        <div class="stage-copy">
          <h1>${title}</h1>
          <p>${phase === 'writing' ? '词语会在所有人提交后揭晓' : phase === 'voting' ? '5 秒内同时投票，超时视为否' : phase === 'prepare' ? '全员准备或倒计时结束后进入下一轮' : '感谢一起游玩'}</p>
        </div>
        ${phase !== 'result' ? `<div class="writing-clock" role="timer" aria-live="off">${icon('clock')}<span id="countdown">–</span></div>` : ''}
      </div>
    </section>
    ${phase === 'writing' ? `<div id="previous-words">${previousRound ? `<section class="surface-block"><div class="section-heading"><h2>上一轮的词</h2>${pathButton}</div><ul class="word-grid">${wordCards}</ul></section>` : ''}</div>` : ''}
    ${phase === 'writing' ? `<form id="word-form" class="surface-block game-form"><label for="word-input">你的词</label><input id="word-input" class="input" value="${escapeHtml(ui.draft || '')}" autocomplete="off" spellcheck="false" placeholder="输入 1–12 个汉字、字母或数字" ${submitted ? 'disabled' : ''}><p class="game-hint">可使用空格；超时将提交输入框中的内容</p><button class="button primary" type="submit" ${submitted ? 'disabled' : ''}>${submitted ? '已提交，等待其他玩家' : '提交'}</button></form><section class="surface-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list" id="game-status">${statuses}</ul></section>` : ''}
    ${phase === 'voting' || phase === 'prepare' || phase === 'result' ? `<section class="surface-block"><div class="section-heading"><h2>本轮的词</h2>${pathButton}</div><ul class="word-grid">${wordCards}</ul></section>` : ''}
    ${phase === 'voting' ? `<section class="surface-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list">${statuses}</ul></section><div class="game-actions"><button class="button primary" type="button" data-action="vote-yes" ${voted ? 'disabled' : ''}>是</button><button class="button secondary" type="button" data-action="vote-no" ${voted ? 'disabled' : ''}>否</button></div><p class="game-hint game-center">${voted ? '已投票，等待揭晓' : '投票期间不会显示其他人的选择'}</p>` : ''}
    ${phase === 'prepare' ? `<section class="surface-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list">${statuses}</ul></section><button class="button primary game-wide" type="button" data-action="game-ready" ${ready ? 'disabled' : ''}>${ready ? '已准备，等待其他玩家' : '准备下一轮'}</button>` : ''}
    <button class="button secondary game-wide game-leave" type="button" data-action="leave">${icon('log-out')}<span>退出房间</span></button>
  </div>`;
}
