import { chartMarkup } from './chart.js';

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
      <span class="mode-label"><span class="setting-label">模式</span><span class="theme-setting-hint" data-theme-setting-hint ${settings.mode === 'theme' ? '' : 'hidden'}>开始后随机抽取主题。</span></span>
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

export function themeMarkup(room) {
  return room.mode === 'theme' ? `<p class="current-theme"><span>${['result', 'rematch', 'interrupted'].includes(room.phase) ? '本局主题' : '当前主题'}</span><strong>${escapeHtml(room.themeName || '等待抽取')}</strong></p>` : '';
}

export function settingsSummaryText(settings) {
  const modeText = settings.mode === 'theme' ? '主题' : '自由';
  const repeatText = settings.banRepeat ? '禁重复' : '可重复';
  return `${modeText} · ${settings.maxRounds} 轮 · 写 ${settings.writeSeconds}s`;
}

export function shellMarkup(inRoom = false, user = null, renameOpen = false) {
  const name = user?.name || '';
  const uid = user?.uid || '';
  const identity = `${avatarMarkup(name, 'header-avatar')}<span class="header-user-name" id="header-user-name">${escapeHtml(name)}</span>`;
  // 只在首页让名字与头像整块可点进档案；房间里保持纯展示，避免误触打断对局
  const identityBlock = !inRoom
    ? `<button class="header-profile-trigger" type="button" data-action="open-profile" aria-label="查看我的档案" title="查看我的档案">${identity}</button>`
    : identity;
  return `<header class="site-header" id="site-header" data-in-room="${inRoom}">
    ${brandMarkup()}
    <div class="header-actions">
      <div class="header-user ${user ? 'is-visible' : ''}" id="header-user">
        ${identityBlock}
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
          <button class="button secondary" type="button" data-action="cancel-rename"><span>取消</span>${icon('x')}</button>
          <button class="button primary" type="submit"><span>保存</span>${icon('check')}</button>
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
        <button class="button secondary" type="button" data-action="cancel-transfer"><span>取消</span>${icon('x')}</button>
        <button class="button primary" type="button" data-action="confirm-transfer">${icon('user')}<span>转让房主</span></button>
      </div>
    </section>
  </div>
  <div class="rename-modal confirm-modal" id="confirm-modal" inert>
    <button class="rename-modal-backdrop" type="button" data-action="cancel-confirm" aria-label="取消操作"></button>
    <section class="rename-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
      <div class="rename-dialog-heading">
        <h2 id="confirm-title">退出房间？</h2>
        <button class="icon-button" type="button" data-action="cancel-confirm" aria-label="取消操作">${icon('x')}</button>
      </div>
      <p class="transfer-hint" id="confirm-description"></p>
      <div class="rename-dialog-actions">
        <button class="button secondary" type="button" data-action="cancel-confirm"><span>取消</span>${icon('x')}</button>
        <button class="button danger" type="button" data-action="accept-confirm"><span>退出房间</span>${icon('check')}</button>
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
  <main id="stage" class="stage"></main>
  <footer class="site-footer"><a href="/privacy.html">隐私说明</a></footer>`;
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
        <button class="button secondary join-submit" type="submit">${icon('arrow-right')}<span>加入房间</span></button>
      </form>
    </div>
  </div>`;
}

function profileDate(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function profileMatchMarkup(match) {
  const outcome = match.outcome === 'none'
    ? `打满 ${match.totalRounds} 轮未相遇`
    : `第 ${match.convergedRound} 轮${match.outcome === 'voted' ? '投票' : ''}相遇`;
  const details = [`房号 ${match.roomCode}`, match.themeName ? `主题 · ${match.themeName}` : '自由模式',
    match.players.join('、')];
  return `<li class="profile-match">
        <span class="profile-match-outcome" data-outcome="${escapeHtml(match.outcome)}">${escapeHtml(outcome)}</span>
        <span class="profile-match-date">${escapeHtml(profileDate(match.startedAt))}</span>
        <span class="profile-match-meta">${escapeHtml(details.join(' · '))}</span>
      </li>`;
}

// 档案：只展示自己的身份与对局，每页 10 局，可翻完全部记录。
export function profileMarkup(state) {
  const profile = state.profile;
  if (!profile) {
    return `<div class="page profile-page" data-screen="profile"><p class="profile-empty">正在读取档案…</p></div>`;
  }
  const { user } = profile;
  const matches = profile.matches || [];
  const page = profile.page || 1;
  const pages = Math.max(1, Math.ceil((profile.total || 0) / (profile.pageSize || 10)));
  const former = (profile.nameHistory || []).map((item) => item.name).filter((name) => name !== user.name);
  const pager = pages > 1
    ? `<div class="profile-pager">
        <button class="button secondary" type="button" data-action="profile-prev" ${page <= 1 ? 'disabled' : ''}><span>上一页</span></button>
        <span class="profile-page-count">第 ${page} / ${pages} 页</span>
        <button class="button secondary" type="button" data-action="profile-next" ${page >= pages ? 'disabled' : ''}><span>下一页</span></button>
      </div>`
    : '';
  return `<div class="page profile-page" data-screen="profile">
    <section class="surface-block profile-identity">
      ${avatarMarkup(user.name, 'profile-avatar')}
      <div class="profile-identity-text">
        <h1 class="profile-name">${escapeHtml(user.name)}</h1>
        <p class="profile-uid">UID：${escapeHtml(user.uid)}<button class="icon-button profile-uid-copy" type="button" data-action="copy-uid" aria-label="复制 UID" title="复制 UID">${icon('copy')}</button></p>
        <p class="profile-meta">${icon('clock')}<span>加入于 ${escapeHtml(profileDate(user.createdAt))}${former.length ? ` · 曾用名 ${escapeHtml(former.join('、'))}` : ''}</span></p>
      </div>
    </section>
    <section class="surface-block profile-history">
      <div class="section-heading"><h2>${icon('route')}<span>对局记录</span></h2><span class="profile-total">${profile.total || 0} 局</span></div>
      ${matches.length
        ? `<ol class="profile-matches">${matches.map(profileMatchMarkup).join('')}</ol>`
        : '<p class="profile-empty">还没有完成的对局。开一局，回来就能看到。</p>'}
      ${pager}
    </section>
    <p class="profile-privacy">本设备保存随机 UID；服务器保存名字和完成过的对局记录。</p>
    <div class="profile-actions">
      <button class="button secondary" type="button" data-action="home">${icon('arrow-right')}<span>回主页</span></button>
      <button class="button danger" type="button" data-action="reset-identity">${icon('rotate-ccw')}<span>我是新人</span></button>
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
      ? '<span class="ready-state">连接中断 · 等待重连</span>'
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
          ${icon('copy', 'ticket-copy-icon')}
          <span class="ticket-code" id="lobby-room-code">${escapeHtml(room.code)}</span>
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
        : `<button class="button ${me?.ready ? 'secondary' : 'primary'} ready-button" type="button" data-action="ready">${me?.ready ? `<span>取消准备</span>${icon('x')}` : `<span>准备</span>${icon('check')}`}</button>`}
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
  const voted = Boolean((phase === 'breakVote' ? me?.breakVoted : me?.voted) || ui.voted);
  const ready = Boolean(me?.ready || ui.ready);
  const outcome = room.outcome || room.history?.at(-1)?.outcome;
  const pathAvailable = room.round > 2 || (room.round === 2 && phase !== 'writing');
  const pathButton = pathAvailable ? `<button class="path-open" type="button" data-action="open-path">${icon('route')}<span>思考路径</span></button>` : '';
  const stageProgress = [['writing', '写词', 'pen-line'], ['voting', '投票', 'check'], [phase === 'breakVote' ? 'breakVote' : 'prepare', phase === 'breakVote' ? '崩局投票' : '准备', 'play']].map(([step, label, glyph]) => `<span class="stage-step${phase === step ? ' is-current' : ''}"${phase === step ? ' aria-current="step"' : ''}>${icon(glyph)}<span class="stage-step-label">${label}</span></span>`).join('<span class="stage-step-divider" aria-hidden="true">·</span>');
  const title = phase === 'writing' ? '各自写下此刻想到的词' : phase === 'voting' ? '这些词想到一起了吗？' : phase === 'breakVote' ? '继续下一轮，还是结束本局？' : phase === 'prepare' ? '准备好，再靠近一点' : phase === 'result' ? (outcome === 'exact' || outcome === 'voted' ? '我们相遇了' : outcome === 'miss' || outcome === 'failed' ? '这一局结束了' : '对局结束') : '等待下一阶段';
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
    const complete = phase === 'writing' ? (player.submitted || (mine && ui.submitted)) : phase === 'voting' ? (player.voted || (mine && ui.voted)) : phase === 'breakVote' ? (player.breakVoted || (mine && ui.voted)) : (player.ready || (mine && ui.ready));
    const statusKey = player.connected === false ? 'away' : complete ? 'done' : phase === 'writing' && (player.typing || (mine && ui.draft)) ? 'active' : 'waiting';
    const status = statusKey === 'away' ? '连接中断 · 等待重连' : phase === 'writing' ? ({ done: '已提交', active: '正在输入', waiting: '未开始' }[statusKey]) : ['voting', 'breakVote'].includes(phase) ? (complete ? '已投票' : '未投票') : (complete ? '已准备' : '未准备');
    return `<li class="game-status status-${statusKey}"><span class="game-status-name">${avatarMarkup(player.name || '玩家', 'game-status-avatar')}<span>${escapeHtml(player.name || '玩家')}${player.uid === uid ? '（你）' : ''}</span></span><span class="ready-state">${icon({ waiting: 'clock', active: 'pen-line', done: 'check', away: 'log-out' }[statusKey], 'game-status-icon')}<span>${status}</span></span></li>`;
  }).join('');
  return `<div class="page writing-page" data-screen="${escapeHtml(phase)}" data-room="${escapeHtml(room.code || '')}" data-round="${escapeHtml(room.round ?? '')}">
    <section class="writing-stage">
      <div class="stage-meta"><span class="stage-round">第 ${escapeHtml(room.round ?? '–')} / ${escapeHtml(room.maxRounds ?? '–')} 轮</span><nav class="stage-progress" aria-label="对局阶段">${stageProgress}</nav><span class="stage-room">房间 ${escapeHtml(room.code || '–')}</span></div>
      <div class="stage-content">
        <div class="stage-copy">
          <h1>${title}</h1>
          <p>${phase === 'writing' ? '词语会在所有人提交后揭晓' : phase === 'voting' ? '5 秒内同时投票，超时视为否' : phase === 'breakVote' ? '至少半数选择玩崩了，本局结束且不保存记录；未投票视为继续' : phase === 'prepare' ? '全员准备或倒计时结束后进入下一轮' : '感谢一起游玩'}</p>
          ${phase === 'prepare' ? '<p id="prepare-grace-hint" class="prepare-grace-hint" role="status" hidden>有人掉线，多等一会 · 本次准备额外增加 10 秒</p>' : ''}
        </div>
        ${phase !== 'result' ? `<div class="writing-clock" role="timer" aria-live="off">${icon('clock')}<span id="countdown">–</span></div>` : ''}
      </div>
      <div id="current-theme" class="stage-theme">${themeMarkup(room)}</div>
    </section>
    ${phase === 'writing' ? `<div id="previous-words">${previousRound ? `<section class="surface-block"><div class="section-heading"><h2>上一轮的词</h2>${pathButton}</div><ul class="word-grid">${wordCards}</ul></section>` : ''}</div>` : ''}
    ${phase === 'writing' ? `<form id="word-form" class="surface-block game-form"><label for="word-input">你的词</label><input id="word-input" class="input" value="${escapeHtml(ui.draft || '')}" autocomplete="off" spellcheck="false" placeholder="输入 1–12 个汉字、字母或数字" ${submitted ? 'disabled' : ''}><p class="game-hint">可使用空格；超时将提交输入框中的内容</p><button class="button primary" type="submit" ${submitted ? 'disabled' : ''}><span>${submitted ? '已提交，等待其他玩家' : '提交'}</span>${icon('check')}</button></form><section class="surface-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list" id="game-status">${statuses}</ul></section>` : ''}
    ${phase === 'voting' || phase === 'prepare' || phase === 'breakVote' || phase === 'result' ? `<section class="surface-block"><div class="section-heading"><h2>本轮的词</h2>${pathButton}</div><ul class="word-grid">${wordCards}</ul></section>` : ''}
    ${phase === 'voting' ? `<section class="surface-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list">${statuses}</ul></section><div class="game-actions"><button class="button primary" type="button" data-action="vote-yes" ${voted ? 'disabled' : ''}><span>是</span>${icon('check')}</button><button class="button secondary" type="button" data-action="vote-no" ${voted ? 'disabled' : ''}><span>否</span>${icon('x')}</button></div><p class="game-hint game-center">${voted ? '已投票，等待揭晓' : '投票期间不会显示其他人的选择'}</p>` : ''}
    ${phase === 'prepare' ? `<section class="surface-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list">${statuses}</ul></section><button class="button primary game-wide" type="button" data-action="game-ready" ${ready ? 'disabled' : ''}><span>${ready ? '已准备，等待其他玩家' : '准备下一轮'}</span>${icon('check')}</button>` : ''}
    ${phase === 'breakVote' ? `<section class="surface-block"><div class="section-heading"><h2>玩家状态</h2></div><ul class="game-status-list">${statuses}</ul></section><div class="game-actions"><button class="button primary" type="button" data-action="break-no" ${voted ? 'disabled' : ''}>${icon('arrow-right')}<span>下一轮</span></button><button class="button primary" type="button" data-action="break-yes" ${voted ? 'disabled' : ''}><span>玩崩了</span>${icon('x')}</button></div><p class="game-hint game-center">${voted ? '已选择，结果确定或倒计时结束后揭晓' : '选择提交后不可更改；结果确定后提前结束'}</p>` : ''}
    <button class="button secondary game-wide game-leave" type="button" data-action="leave">${icon('log-out')}<span>退出房间</span></button>
  </div>`;
}

const RESULT_LINES = {
  exact: ['这次想到一块了', '答案，终于一致了', '默契刚好对上', '不同的思路，同一个答案', '这一轮，心有灵犀', '这次，答案对上了'],
  voted: ['这份默契，大家认可', '词不同，想法很接近', '这一轮，大家都点头', '换个说法，也是同一种想法'],
  none: ['这局各有各的想法', '答案不同，过程也有意思', '这次还差一点默契', '先把这些灵感留在这里']
};

export function resultTitle(room) {
  if (room.outcome === 'break') return '本局已结束';
  const lines = room.outcome === 'exact' && room.history?.length === 1
    ? ['第一轮就想到一块了', '开局就有默契', '一个词，刚好想到一起']
    : RESULT_LINES[room.outcome] || RESULT_LINES.none;
  const seed = `${room.code}:${JSON.stringify(room.history || [])}`;
  let hash = 0;
  for (const ch of seed) hash = (Math.imul(hash, 31) + ch.codePointAt(0)) >>> 0;
  return lines[hash % lines.length];
}

export function rematchMarkup(state) {
  const { room, uid } = state;
  const voting = ['result', 'rematch'].includes(room.phase) && room.rematchDeadline != null;
  const eligible = room.rematchEligibleUids || [];
  const choices = room.rematchVotes || {};
  const mine = choices[uid];
  const canChoose = !voting || eligible.includes(uid);
  const roomChosen = eligible.some((id) => choices[id] === 'room');
  const resultPlayers = room.resultPlayers || room.players || [];
  const statusPlayers = [...resultPlayers, ...(room.players || []).filter((player) => !resultPlayers.some((item) => item.uid === player.uid))];
  const statuses = statusPlayers.map((snapshot) => {
    const player = (room.players || []).find((item) => item.uid === snapshot.uid);
    const choice = choices[snapshot.uid];
    const left = !player || !eligible.includes(snapshot.uid);
    const away = !left && player.connected === false;
    const label = choice === 'rematch' ? '重赛' : choice === 'room' ? '回房间' : '选择中';
    const statusKey = left || away ? 'away' : choice ? 'done' : 'waiting';
    const status = left ? '已离开' : away ? `连接中断 · 等待重连${choice ? ` · 已选${label}` : ''}` : choice ? `已选${label}` : label;
    const name = player?.name || snapshot.name || snapshot.uid;
    return `<li class="game-status status-${statusKey}"><span class="game-status-name">${avatarMarkup(name, 'game-status-avatar')}<span>${escapeHtml(name)}${snapshot.uid === uid ? '（你）' : ''}</span></span><span class="ready-state">${icon({ waiting: 'clock', done: 'check', away: 'log-out' }[statusKey], 'game-status-icon')}<span>${escapeHtml(status)}</span></span></li>`;
  }).join('');
  return `<section class="surface-block result-rematch" aria-label="下一步"><div class="section-heading"><h2>下一步</h2>${voting ? '<span class="rematch-clock" role="timer" aria-live="off">'+icon('clock')+'<span id="countdown">30 秒</span></span>' : ''}</div>
    <p class="rematch-description">全员重赛，按当前配置直接开下一局；想调整配置就回房间。</p>
    ${voting ? `<div class="result-player-status" aria-live="polite"><div class="section-heading"><h3>玩家状态</h3></div><ul class="game-status-list">${statuses}</ul></div>` : ''}
    <div class="rematch-actions">
      <button class="button primary" type="button" data-action="rematch-yes" ${!canChoose || roomChosen || mine === 'rematch' ? 'disabled' : ''}>${icon('play')}<span>${mine === 'rematch' ? '已选重赛' : '重赛'}</span></button>
      <button class="button secondary" type="button" data-action="rematch-room" ${!canChoose || mine === 'room' ? 'disabled' : ''}>${icon('users')}<span>${mine === 'room' ? '已选回房间' : '回房间'}</span></button>
      <button class="rematch-home" type="button" data-action="leave">${icon('arrow-right')}<span>回主页</span></button>
    </div>
    <p class="rematch-footnote">到期移除未选择或仍断线的玩家；剩余全选重赛且至少 2 人就直接开局，否则回房间。</p></section>`;
}

export function resultMarkup(state) {
  const { room, uid } = state;
  if (room.phase === 'interrupted') return `<div class="page result-page" data-screen="interrupted" data-room="${escapeHtml(room.code)}">
    <section class="result-heading"><div class="result-heading-copy"><p class="result-eyebrow">房间 ${escapeHtml(room.code)}</p><h1>本局已中断</h1><p>房间只剩一位玩家，本局不会记录。</p></div><div id="current-theme">${themeMarkup(room)}</div></section>
    <section class="surface-block result-rematch" aria-label="下一步"><div class="rematch-actions">
      <button class="button primary" type="button" data-action="rematch-room">${icon('users')}<span>回房间</span></button>
      <button class="button secondary" type="button" data-action="leave">${icon('arrow-right')}<span>回主页</span></button>
    </div></section></div>`;
  const players = room.resultPlayers || room.players || [];
  const history = room.history || [];
  const met = room.outcome === 'exact' || room.outcome === 'voted';
  const voting = room.phase === 'rematch';
  const voteRecords = history.map((round) => `<li class="result-vote-round"><h3>第 ${escapeHtml(round.n)} 轮 · ${round.outcome === 'exact' ? '精确相遇（无需投票）' : round.outcome === 'voted' ? '全票通过' : '未通过'}</h3>${round.votes ? `<ul class="result-vote-list">${players.map((p) => `<li><span>${escapeHtml(p.name)}</span><strong>${Object.hasOwn(round.votes, p.uid) ? round.votes[p.uid] ? '同意' : '否 / 超时' : '未参与'}</strong></li>`).join('')}</ul>` : ''}</li>`).join('');
  return `<div class="page result-page" data-screen="${voting ? 'rematch' : 'result'}" data-room="${escapeHtml(room.code)}">
    <section class="result-heading"><div class="result-heading-copy"><p class="result-eyebrow">房间 ${escapeHtml(room.code)} · 本局回顾</p><h1>${escapeHtml(resultTitle(room))}</h1><p>${room.outcome === 'break' ? '崩局投票通过，本局记录不会保存。' : met ? `第 ${escapeHtml(history.at(-1)?.n ?? room.round)} 轮${room.outcome === 'voted' ? '投票达成一致' : '写出同一个词'}` : `走过 ${escapeHtml(history.length)} 轮，留下了这些不同的想法。`}</p></div><div id="current-theme">${themeMarkup(room)}</div></section>
    <div id="result-rematch" class="result-rematch-group">${rematchMarkup(state)}</div>
    <section class="surface-block"><div class="section-heading"><h2>收敛曲线</h2><button class="path-open" type="button" data-action="export-chart">导出 SVG</button></div><div class="result-chart-scroll">${chartMarkup(room)}</div><ul class="result-legend">${players.map((p) => `<li style="--player:var(--player-${p.seat})"><i></i>${escapeHtml(p.name)}</li>`).join('')}</ul><p class="game-hint">词簇估计仅供回顾，不参与胜负判定。空心点及虚线表示无法计算，不代表 0%；投票相遇以终点标识为准。多人局使用所有玩家两两相似度的平均值。</p></section>
    <section class="surface-block"><div class="section-heading"><h2>完整词路径</h2></div>${thoughtPathMarkup({ ...room, players })}</section>
    <details class="surface-block result-votes"><summary>投票记录<span>按需查看每轮选择</span></summary><ol class="result-vote-records">${voteRecords}</ol></details>
  </div>`;
}
